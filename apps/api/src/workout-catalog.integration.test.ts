import { afterAll, beforeAll, describe, expect, it } from "vitest";
import jwt from "jsonwebtoken";
import request from "supertest";

describe.skipIf(!process.env.DATABASE_URL)("opt-in workout catalogue", () => {
  const suffix = `catalog-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const secret = "catalog-integration-test-secret-32-characters";
  let api: typeof import("./server.js");
  let uid: string, token: string, otherToken: string, templateId: string, sessionId: string;
  const baseId = `${suffix}-base`, extraId = `${suffix}-extra`, archivedId = `${suffix}-archived`;
  const call = (path: string, auth = token) => request(api.app).post(path).set("Authorization", `Bearer ${auth}`);
  beforeAll(async () => {
    process.env.NODE_ENV = "test"; process.env.JWT_SECRET = secret;
    process.env.UPLOAD_DIR = `/tmp/kir-fit-catalog-test-${suffix}`;
    process.env.OPENAI_API_KEY = "";
    api = await import("./server.js");
    const user = await api.prisma.user.create({ data: { username: suffix, displayName: "Catalogue test" } });
    uid = user.id; token = jwt.sign({ sub: uid }, secret); otherToken = jwt.sign({ sub: `other-${suffix}` }, secret);
    for (const id of [baseId, extraId, archivedId]) await api.prisma.exercise.create({ data: {
      id, nameEn: id, nameDe: id, description: "Test equipment", instructions: "Controlled motion",
      targetMuscles: [], equipmentType: "machine", exerciseType: "isolation", defaultSets: 2,
      minReps: 8, maxReps: 12, defaultRestSeconds: 90, defaultIncrement: 2.5, archived: id === archivedId,
    } });
    const program = await api.prisma.workoutProgram.create({ data: { userId: uid, name: suffix, preferredWeekdays: [1] } });
    const template = await api.prisma.workoutTemplate.create({ data: { programId: program.id, name: suffix,
      exercises: { create: { exerciseId: baseId, sortOrder: 1, sets: 2, minReps: 8, maxReps: 12, restSeconds: 90, increment: 2.5 } },
    } });
    templateId = template.id;
    const start = await call("/api/workouts/start").send({ templateId, clientMutationId: crypto.randomUUID() });
    expect(start.status).toBe(201); sessionId = start.body.id;
    expect(start.body.exercises.map((e: any) => e.exercise.id)).toEqual([baseId]);
  });
  afterAll(async () => {
    if (!uid) return;
    await api.prisma.workoutSession.deleteMany({ where: { userId: uid } });
    await api.prisma.workoutTemplateExercise.deleteMany({ where: { template: { program: { userId: uid } } } });
    await api.prisma.workoutTemplate.deleteMany({ where: { program: { userId: uid } } });
    await api.prisma.workoutProgram.deleteMany({ where: { userId: uid } });
    await api.prisma.exercise.deleteMany({ where: { id: { in: [baseId, extraId, archivedId] } } });
    await api.prisma.user.delete({ where: { id: uid } }); await api.prisma.$disconnect();
  });
  it("rejects foreign sessions, archived equipment and unknown models", async () => {
    expect((await call(`/api/workouts/${sessionId}/exercises`, otherToken).send({ exerciseId: extraId })).status).toBe(404);
    expect((await call(`/api/workouts/${sessionId}/exercises`).send({ exerciseId: archivedId })).status).toBe(404);
    expect((await call(`/api/workouts/${sessionId}/exercises`).send({ exerciseId: "missing" })).status).toBe(404);
  });
  it("serializes concurrent additions and retries without modifying the template", async () => {
    const results = await Promise.all(Array.from({ length: 3 }, () => call(`/api/workouts/${sessionId}/exercises`).send({ exerciseId: extraId })));
    for (const result of results) {
      expect(result.status).toBe(200); expect(result.body.exercises).toHaveLength(2);
      expect(result.body.exercises.map((e: any) => e.exercise.id)).toEqual([baseId, extraId]);
    }
    expect(await api.prisma.workoutTemplateExercise.count({ where: { templateId } })).toBe(1);
  });
  it("logs sets and changes settings for an ad-hoc machine without adding a template row", async () => {
    const exercise = await api.prisma.workoutExercise.findFirstOrThrow({ where: { sessionId, exerciseId: extraId } });
    const settings = await request(api.app).patch(`/api/workouts/${sessionId}/exercises/${exercise.id}/settings`)
      .set("Authorization", `Bearer ${token}`).send({ plannedSets: 3, restSeconds: 120, increment: 5, measurementUnit: "kg", customName: "Extra machine", notes: "Seat 3" });
    expect(settings.status).toBe(200);
    const saved = await call(`/api/workouts/${sessionId}/sets`).send({ workoutExerciseId: exercise.id, setNumber: 1, weight: 20, reps: 10, clientMutationId: crypto.randomUUID() });
    expect(saved.status).toBe(201);
    expect(await api.prisma.workoutTemplateExercise.count({ where: { templateId } })).toBe(1);
    expect((await call(`/api/workouts/${sessionId}/finish`).send({})).status).toBe(200);
    const next = await call("/api/workouts/start").send({ templateId, clientMutationId: crypto.randomUUID() });
    expect(next.status).toBe(201); expect(next.body.exercises.map((e: any) => e.exercise.id)).toEqual([baseId]);
    expect((await call(`/api/workouts/${sessionId}/exercises`).send({ exerciseId: extraId })).status).toBe(404);
  });
  it("removes only owned active-session snapshots and their sets, leaving templates intact", async () => {
    const active = await api.prisma.workoutSession.findFirstOrThrow({ where: { userId: uid, status: "active" }, include: { exercises: true } });
    const target = active.exercises[0];
    const remove = (sid: string, eid: string, auth = token) => request(api.app).delete(`/api/workouts/${sid}/exercises/${eid}`).set("Authorization", `Bearer ${auth}`);
    expect((await remove(active.id, target.id, otherToken)).status).toBe(404);
    expect((await remove(sessionId, target.id)).status).toBe(404);
    expect((await remove(active.id, "missing")).status).toBe(200);
    await call(`/api/workouts/${active.id}/sets`).send({ workoutExerciseId: target.id, setNumber: 1, weight: 30, reps: 8, clientMutationId: crypto.randomUUID() });
    const removed = await remove(active.id, target.id);
    expect(removed.status).toBe(200);
    expect(removed.body.exercises).toEqual([]);
    expect(await api.prisma.workoutSet.count({ where: { workoutExerciseId: target.id } })).toBe(0);
    expect(await api.prisma.workoutTemplateExercise.count({ where: { templateId } })).toBe(1);
    const retried = await remove(active.id, target.id);
    expect(retried.status).toBe(200);
    expect(retried.body.exercises).toEqual(removed.body.exercises);
    expect((await call(`/api/workouts/${active.id}/finish`).send({})).status).toBe(200);
    const next = await call("/api/workouts/start").send({ templateId, clientMutationId: crypto.randomUUID() });
    expect(next.body.exercises.map((e: any) => e.exercise.id)).toEqual([baseId]);
    // The earlier completed ad-hoc machine and its recorded set remain intact.
    expect(await api.prisma.workoutExercise.count({ where: { sessionId, exerciseId: extraId } })).toBe(1);
  });
  it("lists only personally logged completed-session machines, retaining archived history", async () => {
    await api.prisma.exercise.update({ where: { id: extraId }, data: { archived: true } });
    const result = await request(api.app).get("/api/exercises/history").set("Authorization", `Bearer ${token}`);
    expect(result.status).toBe(200);
    expect(result.body.map((item: any) => item.id)).toEqual([extraId]);
    const other = await request(api.app).get("/api/exercises/history").set("Authorization", `Bearer ${otherToken}`);
    expect(other.status).toBe(200); expect(other.body).toEqual([]);
    const progress = await request(api.app).get(`/api/exercises/${extraId}/progress`).set("Authorization", `Bearer ${token}`);
    expect(progress.body.history).toHaveLength(1);
    expect(progress.body.history[0].weight).toBe(20);
  });

});
