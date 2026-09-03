import { beforeEach, describe, expect, it } from "vitest";
import { guestApi } from "./guest";
import {
  localDate,
  moveLocalDate,
  scaleNutrients,
  sumItems,
} from "./nutrition";
import { normalizeMealAnalysis } from "./Nutrition";

const values = new Map<string, string>();
Object.defineProperty(globalThis, "localStorage", {
  configurable: true,
  value: {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
  },
});

const meal = {
  occurredAt: "2026-09-03T12:00:00",
  mealType: "lunch",
  title: "Chicken salad",
  consumedPercent: 50,
  items: [
    {
      name: "Chicken",
      estimatedGrams: 200,
      calories: 330,
      proteinGrams: 62,
      fatGrams: 7.2,
      carbsGrams: 0,
      fiberGrams: 0,
    },
    {
      name: "Salad and dressing",
      estimatedGrams: 180,
      calories: 210,
      proteinGrams: 4,
      fatGrams: 15,
      carbsGrams: 15,
      fiberGrams: 5,
    },
  ],
};

describe("nutrition calculations", () => {
  beforeEach(() => values.clear());

  it("scales the full serving deterministically without capping progress totals", () => {
    const full = sumItems(meal.items);
    expect(scaleNutrients(full, 50)).toEqual({
      calories: 270,
      proteinGrams: 33,
      fatGrams: 11.1,
      carbsGrams: 7.5,
      fiberGrams: 2.5,
    });
    expect(scaleNutrients({ ...full, proteinGrams: 133 }, 100).proteinGrams).toBe(
      133,
    );
  });

  it("uses calendar dates instead of adding UTC milliseconds", () => {
    expect(moveLocalDate("2026-03-29", -1)).toBe("2026-03-28");
    expect(moveLocalDate("2026-12-31", 1)).toBe("2027-01-01");
    expect(localDate(new Date(2026, 8, 3, 23, 30))).toBe("2026-09-03");
  });

  it("maps the structured vision response to editable flat values", () => {
    const analysis = normalizeMealAnalysis({
      analysisId: "analysis-1",
      result: {
        summary: "Chicken salad",
        foods: [
          {
            name: "Chicken",
            portion: { estimatedGrams: 180, minGrams: 150, maxGrams: 220 },
            calories: { estimate: 300, min: 250, max: 360 },
            proteinGrams: { estimate: 55, min: 45, max: 65 },
            fatGrams: { estimate: 8, min: 5, max: 12 },
            carbsGrams: { estimate: 1, min: 0, max: 2 },
            fiberGrams: { estimate: 0, min: 0, max: 0 },
          },
        ],
        totals: {
          calories: { estimate: 300, min: 250, max: 360 },
          proteinGrams: { estimate: 55, min: 45, max: 65 },
        },
        assumptions: [{ text: "No added oil", impact: "material" }],
        clarificationQuestions: [
          {
            id: "sauce",
            question: "Which dressing?",
            options: ["Cocktail sauce", "Oil and vinegar"],
          },
        ],
      },
    });
    expect(analysis).toMatchObject({
      id: "analysis-1",
      title: "Chicken salad",
      items: [{ estimatedGrams: 180, calories: 300, proteinGrams: 55 }],
      assumptions: ["No added oil"],
      questions: [
        {
          id: "sauce",
          text: "Which dressing?",
          choices: ["Cocktail sauce", "Oil and vinegar"],
          allowFreeText: true,
        },
      ],
    });
    expect(analysis.uncertainty).toContain("250–360 kcal");
  });
});

describe("guest nutrition journal", () => {
  beforeEach(() => values.clear());

  it("persists manual meals, scales consumption and updates after edit/delete", async () => {
    const saved: any = await guestApi("/nutrition/entries", {
      method: "POST",
      body: JSON.stringify(meal),
    });
    expect(saved).toMatchObject({ calories: 270, proteinGrams: 33 });
    let day: any = await guestApi("/nutrition/days/2026-09-03?timezone=Europe/Berlin");
    expect(day.totals).toMatchObject({ calories: 270, proteinGrams: 33 });

    await guestApi(`/nutrition/entries/${saved.id}`, {
      method: "PATCH",
      body: JSON.stringify({ consumedPercent: 100 }),
    });
    day = await guestApi("/nutrition/days/2026-09-03?timezone=Europe/Berlin");
    expect(day.totals).toMatchObject({ calories: 540, proteinGrams: 66 });

    await guestApi(`/nutrition/entries/${saved.id}`, { method: "DELETE" });
    day = await guestApi("/nutrition/days/2026-09-03?timezone=Europe/Berlin");
    expect(day.entries).toEqual([]);
    expect(day.totals.proteinGrams).toBe(0);
  });

  it("survives module calls and calculates the guest protein target", async () => {
    values.set(
      "kirfit_guest_data_v1",
      JSON.stringify({ weights: [{ date: "2026-09-03", weight: 110 }] }),
    );
    const profile: any = await guestApi("/settings/nutrition", {
      method: "PATCH",
      body: JSON.stringify({
        heightCm: 180,
        goalWeightKg: null,
        proteinTargetMode: "automatic",
        manualProteinTargetGrams: null,
      }),
    });
    expect(profile.calculation).toMatchObject({
      targetGrams: 130,
      explanation: "bmi-25",
    });
    expect(values.get("kirfit_guest_nutrition_v1")).toContain('"heightCm":180');
  });

  it("does not silently add a zero-percent entry", async () => {
    await expect(
      guestApi("/nutrition/entries", {
        method: "POST",
        body: JSON.stringify({ ...meal, consumedPercent: 0 }),
      }),
    ).rejects.toThrow("zero-consumption");
  });
});
