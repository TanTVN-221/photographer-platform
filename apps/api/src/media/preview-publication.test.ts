import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { PreviewStatus, type DatabaseClient } from "@photographer-platform/database";
import { DriveProviderError, type OriginalImageReader } from "@photographer-platform/google-drive";
import sharp from "sharp";
import { describe, expect, it, vi } from "vitest";

import { FileSystemDerivativeStore, type DerivativeStore } from "./derivative-store.js";
import { PreviewPublicationError, PreviewPublicationService } from "./preview-publication.js";

const photo = {
  id: "photo_123",
  driveFileId: "drive_123",
  fileName: "IMG_001.jpg",
  mimeType: "image/jpeg",
  sourceRevision: "version:5",
  previewStatus: PreviewStatus.PENDING,
  previewRevision: null,
  album: { driveFolderId: "folder_123", driveConnectionId: "connection_123" },
};

async function fixture() {
  const bytes = await sharp({ create: { width: 60, height: 30, channels: 3, background: "red" } }).jpeg().toBuffer();
  const reader: OriginalImageReader = {
    readOriginalImage: vi.fn().mockResolvedValue({ bytes, mimeType: "image/jpeg", sourceRevision: "version:5" }),
  };
  const derivativeStore: DerivativeStore = {
    publish: vi.fn().mockResolvedValue(undefined),
    read: vi.fn().mockResolvedValue(null),
  };
  const database = {
    $queryRaw: vi.fn().mockResolvedValue([{ id: "album_123", status: "PUBLISHED" }]),
    photo: {
      findFirst: vi.fn().mockResolvedValue(photo),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
  } as unknown as DatabaseClient;
  database.$transaction = vi.fn(async (callback) => callback(database)) as unknown as DatabaseClient["$transaction"];
  const readerForConnection = vi.fn().mockResolvedValue(reader);
  const service = new PreviewPublicationService({ database, derivativeStore, readerForConnection });
  return { service, database, derivativeStore, reader, readerForConnection };
}

describe("owner-scoped derivative publication (DRIVE-018, PROD-002, IMG-006)", () => {
  it("publishes both derivatives before a revision-checked READY commit", async () => {
    const { service, database, derivativeStore, reader, readerForConnection } = await fixture();
    const order: string[] = [];
    vi.mocked(derivativeStore.publish).mockImplementation(async () => { order.push("publish"); });
    vi.mocked(database.photo.updateMany).mockImplementation((async () => {
      order.push("commit");
      return { count: 1 };
    }) as unknown as typeof database.photo.updateMany);

    await expect(service.processPhoto("owner_123", "album_123", "photo_123")).resolves.toEqual({ status: "ready", photoId: "photo_123" });

    expect(database.photo.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        id: "photo_123", albumId: "album_123", active: true,
        album: { ownerId: "owner_123", status: { not: "ARCHIVED" } },
      }),
    }));
    expect(readerForConnection).toHaveBeenCalledWith("connection_123", "owner_123");
    expect(reader.readOriginalImage).toHaveBeenCalledWith({
      driveFileId: "drive_123", folderId: "folder_123", expectedRevision: "version:5",
    }, undefined);
    expect(order).toEqual(["publish", "commit"]);
    expect(derivativeStore.publish).toHaveBeenCalledWith(
      { photoId: "photo_123", sourceRevision: "version:5" },
      { thumbnail: expect.objectContaining({ mimeType: "image/webp" }), preview: expect.objectContaining({ mimeType: "image/webp" }) },
    );
    expect(database.photo.updateMany).toHaveBeenCalledWith({
      where: { id: "photo_123", albumId: "album_123", active: true, sourceRevision: "version:5",
        album: { ownerId: "owner_123", status: { not: "ARCHIVED" } } },
      data: { previewStatus: PreviewStatus.READY, previewRevision: "version:5", previewErrorCode: null },
    });
  });

  it("integrates the real private store before committing READY", async () => {
    const root = await mkdtemp(join(tmpdir(), "photographer-preview-publication-"));
    try {
      const { database, reader } = await fixture();
      const realStore = new FileSystemDerivativeStore(root);
      vi.mocked(database.photo.updateMany).mockImplementation((async () => {
        const identity = { photoId: "photo_123", sourceRevision: "version:5" };
        expect(await realStore.read(identity, "thumbnail")).not.toBeNull();
        expect(await realStore.read(identity, "preview")).not.toBeNull();
        return { count: 1 };
      }) as unknown as typeof database.photo.updateMany);
      const service = new PreviewPublicationService({
        database,
        derivativeStore: realStore,
        readerForConnection: async () => reader,
      });
      await expect(service.processPhoto("owner_123", "album_123", "photo_123")).resolves.toEqual({ status: "ready", photoId: "photo_123" });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("does not open Drive for an unauthorized or missing photo", async () => {
    const { service, database, readerForConnection, derivativeStore } = await fixture();
    vi.mocked(database.photo.findFirst).mockResolvedValueOnce(null);
    await expect(service.processPhoto("other_owner", "album_123", "photo_123")).rejects.toBeInstanceOf(PreviewPublicationError);
    expect(readerForConnection).not.toHaveBeenCalled();
    expect(derivativeStore.publish).not.toHaveBeenCalled();
  });

  it("refuses a photo without indexed revision", async () => {
    const { service, database, readerForConnection } = await fixture();
    vi.mocked(database.photo.findFirst).mockResolvedValueOnce({ ...photo, sourceRevision: null } as never);
    await expect(service.processPhoto("owner_123", "album_123", "photo_123")).resolves.toEqual({ status: "needs-sync", photoId: "photo_123" });
    expect(readerForConnection).not.toHaveBeenCalled();
  });

  it("does not mark READY when sync supersedes the source during rendering", async () => {
    const { service, database, derivativeStore } = await fixture();
    vi.mocked(database.photo.updateMany).mockResolvedValueOnce({ count: 0 });
    await expect(service.processPhoto("owner_123", "album_123", "photo_123")).resolves.toEqual({ status: "superseded", photoId: "photo_123" });
    expect(derivativeStore.publish).toHaveBeenCalledOnce();
    expect(database.photo.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ sourceRevision: "version:5", active: true }),
    }));
  });

  it("refuses publication state after archive wins the album row lock", async () => {
    const { service, database, derivativeStore } = await fixture();
    vi.mocked(database.$queryRaw).mockResolvedValueOnce([{ id: "album_123", status: "ARCHIVED" }]);
    await expect(service.processPhoto("owner_123", "album_123", "photo_123")).resolves.toEqual({ status: "superseded", photoId: "photo_123" });
    expect(derivativeStore.publish).toHaveBeenCalledOnce();
    expect(database.photo.updateMany).not.toHaveBeenCalled();
  });

  it("does not read originals or write state when already cancelled", async () => {
    const { service, reader, database, derivativeStore } = await fixture();
    const controller = new AbortController();
    controller.abort();
    await expect(service.processPhoto("owner_123", "album_123", "photo_123", controller.signal)).resolves.toEqual({
      status: "deferred", photoId: "photo_123", code: "cancelled",
    });
    expect(reader.readOriginalImage).not.toHaveBeenCalled();
    expect(database.photo.updateMany).not.toHaveBeenCalled();
    expect(derivativeStore.publish).not.toHaveBeenCalled();
  });

  it("does not commit READY when cancelled while publishing", async () => {
    const { service, database, derivativeStore } = await fixture();
    const controller = new AbortController();
    vi.mocked(derivativeStore.publish).mockImplementationOnce(async () => { controller.abort(); });
    await expect(service.processPhoto("owner_123", "album_123", "photo_123", controller.signal)).resolves.toEqual({
      status: "deferred", photoId: "photo_123", code: "cancelled",
    });
    expect(database.photo.updateMany).not.toHaveBeenCalled();
  });

  it("keeps a storage failure pending rather than marking READY", async () => {
    const { service, database, derivativeStore } = await fixture();
    vi.mocked(derivativeStore.publish).mockRejectedValueOnce(new Error("private storage path"));
    await expect(service.processPhoto("owner_123", "album_123", "photo_123")).resolves.toEqual({
      status: "deferred", photoId: "photo_123", code: "storage-unavailable",
    });
    expect(database.photo.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ previewStatus: { not: PreviewStatus.READY } }),
      data: { previewStatus: PreviewStatus.PENDING, previewRevision: null, previewErrorCode: "DEFERRED_STORAGE_UNAVAILABLE" },
    }));
  });

  it("records a safe unsupported state without downloading RAW bytes", async () => {
    const { service, database, reader, derivativeStore } = await fixture();
    vi.mocked(database.photo.findFirst).mockResolvedValueOnce({ ...photo, fileName: "camera.cr3", mimeType: "application/octet-stream" } as never);
    await expect(service.processPhoto("owner_123", "album_123", "photo_123")).resolves.toEqual({
      status: "unsupported-variant", photoId: "photo_123", code: "decoder-not-enabled",
    });
    expect(reader.readOriginalImage).not.toHaveBeenCalled();
    expect(derivativeStore.publish).not.toHaveBeenCalled();
    expect(database.photo.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: { previewStatus: PreviewStatus.UNSUPPORTED_VARIANT, previewRevision: null, previewErrorCode: "UNSUPPORTED_VARIANT_DECODER_NOT_ENABLED" },
    }));
  });

  it("keeps a retryable Drive failure pending without leaking its message", async () => {
    const { service, reader, database } = await fixture();
    vi.mocked(reader.readOriginalImage).mockRejectedValueOnce(new DriveProviderError("quota", "private quota detail"));
    const result = await service.processPhoto("owner_123", "album_123", "photo_123");
    expect(result).toEqual({ status: "deferred", photoId: "photo_123", code: "quota" });
    expect(JSON.stringify(result)).not.toContain("private quota detail");
    expect(database.photo.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: { previewStatus: PreviewStatus.PENDING, previewRevision: null, previewErrorCode: "DEFERRED_QUOTA" },
    }));
  });

  it("records malformed indexed metadata as a safe per-photo failure", async () => {
    const { service, database, reader } = await fixture();
    vi.mocked(database.photo.findFirst).mockResolvedValueOnce({ ...photo, driveFileId: "bad/id" } as never);
    await expect(service.processPhoto("owner_123", "album_123", "photo_123")).resolves.toEqual({
      status: "failed", photoId: "photo_123", code: "invalid-metadata",
    });
    expect(reader.readOriginalImage).not.toHaveBeenCalled();
    expect(database.photo.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: { previewStatus: PreviewStatus.FAILED, previewRevision: null, previewErrorCode: "FAILED_INVALID_METADATA" },
    }));
  });

  it("skips a verified, already-ready pair without reopening Drive", async () => {
    const { service, database, derivativeStore, readerForConnection } = await fixture();
    vi.mocked(database.photo.findFirst).mockResolvedValueOnce({ ...photo, previewStatus: PreviewStatus.READY, previewRevision: "version:5" } as never);
    vi.mocked(derivativeStore.read).mockResolvedValue({ bytes: Buffer.from("stored"), mimeType: "image/webp", width: 1, height: 1 });
    await expect(service.processPhoto("owner_123", "album_123", "photo_123")).resolves.toEqual({ status: "already-ready", photoId: "photo_123" });
    expect(readerForConnection).not.toHaveBeenCalled();
    expect(database.photo.updateMany).not.toHaveBeenCalled();
  });

  it("invalidates READY if a stored pair has disappeared", async () => {
    const { service, database, derivativeStore } = await fixture();
    vi.mocked(database.photo.findFirst).mockResolvedValueOnce({ ...photo, previewStatus: PreviewStatus.READY, previewRevision: "version:5" } as never);
    await expect(service.processPhoto("owner_123", "album_123", "photo_123")).resolves.toEqual({ status: "ready", photoId: "photo_123" });
    expect(database.photo.updateMany).toHaveBeenNthCalledWith(1, {
      where: {
        id: "photo_123", albumId: "album_123", active: true, sourceRevision: "version:5",
        previewStatus: PreviewStatus.READY, previewRevision: "version:5",
        album: { ownerId: "owner_123", status: { not: "ARCHIVED" } },
      },
      data: { previewStatus: PreviewStatus.PENDING, previewRevision: null, previewErrorCode: "STORAGE_UNAVAILABLE" },
    });
    expect(derivativeStore.publish).toHaveBeenCalledOnce();
  });

  it("invalidates a READY state from an older revision before reprocessing", async () => {
    const { service, database, derivativeStore } = await fixture();
    vi.mocked(database.photo.findFirst).mockResolvedValueOnce({ ...photo, previewStatus: PreviewStatus.READY, previewRevision: "version:4" } as never);
    await expect(service.processPhoto("owner_123", "album_123", "photo_123")).resolves.toEqual({ status: "ready", photoId: "photo_123" });
    expect(derivativeStore.read).not.toHaveBeenCalled();
    expect(database.photo.updateMany).toHaveBeenNthCalledWith(1, {
      where: {
        id: "photo_123", albumId: "album_123", active: true, sourceRevision: "version:5",
        previewStatus: PreviewStatus.READY, previewRevision: "version:4",
        album: { ownerId: "owner_123", status: { not: "ARCHIVED" } },
      },
      data: { previewStatus: PreviewStatus.PENDING, previewRevision: null, previewErrorCode: "STALE_PREVIEW_REVISION" },
    });
  });
});
