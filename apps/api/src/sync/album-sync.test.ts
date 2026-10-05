import { SyncRunStatus, type DatabaseClient } from "@photographer-platform/database";
import { DriveProviderError, type StorageProvider } from "@photographer-platform/google-drive";
import { describe, expect, it, vi } from "vitest";

import { AlbumSyncError, AlbumSyncService } from "./album-sync.js";

const NOW = new Date("2026-09-29T00:00:00.000Z");

function fixture() {
  const run = { id: "run-1", albumId: "album-1", status: SyncRunStatus.RUNNING, startedAt: NOW };
  const transaction = {
    $queryRaw: vi.fn().mockResolvedValue([
      {
        id: "album-1",
        status: "PUBLISHED",
        ownerId: "owner-1",
        driveConnectionId: "connection-1",
        driveFolderId: "folder-1",
      },
    ]),
    syncRun: {
      findFirst: vi.fn().mockResolvedValue(null),
      create: vi.fn().mockResolvedValue(run),
      findUnique: vi.fn().mockResolvedValue(run),
      update: vi.fn().mockResolvedValue(run),
    },
    photo: {
      findMany: vi.fn().mockResolvedValue([]),
      createMany: vi.fn().mockResolvedValue({ count: 1 }),
      update: vi.fn(),
      updateMany: vi.fn(),
    },
    album: { update: vi.fn().mockResolvedValue({}) },
  };
  const database = {
    $transaction: vi.fn(async (callback: (tx: typeof transaction) => Promise<unknown>) =>
      callback(transaction),
    ),
    syncRun: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
  } as unknown as DatabaseClient;
  const provider: StorageProvider = {
    listDirectChildImages: vi.fn().mockResolvedValue({
      images: [
        {
          driveFileId: "file-1",
          fileName: "IMG_1.jpg",
          mimeType: "image/jpeg",
          formatId: "jpeg",
          supportLevel: "guaranteed",
          classificationWarnings: [],
          width: 3000,
          height: 2000,
          rotation: null,
          sizeBytes: "1000",
          createdTime: null,
          modifiedTime: null,
          md5Checksum: "hash",
          driveVersion: "1",
        },
      ],
      skippedCount: 2,
      pageCount: 1,
    }),
  };
  const providerForConnection = vi.fn().mockResolvedValue(provider);
  const service = new AlbumSyncService({ database, providerForConnection, now: () => NOW });
  return { service, database, transaction, provider, providerForConnection };
}

describe("AlbumSyncService", () => {
  it("does not claim or access Drive for an archived album (ALB-006)", async () => {
    const { service, transaction, providerForConnection } = fixture();
    transaction.$queryRaw.mockResolvedValueOnce([{ id: "album-1", ownerId: "owner-1", status: "ARCHIVED" }]);
    await expect(service.syncAlbum("owner-1", "album-1")).rejects.toMatchObject({ code: "not-found" });
    expect(transaction.syncRun.create).not.toHaveBeenCalled();
    expect(providerForConnection).not.toHaveBeenCalled();
  });
  it("claims, fetches, then atomically persists a complete catalog and counts", async () => {
    const { service, database, transaction, provider, providerForConnection } = fixture();

    await expect(service.syncAlbum("owner-1", "album-1")).resolves.toEqual({
      syncRunId: "run-1",
      createdCount: 1,
      updatedCount: 0,
      unchangedCount: 0,
      removedCount: 0,
      skippedCount: 2,
      pageCount: 1,
      catalogChanged: true,
    });
    expect(database.$transaction).toHaveBeenCalledTimes(2);
    expect(providerForConnection).toHaveBeenCalledWith("connection-1", "owner-1");
    expect(provider.listDirectChildImages).toHaveBeenCalledWith("folder-1", expect.any(AbortSignal));
    expect(transaction.photo.createMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: [expect.objectContaining({ albumId: "album-1", driveFileId: "file-1", sortOrder: 0 })],
      }),
    );
    expect(transaction.syncRun.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: SyncRunStatus.SUCCEEDED, createdCount: 1, skippedCount: 2 }),
      }),
    );
  });

  it("records a failed Drive listing without touching photo rows", async () => {
    const { service, database, transaction, provider, providerForConnection } = fixture();
    vi.mocked(provider.listDirectChildImages).mockRejectedValue(
      new DriveProviderError("quota", "Google Drive quota has been reached."),
    );

    await expect(service.syncAlbum("owner-1", "album-1")).rejects.toMatchObject({ code: "quota" });
    expect(providerForConnection).toHaveBeenCalledTimes(1);
    expect(database.$transaction).toHaveBeenCalledTimes(1);
    expect(transaction.photo.findMany).not.toHaveBeenCalled();
    expect(transaction.photo.updateMany).not.toHaveBeenCalled();
    expect(database.syncRun.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ errorCode: "DRIVE_QUOTA" }) }),
    );
  });

  it("soft-removes missing photos only after a complete empty listing", async () => {
    const { service, transaction, provider } = fixture();
    vi.mocked(provider.listDirectChildImages).mockResolvedValue({
      images: [],
      skippedCount: 0,
      pageCount: 1,
    });
    transaction.photo.findMany.mockResolvedValue([
      { id: "old-photo", driveFileId: "old-file", active: true },
    ]);

    await expect(service.syncAlbum("owner-1", "album-1")).resolves.toMatchObject({
      removedCount: 1,
    });
    expect(transaction.photo.updateMany).toHaveBeenCalledWith({
      where: { albumId: "album-1", active: true, id: { in: ["old-photo"] } },
      data: { active: false, removedAt: NOW },
    });
    expect(transaction.photo.createMany).not.toHaveBeenCalled();
  });

  it("rejects another owner's album before opening its Drive provider", async () => {
    const { service, transaction, providerForConnection } = fixture();
    transaction.$queryRaw.mockResolvedValueOnce([
      {
        id: "album-1",
        ownerId: "different-owner",
        driveConnectionId: "connection-1",
        driveFolderId: "folder-1",
      },
    ]);

    await expect(service.syncAlbum("owner-1", "album-1")).rejects.toMatchObject({
      code: "not-found",
    });
    expect(providerForConnection).not.toHaveBeenCalled();
    expect(transaction.syncRun.create).not.toHaveBeenCalled();
  });

  it("rejects an already-running album and does not start a second listing", async () => {
    const { service, transaction, providerForConnection } = fixture();
    transaction.syncRun.findFirst.mockResolvedValueOnce({ id: "another-run", startedAt: NOW });

    await expect(service.syncAlbum("owner-1", "album-1")).rejects.toBeInstanceOf(AlbumSyncError);
    expect(providerForConnection).not.toHaveBeenCalled();
    expect(transaction.syncRun.create).not.toHaveBeenCalled();
  });

  it("supersedes an expired run under the album claim lock", async () => {
    const { service, transaction } = fixture();
    transaction.syncRun.findFirst.mockResolvedValueOnce({
      id: "expired-run",
      startedAt: new Date(NOW.getTime() - 31 * 60 * 1000),
    });

    await expect(service.syncAlbum("owner-1", "album-1")).resolves.toMatchObject({
      syncRunId: "run-1",
    });
    expect(transaction.syncRun.update).toHaveBeenCalledWith({
      where: { id: "expired-run" },
      data: { status: SyncRunStatus.FAILED, finishedAt: NOW, errorCode: "STALE_RUN" },
    });
  });

  it("prevents a superseded run from committing after its listing completes", async () => {
    const { service, database, transaction } = fixture();
    transaction.syncRun.findUnique.mockResolvedValueOnce({
      id: "run-1",
      albumId: "album-1",
      status: SyncRunStatus.FAILED,
      startedAt: NOW,
    });

    await expect(service.syncAlbum("owner-1", "album-1")).rejects.toMatchObject({
      code: "stale-run",
    });
    expect(transaction.photo.findMany).not.toHaveBeenCalled();
    expect(database.syncRun.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "run-1", status: SyncRunStatus.RUNNING } }),
    );
  });
});
