BEGIN;
-- Preserve template IDs and all exercise/session relations. The legacy first
-- template becomes Default, and the user's already-selected days retain it.
CREATE TABLE "WorkoutDayAssignment" (
  "programId" TEXT NOT NULL,
  "weekday" INTEGER NOT NULL CHECK ("weekday" BETWEEN 0 AND 6),
  "templateId" TEXT NOT NULL,
  CONSTRAINT "WorkoutDayAssignment_pkey" PRIMARY KEY ("programId", "weekday"),
  CONSTRAINT "WorkoutDayAssignment_programId_fkey" FOREIGN KEY ("programId") REFERENCES "WorkoutProgram"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "WorkoutDayAssignment_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "WorkoutTemplate"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
WITH defaults AS (
  SELECT DISTINCT ON ("programId") id, "programId" FROM "WorkoutTemplate" ORDER BY "programId", id
)
UPDATE "WorkoutTemplate" t SET name = 'Default' FROM defaults d WHERE t.id = d.id;
INSERT INTO "WorkoutDayAssignment" ("programId", weekday, "templateId")
SELECT p.id, days.day, t.id
FROM "WorkoutProgram" p
JOIN LATERAL (SELECT id FROM "WorkoutTemplate" WHERE "programId" = p.id ORDER BY id LIMIT 1) t ON true
CROSS JOIN LATERAL unnest(p."preferredWeekdays") AS days(day)
ON CONFLICT DO NOTHING;
COMMIT;
