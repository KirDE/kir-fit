# Optional Life Fitness Insignia equipment

The shared catalogue is `apps/api/prisma/exercise-catalog.json`. Its explicit
`starterExerciseIds` allowlist contains the original eight exercises. Fifteen
additional models are seeded as catalogue entries, not template entries.

The catalogue is shown in Settings only. Each machine has an explicit Add to
workout button, enabled only while a workout is active. The workout screen has
no catalogue or add button.

`POST /api/workouts/:sessionId/exercises` adds a model to an owned, active workout
only. It does not change saved workout templates. Session-level PostgreSQL row
locking makes additions idempotent across concurrent requests. Logging sets and
changing settings on ad-hoc equipment uses `updateMany` for any existing template
row, so a missing template row is valid and never auto-created. Subsequent manual
additions can recover settings and loads from completed sessions.

Guest mode uses the same JSON catalogue and starter allowlist, with browser-local
session storage. Completed workouts retain their added equipment; fresh workouts
continue to start from the original eight.

## Manufacturer images

All 23 catalogue images were downloaded from official Life Fitness Insignia
product pages on 2026-11-04. Product URLs, original image URLs, dimensions and
output SHA-256 hashes are in `apps/web/public/exercise-images/SOURCES.json`.
Copyright attribution and the limited website-terms review are documented in
`CREDITS.md`; the images are not described as open-licensed. Rendering uses
contain rather than cover to keep complete equipment visible. Existing asset
paths remain stable for historical and in-progress sessions.

The generic existing Leg Press and Leg Curl entries use the manufacturer's Arc
Leg Press and Seated Leg Curl illustrations respectively. These are catalogue
illustrations, not verification of a particular gym's installed hardware.

## Verification

- Isolated PostgreSQL: catalogue seed is idempotent (23 models, 8 template rows).
- API integration: ownership, archived/unknown model rejection, concurrent/retried
  additions, set/settings persistence, and unchanged next workout.
- Guest/UI tests: 23-entry catalogue, opt-in addition, duplicates, and 8-entry
  fresh workout.
- Browser: all fifteen optional models added at 320/390/1440px; next workout
  remains eight, with no horizontal overflow or browser exceptions.

## Personal progress selection

`GET /exercises/history` lists only equipment with at least one logged set in the
requesting user's completed workouts. Merely being in a template, or having sets
only in an active workout, is not enough. Archived equipment remains available
when it has personal history. Per-machine progress likewise excludes unlogged
session entries so skipped equipment does not create artificial zero points.

The Progress page puts body weight before machine progress, uses a 20px gap below
the machine selector, handles an empty history without offering the full
catalogue, and discards stale responses when switching between machines.
