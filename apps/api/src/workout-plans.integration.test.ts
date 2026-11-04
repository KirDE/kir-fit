import { afterAll, beforeAll, describe, expect, it } from "vitest";
import jwt from "jsonwebtoken";
import request from "supertest";

describe.skipIf(!process.env.DATABASE_URL)("named workout plans and schedule", () => {
  const prefix = `plans-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const secret = "named-plan-test-secret-at-least-32-characters";
  let api: typeof import("./server.js");
  let uid: string, otherUid: string, token: string, defaultId: string, foreignId: string, planId: string, sessionId: string;
  const machineIds = [`${prefix}-a`, `${prefix}-b`];
  const entry = (exerciseId: string, sets = 3) => ({ exerciseId, sets, minReps: 8, maxReps: 12, restSeconds: 90, increment: 2.5, measurementUnit: "kg" });
  const post = (url: string) => request(api.app).post(url).set("Authorization", `Bearer ${token}`);
  const patch = (url: string) => request(api.app).patch(url).set("Authorization", `Bearer ${token}`);
  const get = (url: string) => request(api.app).get(url).set("Authorization", `Bearer ${token}`);
  beforeAll(async () => {
    process.env.NODE_ENV = "test"; process.env.JWT_SECRET = secret; process.env.UPLOAD_DIR = `/tmp/${prefix}`; process.env.OPENAI_API_KEY = "";
    api = await import("./server.js");
    for (const id of machineIds) await api.prisma.exercise.create({ data: { id, nameEn: id, nameDe: id, description: "Test", instructions: "Controlled motion", targetMuscles: [], equipmentType: "machine", exerciseType: "isolation", defaultSets: 3, minReps: 8, maxReps: 12, defaultRestSeconds: 90, defaultIncrement: 2.5 } });
    for (const other of [false, true]) {
      const user = await api.prisma.user.create({ data: { username: `${prefix}-${other}`, displayName: "Plan Test" } });
      const program = await api.prisma.workoutProgram.create({ data: { userId: user.id, name: prefix, active: true, preferredWeekdays: [1, 4] } });
      const template = await api.prisma.workoutTemplate.create({ data: { programId: program.id, name: "Default", exercises: { create: { ...entry(machineIds[0]), sortOrder: 1 } } } });
      await api.prisma.workoutDayAssignment.createMany({ data: [1,4].map((weekday) => ({ programId: program.id, weekday, templateId: template.id })) });
      if (other) { otherUid = user.id; foreignId = template.id; }
      else { uid = user.id; defaultId = template.id; token = jwt.sign({ sub: uid }, secret); }
    }
  });
  afterAll(async () => {
    for (const userId of [uid, otherUid].filter(Boolean)) {
      await api.prisma.workoutSession.deleteMany({ where: { userId } });
      await api.prisma.workoutDayAssignment.deleteMany({ where: { program: { userId } } });
      await api.prisma.workoutTemplateExercise.deleteMany({ where: { template: { program: { userId } } } });
      await api.prisma.workoutTemplate.deleteMany({ where: { program: { userId } } });
      await api.prisma.workoutProgram.deleteMany({ where: { userId } });
      await api.prisma.user.delete({ where: { id: userId } });
    }
    await api.prisma.exercise.deleteMany({ where: { id: { in: machineIds } } }); await api.prisma.$disconnect();
  });
  it("creates an owned named plan without changing Default or its selected days", async () => {
    const result = await post("/api/settings/workouts").send({ name: "Upper", exercises: [entry(machineIds[1], 4)] });
    expect(result.status).toBe(201); planId = result.body.templates.find((t: any) => t.name === "Upper").id;
    expect(result.body.templates.find((t: any) => t.id === defaultId).exercises).toHaveLength(1);
    expect(result.body.assignments.map((day: any) => day.templateId)).toEqual([defaultId, defaultId]);
    expect((await post("/api/settings/workouts").send({ name: "upper", exercises: [entry(machineIds[1])] })).status).toBe(409);
    expect((await post("/api/settings/workouts").send({ name: "Empty", exercises: [] })).status).toBe(400);
  });
  it("rejects foreign plans and invalid assignments without mutating the schedule", async () => {
    expect((await patch(`/api/settings/workouts/${foreignId}`).send({ name: "Stolen", exercises: [entry(machineIds[0])] })).status).toBe(404);
    expect((await patch("/api/settings/program").send({ assignments: [{ weekday: 1, templateId: foreignId }] })).status).toBe(400);
    expect((await patch("/api/settings/program").send({ assignments: [{ weekday: 1, templateId: planId }, { weekday: 1, templateId: defaultId }] })).status).toBe(400);
    expect((await get("/api/settings/program")).body.assignments.map((day: any) => day.templateId)).toEqual([defaultId, defaultId]);
  });
  it("selects the assigned plan using the client's local calendar day", async () => {
    expect((await patch("/api/settings/program").send({ assignments: [{ weekday: 1, templateId: planId }, { weekday: 4, templateId: defaultId }] })).status).toBe(200);
    const monday = await get("/api/dashboard").set("X-Kirfit-Local-Date", "2026-11-02");
    expect(monday.body.template).toMatchObject({ id: planId, name: "Upper", exerciseCount: 1 });
    const thursday = await get("/api/dashboard").set("X-Kirfit-Local-Date", "2026-11-05");
    expect(thursday.body.template.id).toBe(defaultId);
    const started = await post("/api/workouts/start").send({ templateId: planId, clientMutationId: crypto.randomUUID() });
    expect(started.status).toBe(201); sessionId = started.body.id;
    expect(started.body.exercises.map((e: any) => e.exercise.id)).toEqual([machineIds[1]]);
    expect(started.body.exercises[0].plannedSets).toBe(4);
    const logged = await post(`/api/workouts/${sessionId}/sets`).send({ workoutExerciseId: started.body.exercises[0].id, setNumber: 1, weight: 25, reps: 10, clientMutationId: crypto.randomUUID() });
    expect(logged.status).toBe(201);
  });
  it("edits ordered exercises for future sessions without altering an active workout or its sets", async () => {
    const before = await api.prisma.workoutSession.findUniqueOrThrow({ where: { id: sessionId }, include: { exercises: { include: { sets: true } } } });
    const edit = await patch(`/api/settings/workouts/${planId}`).send({ name: "Upper revised", exercises: [entry(machineIds[0], 2), entry(machineIds[1], 5)] });
    expect(edit.status).toBe(200);
    const after = await api.prisma.workoutSession.findUniqueOrThrow({ where: { id: sessionId }, include: { exercises: { include: { sets: true } } } });
    expect(after).toEqual(before);
    expect((await post(`/api/workouts/${sessionId}/finish`).send({})).status).toBe(200);
    const next = await post("/api/workouts/start").send({ templateId: planId, clientMutationId: crypto.randomUUID() });
    expect(next.body.exercises.map((e: any) => e.exercise.id)).toEqual(machineIds);
    expect(next.body.exercises.map((e: any) => e.plannedSets)).toEqual([2,5]);
  });
});
