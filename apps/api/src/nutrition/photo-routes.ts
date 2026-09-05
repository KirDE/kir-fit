import express from "express";
import rateLimit from "express-rate-limit";
import multer from "multer";
import { z } from "zod";
import {
  FoodImageError,
  hashIdempotency,
  MAX_FOOD_PHOTO_BYTES,
  PrivateFoodPhotoStore,
} from "./food-image.js";
import {
  createMealAnalysisProviderFromEnvironment,
  MealAnalysisProvider,
  MealAnalysisProviderError,
} from "./meal-analysis.js";

type NutritionPhotoRouterOptions = {
  ownerId: (request: express.Request) => string;
  store?: PrivateFoodPhotoStore;
  provider?: MealAnalysisProvider;
  ephemeral?: (request: express.Request) => boolean;
};

const idempotencyKeyPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/;
const inFlight = new Map<string, Promise<unknown>>();

export function createNutritionPhotoRouter(options: NutritionPhotoRouterOptions) {
  const router = express.Router();
  const store = options.store || new PrivateFoodPhotoStore();
  const provider = options.provider || createMealAnalysisProviderFromEnvironment();
  const memoryUpload = multer({
    storage: multer.memoryStorage(),
    limits: { files: 1, fileSize: MAX_FOOD_PHOTO_BYTES },
  });
  const analysisLimit = rateLimit({
    windowMs: 15 * 60_000,
    limit: Number(process.env.NUTRITION_AI_RATE_LIMIT || 10),
    standardHeaders: "draft-8",
    legacyHeaders: false,
    message: {
      status: "manual_required",
      reasonCode: "rate_limited",
      message: "Photo analysis limit reached; enter the meal manually or try later",
      manualEntryAvailable: true,
    },
  });
  const identityLimit = rateLimit({
    windowMs: 15 * 60_000,
    limit: Number(process.env.NUTRITION_AI_RATE_LIMIT || 10),
    keyGenerator: (request) => options.ownerId(request),
    standardHeaders: "draft-8",
    legacyHeaders: false,
    message: {
      status: "manual_required",
      reasonCode: "rate_limited",
      message: "Photo analysis limit reached; enter the meal manually or try later",
      manualEntryAvailable: true,
    },
  });

  void store.cleanupExpired().catch(() => undefined);
  const cleanupTimer = setInterval(
    () => void store.cleanupExpired().catch(() => undefined),
    60 * 60_000,
  );
  cleanupTimer.unref();

  const launch = (manifest: Awaited<ReturnType<typeof store.requireOwned>>) => {
    const flightKey = `${manifest.ownerId}\0job\0${manifest.analysisId}`;
    if (inFlight.has(flightKey) || !manifest.pendingTask) return;
    const operation = runPendingTask(manifest, store, provider)
      .catch((error) => {
        console.error(JSON.stringify({
          event: "nutrition_analysis_job_failed",
          analysisId: manifest.analysisId,
          error: error instanceof Error ? error.message : String(error),
        }));
      })
      .finally(() => inFlight.delete(flightKey));
    inFlight.set(flightKey, operation);
  };

  void store.listPending().then((jobs) => jobs.forEach(launch)).catch(() => undefined);

  router.get(
    "/",
    asyncHandler(async (request, response) => {
      const jobs = await store.listByOwner(options.ownerId(request));
      response.json(jobs.map(publicManifest));
    }),
  );

  router.get(
    "/:analysisId/status",
    asyncHandler(async (request, response) => {
      const manifest = await store.requireOwned(
        firstParam(request.params.analysisId),
        options.ownerId(request),
      );
      response.status(manifest.status === "processing" ? 202 : 200).json(
        publicManifest(manifest),
      );
    }),
  );

  router.post(
    "/analyze",
    analysisLimit,
    identityLimit,
    memoryUpload.single("image"),
    asyncHandler(async (request, response) => {
      const ownerId = options.ownerId(request);
      const ephemeral = options.ephemeral?.(request) ?? false;
      const language = requestLanguage(request);
      const idempotencyKey = request.header("Idempotency-Key") || "";
      if (!idempotencyKeyPattern.test(idempotencyKey))
        return response.status(400).json({
          error: "A valid Idempotency-Key header is required",
          code: "invalid_idempotency_key",
        });
      if (!request.file)
        return response.status(400).json({
          error: "A meal photo is required",
          code: "photo_required",
        });

      const existing = await store.findByIdempotencyKey(ownerId, idempotencyKey);
      if (existing) {
        if (existing.status === "processing") launch(existing);
        return response.status(existing.status === "processing" ? 202 : 200).json(
          publicManifest(existing),
        );
      }

      const occurredOn = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().parse(
        request.body.occurredOn || undefined,
      );
      const manifest = await store.create(
        ownerId,
        idempotencyKey,
        request.file.buffer,
        undefined,
        occurredOn,
      );
      const queued = await store.update(manifest.analysisId, ownerId, {
        pendingTask: {
          kind: "analyze",
          language,
          retainThumbnail: request.body.retainThumbnail !== "false" || ephemeral,
        },
      });
      launch(queued);
      return response.status(202).json(publicManifest(queued));
    }),
  );

  router.get(
    "/:analysisId/thumbnail",
    asyncHandler(async (request, response) => {
      const bytes = await store.thumbnail(
        firstParam(request.params.analysisId),
        options.ownerId(request),
      );
      response.set({
        "Content-Type": "image/jpeg",
        "Cache-Control": "private, no-store",
        "Content-Disposition": "inline",
        "X-Content-Type-Options": "nosniff",
      });
      return response.send(bytes);
    }),
  );

  router.post(
    "/analyze/:analysisId/clarify",
    analysisLimit,
    identityLimit,
    express.json({ limit: "32kb" }),
    asyncHandler(async (request, response) => {
      const ownerId = options.ownerId(request);
      const analysisId = firstParam(request.params.analysisId);
      const idempotencyKey = request.header("Idempotency-Key") || "";
      if (!idempotencyKeyPattern.test(idempotencyKey))
        return response.status(400).json({
          error: "A valid Idempotency-Key header is required",
          code: "invalid_idempotency_key",
        });
      const { answers } = z
        .strictObject({
          answers: z.record(z.string().max(64), z.string().trim().min(1).max(500)),
          // Accepted only for rolling UI compatibility. The trusted prior result
          // is always loaded from the owner-protected server manifest.
          priorAnalysis: z.unknown().optional(),
          clarificationRound: z.number().int().min(0).max(2).optional(),
        })
        .parse(request.body);
      if (Object.keys(answers).length === 0 || Object.keys(answers).length > 12)
        return response.status(400).json({
          error: "Between 1 and 12 clarification answers are required",
          code: "invalid_answers",
        });
      const manifest = await store.requireOwned(analysisId, ownerId);
      if (manifest.status === "processing")
        return response.status(202).json(publicManifest(manifest));
      const refinementHash = hashIdempotency(ownerId, idempotencyKey);
      if (manifest.refinementIdempotencyHash === refinementHash)
        return response.json(publicManifest(manifest));
      if (Number(manifest.providerMetadata?.clarificationRound ?? 0) >= 1)
        return response.status(409).json({
          status: "manual_required",
          reasonCode: "clarification_limit_reached",
          manualEntryAvailable: true,
        });
      if (!manifest.result)
        return response.status(409).json({
          error: "No completed analysis is available to clarify",
          code: "analysis_not_completed",
          manualEntryAvailable: true,
        });
      if (!provider.refine)
        return response.status(501).json({
          status: "manual_required",
          reasonCode: "clarification_not_supported",
          manualEntryAvailable: true,
        });

      const queued = await store.update(analysisId, ownerId, {
        status: "processing",
        failureCode: undefined,
        failureMessage: undefined,
        retryable: undefined,
        pendingTask: {
          kind: "clarify",
          language: requestLanguage(request),
          answers,
          refinementIdempotencyHash: refinementHash,
        },
      });
      launch(queued);
      return response.status(202).json(publicManifest(queued));
    }),
  );

  router.delete(
    "/:analysisId",
    asyncHandler(async (request, response) => {
      await store.remove(firstParam(request.params.analysisId), options.ownerId(request));
      return response.status(204).end();
    }),
  );

  router.use(
    (
      error: unknown,
      _request: express.Request,
      response: express.Response,
      next: express.NextFunction,
    ) => {
      if (error instanceof multer.MulterError) {
        if (error.code === "LIMIT_FILE_SIZE")
          return response.status(413).json({
            error: "Photo exceeds the 10 MB limit",
            code: "file_too_large",
          });
        return response.status(400).json({ error: "Invalid upload", code: error.code });
      }
      if (error instanceof FoodImageError)
        return response.status(error.status).json({ error: error.message, code: error.code });
      return next(error);
    },
  );

  return router;
}

async function runPendingTask(
  manifest: Awaited<ReturnType<PrivateFoodPhotoStore["requireOwned"]>>,
  store: PrivateFoodPhotoStore,
  provider: MealAnalysisProvider,
) {
  const task = manifest.pendingTask;
  if (!task) return;
  try {
    const result = task.kind === "analyze"
      ? await provider.analyze(
          await store.analysisBytes(manifest.analysisId, manifest.ownerId),
          undefined,
          task.language,
        )
      : await provider.refine!(
          manifest.result as any,
          task.answers,
          undefined,
          task.language,
        );
    const clarificationRound = task.kind === "clarify"
      ? Number(manifest.providerMetadata?.clarificationRound ?? 0) + 1
      : Number(manifest.providerMetadata?.clarificationRound ?? 0);
    const analysis = task.kind === "clarify"
      ? { ...result.analysis, clarificationQuestions: [] }
      : result.analysis;
    await store.update(manifest.analysisId, manifest.ownerId, {
      status: "completed",
      result: analysis,
      providerMetadata: { ...result.metadata, clarificationRound },
      failureCode: undefined,
      failureMessage: undefined,
      retryable: undefined,
      pendingTask: undefined,
      refinementIdempotencyHash:
        task.kind === "clarify"
          ? task.refinementIdempotencyHash
          : manifest.refinementIdempotencyHash,
    });
  } catch (error) {
    const providerError = error instanceof MealAnalysisProviderError;
    await store.update(manifest.analysisId, manifest.ownerId, {
      status: "manual_required",
      failureCode: providerError ? error.code : "internal_error",
      failureMessage: providerError
        ? error.message
        : "Meal analysis could not be completed; retry or enter it manually",
      retryable: providerError ? error.retryable : true,
      pendingTask: undefined,
    });
    console.error(JSON.stringify({
      event: "nutrition_analysis_provider_failed",
      analysisId: manifest.analysisId,
      task: task.kind,
      failureCode: providerError ? error.code : "internal_error",
      retryable: providerError ? error.retryable : true,
      model: manifest.providerMetadata?.model,
    }));
  } finally {
    if (task.kind === "analyze") {
      // The bounded derivative is deleted after the provider finishes. The
      // private thumbnail and manifest remain available for asynchronous review.
      await store.removeAnalysisImage(manifest.analysisId, manifest.ownerId).catch(
        () => undefined,
      );
      if (!task.retainThumbnail)
        await store.removeThumbnail(manifest.analysisId, manifest.ownerId).catch(
          () => undefined,
        );
    }
  }
}

function publicManifest(manifest: {
  analysisId: string;
  status: string;
  result?: unknown;
  providerMetadata?: Record<string, unknown>;
  failureCode?: string;
  failureMessage?: string;
  retryable?: boolean;
  createdAt?: string;
  occurredOn?: string;
  pendingTask?: unknown;
  finalizedAt?: string;
}) {
  return {
    analysisId: manifest.analysisId,
    status: manifest.status,
    createdAt: manifest.createdAt,
    occurredOn: manifest.occurredOn,
    analysis: manifest.result,
    result: manifest.result,
    failureCode: manifest.failureCode,
    message: manifest.failureMessage,
    retryable: manifest.retryable,
    manualEntryAvailable: manifest.status === "manual_required",
    metadata: manifest.providerMetadata,
    thumbnailUrl:
      "thumbnailFile" in manifest && manifest.thumbnailFile === null
        ? null
        : `/api/nutrition/photos/${manifest.analysisId}/thumbnail`,
  };
}

function asyncHandler(
  handler: (
    request: express.Request,
    response: express.Response,
    next: express.NextFunction,
  ) => unknown,
) {
  return (
    request: express.Request,
    response: express.Response,
    next: express.NextFunction,
  ) => Promise.resolve(handler(request, response, next)).catch(next);
}

function firstParam(value: string | string[]) {
  return Array.isArray(value) ? value[0] : value;
}

function requestLanguage(request: express.Request): "en" | "de" | "ru" {
  const candidate = String(request.header("accept-language") || "en")
    .toLowerCase()
    .split(/[,-]/)[0];
  return candidate === "ru" || candidate === "de" ? candidate : "en";
}
