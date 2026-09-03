# Nutrition photo integration contract (MVP)

The photo pipeline is integrated with `NutritionEntry`, `NutritionPhoto`,
`NutritionAnalysis` and the nutrition migration.

## HTTP contract

Authenticated routes use the existing Bearer middleware. Guest analysis uses an
opaque, validated `X-Kirfit-Device` identifier combined with the request IP for
rate limiting and isolation.

- `POST /api/nutrition/photos/analyze`
  - multipart field: `image`
  - required header: `Idempotency-Key` (8–128 safe characters; keep it stable for retries)
  - returns `analysisId`, `status`, `analysis`, `metadata`, and a thumbnail;
    authenticated thumbnails use an owner-checked URL, while guest thumbnails
    are returned inline and retained only in browser-local storage
  - `status=manual_required` includes `failureCode`, `retryable` and
    `manualEntryAvailable=true`
- `GET /api/nutrition/photos/:analysisId/thumbnail`
  - returns JPEG only when the bearer user owns the analysis
- `DELETE /api/nutrition/photos/:analysisId`
  - removes pending analysis and retained thumbnail
- `POST /api/nutrition/photos/analyze/:analysisId/clarify`
  - required new `Idempotency-Key` header
  - JSON: `{ "answers": { "question_id": "answer" }, "priorAnalysis": ... }`
  - authenticated analysis ignores `priorAnalysis` and uses its owner-protected
    server result; stateless guest clarification validates `priorAnalysis`
    against the strict schema before sending it to the provider
  - returns the same envelope as initial analysis and does not charge twice for
    a completed retry with the same idempotency key

The structured `analysis` (also returned as the rolling-UI alias `result`) contains foods, gram and nutrient ranges, totals,
assumptions, alternatives, confidence and required clarification questions.
No entry is created or saved by photo analysis.

## Entry finalization

When `POST /api/nutrition/entries` receives an `analysisId`, the API:

1. calls `PrivateFoodPhotoStore.requireOwned(analysisId, userId)`;
2. requires `status=completed` (or allows a manually corrected entry for
   `manual_required` without treating the missing AI result as trusted);
3. creates the `NutritionAnalysis`/`NutritionPhoto` records using
   the manifest snapshot and the randomized thumbnail identifier;
4. extends the manifest retention while the entry owns it;
5. calls `PrivateFoodPhotoStore.remove(analysisId, userId)` after deleting the
   owning `NutritionEntry`.

Never accept a client-provided filesystem path, provider metadata or nutrient
snapshot as proof of ownership. The owner is the authenticated subject in the
server-side manifest.

## Retention and operations

- Raw upload bytes exist only in memory.
- The normalized analysis derivative is deleted in `finally`, including timeout,
  refusal, malformed output and provider failure.
- Pending thumbnails/manifests expire after 24 hours; cleanup runs at startup and
  hourly.
- Guest jobs are deleted before the analysis request completes. Neither the raw
  photo nor the structured AI result remains on the server.
- The `nutrition_private` Docker volume is separate from public `/uploads` and
  must be included in backup/restore alongside PostgreSQL.
