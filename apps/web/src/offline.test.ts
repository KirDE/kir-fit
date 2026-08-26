import { beforeEach, describe, expect, it, vi } from "vitest";
import { flush, queue } from "./offline";

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

  it("sends queued sets before finishing the workout", async () => {
    queue({ id: "set", path: "/workouts/1/sets", init: { method: "POST" } });
    queue({
      id: "finish",
      path: "/workouts/1/finish",
      init: { method: "POST" },
    });
    const sender = vi.fn().mockResolvedValue({});

    await expect(flush(sender)).resolves.toBe(true);
    expect(sender.mock.calls.map(([path]) => path)).toEqual([
      "/workouts/1/sets",
      "/workouts/1/finish",
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
