import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import sharp, { type Sharp } from "sharp";
import heicDecode from "heic-decode";

export const MAX_FOOD_PHOTO_BYTES = 10 * 1024 * 1024;
export const MAX_FOOD_PHOTO_DIMENSION = 12_000;
export const MAX_FOOD_PHOTO_PIXELS = 40_000_000;
export const DEFAULT_PENDING_RETENTION_MS = 24 * 60 * 60_000;

export type SupportedFoodImage = "jpeg" | "png" | "webp" | "heif";

export type PrivatePhotoManifest = {
  analysisId: string;
  ownerId: string;
  idempotencyHash: string;
  createdAt: string;
  occurredOn?: string;
  expiresAt: string;
  sourceFormat: SupportedFoodImage;
  analysisFile: string | null;
  thumbnailFile: string | null;
  status: "processing" | "completed" | "manual_required";
  result?: unknown;
  providerMetadata?: Record<string, unknown>;
  failureCode?: string;
  failureMessage?: string;
  retryable?: boolean;
  refinementIdempotencyHash?: string;
  finalizedAt?: string;
  pendingTask?:
    | {
        kind: "analyze";
        language: "en" | "de" | "ru";
        retainThumbnail: boolean;
      }
    | {
        kind: "clarify";
        language: "en" | "de" | "ru";
        answers: Record<string, string>;
        refinementIdempotencyHash: string;
      };
};

export class FoodImageError extends Error {
  constructor(
    public readonly code:
      | "file_too_large"
      | "unsupported_media"
      | "invalid_image"
      | "image_dimensions_exceeded"
      | "not_found"
      | "forbidden",
    message: string,
    public readonly status = 400,
  ) {
    super(message);
  }
}

/** Detects the actual container from magic bytes; request MIME and extension are ignored. */
export function detectFoodImageFormat(buffer: Buffer): SupportedFoodImage | null {
  if (
    buffer.length >= 3 &&
    buffer[0] === 0xff &&
    buffer[1] === 0xd8 &&
    buffer[2] === 0xff
  )
    return "jpeg";
  if (
    buffer.length >= 8 &&
    buffer.subarray(0, 8).equals(Buffer.from("89504e470d0a1a0a", "hex"))
  )
    return "png";
  if (
    buffer.length >= 12 &&
    buffer.subarray(0, 4).toString("ascii") === "RIFF" &&
    buffer.subarray(8, 12).toString("ascii") === "WEBP"
  )
    return "webp";
  if (buffer.length >= 12 && buffer.subarray(4, 8).toString("ascii") === "ftyp") {
    const brand = buffer.subarray(8, 12).toString("ascii");
    if (["heic", "heix", "hevc", "hevx", "mif1", "msf1"].includes(brand))
      return "heif";
  }
  return null;
}

const validAnalysisId = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function hashIdempotency(ownerId: string, key: string) {
  return createHash("sha256").update(`${ownerId}\0${key}`).digest("hex");
}

async function writeJsonAtomic(file: string, value: unknown) {
  const temporary = `${file}.${randomUUID()}.tmp`;
  await fs.writeFile(temporary, JSON.stringify(value), { mode: 0o600 });
  await fs.rename(temporary, file);
}

export class PrivateFoodPhotoStore {
  readonly root: string;

  constructor(
    root = process.env.NUTRITION_PRIVATE_DIR ||
      path.resolve("private/nutrition"),
  ) {
    this.root = path.resolve(root);
  }

  async initialize() {
    await fs.mkdir(this.root, { recursive: true, mode: 0o700 });
    await fs.chmod(this.root, 0o700);
  }

  private jobDirectory(analysisId: string) {
    if (!validAnalysisId.test(analysisId))
      throw new FoodImageError("not_found", "Photo not found", 404);
    return path.join(this.root, analysisId);
  }

  async findByIdempotencyKey(ownerId: string, key: string) {
    await this.initialize();
    const wanted = hashIdempotency(ownerId, key);
    for (const entry of await fs.readdir(this.root, { withFileTypes: true })) {
      if (!entry.isDirectory() || !validAnalysisId.test(entry.name)) continue;
      try {
        const manifest = await this.readManifest(entry.name);
        if (manifest.ownerId === ownerId && manifest.idempotencyHash === wanted)
          return manifest;
      } catch {
        // A concurrently deleted/corrupt orphan is handled by cleanup.
      }
    }
    return null;
  }

  async listByOwner(ownerId: string) {
    await this.initialize();
    const manifests: PrivatePhotoManifest[] = [];
    for (const entry of await fs.readdir(this.root, { withFileTypes: true })) {
      if (!entry.isDirectory() || !validAnalysisId.test(entry.name)) continue;
      try {
        const manifest = await this.readManifest(entry.name);
        if (manifest.ownerId === ownerId && !manifest.finalizedAt)
          manifests.push(manifest);
      } catch {
        // Concurrent cleanup may remove a manifest while the list is read.
      }
    }
    return manifests.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  async listPending() {
    await this.initialize();
    const manifests: PrivatePhotoManifest[] = [];
    for (const entry of await fs.readdir(this.root, { withFileTypes: true })) {
      if (!entry.isDirectory() || !validAnalysisId.test(entry.name)) continue;
      try {
        const manifest = await this.readManifest(entry.name);
        if (manifest.status === "processing" && manifest.pendingTask)
          manifests.push(manifest);
      } catch {
        // Concurrent cleanup may remove a manifest while the list is read.
      }
    }
    return manifests;
  }

  async create(
    ownerId: string,
    idempotencyKey: string,
    input: Buffer,
    retentionMs = DEFAULT_PENDING_RETENTION_MS,
    occurredOn?: string,
  ) {
    if (input.byteLength > MAX_FOOD_PHOTO_BYTES)
      throw new FoodImageError("file_too_large", "Photo exceeds the 10 MB limit", 413);
    const sourceFormat = detectFoodImageFormat(input);
    if (!sourceFormat)
      throw new FoodImageError(
        "unsupported_media",
        "Only JPEG, PNG, WebP and supported iPhone photos are accepted",
        415,
      );

    await this.initialize();
    const analysisId = randomUUID();
    const jobDirectory = this.jobDirectory(analysisId);
    await fs.mkdir(jobDirectory, { mode: 0o700 });
    const analysisFile = `${randomUUID()}.analysis.jpg`;
    const thumbnailFile = `${randomUUID()}.thumbnail.jpg`;
    const createdAt = new Date();
    const manifest: PrivatePhotoManifest = {
      analysisId,
      ownerId,
      idempotencyHash: hashIdempotency(ownerId, idempotencyKey),
      createdAt: createdAt.toISOString(),
      occurredOn,
      expiresAt: new Date(createdAt.getTime() + retentionMs).toISOString(),
      sourceFormat,
      analysisFile,
      thumbnailFile,
      status: "processing",
    };

    try {
      let base: Sharp;
      if (sourceFormat === "heif") {
        const frames = await heicDecode.all({ buffer: input });
        try {
          const frame = frames[0];
          if (!frame) throw new Error("HEIF image does not contain a frame");
          assertSafeDimensions(frame.width, frame.height);
          const decoded = await frame.decode();
          base = sharp(
            Buffer.from(
              decoded.data.buffer,
              decoded.data.byteOffset,
              decoded.data.byteLength,
            ),
            {
              raw: {
                width: decoded.width,
                height: decoded.height,
                channels: 4,
              },
              limitInputPixels: MAX_FOOD_PHOTO_PIXELS,
            },
          );
        } finally {
          frames.dispose();
        }
      } else {
        base = sharp(input, {
          failOn: "error",
          limitInputPixels: MAX_FOOD_PHOTO_PIXELS,
          sequentialRead: true,
        });
        const metadata = await base.metadata();
        if (!metadata.width || !metadata.height)
          throw new FoodImageError("invalid_image", "Image dimensions are missing", 415);
        assertSafeDimensions(metadata.width, metadata.height);
      }

      // sharp omits metadata by default. rotate() applies EXIF orientation before EXIF is stripped.
      await Promise.all([
        base
          .clone()
          .rotate()
          .resize({ width: 1600, height: 1600, fit: "inside", withoutEnlargement: true })
          .jpeg({ quality: 82, mozjpeg: true })
          .toFile(path.join(jobDirectory, analysisFile)),
        base
          .clone()
          .rotate()
          .resize({ width: 512, height: 512, fit: "inside", withoutEnlargement: true })
          .jpeg({ quality: 76, mozjpeg: true })
          .toFile(path.join(jobDirectory, thumbnailFile)),
      ]);
      await Promise.all([
        fs.chmod(path.join(jobDirectory, analysisFile), 0o600),
        fs.chmod(path.join(jobDirectory, thumbnailFile), 0o600),
      ]);
      await writeJsonAtomic(path.join(jobDirectory, "manifest.json"), manifest);
      return manifest;
    } catch (error) {
      await fs.rm(jobDirectory, { recursive: true, force: true });
      if (error instanceof FoodImageError) throw error;
      throw new FoodImageError(
        "invalid_image",
        `Photo could not be safely decoded${sourceFormat === "heif" ? " or converted" : ""}`,
        415,
      );
    }
  }

  async readManifest(analysisId: string): Promise<PrivatePhotoManifest> {
    try {
      return JSON.parse(
        await fs.readFile(path.join(this.jobDirectory(analysisId), "manifest.json"), "utf8"),
      );
    } catch (error: any) {
      if (error instanceof FoodImageError) throw error;
      if (error?.code === "ENOENT")
        throw new FoodImageError("not_found", "Photo not found", 404);
      throw error;
    }
  }

  async requireOwned(analysisId: string, ownerId: string) {
    const manifest = await this.readManifest(analysisId);
    if (manifest.ownerId !== ownerId)
      throw new FoodImageError("forbidden", "Photo does not belong to this user", 403);
    return manifest;
  }

  async analysisBytes(analysisId: string, ownerId: string) {
    const manifest = await this.requireOwned(analysisId, ownerId);
    if (!manifest.analysisFile)
      throw new FoodImageError("not_found", "Analysis image is no longer retained", 404);
    return fs.readFile(path.join(this.jobDirectory(analysisId), manifest.analysisFile));
  }

  async thumbnail(analysisId: string, ownerId: string) {
    const manifest = await this.requireOwned(analysisId, ownerId);
    if (!manifest.thumbnailFile)
      throw new FoodImageError("not_found", "Thumbnail is not retained", 404);
    return fs.readFile(path.join(this.jobDirectory(analysisId), manifest.thumbnailFile));
  }

  async update(
    analysisId: string,
    ownerId: string,
    patch: Partial<PrivatePhotoManifest>,
  ) {
    const current = await this.requireOwned(analysisId, ownerId);
    const next = { ...current, ...patch, analysisId, ownerId };
    await writeJsonAtomic(
      path.join(this.jobDirectory(analysisId), "manifest.json"),
      next,
    );
    return next;
  }

  async removeAnalysisImage(analysisId: string, ownerId: string) {
    const manifest = await this.requireOwned(analysisId, ownerId);
    if (manifest.analysisFile)
      await fs.rm(path.join(this.jobDirectory(analysisId), manifest.analysisFile), {
        force: true,
      });
    return this.update(analysisId, ownerId, { analysisFile: null });
  }

  async removeThumbnail(analysisId: string, ownerId: string) {
    const manifest = await this.requireOwned(analysisId, ownerId);
    if (manifest.thumbnailFile)
      await fs.rm(path.join(this.jobDirectory(analysisId), manifest.thumbnailFile), {
        force: true,
      });
    return this.update(analysisId, ownerId, { thumbnailFile: null });
  }

  async remove(analysisId: string, ownerId: string) {
    await this.requireOwned(analysisId, ownerId);
    await fs.rm(this.jobDirectory(analysisId), { recursive: true, force: true });
  }

  async cleanupExpired(now = new Date()) {
    await this.initialize();
    let removed = 0;
    for (const entry of await fs.readdir(this.root, { withFileTypes: true })) {
      if (!entry.isDirectory() || !validAnalysisId.test(entry.name)) continue;
      try {
        const manifest = await this.readManifest(entry.name);
        if (new Date(manifest.expiresAt).getTime() <= now.getTime()) {
          await fs.rm(this.jobDirectory(entry.name), { recursive: true, force: true });
          removed += 1;
        }
      } catch {
        const stat = await fs.stat(path.join(this.root, entry.name)).catch(() => null);
        if (stat && now.getTime() - stat.mtimeMs > DEFAULT_PENDING_RETENTION_MS) {
          await fs.rm(path.join(this.root, entry.name), { recursive: true, force: true });
          removed += 1;
        }
      }
    }
    return removed;
  }
}

function assertSafeDimensions(width: number, height: number) {
  if (
    !Number.isSafeInteger(width) ||
    !Number.isSafeInteger(height) ||
    width <= 0 ||
    height <= 0 ||
    width > MAX_FOOD_PHOTO_DIMENSION ||
    height > MAX_FOOD_PHOTO_DIMENSION ||
    width * height > MAX_FOOD_PHOTO_PIXELS
  )
    throw new FoodImageError(
      "image_dimensions_exceeded",
      "Image dimensions are too large",
      413,
    );
}
