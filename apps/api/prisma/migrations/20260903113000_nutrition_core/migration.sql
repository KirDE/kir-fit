-- Nutrition profile and immutable meal nutrient snapshots.
-- PostgreSQL 13 compatible; no generated columns or newer syntax is used.
ALTER TABLE "User"
  ADD COLUMN "goalWeightKg" DECIMAL(6,2),
  ADD COLUMN "proteinTargetMode" TEXT NOT NULL DEFAULT 'automatic',
  ADD COLUMN "manualProteinTargetGrams" INTEGER;

ALTER TABLE "User"
  ADD CONSTRAINT "User_proteinTargetMode_check"
    CHECK ("proteinTargetMode" IN ('automatic', 'manual')),
  ADD CONSTRAINT "User_nutrition_values_check"
    CHECK (
      ("goalWeightKg" IS NULL OR ("goalWeightKg" >= 30 AND "goalWeightKg" <= 500))
      AND ("manualProteinTargetGrams" IS NULL OR ("manualProteinTargetGrams" >= 20 AND "manualProteinTargetGrams" <= 400))
    );

CREATE TABLE "NutritionEntry" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "occurredAt" TIMESTAMP(3) NOT NULL,
  "mealType" TEXT,
  "title" TEXT,
  "consumedPercent" DECIMAL(5,2) NOT NULL DEFAULT 100,
  "fullCalories" DECIMAL(10,2) NOT NULL,
  "fullProteinGrams" DECIMAL(10,2) NOT NULL,
  "fullFatGrams" DECIMAL(10,2) NOT NULL,
  "fullCarbsGrams" DECIMAL(10,2) NOT NULL,
  "fullFiberGrams" DECIMAL(10,2) NOT NULL,
  "calories" DECIMAL(10,2) NOT NULL,
  "proteinGrams" DECIMAL(10,2) NOT NULL,
  "fatGrams" DECIMAL(10,2) NOT NULL,
  "carbsGrams" DECIMAL(10,2) NOT NULL,
  "fiberGrams" DECIMAL(10,2) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "NutritionEntry_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "NutritionEntry_percent_check" CHECK ("consumedPercent" >= 0 AND "consumedPercent" <= 100),
  CONSTRAINT "NutritionEntry_nutrients_check" CHECK (
    "fullCalories" >= 0 AND "fullProteinGrams" >= 0 AND "fullFatGrams" >= 0 AND "fullCarbsGrams" >= 0 AND "fullFiberGrams" >= 0
    AND "calories" >= 0 AND "proteinGrams" >= 0 AND "fatGrams" >= 0 AND "carbsGrams" >= 0 AND "fiberGrams" >= 0
  )
);

CREATE TABLE "NutritionItem" (
  "id" TEXT NOT NULL,
  "entryId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "amountGrams" DECIMAL(10,2),
  "calories" DECIMAL(10,2) NOT NULL,
  "proteinGrams" DECIMAL(10,2) NOT NULL,
  "fatGrams" DECIMAL(10,2) NOT NULL,
  "carbsGrams" DECIMAL(10,2) NOT NULL,
  "fiberGrams" DECIMAL(10,2) NOT NULL,
  "sortOrder" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "NutritionItem_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "NutritionItem_values_check" CHECK (
    ("amountGrams" IS NULL OR "amountGrams" >= 0)
    AND "calories" >= 0 AND "proteinGrams" >= 0 AND "fatGrams" >= 0 AND "carbsGrams" >= 0 AND "fiberGrams" >= 0
  )
);

CREATE TABLE "NutritionPhoto" (
  "id" TEXT NOT NULL,
  "entryId" TEXT NOT NULL,
  "storageKey" TEXT NOT NULL,
  "thumbnailStorageKey" TEXT,
  "mimeType" TEXT NOT NULL,
  "sizeBytes" INTEGER NOT NULL,
  "width" INTEGER,
  "height" INTEGER,
  "sha256" TEXT,
  "originalDeletedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "NutritionPhoto_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "NutritionPhoto_size_check" CHECK ("sizeBytes" >= 0)
);

CREATE TABLE "NutritionAnalysis" (
  "id" TEXT NOT NULL,
  "entryId" TEXT NOT NULL,
  "state" TEXT NOT NULL DEFAULT 'draft',
  "provider" TEXT,
  "model" TEXT,
  "schemaVersion" TEXT,
  "assumptions" JSONB,
  "uncertainty" JSONB,
  "analyzedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "NutritionAnalysis_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "NutritionClarification" (
  "id" TEXT NOT NULL,
  "analysisId" TEXT NOT NULL,
  "questionKey" TEXT NOT NULL,
  "question" TEXT NOT NULL,
  "options" JSONB,
  "answer" TEXT,
  "required" BOOLEAN NOT NULL DEFAULT true,
  "answeredAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "NutritionClarification_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "NutritionEntry_userId_occurredAt_idx" ON "NutritionEntry"("userId", "occurredAt");
CREATE INDEX "NutritionItem_entryId_sortOrder_idx" ON "NutritionItem"("entryId", "sortOrder");
CREATE UNIQUE INDEX "NutritionPhoto_entryId_key" ON "NutritionPhoto"("entryId");
CREATE UNIQUE INDEX "NutritionPhoto_storageKey_key" ON "NutritionPhoto"("storageKey");
CREATE UNIQUE INDEX "NutritionAnalysis_entryId_key" ON "NutritionAnalysis"("entryId");
CREATE INDEX "NutritionClarification_analysisId_idx" ON "NutritionClarification"("analysisId");

ALTER TABLE "NutritionEntry" ADD CONSTRAINT "NutritionEntry_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "NutritionItem" ADD CONSTRAINT "NutritionItem_entryId_fkey"
  FOREIGN KEY ("entryId") REFERENCES "NutritionEntry"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "NutritionPhoto" ADD CONSTRAINT "NutritionPhoto_entryId_fkey"
  FOREIGN KEY ("entryId") REFERENCES "NutritionEntry"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "NutritionAnalysis" ADD CONSTRAINT "NutritionAnalysis_entryId_fkey"
  FOREIGN KEY ("entryId") REFERENCES "NutritionEntry"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "NutritionClarification" ADD CONSTRAINT "NutritionClarification_analysisId_fkey"
  FOREIGN KEY ("analysisId") REFERENCES "NutritionAnalysis"("id") ON DELETE CASCADE ON UPDATE CASCADE;
