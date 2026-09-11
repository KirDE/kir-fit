import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { writeNutritionAnalysisLog } from "./analysis-log.js";

describe("persistent nutrition analysis log", () => {
  const previous = process.env.NUTRITION_ANALYSIS_LOG;
  let root = "";

  afterEach(async () => {
    if (previous === undefined) delete process.env.NUTRITION_ANALYSIS_LOG;
    else process.env.NUTRITION_ANALYSIS_LOG = previous;
    if (root) await fs.rm(root, { recursive: true, force: true });
  });

  it("appends structured JSON lines to the configured host-mounted path", async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), "kir-fit-analysis-log-"));
    const file = path.join(root, "nested", "nutrition-analysis.jsonl");
    process.env.NUTRITION_ANALYSIS_LOG = file;

    await writeNutritionAnalysisLog({
      event: "nutrition_analysis_provider_failed",
      analysisId: "analysis-1",
      failureCode: "malformed_response",
      details: [{ path: ["foods", 0, "calories"], code: "invalid_type" }],
    });

    const entry = JSON.parse((await fs.readFile(file, "utf8")).trim());
    expect(entry).toMatchObject({
      event: "nutrition_analysis_provider_failed",
      analysisId: "analysis-1",
      failureCode: "malformed_response",
      details: [{ path: ["foods", 0, "calories"], code: "invalid_type" }],
    });
    expect(entry.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });
});
