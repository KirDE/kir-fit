import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  closeRestTimerNotification,
  restNotificationPermission,
  setRestNotificationPromptDismissed,
  shouldPromptForRestNotifications,
  showRestFinishedNotification,
  showRestTimerNotification,
} from "./restNotifications";

const values = new Map<string, string>();
const close = vi.fn();
const showNotification = vi.fn().mockResolvedValue(undefined);
const getNotifications = vi.fn().mockResolvedValue([{ close }]);

beforeEach(() => {
  values.clear();
  vi.clearAllMocks();
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: globalThis,
  });
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
      removeItem: (key: string) => values.delete(key),
    },
  });
  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    value: {
      serviceWorker: {
        ready: Promise.resolve({ showNotification, getNotifications }),
      },
    },
  });
  Object.defineProperty(globalThis, "Notification", {
    configurable: true,
    value: { permission: "default", requestPermission: vi.fn() },
  });
});

describe("rest timer notifications", () => {
  it("offers the explanation once until it is dismissed", () => {
    expect(restNotificationPermission()).toBe("default");
    expect(shouldPromptForRestNotifications()).toBe(true);
    setRestNotificationPromptDismissed(true);
    expect(shouldPromptForRestNotifications()).toBe(false);
    setRestNotificationPromptDismissed(false);
    expect(shouldPromptForRestNotifications()).toBe(true);
  });

  it("replaces the timer notification and announces completion", async () => {
    Object.defineProperty(globalThis, "Notification", {
      configurable: true,
      value: { permission: "granted", requestPermission: vi.fn() },
    });

    await expect(
      showRestTimerNotification("Rest 1:30", "Until 20:00", 123_000),
    ).resolves.toBe(true);
    expect(showNotification).toHaveBeenCalledWith(
      "Rest 1:30",
      expect.objectContaining({ tag: "kirfit-rest-timer", timestamp: 123_000 }),
    );

    await expect(
      showRestFinishedNotification("Rest finished", "Next set"),
    ).resolves.toBe(true);
    expect(showNotification).toHaveBeenLastCalledWith(
      "Rest finished",
      expect.objectContaining({ tag: "kirfit-rest-timer", renotify: true }),
    );
  });

  it("closes the active notification when rest is skipped", async () => {
    Object.defineProperty(globalThis, "Notification", {
      configurable: true,
      value: { permission: "granted", requestPermission: vi.fn() },
    });
    await closeRestTimerNotification();
    expect(getNotifications).toHaveBeenCalledWith({
      tag: "kirfit-rest-timer",
    });
    expect(close).toHaveBeenCalledOnce();
  });
});
