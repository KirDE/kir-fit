export type SetRow={id:string;setNumber:number;weight:number;reps:number;rir:number|null};
export type Exercise={id:string;nameEn:string;nameDe:string;nameRu?:string;description:string;descriptionDe?:string;descriptionRu?:string;instructions:string;instructionsDe?:string;instructionsRu?:string;targetMuscles:string[];defaultIncrement:number;images:{path:string;caption?:string}[];machines:any[]};
export type WorkoutExercise={id:string;exercise:Exercise;plannedSets:number;minReps:number;maxReps:number;restSeconds:number;increment:number;measurementUnit:"kg"|"units";customName?:string|null;lastWeight?:number|null;lastReps?:number|null;lastRir?:number|null;sets:SetRow[];suggestIncrease:boolean;machine?:any};
export type Session={id:string;startedAt:string;finishedAt?:string;status:string;exercises:WorkoutExercise[];summary:any};

export type Nutrients = {
  calories: number;
  proteinGrams: number;
  fatGrams: number;
  carbsGrams: number;
  fiberGrams: number;
};

export type NutritionItem = Nutrients & {
  id?: string;
  name: string;
  estimatedGrams: number;
};

export type NutritionEntry = Nutrients & {
  id: string;
  occurredAt: string;
  mealType: "breakfast" | "lunch" | "dinner" | "snack";
  title: string;
  consumedPercent: number;
  items: NutritionItem[];
  thumbnailUrl?: string | null;
  assumptions?: string[];
  uncertainty?: string | null;
  originalAnalysis?: unknown;
};

export type NutritionDay = {
  date: string;
  proteinTarget: number;
  totals: Nutrients;
  entries: NutritionEntry[];
};

export type ClarificationQuestion = {
  id: string;
  text: string;
  choices: string[];
  allowFreeText?: boolean;
};

export type MealAnalysis = {
  id: string;
  title: string;
  items: NutritionItem[];
  assumptions: string[];
  uncertainty?: string;
  questions: ClarificationQuestion[];
  clarificationRound: number;
  thumbnailUrl?: string;
  providerResult?: unknown;
};
