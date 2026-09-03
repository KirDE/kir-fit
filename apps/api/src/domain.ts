export function shouldSuggestIncrease(sets:{reps:number}[], plannedSets:number, maxReps:number) {
  return sets.length >= plannedSets && sets.slice(0,plannedSets).every(s=>s.reps>=maxReps);
}
export function volume(sets:{weight:number|string;reps:number}[]) {
  return sets.reduce((sum,s)=>sum+Number(s.weight)*s.reps,0);
}
export function nextWorkoutDay(now:Date, preferred:number[]) {
  for(let add=0;add<8;add++){const d=new Date(now);d.setDate(d.getDate()+add);if(preferred.includes(d.getDay()))return d;}return now;
}

export type ProteinTargetMode = "automatic" | "manual";

export interface ProteinTargetInput {
  heightCm: number | null;
  currentWeightKg: number | null;
  startingWeightKg: number | null;
  goalWeightKg: number | null;
  mode: ProteinTargetMode;
  manualProteinTargetGrams: number | null;
}

export interface ProteinTargetCalculation {
  mode: ProteinTargetMode;
  currentWeightKg: number | null;
  weightSource: "latest" | "starting" | null;
  bmi: number | null;
  referenceWeightKg: number | null;
  referenceWeightSource: "current" | "goal" | "bmi25" | null;
  multiplierGramsPerKg: 1.6;
  recommendedRangeGrams: { min: number; max: number } | null;
  targetGrams: number | null;
  automaticTargetGrams: number | null;
  isEstimate: true;
}

const roundToFive = (value: number) => Math.round(value / 5) * 5;
const roundOne = (value: number) => Math.round(value * 10) / 10;

/**
 * Transparent protein target used by both authenticated and guest clients.
 * No target is returned until height and at least one weight are available.
 */
export function calculateProteinTarget(
  input: ProteinTargetInput,
): ProteinTargetCalculation {
  const currentWeightKg = input.currentWeightKg ?? input.startingWeightKg;
  const weightSource = input.currentWeightKg
    ? "latest"
    : input.startingWeightKg
      ? "starting"
      : null;
  const heightM = input.heightCm ? input.heightCm / 100 : null;
  const bmi =
    heightM && currentWeightKg
      ? roundOne(currentWeightKg / (heightM * heightM))
      : null;

  let referenceWeightKg: number | null = null;
  let referenceWeightSource: ProteinTargetCalculation["referenceWeightSource"] =
    null;
  if (heightM && currentWeightKg && bmi !== null) {
    if (bmi < 30) {
      referenceWeightKg = currentWeightKg;
      referenceWeightSource = "current";
    } else if (input.goalWeightKg !== null) {
      referenceWeightKg = input.goalWeightKg;
      referenceWeightSource = "goal";
    } else {
      referenceWeightKg = roundOne(25 * heightM * heightM);
      referenceWeightSource = "bmi25";
    }
  }

  const automaticTargetGrams = referenceWeightKg
    ? roundToFive(referenceWeightKg * 1.6)
    : null;
  const recommendedRangeGrams = referenceWeightKg
    ? {
        min: roundToFive(referenceWeightKg * 1.2),
        max: roundToFive(referenceWeightKg * 1.6),
      }
    : null;

  return {
    mode: input.mode,
    currentWeightKg,
    weightSource,
    bmi,
    referenceWeightKg,
    referenceWeightSource,
    multiplierGramsPerKg: 1.6,
    recommendedRangeGrams,
    targetGrams:
      input.mode === "manual"
        ? input.manualProteinTargetGrams
        : automaticTargetGrams,
    automaticTargetGrams,
    isEstimate: true,
  };
}

export interface Nutrients {
  calories: number;
  proteinGrams: number;
  fatGrams: number;
  carbsGrams: number;
  fiberGrams: number;
}

export const emptyNutrients = (): Nutrients => ({
  calories: 0,
  proteinGrams: 0,
  fatGrams: 0,
  carbsGrams: 0,
  fiberGrams: 0,
});

export function sumNutrients(values: Nutrients[]): Nutrients {
  return values.reduce((total, value) => ({
    calories: total.calories + value.calories,
    proteinGrams: total.proteinGrams + value.proteinGrams,
    fatGrams: total.fatGrams + value.fatGrams,
    carbsGrams: total.carbsGrams + value.carbsGrams,
    fiberGrams: total.fiberGrams + value.fiberGrams,
  }), emptyNutrients());
}

export function scaleNutrients(
  nutrients: Nutrients,
  consumedPercent: number,
): Nutrients {
  const scale = consumedPercent / 100;
  const fixed = (value: number) => Math.round(value * scale * 100) / 100;
  return {
    calories: fixed(nutrients.calories),
    proteinGrams: fixed(nutrients.proteinGrams),
    fatGrams: fixed(nutrients.fatGrams),
    carbsGrams: fixed(nutrients.carbsGrams),
    fiberGrams: fixed(nutrients.fiberGrams),
  };
}

/** Resolve a local YYYY-MM-DD midnight to UTC for an arbitrary IANA zone. */
export function localDateToUtc(date: string, timeZone: string): Date {
  const [year, month, day] = date.split("-").map(Number);
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  });
  const wanted = Date.UTC(year, month - 1, day);
  let result = wanted;
  for (let iteration = 0; iteration < 3; iteration++) {
    const parts = Object.fromEntries(
      formatter
        .formatToParts(new Date(result))
        .filter((part) => part.type !== "literal")
        .map((part) => [part.type, Number(part.value)]),
    );
    const represented = Date.UTC(
      parts.year,
      parts.month - 1,
      parts.day,
      parts.hour,
      parts.minute,
      parts.second,
    );
    result += wanted - represented;
  }
  return new Date(result);
}

export function nextLocalDate(date: string): string {
  const [year, month, day] = date.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day + 1))
    .toISOString()
    .slice(0, 10);
}

export function localDateKey(date: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const values = Object.fromEntries(
    parts
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, part.value]),
  );
  return `${values.year}-${values.month}-${values.day}`;
}
