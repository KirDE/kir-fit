# Nutrition photo integration contract (MVP)

This branch intentionally owns no Prisma models. The nutrition core branch owns
`NutritionEntry`, `NutritionPhoto`, `NutritionAnalysis` and their migration.

## HTTP contract

All routes require the existing Bearer authentication middleware.

- `POST /api/nutrition/photos/analyze`
  - multipart field: `image`
  - required header: `Idempotency-Key` (8–128 safe characters; keep it stable for retries)
  - returns `analysisId`, `status`, `analysis`, `metadata`, and authenticated
    `thumbnailUrl`
  - `status=manual_required` includes `failureCode`, `retryable` and
    `manualEntryAvailable=true`
- `GET /api/nutrition/photos/:analysisId/thumbnail`
  - returns JPEG only when the bearer user owns the analysis
- `DELETE /api/nutrition/photos/:analysisId`
  - removes pending analysis and retained thumbnail
- `POST /api/nutrition/photos/analyze/:analysisId/clarify`
  - required new `Idempotency-Key` header
  - JSON: `{ "answers": { "question_id": "answer" }, "priorAnalysis": ... }`
  - `priorAnalysis` is accepted for rolling UI compatibility but deliberately
    ignored; the server uses its owner-protected result as the trusted prior
  - returns the same envelope as initial analysis and does not charge twice for
    a completed retry with the same idempotency key

The structured `analysis` (also returned as the rolling-UI alias `result`) contains foods, gram and nutrient ranges, totals,
assumptions, alternatives, confidence and required clarification questions.
No entry is created or saved by photo analysis.

## Core merge hook

When `POST /api/nutrition/entries` receives an `analysisId`, integration must:

1. call `PrivateFoodPhotoStore.requireOwned(analysisId, userId)`;
2. require `status=completed` (or allow a manually corrected entry for
   `manual_required` without treating the missing AI result as trusted);
3. transactionally create the `NutritionAnalysis`/`NutritionPhoto` records using
   the manifest snapshot and the randomized thumbnail identifier;
4. extend the manifest expiration while the entry owns it, or move the thumbnail
   to an entry-owned private directory;
5. call `PrivateFoodPhotoStore.remove(analysisId, userId)` after deleting the
   owning `NutritionEntry` (or remove only after a successful transactional move).

Never accept a client-provided filesystem path, provider metadata or nutrient
snapshot as proof of ownership. The owner is the authenticated subject in the
server-side manifest.

## Retention and operations

- Raw upload bytes exist only in memory.
- The normalized analysis derivative is deleted in `finally`, including timeout,
  refusal, malformed output and provider failure.
- Pending thumbnails/manifests expire after 24 hours; cleanup runs at startup and
  hourly.
- The `nutrition_private` Docker volume is separate from public `/uploads` and
  must be included in backup/restore alongside PostgreSQL.
