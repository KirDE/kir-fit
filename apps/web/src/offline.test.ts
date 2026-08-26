import { beforeEach, describe, expect, it, vi } from "vitest";
import { discardWorkoutFinishes, flush, queue } from "./offline";

const values = new Map<string, string>();
Object.defineProperty(globalThis, "localStorage", {
  value: {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
  },
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
