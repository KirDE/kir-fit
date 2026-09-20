import { afterAll, beforeAll, describe, expect, it } from "vitest";
import jwt from "jsonwebtoken";
import request from "supertest";

const hasDatabase = Boolean(process.env.DATABASE_URL);

describe.skipIf(!hasDatabase)("workout exercise settings API", () => {
  const secret = "integration-test-secret-that-is-at-least-32-characters";
  const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  let api: typeof import("./server.js");
  let userId: string;
  let exerciseId: string;
  let programId: string;
  let templateId: string;
  let sessionId: string;
  let workoutExerciseId: string;
  let token: string;

  beforeAll(async () => {
    process.env.NODE_ENV = "test";
    process.env.JWT_SECRET = secret;
    process.env.OPENAI_API_KEY = "";
    process.env.UPLOAD_DIR = `/tmp/kir-fit-workout-test-${suffix}`;
    api = await import("./server.js");
    exerciseId = `machine-note-${suffix}`;
    const user = await api.prisma.user.create({
      data: {
        username: `machine-note-${suffix}`,
        displayName: "Machine Note Test",
      },
    });
    userId = user.id;
    token = jwt.sign({ sub: userId }, secret);
    await api.prisma.exercise.create({
      data: {
        id: exerciseId,
        nameEn: "Test Machine",
        nameDe: "Testgerät",
        description: "Test machine description",
        instructions: "Use the test machine",
        targetMuscles: ["Test"],
        equipmentType: "machine",
        exerciseType: "isolation",
        defaultSets: 3,
        minReps: 8,
        maxReps: 12,
        defaultRestSeconds: 90,
        defaultIncrement: 2.5,
      },
    });
    const program = await api.prisma.workoutProgram.create({
      data: {
        userId,
        name: "Machine note program",
        active: true,
        preferredWeekdays: [1],
      },
    });
    programId = program.id;
    const template = await api.prisma.workoutTemplate.create({
      data: { programId, name: "Machine note template" },
    });
    templateId = template.id;
    await api.prisma.workoutTemplateExercise.create({
      data: {
        templateId,
        exerciseId,
        sortOrder: 1,
        sets: 3,
        minReps: 8,
        maxReps: 12,
        restSeconds: 90,
        increment: 2.5,
      },
    });
    const session = await api.prisma.workoutSession.create({
      data: {
        userId,
        templateId,
        clientMutationId: crypto.randomUUID(),
      },
    });
    sessionId = session.id;
    const workoutExercise = await api.prisma.workoutExercise.create({
      data: {
        sessionId,
        exerciseId,
        sortOrder: 1,
        plannedSets: 3,
        minReps: 8,
        maxReps: 12,
        restSeconds: 90,
        increment: 2.5,
        exerciseNameSnapshot: "Test Machine",
      },
    });
    workoutExerciseId = workoutExercise.id;
  });

  afterAll(async () => {
    if (!api) return;
    await api.prisma.workoutExercise.deleteMany({ where: { sessionId } });
    await api.prisma.workoutSession.deleteMany({ where: { id: sessionId } });
    await api.prisma.workoutTemplateExercise.deleteMany({ where: { templateId } });
    await api.prisma.workoutTemplate.deleteMany({ where: { id: templateId } });
    await api.prisma.workoutProgram.deleteMany({ where: { id: programId } });
    await api.prisma.exercise.deleteMany({ where: { id: exerciseId } });
    await api.prisma.user.deleteMany({ where: { id: userId } });
    await api.prisma.$disconnect();
  });

  const settings = (notes?: string) => ({
    plannedSets: 4,
    restSeconds: 120,
    increment: 5,
    measurementUnit: "kg",
    customName: "My machine",
    ...(notes === undefined ? {} : { notes }),
  });

  it("persists an optional machine note and preserves it for older clients", async () => {
    const saved = await request(api.app)
      .patch(`/api/workouts/${sessionId}/exercises/${workoutExerciseId}/settings`)
      .set("Authorization", `Bearer ${token}`)
      .send(settings("  Seat 4, neutral grip  "));

    expect(saved.status).toBe(200);
    expect(saved.body.exercises[0].notes).toBe("Seat 4, neutral grip");
    await expect(
      api.prisma.workoutTemplateExercise.findUniqueOrThrow({
        where: { templateId_exerciseId: { templateId, exerciseId } },
      }),
    ).resolves.toMatchObject({ notes: "Seat 4, neutral grip" });

    const legacySave = await request(api.app)
      .patch(`/api/workouts/${sessionId}/exercises/${workoutExerciseId}/settings`)
      .set("Authorization", `Bearer ${token}`)
      .send(settings());
    expect(legacySave.status).toBe(200);
    expect(legacySave.body.exercises[0].notes).toBe("Seat 4, neutral grip");

    const cleared = await request(api.app)
      .patch(`/api/workouts/${sessionId}/exercises/${workoutExerciseId}/settings`)
      .set("Authorization", `Bearer ${token}`)
      .send(settings("   "));
    expect(cleared.status).toBe(200);
    expect(cleared.body.exercises[0].notes).toBeNull();
  });
});
