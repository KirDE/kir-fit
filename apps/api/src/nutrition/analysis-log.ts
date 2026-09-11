import fs from "node:fs/promises";
import path from "node:path";

export type NutritionAnalysisLogEvent = Record<string, unknown> & {
  event: string;
  analysisId: string;
};

export async function writeNutritionAnalysisLog(event: NutritionAnalysisLogEvent) {
  const file = process.env.NUTRITION_ANALYSIS_LOG?.trim();
  if (!file) return;
  await fs.mkdir(path.dirname(file), { recursive: true, mode: 0o750 });
  await fs.appendFile(
    file,
    `${JSON.stringify({ timestamp: new Date().toISOString(), ...event })}\n`,
    { encoding: "utf8", mode: 0o640 },
  );
}
