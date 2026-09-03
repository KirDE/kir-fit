import { describe, expect, it, vi } from "vitest";
import { mealAnalysisV1Fixtures } from "./fixtures/meal-analysis-v1.js";
import { normalizeMealAnalysis, OpenAiMealAnalysisProvider } from "./meal-analysis.js";

describe("meal analysis schema v1 fixtures", () => {
  it.each(mealAnalysisV1Fixtures.map((fixture, index) => [index, fixture]))(
    "validates fixture %s",
    (_index, fixture) => {
      expect(normalizeMealAnalysis(fixture)).toEqual(fixture);
    },
  );

  it("rejects estimates outside their declared range", () => {
    const invalid = structuredClone(mealAnalysisV1Fixtures[0]);
    invalid.totals.calories.estimate = invalid.totals.calories.max + 1;
    expect(() => normalizeMealAnalysis(invalid)).toThrow();
  });

  it("turns every material assumption into a blocking question", () => {
    const input = structuredClone(mealAnalysisV1Fixtures[0]);
    input.clarificationQuestions = [];
    const result = normalizeMealAnalysis(input);
    expect(result.clarificationQuestions).toEqual([
      expect.objectContaining({ required: true, id: "material_assumption_1" }),
    ]);
  });
});

describe("OpenAI meal analysis adapter", () => {
  it("uses strict structured output and returns bounded metadata", async () => {
    const fetchImpl = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      const request = JSON.parse(String(init?.body));
      expect(request.text.format.strict).toBe(true);
      expect(request.text.format.schema.additionalProperties).toBe(false);
      expect(request.max_output_tokens).toBe(2500);
      return new Response(
        JSON.stringify({
          output: [
            { content: [{ type: "output_text", text: JSON.stringify(mealAnalysisV1Fixtures[0]) }] },
          ],
          usage: { input_tokens: 100, output_tokens: 200 },
        }),
        { status: 200 },
      );
    });
    const provider = new OpenAiMealAnalysisProvider({
      apiKey: "test-only-key",
      model: "test-model",
      fetchImpl: fetchImpl as typeof fetch,
    });
    const result = await provider.analyze(Buffer.from("image"));
    expect(result.analysis.summary).toBe("Mixed salad");
    expect(result.metadata).toEqual(
      expect.objectContaining({
        provider: "openai",
        model: "test-model",
        schemaVersion: "meal-photo-v1",
        inputTokens: 100,
        outputTokens: 200,
      }),
    );
  });

  it("maps quota/rate failures to a recoverable error", async () => {
    const provider = new OpenAiMealAnalysisProvider({
      apiKey: "test-only-key",
      maxAttempts: 1,
      fetchImpl: vi.fn(async () =>
        new Response("", {
          status: 429,
          headers: { "x-ratelimit-remaining-requests": "0" },
        })) as typeof fetch,
    });
    await expect(provider.analyze(Buffer.from("image"))).rejects.toMatchObject({
      code: "quota_exhausted",
      retryable: false,
    });
  });

  it("rejects malformed provider JSON", async () => {
    const provider = new OpenAiMealAnalysisProvider({
      apiKey: "test-only-key",
      fetchImpl: vi.fn(async () =>
        Response.json({ output_text: JSON.stringify({ foods: [] }) })) as typeof fetch,
    });
    await expect(provider.analyze(Buffer.from("image"))).rejects.toMatchObject({
      code: "malformed_response",
    });
  });
});
