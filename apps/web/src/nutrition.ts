import { api, isGuest, token } from "./api";
import type {
  MealAnalysis,
  PhotoAnalysisJob,
  Nutrients,
  NutritionDay,
  NutritionEntry,
  NutritionItem,
} from "./types";
import { getLanguage } from "./i18n";

export const emptyNutrients = (): Nutrients => ({
  calories: 0,
  proteinGrams: 0,
  fatGrams: 0,
  carbsGrams: 0,
  fiberGrams: 0,
});

const finite = (value: unknown) =>
  Number.isFinite(Number(value)) ? Number(value) : 0;

export const roundNutrient = (value: number, nutrient: keyof Nutrients) =>
  nutrient === "calories" ? Math.round(value) : Math.round(value * 10) / 10;

export const scaleNutrients = <T extends Nutrients>(
  value: T,
  percent: number,
): Nutrients => {
  const ratio = Math.min(100, Math.max(0, percent)) / 100;
  return {
    calories: roundNutrient(finite(value.calories) * ratio, "calories"),
    proteinGrams: roundNutrient(
      finite(value.proteinGrams) * ratio,
      "proteinGrams",
    ),
    fatGrams: roundNutrient(finite(value.fatGrams) * ratio, "fatGrams"),
    carbsGrams: roundNutrient(finite(value.carbsGrams) * ratio, "carbsGrams"),
    fiberGrams: roundNutrient(finite(value.fiberGrams) * ratio, "fiberGrams"),
  };
};

export const sumItems = (items: NutritionItem[]): Nutrients =>
  items.reduce(
    (total, item) => ({
      calories: total.calories + finite(item.calories),
      proteinGrams: total.proteinGrams + finite(item.proteinGrams),
      fatGrams: total.fatGrams + finite(item.fatGrams),
      carbsGrams: total.carbsGrams + finite(item.carbsGrams),
      fiberGrams: total.fiberGrams + finite(item.fiberGrams),
    }),
    emptyNutrients(),
  );

export const localDate = (date = new Date()) => {
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 10);
};

export const moveLocalDate = (date: string, days: number) => {
  const [year, month, day] = date.split("-").map(Number);
  const next = new Date(year, month - 1, day + days, 12);
  return localDate(next);
};

const normalizeEntry = (entry: any): NutritionEntry => ({
  ...entry,
  items: (entry.items || []).map((item: any) => ({
    ...item,
    estimatedGrams: item.estimatedGrams ?? item.amountGrams ?? 0,
  })),
  thumbnailUrl:
    entry.thumbnailUrl ||
    entry.photo?.thumbnailUrl ||
    (entry.photo?.analysisId || entry.photo?.id
      ? `/api/nutrition/photos/${entry.photo.analysisId || entry.photo.id}/thumbnail`
      : null),
  assumptions: entry.assumptions || entry.analysis?.assumptions || [],
  uncertainty: entry.uncertainty || entry.analysis?.uncertainty || null,
  originalAnalysis: entry.originalAnalysis || entry.analysis,
});

export const nutritionDay = async (date: string) => {
  const value = await api<NutritionDay & { proteinTargetGrams?: number }>(
    `/nutrition/days/${date}?timezone=${encodeURIComponent(Intl.DateTimeFormat().resolvedOptions().timeZone)}`,
  );
  return {
    ...value,
    proteinTarget: value.proteinTarget ?? value.proteinTargetGrams ?? 0,
    entries: (value.entries || []).map(normalizeEntry),
  };
};

export const saveNutritionEntry = (
  entry: Omit<NutritionEntry, "id"> & { id?: string },
) => {
  const body = JSON.stringify({
    occurredAt: entry.occurredAt,
    mealType: entry.mealType,
    title: entry.title,
    consumedPercent: entry.consumedPercent,
    ...(!entry.id && entry.originalAnalysis && typeof entry.originalAnalysis === "object"
      ? { analysisId: (entry.originalAnalysis as MealAnalysis).id }
      : {}),
    items: entry.items.map((item) => ({
      name: item.name,
      amountGrams: item.estimatedGrams,
      calories: item.calories,
      proteinGrams: item.proteinGrams,
      fatGrams: item.fatGrams,
      carbsGrams: item.carbsGrams,
      fiberGrams: item.fiberGrams,
    })),
  });
  return entry.id
    ? api<NutritionEntry>(`/nutrition/entries/${entry.id}`, {
        method: "PATCH",
        body,
      })
    : api<NutritionEntry>("/nutrition/entries", {
        method: "POST",
        body,
      });
};

export const deleteNutritionEntry = (id: string) =>
  api(`/nutrition/entries/${id}`, { method: "DELETE" });

const analysisDeviceId = () => {
  const key = "kirfit_nutrition_device";
  const existing = localStorage.getItem(key);
  if (existing) return existing;
  const id = crypto.randomUUID();
  localStorage.setItem(key, id);
  return id;
};

export function analysisHeaders() {
  const headers = new Headers();
  headers.set("Accept-Language", getLanguage());
  if (token()) headers.set("Authorization", `Bearer ${token()}`);
  if (isGuest()) headers.set("X-Kirfit-Device", analysisDeviceId());
  return headers;
}

async function analysisRequest(
  path: string,
  body: FormData | string,
  idempotencyKey?: string,
) {
  const headers = analysisHeaders();
  if (idempotencyKey) headers.set("Idempotency-Key", idempotencyKey);
  if (typeof body === "string") headers.set("Content-Type", "application/json");
  const response = await fetch(`/api${path}`, { method: "POST", headers, body });
  if (!response.ok) {
    const problem = await response.json().catch(() => ({}));
    const error = new Error(problem.error || "Meal analysis unavailable");
    (error as Error & { status?: number }).status = response.status;
    throw error;
  }
  const result = await response.json();
  return result as PhotoAnalysisJob;
}

export const analyzeMeal = (file: File) => {
  if (!file.type.startsWith("image/")) throw new Error("invalid-image");
  if (file.size > 10 * 1024 * 1024) throw new Error("image-too-large");
  const body = new FormData();
  body.set("image", file);
  return analysisRequest(
    "/nutrition/photos/analyze",
    body,
    crypto.randomUUID(),
  );
};

export const clarifyMeal = (
  analysis: MealAnalysis,
  answers: Record<string, string>,
) =>
  analysisRequest(
    `/nutrition/photos/analyze/${analysis.id}/clarify`,
    JSON.stringify({
      answers,
      priorAnalysis: analysis.providerResult || analysis,
      clarificationRound: analysis.clarificationRound,
    }),
    crypto.randomUUID(),
  );

export async function photoAnalysisJobs() {
  const response = await fetch("/api/nutrition/photos", {
    headers: analysisHeaders(),
  });
  if (!response.ok) throw new Error("analysis-list-unavailable");
  return (await response.json()) as PhotoAnalysisJob[];
}

export async function photoAnalysisStatus(analysisId: string) {
  const response = await fetch(
    `/api/nutrition/photos/${encodeURIComponent(analysisId)}/status`,
    { headers: analysisHeaders() },
  );
  if (!response.ok && response.status !== 202)
    throw new Error("analysis-status-unavailable");
  return (await response.json()) as PhotoAnalysisJob;
}

export async function deletePhotoAnalysis(analysisId: string) {
  const response = await fetch(
    `/api/nutrition/photos/${encodeURIComponent(analysisId)}`,
    { method: "DELETE", headers: analysisHeaders() },
  );
  if (!response.ok && response.status !== 404)
    throw new Error("analysis-delete-unavailable");
}

export const finalizePhotoAnalysis = (analysisId: string) =>
  analysisRequest(
    `/nutrition/photos/${encodeURIComponent(analysisId)}/finalize`,
    "{}",
  );
