import { beforeEach, describe, expect, it } from "vitest";
import { guestApi } from "./guest";
import { getLanguage, tr } from "./i18n";

const values = new Map<string, string>();
Object.defineProperty(globalThis, "localStorage", {
  value: {
    getItem: (k: string) => values.get(k) ?? null,
    setItem: (k: string, v: string) => values.set(k, v),
    removeItem: (k: string) => values.delete(k),
  },
});

describe("guest persistence", () => {
  beforeEach(() => values.clear());
  it("keeps an active workout and completed set in local storage", async () => {
    const started: any = await guestApi("/workouts/start", {
      method: "POST",
      body: JSON.stringify({ introWeeks: true }),
    });
    const exercise = started.exercises[0];
    expect(exercise.increment).toBe(2.5);
    await guestApi(`/workouts/${started.id}/sets`, {
      method: "POST",
      body: JSON.stringify({
        workoutExerciseId: exercise.id,
        setNumber: 1,
        weight: 40,
        reps: 12,
      }),
    });
    const restored: any = await guestApi("/workouts/active");
    expect(restored.id).toBe(started.id);
    expect(restored.exercises[0].sets[0]).toMatchObject({
      weight: 40,
      reps: 12,
    });
    expect(values.get("kirfit_guest_data_v1")).toContain('"weight":40');
  });
  it("starts without invented body weight and persists chosen training days", async () => {
    expect(await guestApi("/body-weight")).toEqual([]);
    await guestApi("/settings/program", {
      method: "PATCH",
      body: JSON.stringify({ preferredWeekdays: [2, 4] }),
    });
    expect(await guestApi("/settings/program")).toEqual({
      preferredWeekdays: [2, 4],
    });
  });
  it("persists set count and unit settings for the next workout", async () => {
    const started: any = await guestApi("/workouts/start", {
      method: "POST",
      body: JSON.stringify({ introWeeks: true }),
    });
    const exercise = started.exercises[0];
    const updated: any = await guestApi(
      `/workouts/${started.id}/exercises/${exercise.id}/settings`,
      {
        method: "PATCH",
        body: JSON.stringify({
          plannedSets: 4,
          increment: 1.25,
          measurementUnit: "units",
          customName: "Тренажёр у окна",
        }),
      },
    );
    expect(updated.exercises[0]).toMatchObject({
      plannedSets: 4,
      increment: 1.25,
      measurementUnit: "units",
      customName: "Тренажёр у окна",
    });
    await guestApi(`/workouts/${started.id}/sets`, {
      method: "POST",
      body: JSON.stringify({
        workoutExerciseId: exercise.id,
        setNumber: 1,
        weight: 17,
        reps: 11,
        rir: 2,
      }),
    });
    await guestApi(`/workouts/${started.id}/finish`, { method: "POST" });
    const next: any = await guestApi("/workouts/start", {
      method: "POST",
      body: JSON.stringify({ introWeeks: true }),
    });
    expect(next.exercises[0]).toMatchObject({
      plannedSets: 4,
      increment: 1.25,
      measurementUnit: "units",
      customName: "Тренажёр у окна",
      lastWeight: 17,
      lastReps: 11,
      lastRir: 2,
    });
  });
  it("resumes a workout completed today", async () => {
    const started: any = await guestApi("/workouts/start", { method: "POST" });
    await guestApi(`/workouts/${started.id}/finish`, { method: "POST" });
    const today = new Date();
    const localDate = `${today.getFullYear()}-${String(
      today.getMonth() + 1,
    ).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
    const resumed: any = await guestApi(`/workouts/${started.id}/resume`, {
      method: "POST",
      body: JSON.stringify({
        localDate,
        timezoneOffsetMinutes: today.getTimezoneOffset(),
      }),
    });
    expect(resumed).toMatchObject({ id: started.id, status: "active" });
    expect(resumed.finishedAt).toBeUndefined();
  });
  it("deletes a completed workout from history", async () => {
    const started: any = await guestApi("/workouts/start", { method: "POST" });
    await guestApi(`/workouts/${started.id}/finish`, { method: "POST" });
    expect(await guestApi("/history")).toHaveLength(1);
    await guestApi(`/workouts/${started.id}`, { method: "DELETE" });
    expect(await guestApi("/history")).toEqual([]);
  });
  it("cancels an active workout so a fresh one can start", async () => {
    const started: any = await guestApi("/workouts/start", { method: "POST" });
    await guestApi(`/workouts/${started.id}/active`, { method: "DELETE" });
    expect(await guestApi("/workouts/active")).toBeNull();
    const restarted: any = await guestApi("/workouts/start", {
      method: "POST",
    });
    expect(restarted.id).not.toBe(started.id);
  });

  it("provides Russian interface messages", () => {
    localStorage.setItem("kirfit_language", "ru");
    expect(tr("startWorkout")).toBe("Начать тренировку");
    expect(tr("continueWorkout")).toBe("Продолжить тренировку");
    expect(tr("unfinishedWorkout")).toBe("Не закончена");
    expect(tr("guestWarning")).toContain("данные");
  });
  it("detects a supported browser language and falls back to English", () => {
    localStorage.removeItem("kirfit_language");
    Object.defineProperty(globalThis, "navigator", {
      configurable: true,
      value: { languages: ["de-DE"] },
    });
    expect(getLanguage()).toBe("de");
    Object.defineProperty(globalThis, "navigator", {
      configurable: true,
      value: { languages: ["fr-FR"] },
    });
    expect(getLanguage()).toBe("en");
  });
});
