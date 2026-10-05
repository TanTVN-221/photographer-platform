import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type DatabaseClient, PreviewStatus } from "@photographer-platform/database";
import sharp from "sharp";
import { afterEach, describe, expect, it, vi } from "vitest";

import { FileSystemDerivativeStore } from "./derivative-store.js";
import { createOwnerPreviewPublisher } from "./owner-preview-publication.js";
import { PreviewBatchCursorCodec } from "./preview-batch-cursor.js";
import { PreviewBatchService } from "./preview-batch.js";

afterEach(() => vi.unstubAllGlobals());

describe("OAuth provider/batch/raster/private-volume composition (DRIVE-016/018, IMG-004/006/007)", () => {
  it("reads one authorized original ephemerally and persists only bounded WebP derivatives", async () => {
    const root = await mkdtemp(join(tmpdir(), "photographer-owner-batch-"));
    try {
      const bytes = await sharp({ create: { width: 120, height: 60, channels: 3, background: "blue" } }).jpeg().toBuffer();
      const fetchImpl = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
        expect(init?.headers).toMatchObject({ Authorization: "Bearer ephemeral-token" });
        const url = new URL(String(input));
        expect(url.pathname).toBe("/drive/v3/files/drive_123");
        expect(url.hostname).toBe("www.googleapis.com");
        return url.searchParams.get("alt") === "media"
          ? new Response(new Uint8Array(bytes))
          : Response.json({ id: "drive_123", mimeType: "image/jpeg", size: String(bytes.length), version: "5",
            parents: ["folder_123"], trashed: false, capabilities: { canDownload: true } });
      });
      vi.stubGlobal("fetch", fetchImpl);
      const photo = { id: "photo_123", driveFileId: "drive_123", fileName: "IMG_2.jpg", mimeType: "image/jpeg",
        sourceRevision: "version:5", previewStatus: PreviewStatus.PENDING, previewRevision: null,
        album: { driveFolderId: "folder_123", driveConnectionId: "connection_123" } };
      const transaction = {
        album: { findFirst: vi.fn().mockResolvedValue({ catalogVersion: 1 }) },
        photo: { findMany: vi.fn().mockResolvedValue([{ id: photo.id, sortOrder: 0 }]),
          findFirst: vi.fn().mockResolvedValue(photo), updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
        $queryRaw: vi.fn().mockResolvedValue([{ id: "album_123", status: "PUBLISHED" }]),
      };
      const database = { ...transaction,
        $transaction: vi.fn(async (callback: (tx: typeof transaction) => Promise<unknown>) => callback(transaction)),
      } as unknown as DatabaseClient;
      const connections = { getAccessToken: vi.fn().mockResolvedValue("ephemeral-token") };
      const store = new FileSystemDerivativeStore(root);
      const publisher = createOwnerPreviewPublisher(database, store, connections);
      const batch = new PreviewBatchService(database, new PreviewBatchCursorCodec(Buffer.alloc(32, 2)), publisher);
      expect(await batch.processBatch({ ownerId: "owner_123", albumId: "album_123" })).toEqual({
        status: "complete", outcomes: [{ status: "ready", photoId: "photo_123" }], nextCursor: null,
      });
      expect(connections.getAccessToken).toHaveBeenCalledTimes(3);
      expect(connections.getAccessToken).toHaveBeenCalledWith("owner_123", "connection_123");
      expect(fetchImpl).toHaveBeenCalledTimes(3);
      const identity = { photoId: "photo_123", sourceRevision: "version:5" };
      for (const variant of ["thumbnail", "preview"] as const) {
        const derivative = await store.read(identity, variant);
        expect(derivative?.mimeType).toBe("image/webp");
        expect((await sharp(derivative?.bytes).metadata()).format).toBe("webp");
        expect(derivative?.bytes.equals(bytes)).toBe(false);
      }
      expect((await readdir(root, { recursive: true })).filter((name) => name.endsWith(".jpg"))).toEqual([]);
    } finally { await rm(root, { recursive: true, force: true }); }
  });

  it("propagates credential failure as a narrow retryable photo outcome without provider calls", async () => {
    const database = {
      photo: { findFirst: vi.fn().mockResolvedValue({ id: "photo_123", driveFileId: "drive_123", fileName: "IMG_2.jpg",
        mimeType: "image/jpeg", sourceRevision: "version:5", previewStatus: PreviewStatus.PENDING, previewRevision: null,
        album: { driveFolderId: "folder_123", driveConnectionId: "connection_123" } }), updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
      $queryRaw: vi.fn().mockResolvedValue([{ id: "album_123", status: "PUBLISHED" }]),
    } as unknown as DatabaseClient;
    database.$transaction = vi.fn(async (callback: (tx: DatabaseClient) => Promise<unknown>) => callback(database)) as unknown as DatabaseClient["$transaction"];
    const fetchImpl = vi.fn(); vi.stubGlobal("fetch", fetchImpl);
    const connections = { getAccessToken: vi.fn().mockRejectedValue(new Error("private refresh token detail")) };
    const store = { read: vi.fn(), publish: vi.fn() };
    const result = await createOwnerPreviewPublisher(database, store, connections).processPhoto("owner_123", "album_123", "photo_123");
    expect(result).toEqual({ status: "deferred", photoId: "photo_123", code: "authentication" });
    expect(JSON.stringify(result)).not.toContain("private");
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(store.publish).not.toHaveBeenCalled();
  });
});
