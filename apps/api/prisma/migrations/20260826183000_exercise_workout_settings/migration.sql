ALTER TABLE "WorkoutTemplateExercise"
ADD COLUMN "measurementUnit" TEXT NOT NULL DEFAULT 'kg';

ALTER TABLE "WorkoutExercise"
ADD COLUMN "measurementUnit" TEXT NOT NULL DEFAULT 'kg';
