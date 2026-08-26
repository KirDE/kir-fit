ALTER TABLE "WorkoutTemplateExercise"
ADD COLUMN "customName" TEXT,
ADD COLUMN "lastWeight" DECIMAL(6,2),
ADD COLUMN "lastReps" INTEGER,
ADD COLUMN "lastRir" INTEGER;

ALTER TABLE "WorkoutExercise"
ADD COLUMN "customName" TEXT,
ADD COLUMN "lastWeight" DECIMAL(6,2),
ADD COLUMN "lastReps" INTEGER,
ADD COLUMN "lastRir" INTEGER;
