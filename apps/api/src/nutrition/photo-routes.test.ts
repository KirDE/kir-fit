import express from "express";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { AddressInfo } from "node:net";
import sharp from "sharp";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PrivateFoodPhotoStore } from "./food-image.js";
import { mealAnalysisV1Fixtures } from "./fixtures/meal-analysis-v1.js";
import {
  MealAnalysisProviderError,
  type MealAnalysisProvider,
} from "./meal-analysis.js";
import { createNutritionPhotoRouter } from "./photo-routes.js";

const cleanup: Array<() => Promise<void>> = [];
afterEach(async () => {
  await Promise.all(cleanup.splice(0).map((fn) => fn()));
});

async function testServer(
  provider: MealAnalysisProvider,
  persistResult?: Parameters<typeof createNutritionPhotoRouter>[0]["persistResult"],
) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "kir-fit-route-test-"));
  const app = express();
  app.use(
    "/api/nutrition/photos",
    createNutritionPhotoRouter({
      ownerId: (request) => String(request.header("x-test-owner") || "anonymous"),
      ephemeral: (request) => request.header("x-ephemeral") === "1",
      store: new PrivateFoodPhotoStore(root),
      provider,
      persistResult,
    }),
  );
  const server = app.listen(0);
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  cleanup.push(async () => {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
    await fs.rm(root, { recursive: true, force: true });
  });
  return url;
}

async function photoForm() {
  const bytes = await sharp({
    create: { width: 64, height: 48, channels: 3, background: "green" },
  })
    .jpeg()
    .toBuffer();
  const form = new FormData();
  form.set("image", new Blob([bytes], { type: "application/octet-stream" }), "fake.exe");
  return form;
}

async function waitForJob(
  url: string,
  analysisId: string,
  headers: Record<string, string>,
) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const response = await fetch(
      `${url}/api/nutrition/photos/${analysisId}/status`,
      { headers },
    );
    const body: any = await response.json();
    if (body.status !== "processing") return body;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error("analysis job did not finish");
}

describe("private nutrition photo routes", () => {
  it("analyzes once, ignores claimed MIME/extension and ownership-protects bytes", async () => {
    const analyze = vi.fn(async () => ({
      analysis: mealAnalysisV1Fixtures[0],
      metadata: {
        provider: "fixture",
        model: "fixture-v1",
        schemaVersion: "meal-photo-v1",
        latencyMs: 1,
        inputTokens: null,
        outputTokens: null,
        estimatedCostUsd: null,
      },
    }));
    const url = await testServer({ analyze });
    const headers = { "x-test-owner": "owner-a", "Idempotency-Key": "request-1001" };
    const first = await fetch(`${url}/api/nutrition/photos/analyze`, {
      method: "POST",
      headers,
      body: await photoForm(),
    });
    expect(first.status).toBe(202);
    const body: any = await first.json();
    expect(body).toMatchObject({ status: "processing" });
    const completed = await waitForJob(url, body.analysisId, {
      "x-test-owner": "owner-a",
    });
    expect(completed).toMatchObject({
      status: "completed",
      analysis: { summary: "Mixed salad" },
    });

    const retry = await fetch(`${url}/api/nutrition/photos/analyze`, {
      method: "POST",
      headers,
      body: await photoForm(),
    });
    expect(retry.status).toBe(200);
    expect(analyze).toHaveBeenCalledTimes(1);

    const ownThumbnail = await fetch(`${url}${body.thumbnailUrl}`, {
      headers: { "x-test-owner": "owner-a" },
    });
    expect(ownThumbnail.status).toBe(200);
    expect(ownThumbnail.headers.get("cache-control")).toBe("private, no-store");
    expect(ownThumbnail.headers.get("content-type")).toContain("image/jpeg");
    const stolenThumbnail = await fetch(`${url}${body.thumbnailUrl}`, {
      headers: { "x-test-owner": "owner-b" },
    });
    expect(stolenThumbnail.status).toBe(403);
    expect((await stolenThumbnail.arrayBuffer()).byteLength).toBeLessThan(200);
  });

  it("returns manual fallback and cleans the analysis derivative on provider failure", async () => {
    const url = await testServer({
      analyze: async () => {
        throw new MealAnalysisProviderError(
          "timeout",
          "Meal analysis timed out; enter it manually",
          true,
        );
      },
    });
    const response = await fetch(`${url}/api/nutrition/photos/analyze`, {
      method: "POST",
      headers: { "x-test-owner": "owner-a", "Idempotency-Key": "request-1002" },
      body: await photoForm(),
    });
    expect(response.status).toBe(202);
    const body: any = await response.json();
    const failed = await waitForJob(url, body.analysisId, {
      "x-test-owner": "owner-a",
    });
    expect(failed).toMatchObject({
      status: "manual_required",
      failureCode: "timeout",
      retryable: true,
      manualEntryAvailable: true,
    });
    expect((await fetch(`${url}${body.thumbnailUrl}`, { headers: { "x-test-owner": "owner-a" } })).status).toBe(200);
  });

  it("refines the trusted stored result and makes clarification retries idempotent", async () => {
    const refined = { ...structuredClone(mealAnalysisV1Fixtures[0]), summary: "Salad with oil dressing" };
    const refine = vi.fn(async (prior) => {
      expect(prior.summary).toBe("Mixed salad");
      return {
        analysis: refined,
        metadata: {
          provider: "fixture",
          model: "fixture-v1",
          schemaVersion: "meal-photo-v1",
          latencyMs: 1,
          inputTokens: null,
          outputTokens: null,
          estimatedCostUsd: null,
        },
      };
    });
    const persistResult = vi.fn(async (input) => input.entryId || "entry-auto-1");
    const url = await testServer({
      analyze: async () => ({
        analysis: mealAnalysisV1Fixtures[0],
        metadata: {
          provider: "fixture",
          model: "fixture-v1",
          schemaVersion: "meal-photo-v1",
          latencyMs: 1,
          inputTokens: null,
          outputTokens: null,
          estimatedCostUsd: null,
        },
      }),
      refine,
    }, persistResult);
    const uploaded = await fetch(`${url}/api/nutrition/photos/analyze`, {
      method: "POST",
      headers: { "x-test-owner": "owner-a", "Idempotency-Key": "request-1003" },
      body: await photoForm(),
    });
    const original: any = await uploaded.json();
    await waitForJob(url, original.analysisId, { "x-test-owner": "owner-a" });
    const clarify = () =>
      fetch(`${url}/api/nutrition/photos/analyze/${original.analysisId}/clarify`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-test-owner": "owner-a",
          "Idempotency-Key": "clarify-1003",
        },
        body: JSON.stringify({
          answers: { preparation_detail: "olive oil and vinegar" },
          priorAnalysis: { summary: "client attempted replacement" },
        }),
      });
    const first = await clarify();
    expect(first.status).toBe(202);
    const refinedBody = await waitForJob(url, original.analysisId, {
      "x-test-owner": "owner-a",
    });
    expect(refinedBody).toMatchObject({
      entryId: "entry-auto-1",
      result: {
        summary: "Salad with oil dressing",
        clarificationQuestions: [],
      },
    });
    expect((await clarify()).status).toBe(200);
    expect(refine).toHaveBeenCalledTimes(1);
    expect(persistResult).toHaveBeenCalledTimes(2);
    expect(persistResult.mock.calls[1][0]).toMatchObject({
      entryId: "entry-auto-1",
      analysisId: original.analysisId,
    });
  });

  it("keeps the prior estimate and records the provider error when async clarification fails", async () => {
    const url = await testServer({
      analyze: async () => ({
        analysis: mealAnalysisV1Fixtures[0],
        metadata: {
          provider: "fixture",
          model: "fixture-v1",
          schemaVersion: "meal-photo-v1",
          latencyMs: 1,
          inputTokens: null,
          outputTokens: null,
          estimatedCostUsd: null,
        },
      }),
      refine: async () => {
        throw new MealAnalysisProviderError(
          "malformed_response",
          "The updated estimate was incomplete",
          true,
        );
      },
    });
    const ownerHeaders = { "x-test-owner": "owner-a" };
    const uploaded = await fetch(`${url}/api/nutrition/photos/analyze`, {
      method: "POST",
      headers: { ...ownerHeaders, "Idempotency-Key": "request-1004" },
      body: await photoForm(),
    });
    const queued: any = await uploaded.json();
    await waitForJob(url, queued.analysisId, ownerHeaders);

    const clarification = await fetch(
      `${url}/api/nutrition/photos/analyze/${queued.analysisId}/clarify`,
      {
        method: "POST",
        headers: {
          ...ownerHeaders,
          "Content-Type": "application/json",
          "Idempotency-Key": "clarify-1004",
        },
        body: JSON.stringify({ answers: { sauce: "oil and vinegar" } }),
      },
    );
    expect(clarification.status).toBe(202);
    expect(await waitForJob(url, queued.analysisId, ownerHeaders)).toMatchObject({
      status: "manual_required",
      failureCode: "malformed_response",
      retryable: true,
      result: { summary: "Mixed salad" },
    });
  });

  it("keeps guest analysis private and supports asynchronous clarification", async () => {
    const refined = {
      ...structuredClone(mealAnalysisV1Fixtures[0]),
      summary: "Guest clarified salad",
    };
    const refine = vi.fn(async () => ({
      analysis: refined,
      metadata: {
        provider: "fixture",
        model: "fixture-v1",
        schemaVersion: "meal-photo-v1",
        latencyMs: 1,
        inputTokens: null,
        outputTokens: null,
        estimatedCostUsd: null,
      },
    }));
    const url = await testServer({
      analyze: async () => ({
        analysis: mealAnalysisV1Fixtures[0],
        metadata: {
          provider: "fixture",
          model: "fixture-v1",
          schemaVersion: "meal-photo-v1",
          latencyMs: 1,
          inputTokens: null,
          outputTokens: null,
          estimatedCostUsd: null,
        },
      }),
      refine,
    });
    const uploaded = await fetch(`${url}/api/nutrition/photos/analyze`, {
      method: "POST",
      headers: {
        "x-test-owner": "guest-owner",
        "x-ephemeral": "1",
        "Idempotency-Key": "guest-request-1001",
      },
      body: await photoForm(),
    });
    expect(uploaded.status).toBe(202);
    const body: any = await uploaded.json();
    const completed = await waitForJob(url, body.analysisId, {
      "x-test-owner": "guest-owner",
    });
    expect(completed.thumbnailUrl).toContain(`/api/nutrition/photos/${body.analysisId}/thumbnail`);
    expect(
      (
        await fetch(`${url}/api/nutrition/photos/${body.analysisId}/thumbnail`, {
          headers: { "x-test-owner": "guest-owner" },
        })
      ).status,
    ).toBe(200);

    const clarified = await fetch(
      `${url}/api/nutrition/photos/analyze/${body.analysisId}/clarify`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-test-owner": "guest-owner",
          "x-ephemeral": "1",
          "Idempotency-Key": "guest-clarify-1001",
        },
        body: JSON.stringify({
          answers: { sauce: "oil and vinegar" },
          priorAnalysis: mealAnalysisV1Fixtures[0],
        }),
      },
    );
    expect(clarified.status).toBe(202);
    expect(await waitForJob(url, body.analysisId, {
      "x-test-owner": "guest-owner",
    })).toMatchObject({
      status: "completed",
      analysis: { summary: "Guest clarified salad" },
      metadata: { clarificationRound: 1 },
    });
    expect(refine).toHaveBeenCalledTimes(1);
  });
});
