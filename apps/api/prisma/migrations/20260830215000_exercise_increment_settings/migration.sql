ALTER TABLE "WorkoutExercise"
ADD COLUMN "increment" DECIMAL(6,2) NOT NULL DEFAULT 2.5;

UPDATE "WorkoutTemplateExercise"
SET "increment" = 2.5
WHERE "exerciseId" = 'leg-press' AND "increment" = 5;
