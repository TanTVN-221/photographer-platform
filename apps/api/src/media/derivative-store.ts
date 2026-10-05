import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { access, lstat, mkdir, mkdtemp, open, rename, rm } from "node:fs/promises";
import { isAbsolute, join, parse, resolve } from "node:path";

import { z } from "zod";

import type { WebpDerivative } from "./raster-derivatives.js";

const MAX_DERIVATIVE_BYTES = 6 * 1024 * 1024;
const identitySchema = z.strictObject({
  photoId: z.string().regex(/^[A-Za-z0-9_-]{1,128}$/),
  sourceRevision: z.string().min(1).max(512).regex(/^(?:md5|version|fallback):/),
});
const imageMetadataSchema = z.strictObject({
  width: z.number().int().min(1).max(1600),
  height: z.number().int().min(1).max(1600),
  byteLength: z.number().int().min(1).max(MAX_DERIVATIVE_BYTES),
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
});
const manifestSchema = z.strictObject({
  version: z.literal(1),
  key: z.string().regex(/^[a-f0-9]{64}$/),
  thumbnail: imageMetadataSchema,
  preview: imageMetadataSchema,
});

type Variant = "thumbnail" | "preview";
type Identity = z.infer<typeof identitySchema>;
type Manifest = z.infer<typeof manifestSchema>;

export interface DerivativePair {
  readonly thumbnail: WebpDerivative;
  readonly preview: WebpDerivative;
}

export interface DerivativeStore {
  publish(identity: Identity, pair: DerivativePair): Promise<void>;
  read(identity: Identity, variant: Variant): Promise<WebpDerivative | null>;
}

export class DerivativeStoreError extends Error {
  constructor(readonly code: "invalid-request" | "storage-unavailable" | "corrupt") {
    super(
      code === "invalid-request"
        ? "A valid derivative key and image pair are required."
        : code === "corrupt"
          ? "The stored preview is incomplete or corrupt."
          : "The preview store is unavailable.",
    );
    this.name = "DerivativeStoreError";
  }
}

function validIdentity(input: Identity): Identity {
  const parsed = identitySchema.safeParse(input);
  if (!parsed.success) throw new DerivativeStoreError("invalid-request");
  return parsed.data;
}

function digest(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function pairKey(identity: Identity): string {
  return digest(Buffer.from(`${identity.photoId}\0${identity.sourceRevision}`, "utf8"));
}

function validateDerivative(value: WebpDerivative): void {
  if (
    value.mimeType !== "image/webp" ||
    !Buffer.isBuffer(value.bytes) ||
    value.bytes.byteLength < 1 ||
    value.bytes.byteLength > MAX_DERIVATIVE_BYTES ||
    !Number.isInteger(value.width) || value.width < 1 || value.width > 1600 ||
    !Number.isInteger(value.height) || value.height < 1 || value.height > 1600 ||
    value.bytes.toString("ascii", 0, 4) !== "RIFF" ||
    value.bytes.toString("ascii", 8, 12) !== "WEBP"
  ) throw new DerivativeStoreError("invalid-request");
}

function imageMetadata(value: WebpDerivative) {
  return {
    width: value.width,
    height: value.height,
    byteLength: value.bytes.byteLength,
    sha256: digest(value.bytes),
  };
}

async function syncDirectory(path: string): Promise<void> {
  const directory = await open(path, constants.O_RDONLY);
  try {
    await directory.sync();
  } finally {
    await directory.close();
  }
}

async function writeDurable(path: string, bytes: Uint8Array): Promise<void> {
  const file = await open(path, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL, 0o600);
  try {
    await file.writeFile(bytes);
    await file.sync();
  } finally {
    await file.close();
  }
}

async function readBoundedFile(path: string, maxBytes: number, expectedBytes?: number): Promise<Buffer> {
  const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const info = await file.stat();
    if (!info.isFile() || info.size < 1 || info.size > maxBytes ||
      (expectedBytes !== undefined && info.size !== expectedBytes)) {
      throw new DerivativeStoreError("corrupt");
    }
    const buffer = Buffer.alloc(info.size + 1);
    let offset = 0;
    while (offset < buffer.byteLength) {
      const { bytesRead } = await file.read(buffer, offset, buffer.byteLength - offset, offset);
      if (bytesRead === 0) break;
      offset += bytesRead;
    }
    if (offset !== info.size) throw new DerivativeStoreError("corrupt");
    return buffer.subarray(0, offset);
  } finally {
    await file.close();
  }
}

function isMissing(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}

function isAlreadyPublished(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error &&
    (error.code === "EEXIST" || error.code === "ENOTEMPTY");
}

/** Private, single-volume implementation; the root must be explicitly configured. */
export class FileSystemDerivativeStore implements DerivativeStore {
  private readonly root: string;

  constructor(root: string) {
    if (!isAbsolute(root) || resolve(root) === parse(root).root) {
      throw new DerivativeStoreError("invalid-request");
    }
    this.root = resolve(root);
  }

  private async ensurePrivateRoot(): Promise<void> {
    await mkdir(this.root, { recursive: true, mode: 0o700 });
    const info = await lstat(this.root);
    if (!info.isDirectory() || (info.mode & 0o077) !== 0) {
      throw new DerivativeStoreError("storage-unavailable");
    }
  }

  /** Read-only readiness probe: never creates directories or preview data. */
  async checkReady(): Promise<boolean> {
    try {
      const info = await lstat(this.root);
      if (!info.isDirectory() || (info.mode & 0o077) !== 0) return false;
      await access(this.root, constants.R_OK | constants.W_OK | constants.X_OK);
      return true;
    } catch { return false; }
  }

  private paths(identity: Identity) {
    const key = pairKey(identity);
    const parent = join(this.root, key.slice(0, 2));
    return { key, parent, final: join(parent, key) };
  }

  async publish(input: Identity, pair: DerivativePair): Promise<void> {
    const identity = validIdentity(input);
    validateDerivative(pair.thumbnail);
    validateDerivative(pair.preview);
    const { key, parent, final } = this.paths(identity);
    let staging: string | null = null;
    try {
      await this.ensurePrivateRoot();
      await mkdir(parent, { recursive: true, mode: 0o700 });
      await syncDirectory(this.root);
      staging = await mkdtemp(join(parent, ".staging-"));
      const manifest: Manifest = {
        version: 1,
        key,
        thumbnail: imageMetadata(pair.thumbnail),
        preview: imageMetadata(pair.preview),
      };
      await writeDurable(join(staging, "thumbnail.webp"), pair.thumbnail.bytes);
      await writeDurable(join(staging, "preview.webp"), pair.preview.bytes);
      await writeDurable(join(staging, "manifest.json"), Buffer.from(JSON.stringify(manifest), "utf8"));
      await syncDirectory(staging);
      try {
        await rename(staging, final);
      } catch (error) {
        if (!isAlreadyPublished(error)) throw error;
        // A concurrent attempt may already have published this exact revision.
        await this.verifyExisting(identity);
      }
      await syncDirectory(parent);
    } catch (error) {
      if (error instanceof DerivativeStoreError) throw error;
      throw new DerivativeStoreError("storage-unavailable");
    } finally {
      if (staging !== null) {
        try {
          await rm(staging, { recursive: true, force: true });
        } catch {
          throw new DerivativeStoreError("storage-unavailable");
        }
      }
    }
  }

  private async readManifest(identity: Identity): Promise<Manifest | null> {
    const { key, final } = this.paths(identity);
    let contents: Buffer;
    try {
      contents = await readBoundedFile(join(final, "manifest.json"), 2048);
    } catch (error) {
      if (isMissing(error)) return null;
      if (error instanceof DerivativeStoreError) throw error;
      throw new DerivativeStoreError("storage-unavailable");
    }
    try {
      const parsed = manifestSchema.parse(JSON.parse(contents.toString("utf8")));
      if (parsed.key !== key) throw new Error("Revision key mismatch");
      return parsed;
    } catch {
      throw new DerivativeStoreError("corrupt");
    }
  }

  async read(input: Identity, variant: Variant): Promise<WebpDerivative | null> {
    const identity = validIdentity(input);
    if (variant !== "thumbnail" && variant !== "preview") throw new DerivativeStoreError("invalid-request");
    try {
      await this.ensurePrivateRoot();
    } catch (error) {
      if (error instanceof DerivativeStoreError) throw error;
      throw new DerivativeStoreError("storage-unavailable");
    }
    const manifest = await this.readManifest(identity);
    if (manifest === null) return null;
    const expected = manifest[variant];
    const filePath = join(this.paths(identity).final, `${variant}.webp`);
    let bytes: Buffer;
    try {
      bytes = await readBoundedFile(filePath, MAX_DERIVATIVE_BYTES, expected.byteLength);
    } catch (error) {
      if (isMissing(error) || error instanceof DerivativeStoreError) throw new DerivativeStoreError("corrupt");
      throw new DerivativeStoreError("storage-unavailable");
    }
    if (bytes.byteLength !== expected.byteLength || digest(bytes) !== expected.sha256) {
      throw new DerivativeStoreError("corrupt");
    }
    return { bytes, mimeType: "image/webp", width: expected.width, height: expected.height };
  }

  private async verifyExisting(identity: Identity): Promise<void> {
    const thumbnail = await this.read(identity, "thumbnail");
    const preview = await this.read(identity, "preview");
    if (thumbnail === null || preview === null) throw new DerivativeStoreError("corrupt");
  }
}
