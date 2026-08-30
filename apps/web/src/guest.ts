const STORAGE = "kirfit_guest_data_v1";
const copy = (x: any) => structuredClone(x);
const exercises = [
  [
    "leg-press",
    "Leg Press",
    "Beinpresse",
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
    "Leg Curl",
    "Beinbeuger",
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
    "Triceps Pushdown",
    "Trizeps am Kabel",
    "A cable station where a bar or rope is pushed down.",
    "Kabelstation, an der Stange oder Seil nach unten gedrückt werden.",
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
      "leg-press": "Жим ногами",
      "chest-press": "Жим от груди",
      "lat-pulldown": "Тяга верхнего блока",
      "seated-row": "Горизонтальная тяга",
      "leg-curl": "Сгибание ног",
      "shoulder-press": "Жим на плечи",
      "triceps-pushdown": "Разгибание рук на блоке",
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
      "triceps-pushdown": "Блочный тренажёр для разгибания рук вниз.",
      "biceps-curl": "Тренажёр для сгибания рук к плечам.",
    } as Record<string, string>
  )[x[0]],
  instructions: "Use a controlled range of motion and keep stable posture.",
  instructionsDe:
    "Kontrollierten Bewegungsumfang verwenden und den Körper stabil halten.",
  instructionsRu:
    "Выполняйте движение подконтрольно и сохраняйте устойчивое положение тела.",
  targetMuscles: [],
  defaultSets: x[5],
  minReps: x[6],
  maxReps: x[7],
  defaultRestSeconds: x[8],
  defaultIncrement: x[9],
  images: [{ path: `/exercise-images/${x[0]}.webp` }],
  machines: [],
}));
type State = {
  sessions: any[];
  weights: any[];
  preferredWeekdays: number[];
  exerciseSettings: Record<
    string,
    {
      plannedSets: number;
      increment?: number;
      measurementUnit: "kg" | "units";
      customName?: string | null;
      lastWeight?: number | null;
      lastReps?: number | null;
      lastRir?: number | null;
    }
  >;
};
const fresh = (): State => ({
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
    increment: e.increment ?? e.exercise.defaultIncrement ?? 2.5,
    measurementUnit: e.measurementUnit || "kg",
    suggestIncrease:
      e.sets.length === e.plannedSets &&
      e.sets.every((x: any) => x.reps >= e.maxReps),
  })),
});
export async function guestApi(path: string, init: RequestInit = {}) {
  const state = load();
  const method = init.method || "GET";
  if (path === "/exercises") return copy(exercises);
  if (path === "/dashboard") {
    const last = state.sessions.filter((s) => s.status === "completed").at(-1);
    const current = state.weights.at(-1)?.weight;
    return {
      nextWorkout: nextDay(state.preferredWeekdays),
      template: { id: "guest-full-body", name: "Full Body" },
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
    const s = {
      id: crypto.randomUUID(),
      startedAt: new Date().toISOString(),
      status: "active",
      exercises: exercises.map((e: any, i) => {
        const settings = state.exerciseSettings[e.id];
        return {
          id: crypto.randomUUID(),
          exercise: copy(e),
          sortOrder: i + 1,
          plannedSets:
            settings?.plannedSets ??
            (intro &&
            [
              "leg-press",
              "chest-press",
              "lat-pulldown",
              "seated-row",
              "shoulder-press",
            ].includes(e.id)
              ? Math.min(2, e.defaultSets)
              : e.defaultSets),
          minReps: e.minReps,
          maxReps: e.maxReps,
          restSeconds: e.defaultRestSeconds,
          increment: settings?.increment ?? e.defaultIncrement,
          measurementUnit: settings?.measurementUnit || "kg",
          customName: settings?.customName || null,
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
    e.increment = settings.increment;
    e.measurementUnit = settings.measurementUnit;
    e.customName = settings.customName || null;
    state.exerciseSettings[e.exercise.id] = {
      ...state.exerciseSettings[e.exercise.id],
      plannedSets: settings.plannedSets,
      increment: settings.increment,
      measurementUnit: settings.measurementUnit,
      customName: settings.customName || null,
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
  if (path === "/settings/program" && method === "GET")
    return { preferredWeekdays: [...state.preferredWeekdays] };
  if (path === "/settings/program" && method === "PATCH") {
    const days = body(init).preferredWeekdays;
    if (!Array.isArray(days) || !days.length)
      throw new Error("Select at least one training day");
    state.preferredWeekdays = [...new Set(days)].sort((a, b) => a - b);
    save(state);
    return { preferredWeekdays: [...state.preferredWeekdays] };
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
