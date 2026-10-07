import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import jwt from "jsonwebtoken";
import type { Request, Response } from "express";
import { Prisma } from "@prisma/client";

const db = vi.hoisted(() => ({
  exercise: vi.fn(),
  findSet: vi.fn(),
  createSet: vi.fn(),
  updateExercise: vi.fn(),
  updateTemplate: vi.fn(),
  transaction: vi.fn(),
}));
vi.mock("@prisma/client", async (importOriginal) => ({
  ...await importOriginal<typeof import("@prisma/client")>(),
  PrismaClient: class {
    $transaction = db.transaction;
    $disconnect = vi.fn();
  },
}));

const tx = {
  workoutExercise: { findFirstOrThrow: db.exercise, update: db.updateExercise },
  workoutSet: { findUnique: db.findSet, create: db.createSet },
  workoutTemplateExercise: { update: db.updateTemplate },
};
const originalMutation = "00000000-0000-4000-8000-000000000001";
const newMutation = "00000000-0000-4000-8000-000000000002";
const payload = {
  workoutExerciseId: "exercise", setNumber: 1,
  weight: 20, reps: 10, rir: null, clientMutationId: newMutation,
};
const persisted = {
  ...payload, id: "saved-set", weight: new Prisma.Decimal("20.00"),
  clientMutationId: originalMutation,
};
const uniqueError = () => new Prisma.PrismaClientKnownRequestError("Unique constraint failed", {
  code: "P2002", clientVersion: "6.12.0",
});

describe("authenticated set reconciliation", () => {
  const secret = "workout-sets-test-secret-at-least-32-characters";
  let api: typeof import("./server.js");
  let records: typeof persisted[];

  beforeAll(async () => {
    vi.stubEnv("NODE_ENV", "test");
    vi.stubEnv("JWT_SECRET", secret);
    vi.stubEnv("UPLOAD_DIR", "/tmp/kir-fit-sets-test-uploads");
    api = await import("./server.js");
  });
  afterAll(() => vi.unstubAllEnvs());

  beforeEach(() => {
    Object.values(db).forEach((mock) => mock.mockReset());
    records = [];
    db.exercise.mockResolvedValue({
      id: "exercise", exerciseId: "catalog-exercise", session: { templateId: "template" },
    });
    db.findSet.mockImplementation(async ({ where }) => records.find((set) =>
      where.clientMutationId
        ? set.clientMutationId === where.clientMutationId
        : set.workoutExerciseId === where.workoutExerciseId_setNumber.workoutExerciseId &&
          set.setNumber === where.workoutExerciseId_setNumber.setNumber,
    ) ?? null);
    db.createSet.mockImplementation(async ({ data }) => {
      const set = { ...data, id: "created-set" };
      records.push(set);
      return set;
    });
    db.updateExercise.mockResolvedValue({});
    db.updateTemplate.mockResolvedValue({});
    db.transaction.mockImplementation(async (callback) => {
      const before = [...records];
      try {
        return await callback(tx);
      } catch (error) {
        records = before;
        throw error;
      }
    });
  });

  // Exercise registered authentication, validation, route and error handlers.
  // Database access is mocked; no listening socket or real database is used.
  async function post(body: Record<string, unknown> = payload) {
    const req = {
      params: { sessionId: "session" }, body,
      headers: { authorization: `Bearer ${jwt.sign({ sub: "owner" }, secret)}` },
    };
    const res = { status: vi.fn().mockReturnThis(), json: vi.fn() };
    const next = vi.fn();
    const route = api.app.router.stack.find((layer: any) =>
      layer.route?.path === "/api/workouts/:sessionId/sets",
    )!.route!;
    for (const layer of route.stack) {
      next.mockClear();
      await layer.handle(req as unknown as Request, res as unknown as Response, next);
      const error = next.mock.calls[0]?.[0];
      if (error) {
        const handler = api.app.router.stack.find((layer: any) => layer.handle.length === 4)!;
        (handler.handle as any)(error, req, res, vi.fn());
        break;
      }
      if (res.json.mock.calls.length) break;
    }
    return { status: res.status.mock.calls[0]?.[0], body: res.json.mock.calls[0]?.[0] };
  }

  function expectNoWrites() {
    expect(db.createSet).not.toHaveBeenCalled();
    expect(db.updateExercise).not.toHaveBeenCalled();
    expect(db.updateTemplate).not.toHaveBeenCalled();
  }

  it("accepts an exact duplicate with a distinct mutation ID and preserves the original", async () => {
    records = [persisted];
    const result = await post();
    expect(result.status).toBe(201);
    expect(result.body).toEqual({ ...persisted, weight: 20 });
    expect(records).toEqual([persisted]);
    expectNoWrites();
    expect(db.exercise).toHaveBeenCalledWith({
      where: { id: "exercise", sessionId: "session", session: { userId: "owner", status: "active" } },
      include: { session: true },
    });
  });

  it("normalizes omitted RIR to persisted null", async () => {
    records = [persisted];
    const { rir: _rir, ...withoutRir } = payload;
    expect((await post(withoutRir)).status).toBe(201);
    expectNoWrites();
  });

  it.each([
    { weight: 20.01 }, { reps: 11 }, { rir: 0 },
  ])("returns 409 and preserves data when a duplicate differs: %j", async (changed) => {
    records = [persisted];
    const result = await post({ ...payload, ...changed });
    expect(result.status).toBe(409);
    expect(result.body.error).toContain("different values");
    expect(records).toEqual([persisted]);
    expectNoWrites();
  });

  it("keeps original mutation-ID retries idempotent", async () => {
    records = [persisted];
    const result = await post({ ...payload, clientMutationId: originalMutation });
    expect(result.status).toBe(201);
    expect(result.body.id).toBe(persisted.id);
    expect(db.findSet).toHaveBeenCalledTimes(1);
    expectNoWrites();
  });

  it.each([
    { reps: 11 }, { setNumber: 2 },
  ])("rejects a reused mutation ID with different data: %j", async (changed) => {
    records = [persisted];
    expect((await post({ ...payload, clientMutationId: originalMutation, ...changed })).status).toBe(409);
    expect(records).toEqual([persisted]);
    expectNoWrites();
  });

  it("does not accept a mutation belonging to another exercise", async () => {
    const other = { ...persisted, workoutExerciseId: "other-exercise" };
    records = [other];
    expect((await post({ ...payload, clientMutationId: originalMutation })).status).toBe(409);
    expect(records).toEqual([other]);
    expectNoWrites();
  });

  it.each(["slot", "mutation", "conflict"])("reconciles a P2002 race on %s in a fresh transaction", async (kind) => {
    const winner = {
      ...persisted,
      ...(kind === "mutation" ? { clientMutationId: newMutation } : {}),
      ...(kind === "conflict" ? { reps: 11 } : {}),
    };
    db.createSet.mockRejectedValueOnce(uniqueError());
    db.transaction.mockImplementationOnce(async (callback) => {
      try {
        return await callback(tx);
      } finally {
        // The concurrent winner commits outside the failed transaction.
        records = [winner];
      }
    });
    const result = await post();
    expect(result.status).toBe(kind === "conflict" ? 409 : 201);
    if (kind !== "conflict") expect(result.body).toEqual({ ...winner, weight: 20 });
    expect(db.transaction).toHaveBeenCalledTimes(2);
    expect(db.exercise).toHaveBeenCalledTimes(2);
    expect(db.createSet).toHaveBeenCalledTimes(1);
    expect(db.updateExercise).not.toHaveBeenCalled();
    expect(db.updateTemplate).not.toHaveBeenCalled();
    expect(records).toEqual([winner]);
  });

  it("creates new sets and updates both last-set records atomically", async () => {
    const result = await post();
    expect(result.status).toBe(201);
    expect(result.body.clientMutationId).toBe(newMutation);
    expect(db.transaction).toHaveBeenCalledTimes(1);
    expect(db.updateExercise).toHaveBeenCalledWith({
      where: { id: "exercise" },
      data: { lastWeight: new Prisma.Decimal(20), lastReps: 10, lastRir: null },
    });
    expect(db.updateTemplate).toHaveBeenCalledWith({
      where: { templateId_exerciseId: { templateId: "template", exerciseId: "catalog-exercise" } },
      data: { lastWeight: new Prisma.Decimal(20), lastReps: 10, lastRir: null },
    });
    expect((await post()).status).toBe(201);
    expect(db.createSet).toHaveBeenCalledTimes(1);
    expect(db.updateExercise).toHaveBeenCalledTimes(1);
    expect(db.updateTemplate).toHaveBeenCalledTimes(1);
  });

  it("rechecks the active owned session after a uniqueness race", async () => {
    db.createSet.mockRejectedValueOnce(uniqueError());
    db.exercise.mockResolvedValueOnce({
      id: "exercise", exerciseId: "catalog-exercise", session: { templateId: "template" },
    }).mockRejectedValueOnce(new Prisma.PrismaClientKnownRequestError("Not found", {
      code: "P2025", clientVersion: "6.12.0",
    }));

    expect((await post()).status).toBe(404);
    expect(db.transaction).toHaveBeenCalledTimes(2);
    expect(db.exercise).toHaveBeenCalledTimes(2);
    expect(db.createSet).toHaveBeenCalledTimes(1);
    expect(db.updateExercise).not.toHaveBeenCalled();
    expect(db.updateTemplate).not.toHaveBeenCalled();
  });

  it("propagates transaction failure and does not turn it into duplicate success", async () => {
    db.updateTemplate.mockRejectedValue(new Error("database failure"));
    expect((await post()).status).toBe(500);
    expect(records).toEqual([]);
    expect(db.transaction).toHaveBeenCalledTimes(1);
  });

  it("requires the owned exercise to remain in the active session even for duplicates", async () => {
    records = [persisted];
    db.exercise.mockRejectedValue(new Prisma.PrismaClientKnownRequestError("Not found", {
      code: "P2025", clientVersion: "6.12.0",
    }));
    expect((await post()).status).toBe(404);
    expect(db.findSet).not.toHaveBeenCalled();
    expectNoWrites();
  });
});
