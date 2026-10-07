import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  discardWorkout,
  discardWorkoutFinishes,
  flush,
  flushWorkoutSets,
  queue,
  remainingRestSeconds,
} from "./offline";

const values = new Map<string, string>();
Object.defineProperty(globalThis, "localStorage", {
  value: {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
  },
});

describe("rest timer", () => {
  it("uses elapsed wall-clock time after the app was suspended", () => {
    const timer = { startedAt: 1_000_000, durationSeconds: 120 };
    expect(remainingRestSeconds(timer, 1_045_100)).toBe(75);
    expect(remainingRestSeconds(timer, 1_121_000)).toBe(0);
  });
});

describe("offline mutation queue", () => {
  beforeEach(() => {
    values.clear();
    Object.defineProperty(globalThis, "navigator", {
      configurable: true,
      value: { onLine: true },
    });
  });

  it("discards delayed finishes while keeping queued sets", async () => {
    queue({ id: "set", path: "/workouts/1/sets", init: { method: "POST" } });
    queue({
      id: "finish",
      path: "/workouts/1/finish",
      init: { method: "POST" },
    });
    const sender = vi.fn().mockResolvedValue({});
    discardWorkoutFinishes();

    await expect(flush(sender)).resolves.toBe(true);
    expect(sender.mock.calls.map(([path]) => path)).toEqual([
      "/workouts/1/sets",
    ]);
  });

  it("discards only mutations for the canceled workout", async () => {
    queue({ id: "old", path: "/workouts/old/sets", init: { method: "POST" } });
    queue({ id: "new", path: "/workouts/new/sets", init: { method: "POST" } });
    discardWorkout("old");
    const sender = vi.fn().mockResolvedValue({});

    await expect(flush(sender)).resolves.toBe(true);
    expect(sender.mock.calls.map(([path]) => path)).toEqual([
      "/workouts/new/sets",
    ]);
  });

  it("keeps later mutations queued when a set cannot be saved", async () => {
    queue({ id: "set", path: "/workouts/1/sets", init: { method: "POST" } });
    queue({
      id: "finish",
      path: "/workouts/1/finish",
      init: { method: "POST" },
    });
    const sender = vi.fn().mockRejectedValue(new Error("network"));

    await expect(flush(sender)).resolves.toBe(false);
    expect(values.get("kirfit_pending")).toContain('"id":"finish"');
  });
});


describe("workout-scoped sync", () => {
  beforeEach(() => {
    values.clear();
    Object.defineProperty(globalThis, "navigator", { configurable: true, value: { onLine: true } });
  });

  it("flushes only active workout sets and preserves unrelated writes exactly", async () => {
    const stale = { id: "stale", path: "/workouts/old/sets", init: { method: "POST", body: "old payload" } };
    const other = { id: "other", path: "/workouts/10/sets", init: { method: "POST", body: "other payload" } };
    const finish = { id: "finish", path: "/workouts/1/finish", init: { method: "POST" } };
    queue(stale);
    queue({ id: "current", path: "/workouts/1/sets", init: { method: "POST" } });
    queue(other);
    queue(finish);
    const sender = vi.fn(async (path: string) => {
      if (path !== "/workouts/1/sets") throw new Error("session is not active");
    });

    await expect(flushWorkoutSets(sender, "1")).resolves.toBe(true);
    expect(sender).toHaveBeenCalledExactlyOnceWith("/workouts/1/sets", { method: "POST" });
    expect(JSON.parse(values.get("kirfit_pending")!)).toEqual([stale, other, finish]);
  });

  it("keeps failed current sets and later writes for retry", async () => {
    const items = ["old", "1", "1"].map((session, index) => ({
      id: String(index), path: `/workouts/${session}/sets`, init: { method: "POST", body: String(index) },
    }));
    items.forEach(queue);
    const sender = vi.fn().mockRejectedValue(new Error("validation failed"));

    await expect(flushWorkoutSets(sender, "1")).resolves.toBe(false);
    expect(sender).toHaveBeenCalledTimes(1);
    expect(JSON.parse(values.get("kirfit_pending")!)).toEqual(items);
  });

  it.each([true, false])("shares an in-flight online write with finish (success=%s)", async (success) => {
    queue({ id: "current", path: "/workouts/1/sets", init: { method: "POST" } });
    let settle!: () => void;
    const sender = vi.fn(() => new Promise<void>((resolve, reject) => {
      settle = () => success ? resolve() : reject(new Error("failed"));
    }));
    const online = flush(sender);
    const finishing = flushWorkoutSets(sender, "1");
    await Promise.resolve();
    expect(sender).toHaveBeenCalledTimes(1);
    const added = { id: "added", path: "/workouts/other/sets", init: { method: "POST", body: "new payload" } };
    queue(added);
    settle();

    await expect(finishing).resolves.toBe(success);
    await expect(online).resolves.toBe(false);
    const remaining = JSON.parse(values.get("kirfit_pending")!);
    expect(remaining).toContainEqual(added);
    expect(remaining.some((item: { id: string }) => item.id === "current")).toBe(!success);
  });

  it("can finish while online sync is waiting on an unrelated write", async () => {
    queue({ id: "old", path: "/workouts/old/sets", init: { method: "POST" } });
    queue({ id: "current", path: "/workouts/1/sets", init: { method: "POST" } });
    let rejectOld!: (error: Error) => void;
    const sender = vi.fn((path: string) => path === "/workouts/old/sets"
      ? new Promise<void>((_, reject) => { rejectOld = reject; })
      : Promise.resolve());
    const online = flush(sender);

    await expect(flushWorkoutSets(sender, "1")).resolves.toBe(true);
    rejectOld(new Error("session is not active"));
    await expect(online).resolves.toBe(false);
    expect(JSON.parse(values.get("kirfit_pending")!)).toEqual([
      { id: "old", path: "/workouts/old/sets", init: { method: "POST" } },
    ]);
  });

  it("does not report success if another current set is queued during sync", async () => {
    queue({ id: "first", path: "/workouts/1/sets", init: { method: "POST" } });
    const added = { id: "added", path: "/workouts/1/sets", init: { method: "POST" } };
    const sender = vi.fn(async () => { queue(added); });

    await expect(flushWorkoutSets(sender, "1")).resolves.toBe(false);
    expect(JSON.parse(values.get("kirfit_pending")!)).toEqual([added]);
  });
});
