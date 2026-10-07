import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import jwt from "jsonwebtoken";
import type { Request, Response } from "express";

const { update } = vi.hoisted(() => ({ update: vi.fn() }));
vi.mock("@prisma/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@prisma/client")>();
  return {
    ...actual,
    PrismaClient: class {
      workoutSession = { update };
      $disconnect = vi.fn();
    },
  };
});

// No database connection: exercise the real authenticated finish route.
describe("workout finish API", () => {
  const secret = "workout-finish-test-secret-at-least-32-characters";
  let api: typeof import("./server.js");

  beforeAll(async () => {
    vi.stubEnv("NODE_ENV", "test");
    vi.stubEnv("JWT_SECRET", secret);
    vi.stubEnv("UPLOAD_DIR", "/tmp/kir-fit-finish-test-uploads");
    api = await import("./server.js");
  });

  afterAll(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
  });

  it("finishes a workout from the previous day at the current server time", async () => {
    const now = new Date("2026-10-07T22:10:00.000Z"); // 00:10 in Berlin
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(now);
    const startedAt = new Date("2026-10-07T21:50:00.000Z");
    update.mockImplementation(async ({ data }) => ({
      id: "current", startedAt, ...data,
      exercises: [{
        increment: 2.5, lastWeight: 20, plannedSets: 1, maxReps: 12,
        exercise: {}, sets: [{ id: "saved-set", weight: 20, reps: 10 }],
      }],
    }));

    const req = {
      params: { id: "current" }, body: {},
      headers: { authorization: `Bearer ${jwt.sign({ sub: "test-user" }, secret)}` },
    };
    const res = { json: vi.fn(), status: vi.fn().mockReturnThis() };
    const next = vi.fn();
    const route = api.app.router.stack.find((layer: any) => layer.route?.path === "/api/workouts/:id/finish")!.route!;
    // Invoke the registered auth and route handlers without opening a socket.
    for (const layer of route.stack) await layer.handle(req as unknown as Request, res as unknown as Response, next);
    expect(next).toHaveBeenCalledExactlyOnceWith();
    const body = JSON.parse(JSON.stringify(res.json.mock.calls[0][0]));
    expect(update).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
      where: { id: "current", userId: "test-user", status: "active" },
      data: { status: "completed", finishedAt: now, notes: undefined },
    }));
    expect(body.finishedAt).toBe(now.toISOString());
    expect(body.startedAt).toBe(startedAt.toISOString());
    expect(body.exercises[0].sets).toEqual([{ id: "saved-set", weight: 20, reps: 10 }]);
    expect(body.summary.setCount).toBe(1);
  });
});
