import { randomBytes } from "node:crypto";
import type { DatabaseClient } from "@photographer-platform/database";
import { describe, expect, it, vi } from "vitest";
import { OwnerCursorCodec } from "./owner-cursor.js";
import { WorkspaceService } from "./workspace-service.js";

const date = new Date("2026-10-04T00:00:00.000Z");
function album(id = "album") {
  return { id, title: "Wedding", publicSlug: "a".repeat(24), status: "PUBLISHED", passwordHash: "private-hash",
    selectionLimit: 100, createdAt: date, updatedAt: date, catalogVersion: 1,
    _count: { photos: 101 }, selection: { id: "selection", status: "SUBMITTED", revision: 1, submittedAt: date,
      lockedAt: null, _count: { items: 101 } } };
}
function fixture(size = 101) {
  const row = album();
  const keys = Array.from({ length: size }, (_, index) => ({ photoId: `photo_${index + 1}`, updatedAt: date,
    photo: { fileName: `IMG_${index + 1}.jpg`, driveFileId: `drive_${index + 1}`, active: index !== 1 } })).reverse();
  row.selection._count.items = size;
  const tx = {
    album: { findMany: vi.fn().mockResolvedValue([row]), findFirst: vi.fn().mockResolvedValue(row), update: vi.fn() },
    selectionItem: { findMany: vi.fn(async (args: { select: { comment?: boolean }; where: { photoId?: { in: string[] } } }) =>
      args.select.comment ? args.where.photoId!.in.map((photoId) => ({ photoId, comment: "client comment",
        photo: { width: 1200, height: 800, sourceRevision: "revision", previewRevision: "revision", previewStatus: "READY" } })) : [...keys]) },
    syncRun: { findFirst: vi.fn().mockResolvedValue(null), update: vi.fn() },
    $queryRaw: vi.fn().mockResolvedValue([{ id: "album", status: "PUBLISHED" }]),
  };
  const transaction = vi.fn(async <T>(fn: (client: typeof tx) => Promise<T>) => fn(tx));
  const database = { ...tx, $transaction: transaction } as unknown as DatabaseClient;
  const cursors = new OwnerCursorCodec(randomBytes(32));
  return { service: new WorkspaceService(database, cursors, true, () => date), cursors, tx, row, keys, transaction };
}

describe("indexed owner workspace (ALB-004/005/006, SEL-010, PERF-003/005)", () => {
  it("uses owner-scoped stable keyset queries with 25 albums and narrow counts", async () => {
    const { service, tx, cursors } = fixture();
    tx.album.findMany.mockResolvedValueOnce(Array.from({ length: 26 }, (_, index) => album(`album_${index}`)));
    const page = await service.albums("owner");
    expect(page.albums).toHaveLength(25);
    expect(JSON.stringify(page)).not.toMatch(/private-hash|driveFolderId|ownerId/);
    expect(page.albums[0]).toMatchObject({ photoCount: 101, selectedCount: 101, selectionStatus: "SUBMITTED", passwordProtected: true });
    const cursor = cursors.decode(page.nextCursor!);
    expect(cursor).toMatchObject({ kind: "albums", ownerId: "owner", albumId: "album_24" });
    await service.albums("owner", page.nextCursor!);
    expect(tx.album.findMany.mock.lastCall?.[0]).toMatchObject({ where: { ownerId: "owner", OR: [
      { createdAt: { lt: date } }, { createdAt: date, id: { lt: "album_24" } },
    ] }, take: 26, orderBy: [{ createdAt: "desc" }, { id: "desc" }] });
    await expect(service.albums("other", page.nextCursor!)).rejects.toMatchObject({ code: "invalid-cursor" });
  });
  it("reviews three natural-order pages with retained inactive photos and only 50 comments per query", async () => {
    const { service, tx, transaction } = fixture();
    const first = await service.review("owner", "album");
    expect(first.items).toHaveLength(50);
    expect(first.items.slice(0, 3).map((item) => item.fileName)).toEqual(["IMG_1.jpg", "IMG_2.jpg", "IMG_3.jpg"]);
    expect(first.items[1]).toMatchObject({ active: false, comment: "client comment", thumbnail: { src: "/api/v1/workspace/albums/album/images/photo_2" } });
    const second = await service.review("owner", "album", first.nextCursor!);
    const third = await service.review("owner", "album", second.nextCursor!);
    expect(second.items[0]?.fileName).toBe("IMG_51.jpg");
    expect(third.items.map((item) => item.fileName)).toEqual(["IMG_101.jpg"]);
    expect(third.nextCursor).toBeNull();
    expect(new Set([...first.items, ...second.items, ...third.items].map((item) => item.photoId)).size).toBe(101);
    const detailCalls = tx.selectionItem.findMany.mock.calls.filter(([args]) => args.select.comment);
    expect(detailCalls.map(([args]) => args.where.photoId!.in.length)).toEqual([50, 50, 1]);
    expect(tx.album.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "album", ownerId: "owner" } }));
    expect(transaction).toHaveBeenCalledWith(expect.any(Function), { isolationLevel: "RepeatableRead" });
  });
  it("returns bounded detail data for a 10,000-selection catalog", async () => {
    const { service, tx } = fixture(10_000);
    const page = await service.review("owner", "album");
    expect(page.items).toHaveLength(50);
    expect(page.album.selectedCount).toBe(10_000);
    expect(tx.selectionItem.findMany.mock.calls[0]?.[0].select).not.toHaveProperty("comment");
    expect(JSON.stringify(page).length).toBeLessThan(20_000);
  });
  it.each(["catalog", "comment", "removal", "status", "addition", "revision"])("rejects changed %s snapshots", async (change) => {
    const { service, row, keys } = fixture();
    const first = await service.review("owner", "album");
    if (change === "catalog") row.catalogVersion++;
    if (change === "comment") keys[0]!.updatedAt = new Date(date.getTime() + 1);
    if (change === "removal") keys[0]!.photo.active = false;
    if (change === "status") row.selection.status = "LOCKED";
    if (change === "addition") keys.pop();
    if (change === "revision") row.selection.revision++;
    await expect(service.review("owner", "album", first.nextCursor!)).rejects.toMatchObject({ code: "stale-cursor" });
  });
  it("rejects cross-owner, cross-album and cross-route cursors before database reads", async () => {
    const { service, tx } = fixture();
    const first = await service.review("owner", "album");
    tx.album.findFirst.mockClear();
    await expect(service.review("other", "album", first.nextCursor!)).rejects.toMatchObject({ code: "invalid-cursor" });
    await expect(service.review("owner", "other", first.nextCursor!)).rejects.toMatchObject({ code: "invalid-cursor" });
    await expect(service.albums("owner", first.nextCursor!)).rejects.toMatchObject({ code: "invalid-cursor" });
    expect(tx.album.findFirst).not.toHaveBeenCalled();
  });
  it("fails ownership before reading any selections and supports empty albums", async () => {
    const { service, tx } = fixture();
    tx.album.findFirst.mockResolvedValueOnce(null);
    await expect(service.review("other", "album")).rejects.toMatchObject({ code: "not-found" });
    expect(tx.selectionItem.findMany).not.toHaveBeenCalled();
    tx.album.findFirst.mockResolvedValueOnce({ ...album(), selection: null });
    expect(await service.review("owner", "album")).toMatchObject({ items: [], nextCursor: null, album: { selectionStatus: "DRAFT", selectedCount: 0 } });
  });
  it("archives only after an owner-bound album lock, retains history, and is idempotent", async () => {
    const { service, tx } = fixture();
    await service.archive("owner", "album");
    expect(tx.$queryRaw.mock.calls[0]?.slice(1)).toEqual(["album", "owner"]);
    expect(tx.$queryRaw.mock.calls[0]?.[0].join("")).toContain("FOR UPDATE");
    expect(tx.$queryRaw.mock.invocationCallOrder[0]).toBeLessThan(tx.album.update.mock.invocationCallOrder[0]!);
    expect(tx.album.update).toHaveBeenCalledWith({ where: { id: "album" }, data: { status: "ARCHIVED", archivedAt: expect.any(Date) } });
    tx.$queryRaw.mockResolvedValueOnce([{ id: "album", status: "ARCHIVED" }]);
    await service.archive("owner", "album");
    expect(tx.album.update).toHaveBeenCalledOnce();
    expect(tx.selectionItem.findMany).not.toHaveBeenCalled();
  });
  it("rejects missing/foreign albums and running sync before an archive write", async () => {
    const { service, tx } = fixture();
    tx.$queryRaw.mockResolvedValueOnce([]);
    await expect(service.archive("other", "album")).rejects.toMatchObject({ code: "not-found" });
    tx.syncRun.findFirst.mockResolvedValueOnce({ id: "run", startedAt: date });
    await expect(service.archive("owner", "album")).rejects.toMatchObject({ code: "conflict" });
    expect(tx.album.update).not.toHaveBeenCalled();
  });
  it("expires a crashed sync under the existing lease policy rather than stranding archive", async () => {
    const { service, tx } = fixture();
    tx.syncRun.findFirst.mockResolvedValueOnce({ id: "expired", startedAt: new Date(date.getTime() - 30 * 60 * 1000) });
    await service.archive("owner", "album");
    expect(tx.syncRun.update).toHaveBeenCalledWith({ where: { id: "expired" }, data: { status: "FAILED", finishedAt: date, errorCode: "STALE_RUN" } });
    expect(tx.syncRun.update.mock.invocationCallOrder[0]).toBeLessThan(tx.album.update.mock.invocationCallOrder[0]!);
  });
});
