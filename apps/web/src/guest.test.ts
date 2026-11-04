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
    expect(await guestApi("/settings/program")).toMatchObject({
      preferredWeekdays: [2, 4],
    });
  });
  it("persists set count, rest time and unit settings for the next workout", async () => {
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
          restSeconds: 75,
          increment: 1.25,
          measurementUnit: "units",
          customName: "Тренажёр у окна",
        }),
      },
    );
    expect(updated.exercises[0]).toMatchObject({
      plannedSets: 4,
      restSeconds: 75,
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
      restSeconds: 75,
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


describe("optional catalogue machines", () => {
  it("lists all 23 models but keeps each fresh workout at the original eight", async () => {
    values.clear();
    const catalogue: any[] = await guestApi("/exercises");
    expect(catalogue).toHaveLength(23);
    const active: any = await guestApi("/workouts/start", { method: "POST" });
    expect(active.exercises).toHaveLength(8);
    const extra = catalogue.find((entry) => entry.id === "pectoral-fly-rear-deltoid");
    const path = `/workouts/${active.id}/exercises`;
    for (let i = 0; i < 2; i++) {
      const updated: any = await guestApi(path, { method: "POST", body: JSON.stringify({ exerciseId: extra.id }) });
      expect(updated.exercises).toHaveLength(9);
    }
    await guestApi(`/workouts/${active.id}/finish`, { method: "POST" });
    await expect(guestApi(path, { method: "POST", body: JSON.stringify({ exerciseId: extra.id }) })).rejects.toThrow();
    const next: any = await guestApi("/workouts/start", { method: "POST" });
    expect(next.exercises).toHaveLength(8);
  });
});


describe("named guest workouts", () => {
  beforeEach(() => values.clear());
  it("migrates legacy preferences and settings to Default without changing recorded sets", async () => {
    const active: any = await guestApi("/workouts/start", { method: "POST" });
    await guestApi(`/workouts/${active.id}/sets`, { method: "POST", body: JSON.stringify({ workoutExerciseId: active.exercises[0].id, setNumber: 1, weight: 35, reps: 11 }) });
    const legacy = JSON.parse(values.get("kirfit_guest_data_v1")!);
    delete legacy.templates; delete legacy.assignments;
    legacy.preferredWeekdays = [1, 4, 6];
    legacy.exerciseSettings["leg-press"] = { ...legacy.exerciseSettings["leg-press"], plannedSets: 5, restSeconds: 150, increment: 5, measurementUnit: "kg", customName: "Old machine", notes: "Seat 4" };
    const before = structuredClone(legacy.sessions[0].exercises);
    values.set("kirfit_guest_data_v1", JSON.stringify(legacy));
    const program: any = await guestApi("/settings/program");
    expect(program.templates[0]).toMatchObject({ id: "guest-full-body", name: "Default" });
    expect(program.templates[0].exercises[0]).toMatchObject({ sets: 5, restSeconds: 150, customName: "Old machine", notes: "Seat 4" });
    expect(program.assignments).toEqual([1,4,6].map((weekday) => ({ weekday, templateId: "guest-full-body" })));
    expect(JSON.parse(values.get("kirfit_guest_data_v1")!).sessions[0].exercises).toEqual(before);
  });
  it("assigns an independently configured plan to a day and preserves active session data during edits", async () => {
    const base: any = await guestApi("/settings/program");
    const config = (exerciseId: string, sets = 3) => ({ exerciseId, sets, minReps: 8, maxReps: 12, restSeconds: 90, increment: 2.5, measurementUnit: "kg" });
    const created: any = await guestApi("/settings/workouts", { method: "POST", body: JSON.stringify({ name: "Upper", exercises: [config("pectoral-fly-rear-deltoid",4), config("seated-row",2)] }) });
    const plan = created.templates.find((entry: any) => entry.name === "Upper");
    const today = new Date().getDay();
    await guestApi("/settings/program", { method: "PATCH", body: JSON.stringify({ assignments: [{ weekday: today, templateId: plan.id }] }) });
    expect((await guestApi("/dashboard")).template.name).toBe("Upper");
    const active: any = await guestApi("/workouts/start", { method: "POST", body: JSON.stringify({ templateId: plan.id }) });
    expect(active.exercises.map((entry: any) => entry.plannedSets)).toEqual([4,2]);
    const before = structuredClone(active);
    await guestApi(`/settings/workouts/${plan.id}`, { method: "PATCH", body: JSON.stringify({ name: "Upper revised", exercises: [config("seated-row",5)] }) });
    expect(await guestApi("/workouts/active")).toEqual(before);
    await guestApi(`/workouts/${active.id}/finish`, { method: "POST" });
    const next: any = await guestApi("/workouts/start", { method: "POST", body: JSON.stringify({ templateId: plan.id }) });
    expect(next.exercises.map((entry: any) => entry.exercise.id)).toEqual(["seated-row"]);
    expect(next.exercises[0].plannedSets).toBe(5);
    const restored: any = await guestApi("/settings/program");
    expect(restored.templates.find((t: any) => t.id === base.templates[0].id).exercises).toHaveLength(8);
    await expect(guestApi("/settings/program", { method: "PATCH", body: JSON.stringify({ assignments: [{ weekday: today, templateId: "missing" }] }) })).rejects.toThrow();
  });
});


describe("personal machine progress catalogue", () => {
  it("excludes unlogged machines and active-only sessions from history", async () => {
    values.clear();
    expect(await guestApi("/exercises/history")).toEqual([]);
    const active: any = await guestApi("/workouts/start", { method: "POST" });
    await guestApi(`/workouts/${active.id}/sets`, { method: "POST", body: JSON.stringify({ workoutExerciseId: active.exercises[0].id, setNumber: 1, weight: 30, reps: 10 }) });
    expect(await guestApi("/exercises/history")).toEqual([]);
    await guestApi(`/workouts/${active.id}/finish`, { method: "POST" });
    const recorded: any[] = await guestApi("/exercises/history");
    expect(recorded.map((entry) => entry.id)).toEqual(["leg-press"]);
    await guestApi(`/workouts/${active.id}`, { method: "DELETE" });
    expect(await guestApi("/exercises/history")).toEqual([]);
  });
});
