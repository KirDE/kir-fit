import { z } from "zod";

export const MEAL_ANALYSIS_SCHEMA_VERSION = "meal-photo-v1";

const nutrientEstimateSchema = z
  .strictObject({
    estimate: z.number().nonnegative().finite(),
    min: z.number().nonnegative().finite(),
    max: z.number().nonnegative().finite(),
  })
  .refine((value) => value.min <= value.estimate && value.estimate <= value.max, {
    message: "Estimate must be within its range",
  });

const portionSchema = z
  .strictObject({
    estimatedGrams: z.number().nonnegative().max(10_000),
    minGrams: z.number().nonnegative().max(10_000),
    maxGrams: z.number().nonnegative().max(10_000),
  })
  .refine(
    (value) =>
      value.minGrams <= value.estimatedGrams &&
      value.estimatedGrams <= value.maxGrams,
    { message: "Portion estimate must be within its range" },
  );

const clarificationSchema = z.strictObject({
  id: z.string().regex(/^[a-z0-9][a-z0-9_-]{0,63}$/),
  question: z.string().trim().min(3).max(300),
  options: z.array(z.string().trim().min(1).max(120)).max(8),
  impact: z.string().trim().min(3).max(300),
  required: z.boolean(),
});

export const mealAnalysisSchema = z.strictObject({
  summary: z.string().trim().min(1).max(300),
  foods: z
    .array(
      z.strictObject({
        name: z.string().trim().min(1).max(160),
        portion: portionSchema,
        calories: nutrientEstimateSchema,
        proteinGrams: nutrientEstimateSchema,
        fatGrams: nutrientEstimateSchema,
        carbsGrams: nutrientEstimateSchema,
        fiberGrams: nutrientEstimateSchema,
        confidence: z.enum(["high", "medium", "low"]),
        confidenceScore: z.number().min(0).max(1),
      }),
    )
    .min(1)
    .max(30),
  totals: z.strictObject({
    calories: nutrientEstimateSchema,
    proteinGrams: nutrientEstimateSchema,
    fatGrams: nutrientEstimateSchema,
    carbsGrams: nutrientEstimateSchema,
    fiberGrams: nutrientEstimateSchema,
  }),
  assumptions: z.array(
    z.strictObject({
      text: z.string().trim().min(3).max(300),
      impact: z.enum(["low", "material"]),
      nutrientImpactPercent: z.number().min(0).max(500).nullable(),
    }),
  ).max(30),
  alternatives: z.array(
    z.strictObject({
      label: z.string().trim().min(1).max(160),
      reason: z.string().trim().min(3).max(300),
    }),
  ).max(20),
  clarificationQuestions: z.array(clarificationSchema).max(12),
  overallConfidence: z.enum(["high", "medium", "low"]),
  isRecognizable: z.boolean(),
});

export type MealAnalysis = z.infer<typeof mealAnalysisSchema>;

export type MealAnalysisMetadata = {
  provider: string;
  model: string;
  schemaVersion: string;
  latencyMs: number;
  inputTokens: number | null;
  outputTokens: number | null;
  estimatedCostUsd: number | null;
};

export type MealAnalysisResponse = {
  analysis: MealAnalysis;
  metadata: MealAnalysisMetadata;
};

export class MealAnalysisProviderError extends Error {
  constructor(
    public readonly code:
      | "not_configured"
      | "timeout"
      | "rate_limited"
      | "quota_exhausted"
      | "refused"
      | "malformed_response"
      | "provider_unavailable",
    message: string,
    public readonly retryable: boolean,
  ) {
    super(message);
  }
}

export interface MealAnalysisProvider {
  analyze(image: Buffer, signal?: AbortSignal): Promise<MealAnalysisResponse>;
  refine?(
    prior: MealAnalysis,
    answers: Record<string, string>,
    signal?: AbortSignal,
  ): Promise<MealAnalysisResponse>;
}

/**
 * Re-validates untrusted model JSON and makes material uncertainty blocking.
 * This is deliberately done even when the provider advertises strict schemas.
 */
export function normalizeMealAnalysis(input: unknown): MealAnalysis {
  const parsed = mealAnalysisSchema.parse(input);
  const questions = [...parsed.clarificationQuestions];
  const knownQuestionIds = new Set(questions.map((question) => question.id));

  parsed.assumptions.forEach((assumption, index) => {
    if (assumption.impact !== "material") return;
    const assumptionText = assumption.text.toLocaleLowerCase();
    if (
      questions.some((question) => {
        const questionText = question.question.toLocaleLowerCase();
        return (
          question.required &&
          (questionText.includes(assumptionText) || assumptionText.includes(questionText))
        );
      })
    )
      return;
    const id = `material_assumption_${index + 1}`;
    if (knownQuestionIds.has(id)) return;
    questions.push({
      id,
      question: `Please clarify: ${assumption.text}`,
      options: [],
      impact: "This can materially change the estimated nutrition.",
      required: true,
    });
  });

  if (!parsed.isRecognizable && !questions.some((question) => question.required)) {
    questions.push({
      id: "identify_meal",
      question: "What food or dish is shown?",
      options: [],
      impact: "The photo alone is not recognizable enough for an estimate.",
      required: true,
    });
  }

  const totals = {
    calories: sumNutrient(parsed.foods, "calories"),
    proteinGrams: sumNutrient(parsed.foods, "proteinGrams"),
    fatGrams: sumNutrient(parsed.foods, "fatGrams"),
    carbsGrams: sumNutrient(parsed.foods, "carbsGrams"),
    fiberGrams: sumNutrient(parsed.foods, "fiberGrams"),
  };
  return { ...parsed, totals, clarificationQuestions: questions.slice(0, 12) };
}

function sumNutrient(
  foods: MealAnalysis["foods"],
  nutrient: "calories" | "proteinGrams" | "fatGrams" | "carbsGrams" | "fiberGrams",
) {
  return foods.reduce(
    (total, food) => ({
      estimate: total.estimate + food[nutrient].estimate,
      min: total.min + food[nutrient].min,
      max: total.max + food[nutrient].max,
    }),
    { estimate: 0, min: 0, max: 0 },
  );
}

const estimateJsonSchema = {
  type: "object",
  additionalProperties: false,
  required: ["estimate", "min", "max"],
  properties: {
    estimate: { type: "number", minimum: 0 },
    min: { type: "number", minimum: 0 },
    max: { type: "number", minimum: 0 },
  },
} as const;

export const mealAnalysisJsonSchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "summary",
    "foods",
    "totals",
    "assumptions",
    "alternatives",
    "clarificationQuestions",
    "overallConfidence",
    "isRecognizable",
  ],
  properties: {
    summary: { type: "string" },
    foods: {
      type: "array",
      minItems: 1,
      maxItems: 30,
      items: {
        type: "object",
        additionalProperties: false,
        required: [
          "name",
          "portion",
          "calories",
          "proteinGrams",
          "fatGrams",
          "carbsGrams",
          "fiberGrams",
          "confidence",
          "confidenceScore",
        ],
        properties: {
          name: { type: "string" },
          portion: rangeSchema("estimatedGrams", "minGrams", "maxGrams"),
          calories: estimateJsonSchema,
          proteinGrams: estimateJsonSchema,
          fatGrams: estimateJsonSchema,
          carbsGrams: estimateJsonSchema,
          fiberGrams: estimateJsonSchema,
          confidence: { type: "string", enum: ["high", "medium", "low"] },
          confidenceScore: { type: "number", minimum: 0, maximum: 1 },
        },
      },
    },
    totals: {
      type: "object",
      additionalProperties: false,
      required: ["calories", "proteinGrams", "fatGrams", "carbsGrams", "fiberGrams"],
      properties: {
        calories: estimateJsonSchema,
        proteinGrams: estimateJsonSchema,
        fatGrams: estimateJsonSchema,
        carbsGrams: estimateJsonSchema,
        fiberGrams: estimateJsonSchema,
      },
    },
    assumptions: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["text", "impact", "nutrientImpactPercent"],
        properties: {
          text: { type: "string" },
          impact: { type: "string", enum: ["low", "material"] },
          nutrientImpactPercent: {
            anyOf: [
              { type: "number", minimum: 0, maximum: 500 },
              { type: "null" },
            ],
          },
        },
      },
    },
    alternatives: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["label", "reason"],
        properties: { label: { type: "string" }, reason: { type: "string" } },
      },
    },
    clarificationQuestions: {
      type: "array",
      maxItems: 12,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["id", "question", "options", "impact", "required"],
        properties: {
          id: { type: "string" },
          question: { type: "string" },
          options: { type: "array", items: { type: "string" }, maxItems: 8 },
          impact: { type: "string" },
          required: { type: "boolean" },
        },
      },
    },
    overallConfidence: { type: "string", enum: ["high", "medium", "low"] },
    isRecognizable: { type: "boolean" },
  },
} as const;

function rangeSchema(estimate: string, min: string, max: string) {
  return {
    type: "object",
    additionalProperties: false,
    required: [estimate, min, max],
    properties: {
      [estimate]: { type: "number", minimum: 0, maximum: 10_000 },
      [min]: { type: "number", minimum: 0, maximum: 10_000 },
      [max]: { type: "number", minimum: 0, maximum: 10_000 },
    },
  } as const;
}

const systemPrompt = `You estimate nutrition from one meal photo. Output estimates, never facts.
List each visible component and give ranges for portion and every nutrient. Do not invent invisible
ingredients. Explicitly surface unknown oil, sauce, sugar, cream, cheese, cooking method and portion
scale. Any uncertainty likely to change calories or protein by 15% or more is material and must have
a short targeted clarification question. Mark the question required. If the image is not food or is
not recognizable, set isRecognizable=false and ask the user to identify it. Do not give medical advice.`;

export class OpenAiMealAnalysisProvider implements MealAnalysisProvider {
  constructor(
    private readonly options: {
      apiKey: string;
      model?: string;
      endpoint?: string;
      timeoutMs?: number;
      maxAttempts?: number;
      fetchImpl?: typeof fetch;
    },
  ) {}

  async analyze(image: Buffer, signal?: AbortSignal): Promise<MealAnalysisResponse> {
    return this.requestStructuredAnalysis(
      [
        { type: "input_text", text: systemPrompt },
        {
          type: "input_image",
          image_url: `data:image/jpeg;base64,${image.toString("base64")}`,
        },
      ],
      signal,
    );
  }

  async refine(
    prior: MealAnalysis,
    answers: Record<string, string>,
    signal?: AbortSignal,
  ): Promise<MealAnalysisResponse> {
    return this.requestStructuredAnalysis(
      [
        {
          type: "input_text",
          text: `${systemPrompt}\nRevise the prior analysis using only the user's answers below. Remove a clarification question only when its uncertainty is resolved. Preserve ranges for remaining uncertainty.\nPrior analysis: ${JSON.stringify(prior)}\nUser answers: ${JSON.stringify(answers)}`,
        },
      ],
      signal,
    );
  }

  private async requestStructuredAnalysis(
    content: Array<Record<string, unknown>>,
    signal?: AbortSignal,
  ): Promise<MealAnalysisResponse> {
    if (!this.options.apiKey)
      throw new MealAnalysisProviderError(
        "not_configured",
        "Meal photo analysis is not configured",
        false,
      );
    const startedAt = Date.now();
    const model = this.options.model || "gpt-4.1-mini";
    const maxAttempts = Math.max(1, Math.min(this.options.maxAttempts || 2, 3));
    let lastError: unknown;

    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      const timeoutSignal = AbortSignal.timeout(this.options.timeoutMs || 35_000);
      const combinedSignal = signal
        ? AbortSignal.any([signal, timeoutSignal])
        : timeoutSignal;
      try {
        const response = await (this.options.fetchImpl || fetch)(
          this.options.endpoint || "https://api.openai.com/v1/responses",
          {
            method: "POST",
            signal: combinedSignal,
            headers: {
              Authorization: `Bearer ${this.options.apiKey}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              model,
              store: false,
              max_output_tokens: 2500,
              input: [
                {
                  role: "user",
                  content,
                },
              ],
              text: {
                format: {
                  type: "json_schema",
                  name: "meal_photo_analysis",
                  strict: true,
                  schema: mealAnalysisJsonSchema,
                },
              },
            }),
          },
        );

        if (!response.ok) {
          const providerRequestId = response.headers.get("x-request-id");
          if (response.status === 429) {
            const code = response.headers.get("x-ratelimit-remaining-requests") === "0"
              ? "quota_exhausted"
              : "rate_limited";
            const error = new MealAnalysisProviderError(
              code,
              providerRequestId
                ? `AI capacity limit reached (request ${providerRequestId})`
                : "AI capacity limit reached",
              code === "rate_limited",
            );
            if (attempt < maxAttempts && error.retryable) {
              await boundedBackoff(response.headers.get("retry-after"), attempt, signal);
              continue;
            }
            throw error;
          }
          const retryable = response.status >= 500;
          const error = new MealAnalysisProviderError(
            "provider_unavailable",
            "Meal analysis provider is temporarily unavailable",
            retryable,
          );
          if (attempt < maxAttempts && retryable) {
            await boundedBackoff(response.headers.get("retry-after"), attempt, signal);
            continue;
          }
          throw error;
        }

        const payload: any = await response.json();
        const refusal = payload.output
          ?.flatMap((item: any) => item.content || [])
          .find((item: any) => item.type === "refusal");
        if (refusal)
          throw new MealAnalysisProviderError(
            "refused",
            "The photo could not be analyzed; enter the meal manually",
            false,
          );
        const outputText = extractOutputText(payload);
        if (!outputText)
          throw new MealAnalysisProviderError(
            "malformed_response",
            "The analysis response was incomplete",
            false,
          );
        let decoded: unknown;
        try {
          decoded = JSON.parse(outputText);
        } catch {
          throw new MealAnalysisProviderError(
            "malformed_response",
            "The analysis response was not valid JSON",
            false,
          );
        }
        let analysis: MealAnalysis;
        try {
          analysis = normalizeMealAnalysis(decoded);
        } catch {
          throw new MealAnalysisProviderError(
            "malformed_response",
            "The analysis response did not match the required schema",
            false,
          );
        }
        return {
          analysis,
          metadata: {
            provider: "openai",
            model,
            schemaVersion: MEAL_ANALYSIS_SCHEMA_VERSION,
            latencyMs: Date.now() - startedAt,
            inputTokens: finiteInteger(payload.usage?.input_tokens),
            outputTokens: finiteInteger(payload.usage?.output_tokens),
            estimatedCostUsd: null,
          },
        };
      } catch (error) {
        lastError = error;
        if (error instanceof MealAnalysisProviderError) throw error;
        if ((error as any)?.name === "TimeoutError" || timeoutSignal.aborted)
          throw new MealAnalysisProviderError(
            "timeout",
            "Meal analysis timed out; try again or enter it manually",
            true,
          );
        if ((error as any)?.name === "AbortError") throw error;
        if (attempt < maxAttempts) {
          await boundedBackoff(null, attempt, signal);
          continue;
        }
      }
    }
    throw new MealAnalysisProviderError(
      "provider_unavailable",
      lastError instanceof Error ? lastError.message : "Meal analysis failed",
      true,
    );
  }
}

export function createMealAnalysisProviderFromEnvironment() {
  return new OpenAiMealAnalysisProvider({
    apiKey: process.env.OPENAI_API_KEY || "",
    model: process.env.OPENAI_VISION_MODEL,
  });
}

function extractOutputText(payload: any) {
  if (typeof payload.output_text === "string") return payload.output_text;
  for (const output of payload.output || []) {
    for (const content of output.content || []) {
      if (content.type === "output_text" && typeof content.text === "string")
        return content.text;
    }
  }
  return null;
}

function finiteInteger(value: unknown) {
  return Number.isSafeInteger(value) && Number(value) >= 0 ? Number(value) : null;
}

async function boundedBackoff(
  retryAfter: string | null,
  attempt: number,
  signal?: AbortSignal,
) {
  const parsedRetryAfter = retryAfter ? Number(retryAfter) * 1000 : NaN;
  const waitMs = Math.min(
    2_000,
    Number.isFinite(parsedRetryAfter) ? parsedRetryAfter : 200 * 2 ** (attempt - 1),
  );
  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(resolve, waitMs);
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(timeout);
        reject(signal.reason);
      },
      { once: true },
    );
  });
}
