import type { MealAnalysis } from "../meal-analysis.js";

const estimate = (value: number, spread = 0.2) => ({
  estimate: value,
  min: Math.max(0, value * (1 - spread)),
  max: value * (1 + spread),
});

function fixture(
  summary: string,
  food: string,
  assumption: string,
  recognizable = true,
): MealAnalysis {
  return {
    summary,
    foods: [
      {
        name: food,
        portion: { estimatedGrams: 300, minGrams: 220, maxGrams: 400 },
        calories: estimate(450),
        proteinGrams: estimate(30),
        fatGrams: estimate(18),
        carbsGrams: estimate(42),
        fiberGrams: estimate(7),
        confidence: recognizable ? "medium" : "low",
        confidenceScore: recognizable ? 0.65 : 0.1,
      },
    ],
    totals: {
      calories: estimate(450),
      proteinGrams: estimate(30),
      fatGrams: estimate(18),
      carbsGrams: estimate(42),
      fiberGrams: estimate(7),
    },
    assumptions: [
      { text: assumption, impact: "material", nutrientImpactPercent: 25 },
    ],
    alternatives: [],
    clarificationQuestions: [
      {
        id: "preparation_detail",
        question: assumption,
        options: [],
        impact: "Calories may change by more than 15%.",
        required: true,
      },
    ],
    overallConfidence: recognizable ? "medium" : "low",
    isRecognizable: recognizable,
  };
}

export const mealAnalysisV1Fixtures = [
  fixture("Mixed salad", "Mixed salad", "Which dressing or sauce was used?"),
  fixture("Fried food", "Fried potatoes", "How much oil was used or absorbed?"),
  fixture("Protein and side", "Chicken with rice", "Was the chicken cooked with oil?"),
  fixture("Soup or stew", "Vegetable stew", "Does the broth contain cream?"),
  fixture("Packaged product", "Packaged yogurt", "What fat percentage is on the label?"),
  fixture("Unrecognizable image", "Unknown food", "Please identify the dish.", false),
] as const;
