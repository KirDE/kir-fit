import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";
import { afterEach, describe, expect, it } from "vitest";
import {
  detectFoodImageFormat,
  MAX_FOOD_PHOTO_BYTES,
  PrivateFoodPhotoStore,
} from "./food-image.js";

const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryRoots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })),
  );
});

async function store() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "kir-fit-photo-test-"));
  temporaryRoots.push(root);
  return new PrivateFoodPhotoStore(root);
}

async function jpeg(width = 120, height = 80) {
  return sharp({ create: { width, height, channels: 3, background: "red" } })
    .withMetadata({ orientation: 6 })
    .jpeg()
    .toBuffer();
}

describe("food photo content validation", () => {
  it("detects supported formats from magic bytes instead of filenames", () => {
    expect(detectFoodImageFormat(Buffer.from("ffd8ff00", "hex"))).toBe("jpeg");
    expect(detectFoodImageFormat(Buffer.from("89504e470d0a1a0a", "hex"))).toBe("png");
    expect(detectFoodImageFormat(Buffer.from("524946460000000057454250", "hex"))).toBe("webp");
    expect(detectFoodImageFormat(Buffer.from("000000186674797068656963", "hex"))).toBe("heif");
    expect(detectFoodImageFormat(Buffer.from("not-an-image"))).toBeNull();
  });

  it("rejects oversized files before decoding", async () => {
    const photos = await store();
    const input = Buffer.alloc(MAX_FOOD_PHOTO_BYTES + 1);
    input.set(Buffer.from("ffd8ff", "hex"));
    await expect(photos.create("owner", "12345678", input)).rejects.toMatchObject({
      code: "file_too_large",
    });
  });

  it("rejects malformed media and decompression bombs", async () => {
    const photos = await store();
    await expect(
      photos.create("owner", "badmedia1", Buffer.from("ffd8ff000000", "hex")),
    ).rejects.toMatchObject({ code: "invalid_image" });

    const compressedHuge = await sharp({
      create: { width: 6500, height: 6500, channels: 3, background: "black" },
    })
      .png({ compressionLevel: 9 })
      .toBuffer();
    await expect(photos.create("owner", "hugeimage", compressedHuge)).rejects.toMatchObject({
      code: "invalid_image",
    });
  }, 20_000);
});

describe("private photo store", () => {
  it("normalizes orientation, strips metadata, randomizes names and removes analysis bytes", async () => {
    const photos = await store();
    const manifest = await photos.create("owner-a", "request-0001", await jpeg());
    expect(manifest.analysisFile).not.toContain("request-0001");
    const thumbnail = await photos.thumbnail(manifest.analysisId, "owner-a");
    const metadata = await sharp(thumbnail).metadata();
    expect(metadata.format).toBe("jpeg");
    expect(metadata.orientation).toBeUndefined();
    expect(metadata.width).toBeLessThanOrEqual(512);
    await photos.removeAnalysisImage(manifest.analysisId, "owner-a");
    await expect(photos.analysisBytes(manifest.analysisId, "owner-a")).rejects.toMatchObject({
      code: "not_found",
    });
    expect((await photos.thumbnail(manifest.analysisId, "owner-a")).byteLength).toBeGreaterThan(0);
  });

  it("protects ownership and rejects path traversal IDs", async () => {
    const photos = await store();
    const manifest = await photos.create("owner-a", "request-0002", await jpeg());
    await expect(photos.thumbnail(manifest.analysisId, "owner-b")).rejects.toMatchObject({
      code: "forbidden",
    });
    await expect(photos.thumbnail("../../etc/passwd", "owner-a")).rejects.toMatchObject({
      code: "not_found",
    });
  });

  it("deduplicates by owner/idempotency key and expires orphaned jobs", async () => {
    const photos = await store();
    const manifest = await photos.create("owner-a", "request-0003", await jpeg(), 1);
    expect(await photos.findByIdempotencyKey("owner-a", "request-0003")).toMatchObject({
      analysisId: manifest.analysisId,
    });
    expect(await photos.findByIdempotencyKey("owner-b", "request-0003")).toBeNull();
    expect(await photos.cleanupExpired(new Date(Date.now() + 5_000))).toBe(1);
    await expect(photos.readManifest(manifest.analysisId)).rejects.toMatchObject({
      code: "not_found",
    });
  });
});
