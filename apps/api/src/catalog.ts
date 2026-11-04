import fs from "node:fs";
// Kept alongside the seed so the same catalogue ships in the runtime image.
const catalog: { starterExerciseIds: string[] } = JSON.parse(
  fs.readFileSync(new URL("../prisma/exercise-catalog.json", import.meta.url), "utf8"),
);
export const starterExerciseIds = catalog.starterExerciseIds;
