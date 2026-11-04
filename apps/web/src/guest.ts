import catalog from "../../api/prisma/exercise-catalog.json";
const STORAGE = "kirfit_guest_data_v1";
const copy = (x: any) => structuredClone(x);
const exercises = [
  [
    "leg-press",
    "Seated Leg Press",
    "Beinpresse sitzend",
    "A seated machine with a weighted platform pushed away with both legs.",
    "Sitzende Maschine mit einer Gewichtsplattform, die mit beiden Beinen weggedrückt wird.",
    3,
    10,
    12,
    120,
    2.5,
  ],
  [
    "chest-press",
    "Chest Press",
    "Brustpresse",
    "A seated machine with handles at chest height that press forward.",
    "Sitzende Maschine, deren Griffe auf Brusthöhe nach vorne gedrückt werden.",
    3,
    8,
    12,
    120,
    2.5,
  ],
  [
    "lat-pulldown",
    "Lat Pulldown",
    "Latzug",
    "A cable machine with an overhead bar pulled toward the upper chest.",
    "Kabelzug mit oberer Stange, die zur oberen Brust gezogen wird.",
    3,
    8,
    12,
    120,
    2.5,
  ],
  [
    "seated-row",
    "Seated Row",
    "Rudern",
    "A seated cable machine whose handles are pulled toward the torso.",
    "Sitzender Kabelzug, dessen Griffe zum Oberkörper gezogen werden.",
    3,
    8,
    12,
    120,
    2.5,
  ],
  [
    "leg-curl",
    "Seated Leg Curl",
    "Beinbeuger sitzend",
    "A machine where the knees bend against a padded lever.",
    "Maschine, bei der die Knie gegen eine gepolsterte Rolle gebeugt werden.",
    2,
    10,
    15,
    90,
    2.5,
  ],
  [
    "shoulder-press",
    "Shoulder Press",
    "Schulterpresse",
    "A seated machine with handles pressed upward from shoulder level.",
    "Sitzende Maschine, deren Griffe von Schulterhöhe nach oben gedrückt werden.",
    2,
    8,
    12,
    120,
    2.5,
  ],
  [
    "triceps-pushdown",
    "Triceps Press",
    "Trizepsdrücken",
    "A seated machine with handles pressed down to extend the elbows.",
    "Sitzende Maschine, deren Griffe zum Strecken der Ellbogen nach unten gedrückt werden.",
    2,
    10,
    15,
    90,
    2.5,
  ],
  [
    "biceps-curl",
    "Biceps Curl",
    "Bizeps Curl",
    "A machine used to curl the forearms toward the shoulders.",
    "Maschine, an der die Unterarme zu den Schultern gebeugt werden.",
    2,
    10,
    15,
    90,
    2.5,
  ],
].map((x: any) => ({
  id: x[0],
  nameEn: x[1],
  nameDe: x[2],
  nameRu: (
    {
      "leg-press": "Жим ногами сидя",
      "chest-press": "Жим от груди",
      "lat-pulldown": "Тяга верхнего блока",
      "seated-row": "Горизонтальная тяга",
      "leg-curl": "Сгибание ног сидя",
      "shoulder-press": "Жим на плечи",
      "triceps-pushdown": "Жим на трицепс",
      "biceps-curl": "Сгибание рук на бицепс",
    } as Record<string, string>
  )[x[0]],
  description: x[3],
  descriptionDe: x[4],
  descriptionRu: (
    {
      "leg-press":
        "Сидячий тренажёр с платформой, которую отталкивают обеими ногами.",
      "chest-press":
        "Сидячий тренажёр, в котором ручки на уровне груди выжимаются вперёд.",
      "lat-pulldown":
        "Блочный тренажёр с верхней перекладиной, которую тянут к груди.",
      "seated-row": "Сидячий тренажёр, ручки которого тянут к корпусу.",
      "leg-curl": "Тренажёр, где ноги сгибаются против мягкого валика.",
      "shoulder-press": "Сидячий тренажёр, в котором ручки выжимаются вверх.",
      "triceps-pushdown": "Сидячий тренажёр для жима рукоятей вниз.",
      "biceps-curl": "Тренажёр для сгибания рук к плечам.",
    } as Record<string, string>
  )[x[0]],
  instructions: "Use a controlled range of motion and keep stable posture.",
  instructionsDe:
    "Kontrollierten Bewegungsumfang verwenden und den Körper stabil halten.",
  instructionsRu:
    "Выполняйте движение подконтрольно и сохраняйте устойчивое положение тела.",
  targetMuscles: [] as string[],
  defaultSets: x[5],
  minReps: x[6],
  maxReps: x[7],
  defaultRestSeconds: x[8],
  defaultIncrement: x[9],
  images: [{ path: `/exercise-images/${x[0]}.webp` }],
  machines: [],
}));
exercises.push(...catalog.optionalExercises.map((entry) => ({
  ...entry, images: [{ path: `/exercise-images/${entry.id}.webp` }], machines: [],
})));

type GuestPlan = { id: string; name: string; exercises: any[] };
type State = {
  templates: GuestPlan[];
  assignments: { weekday: number; templateId: string }[];
  sessions: any[];
  weights: any[];
  preferredWeekdays: number[];
  exerciseSettings: Record<
    string,
    {
      plannedSets: number;
      restSeconds?: number;
      increment?: number;
      measurementUnit: "kg" | "units";
      customName?: string | null;
      notes?: string | null;
      lastWeight?: number | null;
      lastReps?: number | null;
      lastRir?: number | null;
    }
  >;
};
const defaultPlan = (settings: State["exerciseSettings"] = {}): GuestPlan => ({
  id: "guest-full-body", name: "Default",
  exercises: exercises.filter((entry) => catalog.starterExerciseIds.includes(entry.id)).map((entry) => ({
    exerciseId: entry.id, customized: !!settings[entry.id], sets: settings[entry.id]?.plannedSets ?? entry.defaultSets,
    minReps: entry.minReps, maxReps: entry.maxReps,
    restSeconds: settings[entry.id]?.restSeconds ?? entry.defaultRestSeconds,
    increment: settings[entry.id]?.increment ?? entry.defaultIncrement,
    measurementUnit: settings[entry.id]?.measurementUnit || "kg",
    customName: settings[entry.id]?.customName || null, notes: settings[entry.id]?.notes || null,
  })),
});
const fresh = (): State => ({
  templates: [defaultPlan()],
  assignments: [0, 3, 5].map((weekday) => ({ weekday, templateId: "guest-full-body" })),
  sessions: [],
  weights: [],
  preferredWeekdays: [0, 3, 5],
  exerciseSettings: {},
});
const load = (): State => {
  try {
    const stored = JSON.parse(localStorage.getItem(STORAGE) || "");
    if (!stored) return fresh();
    stored.weights = (stored.weights || []).filter(
      (x: any) => x.id !== "initial",
    );
    stored.preferredWeekdays ||= [0, 3, 5];
    stored.exerciseSettings ||= {};
    if (!stored.templates) {
      stored.templates = [defaultPlan(stored.exerciseSettings)];
      stored.assignments = stored.preferredWeekdays.map((weekday: number) => ({ weekday, templateId: "guest-full-body" }));
      // Persist the one-time migration without rewriting any sets or measurements.
      for (const active of stored.sessions || []) {
        active.templateId ||= "guest-full-body";
        active.template ||= { id: active.templateId, name: "Default" };
      }
      localStorage.setItem(STORAGE, JSON.stringify(stored));
    }
    stored.assignments ||= stored.preferredWeekdays.map((weekday: number) => ({ weekday, templateId: stored.templates[0].id }));
    return stored;
  } catch {
    return fresh();
  }
};
const save = (s: State) => localStorage.setItem(STORAGE, JSON.stringify(s));
const body = (init: RequestInit) =>
  init.body ? JSON.parse(String(init.body)) : {};
const summary = (s: any) => {
  const sets = s.exercises.flatMap((e: any) => e.sets);
  return {
    durationMinutes: s.finishedAt
      ? Math.max(
          1,
          Math.round(
            (+new Date(s.finishedAt) - +new Date(s.startedAt)) / 60000,
          ),
        )
      : null,
    exerciseCount: s.exercises.filter((e: any) => e.sets.length).length,
    setCount: sets.length,
    volume: sets.reduce((n: number, x: any) => n + x.weight * x.reps, 0),
  };
};
const session = (s: any) => ({
  ...copy(s),
  summary: summary(s),
  exercises: s.exercises.map((e: any) => ({
    ...e,
    exercise: (() => {
      const current = exercises.find((entry) => entry.id === e.exercise.id);
      return current ? { ...e.exercise, nameEn: current.nameEn, nameDe: current.nameDe, nameRu: current.nameRu, images: current.images } : e.exercise;
    })(),
    increment: e.increment ?? e.exercise.defaultIncrement ?? 2.5,
    measurementUnit: e.measurementUnit || "kg",
    suggestIncrease:
      e.sets.length === e.plannedSets &&
      e.sets.every((x: any) => x.reps >= e.maxReps),
  })),
});
export async function guestApi(path: string, init: RequestInit = {}) {
  if (path.startsWith("/nutrition") || path === "/settings/nutrition") {
    const { guestNutritionApi } = await import("./nutritionGuest");
    return guestNutritionApi(path, init);
  }
  const state = load();
  const method = init.method || "GET";
  if (path === "/exercises") return copy(exercises);
  if (path === "/exercises/history") {
    const recorded = new Set(state.sessions.filter((item) => item.status === "completed")
      .flatMap((item) => item.exercises.filter((entry: any) => entry.sets.length > 0).map((entry: any) => entry.exercise.id)));
    return copy(exercises.filter((entry) => recorded.has(entry.id)).sort((a,b) => a.nameEn.localeCompare(b.nameEn)));
  }
  if (path === "/dashboard") {
    const last = state.sessions.filter((s) => s.status === "completed").at(-1);
    const current = state.weights.at(-1)?.weight;
    return {
      nextWorkout: nextDay(state.preferredWeekdays),
      template: (() => {
        const day = new Date(nextDay(state.preferredWeekdays)).getDay();
        const template = state.templates.find((item) => item.id === state.assignments.find((entry) => entry.weekday === day)?.templateId) || state.templates[0];
        return { id: template.id, name: template.name, exerciseCount: template.exercises.length };
      })(),
      last: last ? summary(last) : null,
      currentWeight: current,
      weightChange: null,
      achievements: [],
    };
  }
  if (path === "/workouts/active" && method === "GET") {
    const s = state.sessions.find((s) => s.status === "active");
    return s ? session(s) : null;
  }
  if (path === "/workouts/start") {
    const old = state.sessions.find((s) => s.status === "active");
    if (old) return session(old);
    const intro = body(init).introWeeks;
    const scheduledDay = new Date(nextDay(state.preferredWeekdays)).getDay();
    const templateId = body(init).templateId || state.assignments.find((entry) => entry.weekday === scheduledDay)?.templateId || state.templates[0].id;
    const template = state.templates.find((entry) => entry.id === templateId);
    if (!template) throw new Error("Workout not found");
    const s = {
      templateId: template.id, template: { id: template.id, name: template.name },
      id: crypto.randomUUID(),
      startedAt: new Date().toISOString(),
      status: "active",
      exercises: template.exercises.map((config: any, i: number) => {
        const e = exercises.find((entry) => entry.id === config.exerciseId)!;
        const settings = state.exerciseSettings[e.id];
        return {
          id: crypto.randomUUID(),
          exercise: copy(e),
          sortOrder: i + 1,
          plannedSets:
            config.customized ? config.sets : (intro &&
            [
              "leg-press",
              "chest-press",
              "lat-pulldown",
              "seated-row",
              "shoulder-press",
            ].includes(e.id)
              ? Math.min(2, config.sets)
              : config.sets),
          minReps: config.minReps,
          maxReps: config.maxReps,
          restSeconds: config.restSeconds,
          increment: config.increment,
          measurementUnit: config.measurementUnit || "kg",
          customName: config.customName || null,
          notes: config.notes || null,
          lastWeight: settings?.lastWeight ?? null,
          lastReps: settings?.lastReps ?? null,
          lastRir: settings?.lastRir ?? null,
          sets: [],
        };
      }),
    };
    state.sessions.push(s);
    save(state);
    return session(s);
  }
  const addMatch = path.match(/^\/workouts\/([^/]+)\/exercises$/);
  if (addMatch && method === "POST") {
    const active = state.sessions.find((item) => item.id === addMatch[1] && item.status === "active");
    if (!active) throw new Error("Active workout not found");
    const entry = exercises.find((item) => item.id === body(init).exerciseId);
    if (!entry) throw new Error("Exercise not found");
    if (!active.exercises.some((item: any) => item.exercise.id === entry.id)) {
      const settings = state.exerciseSettings[entry.id];
      active.exercises.push({
        id: crypto.randomUUID(), exercise: copy(entry),
        sortOrder: Math.max(0, ...active.exercises.map((item: any) => item.sortOrder || 0)) + 1,
        plannedSets: settings?.plannedSets ?? entry.defaultSets,
        minReps: entry.minReps, maxReps: entry.maxReps,
        restSeconds: settings?.restSeconds ?? entry.defaultRestSeconds,
        increment: settings?.increment ?? entry.defaultIncrement,
        measurementUnit: settings?.measurementUnit || "kg",
        customName: settings?.customName || null, notes: settings?.notes || null,
        lastWeight: settings?.lastWeight ?? null, lastReps: settings?.lastReps ?? null,
        lastRir: settings?.lastRir ?? null, sets: [],
      });
      save(state);
    }
    return session(active);
  }
  let m = path.match(/^\/workouts\/([^/]+)\/sets$/);
  if (m && method === "POST") {
    const sessionId = m[1];
    const s = state.sessions.find((x) => x.id === sessionId);
    const b = body(init),
      e = s.exercises.find((x: any) => x.id === b.workoutExerciseId);
    const row = {
      id: crypto.randomUUID(),
      setNumber: b.setNumber,
      weight: b.weight,
      reps: b.reps,
      rir: b.rir ?? null,
      completedAt: new Date().toISOString(),
    };
    e.sets.push(row);
    e.lastWeight = b.weight;
    e.lastReps = b.reps;
    e.lastRir = b.rir ?? null;
    state.exerciseSettings[e.exercise.id] = {
      ...(state.exerciseSettings[e.exercise.id] || {
        plannedSets: e.plannedSets,
        measurementUnit: e.measurementUnit,
      }),
      lastWeight: b.weight,
      lastReps: b.reps,
      lastRir: b.rir ?? null,
    };
    save(state);
    return row;
  }
  m = path.match(/^\/workouts\/([^/]+)\/exercises\/([^/]+)\/settings$/);
  if (m && method === "PATCH") {
    const s = state.sessions.find((x) => x.id === m![1]);
    const e = s.exercises.find((x: any) => x.id === m![2]);
    const settings = body(init);
    e.plannedSets = settings.plannedSets;
    e.restSeconds = settings.restSeconds;
    e.increment = settings.increment;
    e.measurementUnit = settings.measurementUnit;
    e.customName = settings.customName || null;
    e.notes = settings.notes || null;
    const config = state.templates.find((template) => template.id === s.templateId)?.exercises.find((entry) => entry.exerciseId === e.exercise.id);
    if (config) Object.assign(config, {
      customized: true, sets: settings.plannedSets, restSeconds: settings.restSeconds,
      increment: settings.increment, measurementUnit: settings.measurementUnit,
      customName: settings.customName || null, notes: settings.notes || null,
    });
    state.exerciseSettings[e.exercise.id] = {
      ...state.exerciseSettings[e.exercise.id],
      plannedSets: settings.plannedSets,
      restSeconds: settings.restSeconds,
      increment: settings.increment,
      measurementUnit: settings.measurementUnit,
      customName: settings.customName || null,
      notes: settings.notes || null,
    };
    save(state);
    return session(s);
  }
  m = path.match(/^\/workouts\/([^/]+)\/sets\/([^/]+)$/);
  if (m && method === "DELETE") {
    const sessionId = m[1],
      setId = m[2];
    const s = state.sessions.find((x) => x.id === sessionId);
    for (const e of s.exercises)
      e.sets = e.sets.filter((x: any) => x.id !== setId);
    save(state);
    return null;
  }
  m = path.match(/^\/workouts\/([^/]+)\/finish$/);
  if (m) {
    const sessionId = m[1];
    const s = state.sessions.find((x) => x.id === sessionId);
    s.status = "completed";
    s.finishedAt = new Date().toISOString();
    save(state);
    return session(s);
  }
  m = path.match(/^\/workouts\/([^/]+)\/resume$/);
  if (m && method === "POST") {
    const s = state.sessions.find((x) => x.id === m![1]);
    const requestedDate = body(init).localDate;
    const finished = new Date(s.finishedAt);
    const finishedDate = `${finished.getFullYear()}-${String(
      finished.getMonth() + 1,
    ).padStart(2, "0")}-${String(finished.getDate()).padStart(2, "0")}`;
    if (s.status !== "completed" || finishedDate !== requestedDate)
      throw new Error("Only today's workout can be resumed");
    if (state.sessions.some((item) => item.status === "active"))
      throw new Error("An active workout already exists");
    s.status = "active";
    delete s.finishedAt;
    save(state);
    return session(s);
  }
  m = path.match(/^\/workouts\/([^/]+)\/active$/);
  if (m && method === "DELETE") {
    const index = state.sessions.findIndex(
      (session) => session.id === m![1] && session.status === "active",
    );
    if (index < 0) throw new Error("Active workout not found");
    state.sessions.splice(index, 1);
    save(state);
    return null;
  }
  m = path.match(/^\/workouts\/([^/]+)$/);
  if (m && method === "DELETE") {
    const index = state.sessions.findIndex(
      (session) => session.id === m![1] && session.status === "completed",
    );
    if (index < 0) throw new Error("Completed workout not found");
    state.sessions.splice(index, 1);
    save(state);
    return null;
  }
  if (path === "/history")
    return state.sessions
      .filter((s) => s.status === "completed")
      .reverse()
      .map(session);
  m = path.match(/^\/exercises\/([^/]+)\/progress$/);
  if (m) {
    const exerciseId = m[1];
    const e = exercises.find((x: any) => x.id === exerciseId);
    return {
      exercise: e,
      history: state.sessions
        .filter((s) => s.status === "completed")
        .flatMap((s) => {
          const we = s.exercises.find((x: any) => x.exercise.id === exerciseId);
          return we?.sets.length
            ? [
                {
                  date: s.finishedAt,
                  weight: Math.max(...we.sets.map((x: any) => x.weight)),
                  volume: we.sets.reduce(
                    (n: number, x: any) => n + x.weight * x.reps,
                    0,
                  ),
                  sets: we.sets,
                },
              ]
            : [];
        }),
    };
  }
  if (path === "/body-weight" && method === "GET") return copy(state.weights);
  if (path === "/body-weight" && method === "POST") {
    const b = body(init),
      row = {
        id: crypto.randomUUID(),
        date: b.date,
        weight: b.weight,
        notes: b.notes,
      };
    state.weights = state.weights.filter(
      (x) => String(x.date).slice(0, 10) !== b.date,
    );
    state.weights.push(row);
    state.weights.sort((a, b) => String(a.date).localeCompare(String(b.date)));
    save(state);
    return row;
  }
  const program = () => ({
    preferredWeekdays: [...state.preferredWeekdays], assignments: copy(state.assignments),
    templates: state.templates.map((template) => ({ ...copy(template), exercises: template.exercises.map((entry) => ({ ...entry, exercise: copy(exercises.find((item) => item.id === entry.exerciseId)) })) })),
  });
  if (path === "/settings/program" && method === "GET") return program();
  if (path === "/settings/program" && method === "PATCH") {
    const payload = body(init);
    const assignments = payload.assignments || payload.preferredWeekdays?.map((weekday: number) => ({ weekday, templateId: state.assignments.find((day) => day.weekday === weekday)?.templateId || state.templates[0].id }));
    if (!Array.isArray(assignments) || !assignments.length || assignments.length > 7 || new Set(assignments.map((a: any) => a.weekday)).size !== assignments.length || assignments.some((day: any) => !Number.isInteger(day.weekday) || day.weekday < 0 || day.weekday > 6 || !state.templates.some((template) => template.id === day.templateId)))
      throw new Error("Select valid training days and workouts");
    state.assignments = assignments;
    state.preferredWeekdays = assignments.map((day: any) => day.weekday).sort((a: number, b: number) => a - b);
    save(state); return program();
  }
  const planMatch = path.match(/^\/settings\/workouts(?:\/([^/]+))?$/);
  if (planMatch && (method === "POST" || method === "PATCH")) {
    const payload = body(init); const name = String(payload.name || "").trim();
    const entries = payload.exercises;
    if (!name || name.length > 80 || !Array.isArray(entries) || !entries.length || entries.length > 50 ||
      new Set(entries.map((e: any) => e.exerciseId)).size !== entries.length || entries.some((e: any) => !exercises.some((item) => item.id === e.exerciseId) || !Number.isInteger(e.sets) || e.sets < 1 || e.sets > 20 || !Number.isInteger(e.minReps) || !Number.isInteger(e.maxReps) || e.minReps < 1 || e.maxReps > 100 || e.minReps > e.maxReps || !Number.isInteger(e.restSeconds) || e.restSeconds < 30 || e.restSeconds > 600 || !(e.increment > 0 && e.increment <= 100) || !["kg", "units"].includes(e.measurementUnit)))
      throw new Error("Invalid workout settings");
    const existing = method === "PATCH" ? state.templates.find((template) => template.id === planMatch[1]) : undefined;
    if (method === "PATCH" && !existing) throw new Error("Workout not found");
    if (state.templates.some((template) => template.id !== existing?.id && template.name.toLocaleLowerCase() === name.toLocaleLowerCase())) throw new Error("A workout with this name already exists");
    const template = existing || { id: crypto.randomUUID(), name, exercises: [] };
    template.name = name;
    template.exercises = entries.map((entry: any) => ({ ...template.exercises.find((item) => item.exerciseId === entry.exerciseId), ...entry, customized: true }));
    if (!existing) state.templates.push(template);
    save(state); return program();
  }
  if (path.match(/^\/exercises\//) && method === "PATCH") return {};
  throw new Error(`Unsupported guest operation: ${method} ${path}`);
}
function nextDay(preferredWeekdays: number[]) {
  const d = new Date();
  for (let i = 0; i < 8; i++) {
    if (preferredWeekdays.includes(d.getDay())) return d.toISOString();
    d.setDate(d.getDate() + 1);
  }
  return d.toISOString();
}
