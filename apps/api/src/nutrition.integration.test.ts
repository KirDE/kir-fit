import { afterAll, beforeAll, describe, expect, it } from "vitest";
import jwt from "jsonwebtoken";
import request from "supertest";
import sharp from "sharp";
import { PrivateFoodPhotoStore } from "./nutrition/food-image.js";
import { mealAnalysisV1Fixtures } from "./nutrition/fixtures/meal-analysis-v1.js";

const hasDatabase = Boolean(process.env.DATABASE_URL);

describe.skipIf(!hasDatabase)("nutrition API", () => {
  const secret = "integration-test-secret-that-is-at-least-32-characters";
  const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  let api: typeof import("./server.js");
  let firstUserId: string;
  let secondUserId: string;
  let firstToken: string;
  let secondToken: string;
  let entryId: string;

  beforeAll(async () => {
    process.env.NODE_ENV = "test";
    process.env.JWT_SECRET = secret;
    process.env.OPENAI_API_KEY = "";
    process.env.UPLOAD_DIR = `/tmp/kir-fit-api-test-${suffix}`;
    process.env.NUTRITION_PRIVATE_DIR = `/tmp/kir-fit-nutrition-test-${suffix}`;
    api = await import("./server.js");
    const [first, second] = await Promise.all([
      api.prisma.user.create({
        data: {
          username: `nutrition-a-${suffix}`,
          displayName: "Nutrition A",
          startingWeightKg: 100,
        },
      }),
      api.prisma.user.create({
        data: {
          username: `nutrition-b-${suffix}`,
          displayName: "Nutrition B",
        },
      }),
    ]);
    firstUserId = first.id;
    secondUserId = second.id;
    firstToken = jwt.sign({ sub: first.id }, secret);
    secondToken = jwt.sign({ sub: second.id }, secret);
  });

  afterAll(async () => {
    if (!api) return;
    await api.prisma.bodyWeightEntry.deleteMany({
      where: { userId: { in: [firstUserId, secondUserId].filter(Boolean) } },
    });
    await api.prisma.user.deleteMany({
      where: { id: { in: [firstUserId, secondUserId].filter(Boolean) } },
    });
    await api.prisma.$disconnect();
  });

  it("persists profile settings and returns the transparent formula", async () => {
    const response = await request(api.app)
      .patch("/api/settings/nutrition")
      .set("Authorization", `Bearer ${firstToken}`)
      .send({ heightCm: 180, goalWeightKg: 82 });
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      heightCm: 180,
      goalWeightKg: 82,
      proteinTargetMode: "automatic",
      calculation: {
        currentWeightKg: 100,
        weightSource: "starting",
        referenceWeightKg: 82,
        referenceWeightSource: "goal",
        multiplierGramsPerKg: 1.6,
        targetGrams: 130,
      },
    });

    const invalidManual = await request(api.app)
      .patch("/api/settings/nutrition")
      .set("Authorization", `Bearer ${firstToken}`)
      .send({ proteinTargetMode: "manual" });
    expect(invalidManual.status).toBe(400);
    expect(invalidManual.body.error).toBe("manual_protein_target_required");

    const manual = await request(api.app)
      .patch("/api/settings/nutrition")
      .set("Authorization", `Bearer ${firstToken}`)
      .send({ proteinTargetMode: "manual", manualProteinTargetGrams: 145 });
    expect(manual.status).toBe(200);
    expect(manual.body.calculation.targetGrams).toBe(145);

    await api.prisma.bodyWeightEntry.create({
      data: {
        userId: firstUserId,
        date: new Date("2026-09-03T12:00:00.000Z"),
        weight: 75,
      },
    });
    const afterWeight = await request(api.app)
      .get("/api/settings/nutrition")
      .set("Authorization", `Bearer ${firstToken}`);
    expect(afterWeight.body.calculation).toMatchObject({
      currentWeightKg: 75,
      weightSource: "latest",
      targetGrams: 145,
      automaticTargetGrams: 120,
    });

    const automatic = await request(api.app)
      .patch("/api/settings/nutrition")
      .set("Authorization", `Bearer ${firstToken}`)
      .send({ proteinTargetMode: "automatic" });
    expect(automatic.body.calculation.targetGrams).toBe(120);
  });

  it("queues rate-limited guest analysis and deletes it on request", async () => {
    const image = await sharp({
      create: { width: 64, height: 48, channels: 3, background: "green" },
    })
      .jpeg()
      .toBuffer();
    const unauthorized = await request(api.app)
      .post("/api/nutrition/photos/analyze")
      .set("Idempotency-Key", "guest-auth-check-1")
      .attach("image", image, "meal.jpg");
    expect(unauthorized.status).toBe(401);

    const response = await request(api.app)
      .post("/api/nutrition/photos/analyze")
      .set("X-Kirfit-Device", "d9ad279e-367f-478d-8390-bd4f05d3a91f")
      .set("Idempotency-Key", "guest-auth-check-2")
      .attach("image", image, "meal.jpg");
    expect(response.status).toBe(202);
    let result: any;
    for (let attempt = 0; attempt < 100; attempt += 1) {
      const status = await request(api.app)
        .get(`/api/nutrition/photos/${response.body.analysisId}/status`)
        .set("X-Kirfit-Device", "d9ad279e-367f-478d-8390-bd4f05d3a91f");
      result = status.body;
      if (result.status !== "processing") break;
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    expect(result).toMatchObject({
      status: "manual_required",
      failureCode: "not_configured",
      manualEntryAvailable: true,
    });
    const store = new PrivateFoodPhotoStore(process.env.NUTRITION_PRIVATE_DIR);
    await expect(store.readManifest(response.body.analysisId)).resolves.toMatchObject({
      status: "manual_required",
    });
    await request(api.app)
      .delete(`/api/nutrition/photos/${response.body.analysisId}`)
      .set("X-Kirfit-Device", "d9ad279e-367f-478d-8390-bd4f05d3a91f")
      .expect(204);
    await expect(store.readManifest(response.body.analysisId)).rejects.toMatchObject({
      code: "not_found",
    });
  });

  it("creates an entry from item snapshots and protects ownership", async () => {
    const created = await request(api.app)
      .post("/api/nutrition/entries")
      .set("Authorization", `Bearer ${firstToken}`)
      .send({
        occurredAt: "2026-03-29T22:30:00.000Z",
        mealType: "dinner",
        consumedPercent: 75,
        items: [
          {
            name: "Chicken",
            amountGrams: 200,
            calories: 330,
            proteinGrams: 62,
            fatGrams: 7,
            carbsGrams: 0,
            fiberGrams: 0,
          },
          {
            name: "Salad",
            amountGrams: 150,
            calories: 100,
            proteinGrams: 3,
            fatGrams: 5,
            carbsGrams: 10,
            fiberGrams: 4,
          },
        ],
      });
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({
      fullCalories: 430,
      fullProteinGrams: 65,
      calories: 322.5,
      proteinGrams: 48.75,
    });
    entryId = created.body.id;

    const otherUserRead = await request(api.app)
      .get(`/api/nutrition/entries/${entryId}`)
      .set("Authorization", `Bearer ${secondToken}`);
    expect(otherUserRead.status).toBe(404);
    const otherUserUpdate = await request(api.app)
      .patch(`/api/nutrition/entries/${entryId}`)
      .set("Authorization", `Bearer ${secondToken}`)
      .send({ consumedPercent: 10 });
    expect(otherUserUpdate.status).toBe(404);
    const otherUserDelete = await request(api.app)
      .delete(`/api/nutrition/entries/${entryId}`)
      .set("Authorization", `Bearer ${secondToken}`);
    expect(otherUserDelete.status).toBe(404);

    const invalid = await request(api.app)
      .post("/api/nutrition/entries")
      .set("Authorization", `Bearer ${firstToken}`)
      .send({
        occurredAt: "2026-03-29T22:30:00.000Z",
        consumedPercent: 101,
        items: [],
      });
    expect(invalid.status).toBe(400);
  });

  it("aggregates by local day and recalculates after edits", async () => {
    const summary = await request(api.app)
      .get("/api/nutrition/days/2026-03-30")
      .query({ timezone: "Europe/Berlin" })
      .set("Authorization", `Bearer ${firstToken}`);
    expect(summary.status).toBe(200);
    expect(summary.body).toMatchObject({
      totals: { calories: 322.5, proteinGrams: 48.75 },
      proteinTargetGrams: 120,
      proteinPercent: 40.6,
      proteinRemainingGrams: 71.25,
    });

    const updated = await request(api.app)
      .patch(`/api/nutrition/entries/${entryId}`)
      .set("Authorization", `Bearer ${firstToken}`)
      .send({ consumedPercent: 50 });
    expect(updated.status).toBe(200);
    expect(updated.body).toMatchObject({ calories: 215, proteinGrams: 32.5 });

    const range = await request(api.app)
      .get("/api/nutrition/entries")
      .query({ from: "2026-03-30", to: "2026-03-30", timezone: "Europe/Berlin" })
      .set("Authorization", `Bearer ${firstToken}`);
    expect(range.status).toBe(200);
    expect(range.body.days[0]).toMatchObject({
      date: "2026-03-30",
      totals: { calories: 215, proteinGrams: 32.5 },
    });
  });

  it("attaches an owned private analysis and removes its thumbnail with the entry", async () => {
    const store = new PrivateFoodPhotoStore(process.env.NUTRITION_PRIVATE_DIR);
    const image = await sharp({
      create: {
        width: 80,
        height: 60,
        channels: 3,
        background: "tomato",
      },
    })
      .jpeg()
      .toBuffer();
    const manifest = await store.create(firstUserId, "integration-photo-1001", image);
    await store.update(manifest.analysisId, firstUserId, {
      status: "completed",
      result: mealAnalysisV1Fixtures[0],
      providerMetadata: {
        provider: "fixture",
        model: "fixture-v1",
        schemaVersion: "meal-photo-v1",
      },
    });

    const created = await request(api.app)
      .post("/api/nutrition/entries")
      .set("Authorization", `Bearer ${firstToken}`)
      .send({
        occurredAt: "2026-09-03T12:00:00.000Z",
        mealType: "lunch",
        title: "Analyzed salad",
        consumedPercent: 100,
        analysisId: manifest.analysisId,
        items: [
          {
            name: "Salad",
            amountGrams: 250,
            calories: 300,
            proteinGrams: 10,
            fatGrams: 20,
            carbsGrams: 25,
            fiberGrams: 6,
          },
        ],
      });
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({
      photo: {
        analysisId: manifest.analysisId,
        thumbnailUrl: `/api/nutrition/photos/${manifest.analysisId}/thumbnail`,
      },
      analysis: { state: "completed", provider: "fixture" },
    });

    const ownThumbnail = await request(api.app)
      .get(created.body.photo.thumbnailUrl)
      .set("Authorization", `Bearer ${firstToken}`);
    expect(ownThumbnail.status).toBe(200);
    const stolenThumbnail = await request(api.app)
      .get(created.body.photo.thumbnailUrl)
      .set("Authorization", `Bearer ${secondToken}`);
    expect(stolenThumbnail.status).toBe(403);

    const removed = await request(api.app)
      .delete(`/api/nutrition/entries/${created.body.id}`)
      .set("Authorization", `Bearer ${firstToken}`);
    expect(removed.status).toBe(204);
    const afterDelete = await request(api.app)
      .get(created.body.photo.thumbnailUrl)
      .set("Authorization", `Bearer ${firstToken}`);
    expect(afterDelete.status).toBe(404);
  });

  it("deletes an owned entry and cascades child items", async () => {
    const removed = await request(api.app)
      .delete(`/api/nutrition/entries/${entryId}`)
      .set("Authorization", `Bearer ${firstToken}`);
    expect(removed.status).toBe(204);
    expect(await api.prisma.nutritionItem.count({ where: { entryId } })).toBe(0);
  });
});
