import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { guestApi } from "./guest";
import {
  localDate,
  moveLocalDate,
  analyzeMeal,
  clarifyMeal,
  saveNutritionEntry,
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
  mealType: "lunch" as const,
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

afterEach(() => vi.unstubAllGlobals());

describe("meal analysis normalization", () => {
  it("replaces a verbose photo description with a concise food title", () => {
    const normalized = normalizeMealAnalysis({
      analysisId: "analysis-title-test",
      result: {
        summary: "На фото изображен пакетик порошкового крем-супа со вкусом спаржи от Knorr, приготовленный только с водой",
        foods: [{
          name: "Крем-суп из спаржи Knorr",
          portion: { estimatedGrams: 250 },
          calories: { estimate: 180 },
          proteinGrams: { estimate: 4 },
          fatGrams: { estimate: 6 },
          carbsGrams: { estimate: 28 },
          fiberGrams: { estimate: 2 },
        }],
        assumptions: [],
        clarificationQuestions: [],
      },
    });

    expect(normalized.title).toBe("Крем-суп из спаржи Knorr");
  });
});

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

  it("uses the server photo contract and attaches analysisId when saving", async () => {
    values.set("kirfit_token", "test-token");
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      if (init?.body instanceof FormData) {
        expect(init.body.get("image")).toBeTruthy();
        expect(init.body.get("photo")).toBeNull();
        return new Response(
          JSON.stringify({
            analysisId: "7ed9bb35-40ab-4fe4-a78f-2cafb9d2381e",
            status: "completed",
            result: { summary: "Meal", foods: [] },
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }
      return new Response(JSON.stringify({ id: "entry-1" }), {
        status: 201,
        headers: { "Content-Type": "application/json" },
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    await analyzeMeal(
      new File([new Uint8Array([0xff, 0xd8, 0xff])], "meal.jpg", {
        type: "image/jpeg",
      }),
    );
    await saveNutritionEntry({
      ...meal,
      id: undefined,
      calories: 540,
      proteinGrams: 66,
      fatGrams: 22.2,
      carbsGrams: 15,
      fiberGrams: 5,
      originalAnalysis: {
        id: "7ed9bb35-40ab-4fe4-a78f-2cafb9d2381e",
        title: "Meal",
        items: [],
        assumptions: [],
        questions: [],
        clarificationRound: 0,
      },
    });
    const saveCall = fetchMock.mock.calls[1];
    const body = JSON.parse(String(saveCall[1]?.body));
    expect(body.analysisId).toBe("7ed9bb35-40ab-4fe4-a78f-2cafb9d2381e");
  });

  it("bounds long AI text after clarification and saves the analyzed meal", async () => {
    values.set("kirfit_token", "test-token");
    const analysisId = "7ed9bb35-40ab-4fe4-a78f-2cafb9d2381e";
    const longTitle = "Очень подробное описание блюда ".repeat(10);
    const longFoodName = "Очень подробное название компонента ".repeat(8);
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (url.includes("/clarify")) {
        return new Response(
          JSON.stringify({
            analysisId,
            status: "completed",
            result: {
              summary: longTitle,
              foods: [
                {
                  name: longFoodName,
                  portion: { estimatedGrams: 250 },
                  calories: { estimate: 420 },
                  proteinGrams: { estimate: 32 },
                  fatGrams: { estimate: 18 },
                  carbsGrams: { estimate: 30 },
                  fiberGrams: { estimate: 6 },
                },
              ],
              assumptions: [],
              clarificationQuestions: [],
            },
            metadata: { clarificationRound: 2 },
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }
      return new Response(JSON.stringify({ id: "entry-after-clarification" }), {
        status: 201,
        headers: { "Content-Type": "application/json" },
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    const refined = normalizeMealAnalysis(
      await clarifyMeal(
        {
          id: analysisId,
          title: "Meal",
          items: meal.items,
          assumptions: [],
          questions: [{ id: "sauce", text: "Соус?", choices: ["Масло"] }],
          clarificationRound: 1,
          providerResult: { summary: "Meal", foods: [] },
        },
        { sauce: "Масло" },
      ),
    );
    expect(refined.id).toBe(analysisId);
    expect(refined.title.length).toBeLessThanOrEqual(72);
    expect(refined.items[0].name.length).toBeLessThanOrEqual(120);

    await saveNutritionEntry({
      occurredAt: meal.occurredAt,
      mealType: meal.mealType,
      title: refined.title,
      consumedPercent: 100,
      items: refined.items,
      ...sumItems(refined.items),
      originalAnalysis: refined,
    });
    const saveBody = JSON.parse(String(fetchMock.mock.calls[1][1]?.body));
    expect(saveBody).toMatchObject({
      analysisId,
      title: refined.title,
      items: [{ name: refined.items[0].name }],
    });
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
