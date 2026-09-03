# Nutrition MVP API contract

All endpoints require `Authorization: Bearer <session token>`. Resources are
always scoped to the authenticated user; attempting to read or mutate another
user's entry returns `404`.

Nutrient numbers are decimal snapshots. Item values describe the complete
photographed/manual portion. The server sums those values into `full*` fields
and scales the persisted non-prefixed fields by `consumedPercent`. Clients must
not calculate authoritative totals themselves.

## Protein target settings

`GET /api/settings/nutrition`

`PATCH /api/settings/nutrition` accepts a strict partial object:

```json
{
  "heightCm": 180,
  "goalWeightKg": 82,
  "proteinTargetMode": "automatic",
  "manualProteinTargetGrams": null
}
```

Limits: height 100–250 cm, goal weight 30–500 kg, manual target 20–400
g/day. Manual mode requires a manual target. The same fields are accepted and
returned by `/api/settings/profile` for compatibility with the Settings page.

The response contains the stored fields plus:

```json
{
  "calculation": {
    "mode": "automatic",
    "currentWeightKg": 100,
    "weightSource": "latest",
    "bmi": 30.9,
    "referenceWeightKg": 82,
    "referenceWeightSource": "goal",
    "multiplierGramsPerKg": 1.6,
    "recommendedRangeGrams": { "min": 100, "max": 130 },
    "targetGrams": 130,
    "automaticTargetGrams": 130,
    "isEstimate": true
  },
  "disclaimer": {
    "code": "nutrition_estimate_not_medical_advice",
    "clinicianReviewCode": "protein_restriction_or_kidney_disease_review"
  }
}
```

`weightSource` is `latest`, `starting`, or `null`.
`referenceWeightSource` is `current`, `goal`, `bmi25`, or `null`. A missing
height or weight produces a `null` automatic target instead of inventing one.

## Entries

### Create

`POST /api/nutrition/entries`

```json
{
  "occurredAt": "2026-09-03T12:30:00+02:00",
  "mealType": "lunch",
  "title": "Chicken salad",
  "consumedPercent": 75,
  "items": [
    {
      "name": "Chicken breast",
      "amountGrams": 180,
      "calories": 297,
      "proteinGrams": 55.8,
      "fatGrams": 6.5,
      "carbsGrams": 0,
      "fiberGrams": 0
    }
  ]
}
```

`mealType` is `breakfast`, `lunch`, `dinner`, `snack`, or `other`. There must
be 1–50 items. Names are limited to 120 characters and the entry title to 160.
All nutrients and amounts must be non-negative. The accepted date range is
2000–2100 and `occurredAt` must include an offset.

### Read, edit and delete

- `GET /api/nutrition/entries/:id`
- `PATCH /api/nutrition/entries/:id` accepts any strict subset of create fields
- `DELETE /api/nutrition/entries/:id` returns `204`

When `items` or `consumedPercent` changes, both entry and daily totals are
recalculated transactionally. Replacing items deletes the old component
snapshots. Deleting an entry cascades items, analysis, clarifications and photo
metadata.

The entry response includes `fullCalories`, `fullProteinGrams`,
`fullFatGrams`, `fullCarbsGrams`, `fullFiberGrams`, the scaled fields without
the `full` prefix, items, safe photo metadata and analysis metadata. Private
storage keys are never returned.

## Calendar aggregation

All grouping uses an explicit IANA timezone and observes daylight-saving
boundaries.

- `GET /api/nutrition/entries?from=YYYY-MM-DD&to=YYYY-MM-DD&timezone=Europe/Berlin`
  returns `{ from, to, timezone, days: [{ date, entries, totals }] }`; range is
  limited to 366 local days.
- `GET /api/nutrition/days/:date?timezone=Europe/Berlin` returns entries,
  macro totals, `proteinTargetGrams`, `proteinPercent`,
  `proteinRemainingGrams`, and `proteinExcessGrams`.

## Migration and rollback

Migration `20260903113000_nutrition_core` is restricted to PostgreSQL 13
syntax and has been smoke-tested on PostgreSQL 13. Before production deploy,
take a `pg_dump --format=custom` backup and verify it with `pg_restore --list`.

The safe rollback after production writes is restoring that backup, because a
schema-only reverse migration would destroy nutrition entries. In a disposable
or confirmed-empty environment, reverse in dependency order by dropping
`NutritionClarification`, `NutritionAnalysis`, `NutritionPhoto`,
`NutritionItem`, and `NutritionEntry`, then remove the three new `User`
columns and their check constraints. Never run that destructive reversal when
nutrition data may need to be retained.
