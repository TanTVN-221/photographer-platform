import { type DatabaseClient } from "@photographer-platform/database";
import { describe, expect, it, vi } from "vitest";

import { PreviewBatchCursorCodec } from "./preview-batch-cursor.js";
import { PreviewBatchService } from "./preview-batch.js";
import { PreviewPublicationError, type PreviewPublicationResult } from "./preview-publication.js";

const request = { ownerId: "owner_123", albumId: "album_123" };
function fixture(total = 3) {
  const rows = Array.from({ length: total }, (_, sortOrder) => ({ id: `photo_${sortOrder}`, sortOrder }));
  const album = { catalogVersion: 8 };
  const transaction = {
    album: { findFirst: vi.fn().mockResolvedValue(album) },
    photo: { findMany: vi.fn().mockResolvedValue(rows) },
  };
  const database = {
    ...transaction,
    $transaction: vi.fn(async (callback: (tx: typeof transaction) => Promise<unknown>) => callback(transaction)),
  } as unknown as DatabaseClient;
  const publisher = { processPhoto: vi.fn(async (_owner: string, _album: string, photoId: string): Promise<PreviewPublicationResult> => ({ status: "ready", photoId })) };
  const cursors = new PreviewBatchCursorCodec(Buffer.alloc(32, 4));
  const service = new PreviewBatchService(database, cursors, publisher);
  return { service, database, publisher, cursors, transaction, rows };
}

describe("bounded owner preview batches (DRIVE-017/018, PROD-002, IMG-004/006)", () => {
  it("uses a narrow owner/catalog snapshot and processes only the bounded page", async () => {
    const { service, transaction, publisher, cursors } = fixture(4);
    const result = await service.processBatch({ ...request, limit: 3 });
    expect(result.status).toBe("page-full");
    expect(result.outcomes).toHaveLength(3);
    expect(publisher.processPhoto).toHaveBeenCalledTimes(3);
    expect(transaction.album.findFirst).toHaveBeenCalledWith({
      where: { id: request.albumId, ownerId: request.ownerId, status: { not: "ARCHIVED" } },
      select: { catalogVersion: true },
    });
    expect(transaction.photo.findMany).toHaveBeenCalledWith({
      where: { albumId: request.albumId, active: true }, select: { id: true, sortOrder: true },
      orderBy: [{ sortOrder: "asc" }, { id: "asc" }], take: 4,
    });
    expect(cursors.decode(result.nextCursor!)).toEqual({ ...request, catalogVersion: 8, after: { photoId: "photo_2", sortOrder: 2 } });
  });

  it("continues with the full indexed sort tuple, without offset", async () => {
    const { service, cursors, transaction } = fixture();
    const cursor = cursors.encode({ ...request, catalogVersion: 8, after: { photoId: "photo_12", sortOrder: 12 } });
    await service.processBatch({ ...request, cursor });
    expect(transaction.photo.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { albumId: request.albumId, active: true, OR: [{ sortOrder: { gt: 12 } }, { sortOrder: 12, id: { gt: "photo_12" } }] },
    }));
  });

  it("processes serially outside the snapshot transaction", async () => {
    const { service, database, publisher } = fixture();
    let inTransaction = false;
    let active = 0;
    vi.mocked(database.$transaction).mockImplementation((async (callback: (tx: DatabaseClient) => Promise<unknown>) => {
      inTransaction = true;
      const page = await callback(database);
      inTransaction = false;
      return page;
    }) as unknown as typeof database.$transaction);
    publisher.processPhoto.mockImplementation(async (_owner, _album, photoId) => {
      expect(inTransaction).toBe(false);
      active += 1;
      expect(active).toBe(1);
      await Promise.resolve();
      active -= 1;
      return { status: "ready", photoId };
    });
    expect((await service.processBatch(request)).status).toBe("complete");
  });

  it("continues past per-photo unsupported, failed and missing-revision outcomes", async () => {
    const { service, publisher } = fixture();
    publisher.processPhoto.mockResolvedValueOnce({ status: "unsupported-variant", photoId: "photo_0", code: "decoder-not-enabled" })
      .mockResolvedValueOnce({ status: "failed", photoId: "photo_1", code: "invalid-source" })
      .mockResolvedValueOnce({ status: "needs-sync", photoId: "photo_2" });
    const result = await service.processBatch(request);
    expect(result.status).toBe("complete");
    expect(result.outcomes).toHaveLength(3);
    expect(result.nextCursor).toBeNull();
  });

  it.each(["quota", "authentication", "storage-unavailable", "reader-unavailable"])("stops and retries rather than skipping a deferred %s item", async (code) => {
    const { service, publisher, cursors } = fixture();
    publisher.processPhoto.mockResolvedValueOnce({ status: "ready", photoId: "photo_0" })
      .mockResolvedValueOnce({ status: "deferred", photoId: "photo_1", code });
    const result = await service.processBatch(request);
    expect(result.status).toBe("blocked");
    expect(publisher.processPhoto).toHaveBeenCalledTimes(2);
    expect(cursors.decode(result.nextCursor!).after).toEqual({ photoId: "photo_0", sortOrder: 0 });
  });

  it("can resume a blocked first photo from a null position", async () => {
    const { service, publisher, cursors } = fixture();
    publisher.processPhoto.mockResolvedValueOnce({ status: "deferred", photoId: "photo_0", code: "quota" });
    const result = await service.processBatch(request);
    expect(cursors.decode(result.nextCursor!).after).toBeNull();
    expect((await service.processBatch({ ...request, cursor: result.nextCursor })).status).toBe("complete");
  });

  it("rejects unknown/archived owners before reading any candidates", async () => {
    const { service, transaction, publisher } = fixture();
    transaction.album.findFirst.mockResolvedValueOnce(null);
    await expect(service.processBatch(request)).rejects.toMatchObject({ code: "not-found" });
    expect(transaction.photo.findMany).not.toHaveBeenCalled();
    expect(publisher.processPhoto).not.toHaveBeenCalled();
  });

  it.each([{ ownerId: "other_owner" }, { albumId: "other_album" }, { catalogVersion: 7 }])("rejects changed cursor binding %j", async (changed) => {
    const { service, cursors, publisher } = fixture();
    const cursor = cursors.encode({ ...request, catalogVersion: 8, after: null, ...changed });
    await expect(service.processBatch({ ...request, cursor })).rejects.toMatchObject({
      code: "catalogVersion" in changed ? "stale-cursor" : "invalid-cursor",
    });
    expect(publisher.processPhoto).not.toHaveBeenCalled();
  });

  it("stops if sync changes the catalog after a processed photo", async () => {
    const { service, transaction, publisher } = fixture();
    transaction.album.findFirst.mockResolvedValueOnce({ catalogVersion: 8 })
      .mockResolvedValueOnce({ catalogVersion: 8 }).mockResolvedValueOnce({ catalogVersion: 9 });
    expect(await service.processBatch(request)).toMatchObject({ status: "catalog-changed", nextCursor: null });
    expect(publisher.processPhoto).toHaveBeenCalledOnce();
  });

  it("treats a disappearing/archived photo as a restart, not an unhandled provider failure", async () => {
    const { service, publisher } = fixture();
    publisher.processPhoto.mockRejectedValueOnce(new PreviewPublicationError("not-found"));
    expect(await service.processBatch(request)).toMatchObject({ status: "catalog-changed", nextCursor: null });
  });

  it("honors cancellation before processing and between files", async () => {
    const { service, publisher, cursors } = fixture();
    const cancelled = new AbortController(); cancelled.abort();
    const initial = await service.processBatch(request, cancelled.signal);
    expect(initial.status).toBe("cancelled");
    expect(cursors.decode(initial.nextCursor!).after).toBeNull();
    expect(publisher.processPhoto).not.toHaveBeenCalled();
    const controller = new AbortController();
    publisher.processPhoto.mockImplementationOnce(async (_owner, _album, photoId) => {
      controller.abort(); return { status: "ready", photoId };
    });
    const result = await service.processBatch(request, controller.signal);
    expect(result.status).toBe("cancelled");
    expect(cursors.decode(result.nextCursor!).after).toEqual({ photoId: "photo_0", sortOrder: 0 });
    expect(publisher.processPhoto).toHaveBeenCalledOnce();
  });

  it("rejects overlapping calls and releases its guard after failures", async () => {
    const { service, publisher } = fixture();
    let release: () => void = () => undefined;
    publisher.processPhoto.mockImplementationOnce(async (_owner, _album, photoId) => {
      await new Promise<void>((resolve) => { release = resolve; });
      return { status: "ready", photoId };
    });
    const first = service.processBatch(request);
    await vi.waitFor(() => expect(publisher.processPhoto).toHaveBeenCalledOnce());
    await expect(service.processBatch(request)).rejects.toMatchObject({ code: "busy" });
    release(); await first;
    publisher.processPhoto.mockRejectedValueOnce(new Error("private db fault"));
    await expect(service.processBatch(request)).rejects.toThrow("private db fault");
    expect((await service.processBatch(request)).status).toBe("complete");
  });

  it.each([0, 26, 1.5])("rejects invalid batch limit %s before reads", async (limit) => {
    const { service, transaction } = fixture();
    await expect(service.processBatch({ ...request, limit })).rejects.toMatchObject({ code: "invalid-request" });
    expect(transaction.album.findFirst).not.toHaveBeenCalled();
  });

  it("handles an empty album without opening Drive", async () => {
    const { service, publisher } = fixture(0);
    expect(await service.processBatch(request)).toEqual({ status: "complete", outcomes: [], nextCursor: null });
    expect(publisher.processPhoto).not.toHaveBeenCalled();
  });
});
