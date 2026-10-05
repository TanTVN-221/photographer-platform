import { PreviewStatus, type DatabaseClient } from "@photographer-platform/database";
import { describe, expect, it, vi } from "vitest";

import type { DerivativeStore } from "../media/derivative-store.js";
import { GalleryImageService } from "./gallery-image.js";
import { imageRevisionToken } from "./image-url-provider.js";
import { GallerySessionCodec } from "./gallery-session.js";

const slug = "AbCdEfGhIjKlMnOpQrStUvWx";
const photoId = "photo_123";
const sourceRevision = "version:5";
const input = { slug, photoId, variant: "thumbnail", token: `${imageRevisionToken(photoId, sourceRevision)}.webp` };

function fixture() {
  const database = {
    photo: {
      findFirst: vi.fn().mockResolvedValue({ sourceRevision, previewRevision: sourceRevision, previewStatus: PreviewStatus.READY }),
    },
  } as unknown as DatabaseClient;
  const bytes = Buffer.from("RIFFxxxxWEBP-image-bytes");
  const store: DerivativeStore = {
    publish: vi.fn(),
    read: vi.fn().mockResolvedValue({ bytes, mimeType: "image/webp", width: 20, height: 10 }),
  };
  const service = new GalleryImageService(database, store);
  return { database, store, service, bytes };
}

describe("passwordless derivative image service (GAL-002/007, DRIVE-018, IMG-004)", () => {
  it("reads only a current stored derivative after the published passwordless predicate", async () => {
    const { service, database, store, bytes } = fixture();
    const result = await service.readPasswordless(input);
    expect(result.bytes).toEqual(bytes);
    expect(result.etag).toMatch(/^"[A-Za-z0-9_-]+"$/);
    expect(database.photo.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: {
        id: photoId,
        active: true,
        album: { publicSlug: slug, status: "PUBLISHED", passwordHash: null },
      },
    }));
    expect(store.read).toHaveBeenCalledWith({ photoId, sourceRevision }, "thumbnail");
  });

  it.each([
    [null],
    [{ sourceRevision, previewRevision: null, previewStatus: PreviewStatus.PENDING }],
    [{ sourceRevision, previewRevision: "version:4", previewStatus: PreviewStatus.READY }],
    [{ sourceRevision: null, previewRevision: null, previewStatus: PreviewStatus.READY }],
  ])("does not read stored bytes for an unavailable or stale photo", async (record) => {
    const { service, database, store } = fixture();
    vi.mocked(database.photo.findFirst).mockResolvedValueOnce(record as never);
    await expect(service.readPasswordless(input)).rejects.toMatchObject({ code: "not-found" });
    expect(store.read).not.toHaveBeenCalled();
  });

  it("rejects an old revision token before touching the store", async () => {
    const { service, store } = fixture();
    await expect(service.readPasswordless({ ...input, token: `${imageRevisionToken(photoId, "version:4")}.webp` }))
      .rejects.toMatchObject({ code: "not-found" });
    expect(store.read).not.toHaveBeenCalled();
  });

  it("sanitizes missing and corrupt private derivative failures", async () => {
    const { service, store } = fixture();
    vi.mocked(store.read).mockResolvedValueOnce(null);
    await expect(service.readPasswordless(input)).rejects.toMatchObject({ code: "unavailable" });
    vi.mocked(store.read).mockRejectedValueOnce(new Error("/private/secret/path"));
    let failure: unknown;
    try { await service.readPasswordless(input); } catch (error) { failure = error; }
    expect(failure).toMatchObject({ code: "unavailable" });
    expect(String(failure)).not.toContain("/private/secret/path");
  });

  it("validates slug, variant, photo ID, and version token", async () => {
    const { service, database } = fixture();
    for (const change of [
      { slug: "short" },
      { photoId: "../file" },
      { variant: "original" },
      { token: "invalid" },
    ]) {
      await expect(service.readPasswordless({ ...input, ...change })).rejects.toMatchObject({ code: "invalid-request" });
    }
    expect(database.photo.findFirst).not.toHaveBeenCalled();
  });

  it("serves a protected derivative only for a current password-bound session", async () => {
    const { database, store } = fixture();
    const sessions = new GallerySessionCodec(Buffer.alloc(32, 7), () => 1_000_000);
    const protectedAlbum = { id: "album-1", passwordHash: "scrypt$v1$first" };
    vi.mocked(database.photo.findFirst).mockResolvedValue({
      sourceRevision, previewRevision: sourceRevision, previewStatus: PreviewStatus.READY,
      album: protectedAlbum,
    } as never);
    const service = new GalleryImageService(database, store, sessions);
    const token = sessions.issue({ id: protectedAlbum.id, slug, passwordHash: protectedAlbum.passwordHash });
    await expect(service.readWithSession(input, "invalid")).rejects.toMatchObject({ code: "not-found" });
    expect(store.read).not.toHaveBeenCalled();
    await expect(service.readWithSession(input, token)).resolves.toHaveProperty("bytes");
    expect(database.photo.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: photoId, active: true, album: { publicSlug: slug, status: "PUBLISHED" } },
    }));
    protectedAlbum.passwordHash = "scrypt$v1$changed";
    await expect(service.readWithSession(input, token)).rejects.toMatchObject({ code: "not-found" });
    expect(store.read).toHaveBeenCalledTimes(1);
  });
});
