import { chmod, mkdtemp, readdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import sharp from "sharp";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { DerivativeStoreError, FileSystemDerivativeStore } from "./derivative-store.js";

const identity = { photoId: "photo_123", sourceRevision: "version:5" };
let root: string;
let store: FileSystemDerivativeStore;

async function pair() {
  const thumbnail = await sharp({ create: { width: 20, height: 10, channels: 3, background: "red" } }).webp().toBuffer();
  const preview = await sharp({ create: { width: 30, height: 15, channels: 3, background: "blue" } }).webp().toBuffer();
  return {
    thumbnail: { bytes: thumbnail, mimeType: "image/webp" as const, width: 20, height: 10 },
    preview: { bytes: preview, mimeType: "image/webp" as const, width: 30, height: 15 },
  };
}

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "photographer-derivatives-"));
  store = new FileSystemDerivativeStore(root);
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe("private filesystem derivative store (DRIVE-018, DB-001, IMG-005/006)", () => {
  it("checks existing private storage read-only and rejects missing, public or symlinked roots (OPS-002)", async () => {
    expect(await store.checkReady()).toBe(true);
    expect(await new FileSystemDerivativeStore(join(root, "missing")).checkReady()).toBe(false);
    expect(await readdir(root)).toEqual([]);
    await symlink(root, join(root, "linked"));
    expect(await new FileSystemDerivativeStore(join(root, "linked")).checkReady()).toBe(false);
    await chmod(root, 0o755);
    expect(await store.checkReady()).toBe(false);
  });
  it("publishes both WebP variants under one revision key and reads them back", async () => {
    const images = await pair();
    expect(await store.read(identity, "thumbnail")).toBeNull();
    await store.publish(identity, images);
    await expect(store.read(identity, "thumbnail")).resolves.toEqual(images.thumbnail);
    await expect(store.read(identity, "preview")).resolves.toEqual(images.preview);
    await expect(store.read({ ...identity, sourceRevision: "version:6" }, "preview")).resolves.toBeNull();

    const buckets = await readdir(root);
    expect(buckets).toHaveLength(1);
    const keys = await readdir(join(root, buckets[0]!));
    expect(keys).toHaveLength(1);
    expect(keys[0]).toMatch(/^[a-f0-9]{64}$/);
    expect(keys[0]).not.toContain(identity.photoId);
  });

  it("accepts a complete existing revision idempotently", async () => {
    const images = await pair();
    await store.publish(identity, images);
    await expect(store.publish(identity, images)).resolves.toBeUndefined();
    await expect(store.read(identity, "preview")).resolves.toEqual(images.preview);
  });

  it("rejects malformed keys and non-WebP data before writing", async () => {
    const images = await pair();
    await expect(store.publish({ ...identity, photoId: "../escape" }, images)).rejects.toBeInstanceOf(DerivativeStoreError);
    await expect(store.publish(identity, {
      ...images,
      preview: { ...images.preview, bytes: Buffer.from("not webp") },
    })).rejects.toMatchObject({ code: "invalid-request" });
    expect(await readdir(root)).toEqual([]);
  });

  it("enforces output-byte and dimension limits at the storage boundary", async () => {
    const images = await pair();
    const oversized = Buffer.concat([Buffer.from("RIFFxxxxWEBP"), Buffer.alloc(6 * 1024 * 1024)]);
    await expect(store.publish(identity, {
      ...images,
      preview: { ...images.preview, bytes: oversized },
    })).rejects.toMatchObject({ code: "invalid-request" });
    await expect(store.publish(identity, {
      ...images,
      thumbnail: { ...images.thumbnail, width: 1601 },
    })).rejects.toMatchObject({ code: "invalid-request" });
    expect(await readdir(root)).toEqual([]);
  });

  it("detects tampered derivative bytes rather than serving them", async () => {
    await store.publish(identity, await pair());
    const bucket = (await readdir(root))[0]!;
    const key = (await readdir(join(root, bucket)))[0]!;
    await writeFile(join(root, bucket, key, "preview.webp"), Buffer.from("altered"));
    await expect(store.read(identity, "preview")).rejects.toMatchObject({ code: "corrupt" });
  });

  it("rejects a broad or relative root and a world-readable root", async () => {
    expect(() => new FileSystemDerivativeStore("/")).toThrow(DerivativeStoreError);
    expect(() => new FileSystemDerivativeStore("relative/path")).toThrow(DerivativeStoreError);
    await chmod(root, 0o755);
    await expect(store.publish(identity, await pair())).rejects.toMatchObject({ code: "storage-unavailable" });
  });
});
