import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { PreviewStatus, type DatabaseClient } from "@photographer-platform/database";
import { errorEnvelopeSchema } from "@photographer-platform/shared";
import sharp from "sharp";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";

import { createApp } from "./app.js";
import { GalleryImageError, GalleryImageService } from "./gallery/gallery-image.js";
import { imageRevisionToken } from "./gallery/image-url-provider.js";
import { FileSystemDerivativeStore } from "./media/derivative-store.js";

const slug = "AbCdEfGhIjKlMnOpQrStUvWx";
const token = "abcdefghijklmnopqrstuvwx.webp";
const path = `/api/v1/galleries/${slug}/images/photo_123/thumbnail/${token}`;
const bytes = Buffer.from("RIFFxxxxWEBP-image-bytes");
const etag = '"verified-derivative"';

describe("passwordless gallery derivative route (GAL-002/007, IMG-001/004)", () => {
  it("returns unavailable when image storage is not composed", async () => {
    const response = await request(createApp()).get(path);
    expect(response.status).toBe(503);
    expect(errorEnvelopeSchema.parse(response.body).error.code).toBe("GALLERY_UNAVAILABLE");
    expect(response.headers["cache-control"]).toBe("no-store");
  });

  it("serves bounded WebP bytes with private revalidation headers", async () => {
    const readPasswordless = vi.fn().mockResolvedValue({ bytes, etag });
    const response = await request(createApp({ galleryImages: { readPasswordless } })).get(path);
    expect(response.status).toBe(200);
    expect(response.body).toEqual(bytes);
    expect(response.headers["content-type"]).toMatch(/^image\/webp/);
    expect(response.headers["cache-control"]).toBe("private, no-cache");
    expect(response.headers.etag).toBe(etag);
    expect(response.headers["x-content-type-options"]).toBe("nosniff");
    expect(readPasswordless).toHaveBeenCalledWith({ slug, photoId: "photo_123", variant: "thumbnail", token });
  });

  it("reads a published filesystem derivative through the real image service", async () => {
    const root = await mkdtemp(join(tmpdir(), "photographer-gallery-image-"));
    try {
      const store = new FileSystemDerivativeStore(root);
      const imageBytes = await sharp({ create: { width: 20, height: 10, channels: 3, background: "red" } }).webp().toBuffer();
      const derivative = { bytes: imageBytes, mimeType: "image/webp" as const, width: 20, height: 10 };
      await store.publish({ photoId: "photo_123", sourceRevision: "version:5" }, { thumbnail: derivative, preview: derivative });
      const database = {
        photo: { findFirst: vi.fn().mockResolvedValue({ sourceRevision: "version:5", previewRevision: "version:5", previewStatus: PreviewStatus.READY }) },
      } as unknown as DatabaseClient;
      const service = new GalleryImageService(database, store);
      const versionedPath = `/api/v1/galleries/${slug}/images/photo_123/thumbnail/${imageRevisionToken("photo_123", "version:5")}.webp`;
      const response = await request(createApp({ galleryImages: service })).get(versionedPath);
      expect(response.status).toBe(200);
      expect(response.body).toEqual(imageBytes);
      expect((await sharp(response.body as Buffer).metadata()).format).toBe("webp");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("revalidates without transferring unchanged image bytes", async () => {
    const readPasswordless = vi.fn().mockResolvedValue({ bytes, etag });
    const response = await request(createApp({ galleryImages: { readPasswordless } }))
      .get(path).set("If-None-Match", etag);
    expect(response.status).toBe(304);
    expect(response.body).toEqual({});
    expect(readPasswordless).toHaveBeenCalledOnce();
  });

  it.each([
    [new GalleryImageError("not-found"), 404, "IMAGE_NOT_FOUND"],
    [new GalleryImageError("unavailable"), 503, "IMAGE_UNAVAILABLE"],
  ])("maps image failures to safe errors", async (failure, status, code) => {
    const response = await request(createApp({ galleryImages: { readPasswordless: vi.fn().mockRejectedValue(failure) } })).get(path);
    expect(response.status).toBe(status);
    expect(errorEnvelopeSchema.parse(response.body).error.code).toBe(code);
    expect(response.headers["cache-control"]).toBe("no-store");
  });

  it.each([
    `/api/v1/galleries/short/images/photo_123/thumbnail/${token}`,
    `/api/v1/galleries/${slug}/images/photo_123/original/${token}`,
    `/api/v1/galleries/${slug}/images/bad%2Fid/thumbnail/${token}`,
    `/api/v1/galleries/${slug}/images/photo_123/thumbnail/short.webp`,
  ])("rejects invalid image paths before invoking the service", async (url) => {
    const readPasswordless = vi.fn();
    const response = await request(createApp({ galleryImages: { readPasswordless } })).get(url);
    expect(response.status).toBe(400);
    expect(readPasswordless).not.toHaveBeenCalled();
  });
});
