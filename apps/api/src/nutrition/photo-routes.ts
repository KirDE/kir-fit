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

  void store.cleanupExpired().catch(() => undefined);
  const cleanupTimer = setInterval(
    () => void store.cleanupExpired().catch(() => undefined),
    60 * 60_000,
  );
  cleanupTimer.unref();

  router.post(
    "/analyze",
    analysisLimit,
    memoryUpload.single("image"),
    asyncHandler(async (request, response) => {
      const ownerId = options.ownerId(request);
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
      if (existing)
        return response.status(existing.status === "processing" ? 202 : 200).json(
          publicManifest(existing),
        );

      const flightKey = `${ownerId}\0${idempotencyKey}`;
      const current = inFlight.get(flightKey);
      if (current) return response.status(202).json({ status: "processing" });

      const operation = analyzeUpload(
        ownerId,
        idempotencyKey,
        request.file.buffer,
        store,
        provider,
        request.body.retainThumbnail !== "false",
      );
      inFlight.set(flightKey, operation);
      try {
        const result = await operation;
        return response.json(result);
      } finally {
        inFlight.delete(flightKey);
      }
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
        })
        .parse(request.body);
      if (Object.keys(answers).length === 0 || Object.keys(answers).length > 12)
        return response.status(400).json({
          error: "Between 1 and 12 clarification answers are required",
          code: "invalid_answers",
        });
      const manifest = await store.requireOwned(analysisId, ownerId);
      if (!manifest.result)
        return response.status(409).json({
          error: "No completed analysis is available to clarify",
          code: "analysis_not_completed",
          manualEntryAvailable: true,
        });
      const refinementHash = hashIdempotency(ownerId, idempotencyKey);
      if (manifest.refinementIdempotencyHash === refinementHash)
        return response.json(publicManifest(manifest));
      if (!provider.refine)
        return response.status(501).json({
          status: "manual_required",
          reasonCode: "clarification_not_supported",
          manualEntryAvailable: true,
        });

      const flightKey = `${ownerId}\0clarify\0${idempotencyKey}`;
      if (inFlight.has(flightKey))
        return response.status(202).json({ analysisId, status: "processing" });
      const operation = provider.refine(manifest.result as any, answers);
      inFlight.set(flightKey, operation);
      try {
        const result = await operation;
        const clarificationRound =
          Number(manifest.providerMetadata?.clarificationRound ?? 0) + 1;
        const updated = await store.update(analysisId, ownerId, {
          status: "completed",
          result: result.analysis,
          providerMetadata: { ...result.metadata, clarificationRound },
          failureCode: undefined,
          refinementIdempotencyHash: refinementHash,
        });
        return response.json(publicManifest(updated));
      } catch (error) {
        if (!(error instanceof MealAnalysisProviderError)) throw error;
        return response.json({
          ...publicManifest(manifest),
          status: "manual_required",
          failureCode: error.code,
          message: error.message,
          retryable: error.retryable,
          manualEntryAvailable: true,
        });
      } finally {
        inFlight.delete(flightKey);
      }
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

async function analyzeUpload(
  ownerId: string,
  idempotencyKey: string,
  bytes: Buffer,
  store: PrivateFoodPhotoStore,
  provider: MealAnalysisProvider,
  retainThumbnail: boolean,
  signal?: AbortSignal,
) {
  const manifest = await store.create(ownerId, idempotencyKey, bytes);
  try {
    const analysisBytes = await store.analysisBytes(manifest.analysisId, ownerId);
    const result = await provider.analyze(analysisBytes, signal);
    const updated = await store.update(manifest.analysisId, ownerId, {
      status: "completed",
      result: result.analysis,
      providerMetadata: result.metadata,
      failureCode: undefined,
    });
    return publicManifest(updated);
  } catch (error) {
    if (!(error instanceof MealAnalysisProviderError)) throw error;
    const updated = await store.update(manifest.analysisId, ownerId, {
      status: "manual_required",
      result: undefined,
      providerMetadata: undefined,
      failureCode: error.code,
    });
    return {
      ...publicManifest(updated),
      message: error.message,
      retryable: error.retryable,
      manualEntryAvailable: true,
    };
  } finally {
    // The bounded analysis derivative is the only "original" sent to AI. It is
    // removed on success, refusal, timeout and malformed/provider failure.
    await store.removeAnalysisImage(manifest.analysisId, ownerId).catch(() => undefined);
    if (!retainThumbnail)
      await store.removeThumbnail(manifest.analysisId, ownerId).catch(() => undefined);
  }
}

function publicManifest(manifest: {
  analysisId: string;
  status: string;
  result?: unknown;
  providerMetadata?: Record<string, unknown>;
  failureCode?: string;
}) {
  return {
    analysisId: manifest.analysisId,
    status: manifest.status,
    analysis: manifest.result,
    result: manifest.result,
    failureCode: manifest.failureCode,
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
