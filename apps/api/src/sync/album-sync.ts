import {
  PreviewStatus,
  SyncRunStatus,
  type DatabaseClient,
  type Prisma,
} from "@photographer-platform/database";
import {
  DriveProviderError,
  type DirectChildImageCatalog,
  type StorageProvider,
} from "@photographer-platform/google-drive";

import { planAlbumReconciliation, type ExistingCatalogPhoto } from "./reconciliation.js";

const SYNC_DEADLINE_MS = 25 * 60 * 1000;
export const RUN_LEASE_MS = 30 * 60 * 1000;
const WRITE_BATCH_SIZE = 500;

type TransactionClient = Prisma.TransactionClient;

interface LockedAlbumRow {
  id: string;
  status: string;
  ownerId: string;
  driveConnectionId: string;
  driveFolderId: string;
}

export type AlbumSyncErrorCode = "not-found" | "already-running" | "stale-run";

export class AlbumSyncError extends Error {
  constructor(readonly code: AlbumSyncErrorCode) {
    super(
      code === "not-found"
        ? "The album was not found."
        : code === "already-running"
          ? "This album is already syncing."
          : "The sync run is no longer active. Please start a new sync.",
    );
    this.name = "AlbumSyncError";
  }
}

export interface AlbumSyncResult {
  readonly syncRunId: string;
  readonly createdCount: number;
  readonly updatedCount: number;
  readonly unchangedCount: number;
  readonly removedCount: number;
  readonly skippedCount: number;
  readonly pageCount: number;
  readonly catalogChanged: boolean;
}

export interface AlbumSyncServiceOptions {
  readonly database: DatabaseClient;
  readonly providerForConnection: (
    driveConnectionId: string,
    ownerId: string,
  ) => Promise<StorageProvider>;
  readonly now?: () => Date;
}

function batches<T>(items: readonly T[]): T[][] {
  const result: T[][] = [];
  for (let index = 0; index < items.length; index += WRITE_BATCH_SIZE) {
    result.push(items.slice(index, index + WRITE_BATCH_SIZE));
  }
  return result;
}

async function lockAlbum(
  transaction: TransactionClient,
  albumId: string,
  ownerId: string,
): Promise<LockedAlbumRow> {
  const rows = await transaction.$queryRaw<LockedAlbumRow[]>`
    SELECT "id", "status", "ownerId", "driveConnectionId", "driveFolderId"
    FROM "Album"
    WHERE "id" = ${albumId}
    FOR UPDATE
  `;
  const album = rows[0];
  // The same message for missing and another owner's album avoids an existence leak.
  if (album === undefined || album.ownerId !== ownerId || album.status === "ARCHIVED") {
    throw new AlbumSyncError("not-found");
  }
  return album;
}

function failureCode(error: unknown): string {
  if (error instanceof DriveProviderError) return `DRIVE_${error.code.toUpperCase().replaceAll("-", "_")}`;
  if (error instanceof AlbumSyncError && error.code === "stale-run") return "STALE_RUN";
  return "SYNC_FAILED";
}

export class AlbumSyncService {
  private readonly database: DatabaseClient;
  private readonly providerForConnection: AlbumSyncServiceOptions["providerForConnection"];
  private readonly now: () => Date;

  constructor(options: AlbumSyncServiceOptions) {
    this.database = options.database;
    this.providerForConnection = options.providerForConnection;
    this.now = options.now ?? (() => new Date());
  }

  async syncAlbum(ownerId: string, albumId: string): Promise<AlbumSyncResult> {
    const claim = await this.claimRun(ownerId, albumId);
    try {
      const provider = await this.providerForConnection(claim.driveConnectionId, ownerId);
      const signal = AbortSignal.timeout(SYNC_DEADLINE_MS);
      const catalog = await provider.listDirectChildImages(claim.driveFolderId, signal);
      if (signal.aborted) {
        throw new DriveProviderError("cancelled", "Google Drive listing exceeded the sync deadline.");
      }
      return await this.commitCatalog(ownerId, albumId, claim.runId, catalog);
    } catch (error) {
      await this.recordFailure(claim.runId, error);
      throw error;
    }
  }

  private async claimRun(ownerId: string, albumId: string) {
    return this.database.$transaction(
      async (transaction) => {
        const album = await lockAlbum(transaction, albumId, ownerId);
        const now = this.now();
        const active = await transaction.syncRun.findFirst({
          where: { albumId, status: SyncRunStatus.RUNNING },
        });
        if (active !== null) {
          if (now.getTime() - active.startedAt.getTime() < RUN_LEASE_MS) {
            throw new AlbumSyncError("already-running");
          }
          await transaction.syncRun.update({
            where: { id: active.id },
            data: { status: SyncRunStatus.FAILED, finishedAt: now, errorCode: "STALE_RUN" },
          });
        }
        const run = await transaction.syncRun.create({
          data: { albumId, status: SyncRunStatus.RUNNING, startedAt: now },
        });
        return {
          runId: run.id,
          driveConnectionId: album.driveConnectionId,
          driveFolderId: album.driveFolderId,
        };
      },
      { maxWait: 10_000, timeout: 10_000 },
    );
  }

  private async commitCatalog(
    ownerId: string,
    albumId: string,
    runId: string,
    catalog: DirectChildImageCatalog,
  ): Promise<AlbumSyncResult> {
    return this.database.$transaction(
      async (transaction) => {
        await lockAlbum(transaction, albumId, ownerId);
        const now = this.now();
        const run = await transaction.syncRun.findUnique({ where: { id: runId } });
        if (
          run === null ||
          run.albumId !== albumId ||
          run.status !== SyncRunStatus.RUNNING ||
          now.getTime() - run.startedAt.getTime() >= RUN_LEASE_MS
        ) {
          throw new AlbumSyncError("stale-run");
        }

        const existingPhotos: ExistingCatalogPhoto[] = await transaction.photo.findMany({
          where: { albumId },
          select: {
            id: true,
            driveFileId: true,
            fileName: true,
            mimeType: true,
            formatId: true,
            width: true,
            height: true,
            sizeBytes: true,
            driveCreatedTime: true,
            driveModifiedTime: true,
            driveVersion: true,
            md5Checksum: true,
            sourceRevision: true,
            sortOrder: true,
            active: true,
            previewStatus: true,
            previewRevision: true,
          },
        });
        const plan = planAlbumReconciliation(catalog, existingPhotos);

        for (const batch of batches(plan.created)) {
          await transaction.photo.createMany({
            data: batch.map(({ driveFileId, fields }) => ({
              albumId,
              driveFileId,
              ...fields,
              active: true,
              previewStatus: PreviewStatus.PENDING,
            })),
          });
        }
        for (const update of plan.updated) {
          await transaction.photo.update({
            where: { id: update.id },
            data: {
              ...update.fields,
              active: true,
              removedAt: null,
              ...(update.invalidatePreview
                ? {
                    previewStatus: PreviewStatus.PENDING,
                    previewRevision: null,
                    previewErrorCode: null,
                  }
                : {}),
            },
          });
        }
        for (const batch of batches(plan.removedIds)) {
          await transaction.photo.updateMany({
            where: { albumId, active: true, id: { in: batch } },
            data: { active: false, removedAt: now },
          });
        }

        await transaction.album.update({
          where: { id: albumId },
          data: {
            lastSyncedAt: now,
            ...(plan.catalogChanged ? { catalogVersion: { increment: 1 } } : {}),
          },
        });
        await transaction.syncRun.update({
          where: { id: runId },
          data: {
            status: SyncRunStatus.SUCCEEDED,
            finishedAt: now,
            createdCount: plan.created.length,
            updatedCount: plan.updated.length,
            unchangedCount: plan.unchangedCount,
            removedCount: plan.removedIds.length,
            skippedCount: plan.skippedCount,
            failedCount: 0,
          },
        });

        return {
          syncRunId: runId,
          createdCount: plan.created.length,
          updatedCount: plan.updated.length,
          unchangedCount: plan.unchangedCount,
          removedCount: plan.removedIds.length,
          skippedCount: plan.skippedCount,
          pageCount: plan.pageCount,
          catalogChanged: plan.catalogChanged,
        };
      },
      { maxWait: 10_000, timeout: 120_000 },
    );
  }

  private async recordFailure(runId: string, error: unknown): Promise<void> {
    await this.database.syncRun.updateMany({
      where: { id: runId, status: SyncRunStatus.RUNNING },
      data: { status: SyncRunStatus.FAILED, finishedAt: this.now(), errorCode: failureCode(error) },
    });
  }
}
