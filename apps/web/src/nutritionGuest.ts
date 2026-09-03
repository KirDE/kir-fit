import type {
  Nutrients,
  NutritionDay,
  NutritionEntry,
  NutritionItem,
} from "./types";
import { emptyNutrients, scaleNutrients, sumItems } from "./nutrition";

const KEY = "kirfit_guest_nutrition_v1";

type GuestNutritionProfile = {
  heightCm: number | null;
  goalWeightKg: number | null;
  proteinTargetMode: "automatic" | "manual";
  manualProteinTargetGrams: number | null;
};

type GuestNutritionState = {
  profile: GuestNutritionProfile;
  entries: NutritionEntry[];
};

const initial = (): GuestNutritionState => ({
  profile: {
    heightCm: null,
    goalWeightKg: null,
    proteinTargetMode: "automatic",
    manualProteinTargetGrams: null,
  },
  entries: [],
});

const load = (): GuestNutritionState => {
  try {
    const parsed = JSON.parse(localStorage.getItem(KEY) || "null");
    return parsed?.profile && Array.isArray(parsed.entries) ? parsed : initial();
  } catch {
    return initial();
  }
};

const save = (state: GuestNutritionState) =>
  localStorage.setItem(KEY, JSON.stringify(state));

const parseBody = (init: RequestInit) =>
  init.body ? JSON.parse(String(init.body)) : {};

const latestGuestWeight = (): number | null => {
  try {
    const data = JSON.parse(localStorage.getItem("kirfit_guest_data_v1") || "{}");
    const weights = Array.isArray(data.weights) ? data.weights : [];
    return weights.length ? Number(weights.at(-1).weight) : null;
  } catch {
    return null;
  }
};

const calculation = (profile: GuestNutritionProfile) => {
  if (
    profile.proteinTargetMode === "manual" &&
    profile.manualProteinTargetGrams
  )
    return {
      targetGrams: profile.manualProteinTargetGrams,
      referenceWeightKg: null,
      rangeMinGrams: null,
      rangeMaxGrams: null,
      explanation: "manual",
    };
  const currentWeight = latestGuestWeight();
  if (!currentWeight || !profile.heightCm)
    return {
      targetGrams: 0,
      referenceWeightKg: null,
      rangeMinGrams: null,
      rangeMaxGrams: null,
      explanation: "missing-height-or-weight",
    };
  const meters = profile.heightCm / 100;
  const bmi = currentWeight / meters ** 2;
  const referenceWeightKg =
    bmi < 30
      ? currentWeight
      : profile.goalWeightKg || Math.round(25 * meters ** 2 * 10) / 10;
  return {
    targetGrams: Math.round((referenceWeightKg * 1.6) / 5) * 5,
    referenceWeightKg,
    rangeMinGrams: Math.round(referenceWeightKg * 1.2),
    rangeMaxGrams: Math.round(referenceWeightKg * 1.6),
    explanation: bmi < 30 ? "current-weight" : profile.goalWeightKg ? "goal-weight" : "bmi-25",
  };
};

const normalizedItem = (item: Partial<NutritionItem>): NutritionItem => ({
  id: item.id || crypto.randomUUID(),
  name: String(item.name || "Food").slice(0, 120),
  estimatedGrams: Math.max(
    0,
    Number(item.estimatedGrams ?? (item as NutritionItem & { amountGrams?: number }).amountGrams) || 0,
  ),
  calories: Math.max(0, Number(item.calories) || 0),
  proteinGrams: Math.max(0, Number(item.proteinGrams) || 0),
  fatGrams: Math.max(0, Number(item.fatGrams) || 0),
  carbsGrams: Math.max(0, Number(item.carbsGrams) || 0),
  fiberGrams: Math.max(0, Number(item.fiberGrams) || 0),
});

const normalizedEntry = (value: Partial<NutritionEntry>, id?: string) => {
  const items = (value.items || []).map(normalizedItem);
  const full = items.length ? sumItems(items) : (value as Nutrients);
  const consumedPercent = Math.min(
    100,
    Math.max(0, Math.round(Number(value.consumedPercent ?? 100))),
  );
  return {
    ...scaleNutrients(full, consumedPercent),
    id: id || crypto.randomUUID(),
    occurredAt: value.occurredAt || new Date().toISOString(),
    mealType: value.mealType || "snack",
    title: String(value.title || "Meal").slice(0, 120),
    consumedPercent,
    items,
    thumbnailUrl: value.thumbnailUrl || null,
    assumptions: value.assumptions || [],
    uncertainty: value.uncertainty || null,
    originalAnalysis: value.originalAnalysis,
  } satisfies NutritionEntry;
};

const dayFor = (state: GuestNutritionState, date: string): NutritionDay => {
  const entries = state.entries.filter((entry) => {
    const time = new Date(entry.occurredAt);
    const offset = time.getTimezoneOffset() * 60_000;
    return new Date(time.getTime() - offset).toISOString().slice(0, 10) === date;
  });
  const totals = entries.reduce(
    (sum, entry) => ({
      calories: sum.calories + entry.calories,
      proteinGrams: sum.proteinGrams + entry.proteinGrams,
      fatGrams: sum.fatGrams + entry.fatGrams,
      carbsGrams: sum.carbsGrams + entry.carbsGrams,
      fiberGrams: sum.fiberGrams + entry.fiberGrams,
    }),
    emptyNutrients(),
  );
  return {
    date,
    entries: entries.sort((a, b) => a.occurredAt.localeCompare(b.occurredAt)),
    totals,
    proteinTarget: calculation(state.profile).targetGrams,
  };
};

export async function guestNutritionApi(path: string, init: RequestInit = {}) {
  if (!path.startsWith("/nutrition") && path !== "/settings/nutrition")
    return undefined;
  const state = load();
  const method = init.method || "GET";
  if (path === "/settings/nutrition" && method === "GET")
    return { ...state.profile, calculation: calculation(state.profile) };
  if (path === "/settings/nutrition" && method === "PATCH") {
    const value = parseBody(init);
    state.profile = {
      heightCm: value.heightCm == null ? null : Number(value.heightCm),
      goalWeightKg:
        value.goalWeightKg == null ? null : Number(value.goalWeightKg),
      proteinTargetMode:
        value.proteinTargetMode === "manual" ? "manual" : "automatic",
      manualProteinTargetGrams:
        value.manualProteinTargetGrams == null
          ? null
          : Number(value.manualProteinTargetGrams),
    };
    save(state);
    return { ...state.profile, calculation: calculation(state.profile) };
  }
  const day = path.match(/^\/nutrition\/days\/(\d{4}-\d{2}-\d{2})/);
  if (day && method === "GET") return dayFor(state, day[1]);
  if (path === "/nutrition/entries" && method === "GET")
    return state.entries;
  if (path === "/nutrition/entries" && method === "POST") {
    const entry = normalizedEntry(parseBody(init));
    if (entry.consumedPercent === 0) throw new Error("zero-consumption");
    state.entries.push(entry);
    save(state);
    return entry;
  }
  const entryPath = path.match(/^\/nutrition\/entries\/([^/?]+)/);
  if (entryPath && method === "PATCH") {
    const index = state.entries.findIndex((entry) => entry.id === entryPath[1]);
    if (index < 0) throw new Error("Nutrition entry not found");
    const entry = normalizedEntry(
      { ...state.entries[index], ...parseBody(init) },
      state.entries[index].id,
    );
    if (entry.consumedPercent === 0) throw new Error("zero-consumption");
    state.entries[index] = entry;
    save(state);
    return entry;
  }
  if (entryPath && method === "DELETE") {
    state.entries = state.entries.filter((entry) => entry.id !== entryPath[1]);
    save(state);
    return null;
  }
  throw new Error(`Unsupported guest nutrition operation: ${method} ${path}`);
}

export const GUEST_NUTRITION_KEY = KEY;
