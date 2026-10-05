import { AlbumStatus, PreviewStatus, type DatabaseClient, type Prisma } from "@photographer-platform/database";
import type { OriginalImageReader } from "@photographer-platform/google-drive";
import { z } from "zod";

import { DerivativeStoreError, type DerivativeStore } from "./derivative-store.js";
import { PreviewPreparationError, preparePreview, type PreviewPreparationResult } from "./prepare-preview.js";

const idSchema = z.string().regex(/^[A-Za-z0-9_-]{1,128}$/);

export class PreviewPublicationError extends Error {
  constructor(readonly code: "invalid-request" | "not-found") {
    super(code === "not-found" ? "The photo was not found." : "A valid owner, album, and photo are required.");
    this.name = "PreviewPublicationError";
  }
}

export type PreviewPublicationResult =
  | { readonly status: "ready" | "already-ready" | "superseded" | "needs-sync"; readonly photoId: string }
  | { readonly status: "unsupported-variant" | "failed" | "stale-source" | "deferred"; readonly photoId: string; readonly code: string };

export interface PreviewPublicationOptions {
  readonly database: DatabaseClient;
  readonly derivativeStore: DerivativeStore;
  readonly readerForConnection: (connectionId: string, ownerId: string) => Promise<OriginalImageReader>;
}

function safeErrorCode(status: string, code: string): string {
  return `${status}_${code}`.toUpperCase().replaceAll("-", "_");
}

/** Internal owner-scoped one-photo publisher; never invoke from a gallery read. */
export class PreviewPublicationService {
  private readonly database: DatabaseClient;
  private readonly derivativeStore: DerivativeStore;
  private readonly readerForConnection: PreviewPublicationOptions["readerForConnection"];

  constructor(options: PreviewPublicationOptions) {
    this.database = options.database;
    this.derivativeStore = options.derivativeStore;
    this.readerForConnection = options.readerForConnection;
  }

  async processPhoto(ownerId: string, albumId: string, photoId: string, signal?: AbortSignal): Promise<PreviewPublicationResult> {
    if (![ownerId, albumId, photoId].every((id) => idSchema.safeParse(id).success)) {
      throw new PreviewPublicationError("invalid-request");
    }
    const photo = await this.database.photo.findFirst({
      where: {
        id: photoId,
        albumId,
        active: true,
        album: { ownerId, status: { not: AlbumStatus.ARCHIVED } },
      },
      select: {
        id: true,
        driveFileId: true,
        fileName: true,
        mimeType: true,
        sourceRevision: true,
        previewStatus: true,
        previewRevision: true,
        album: { select: { driveFolderId: true, driveConnectionId: true } },
      },
    });
    if (photo === null) throw new PreviewPublicationError("not-found");
    if (signal?.aborted) return { status: "deferred", photoId, code: "cancelled" };
    if (photo.sourceRevision === null) {
      await this.updateCurrentPhoto(ownerId, albumId, {
        where: { id: photoId, albumId, active: true, sourceRevision: null, previewStatus: PreviewStatus.READY,
          album: { ownerId, status: { not: AlbumStatus.ARCHIVED } } },
        data: { previewStatus: PreviewStatus.PENDING, previewRevision: null, previewErrorCode: "MISSING_SOURCE_REVISION" },
      });
      return { status: "needs-sync", photoId };
    }

    const identity = { photoId, sourceRevision: photo.sourceRevision };
    if (photo.previewStatus === PreviewStatus.READY && photo.previewRevision !== photo.sourceRevision) {
      const invalidated = await this.invalidateReady(
        ownerId, photoId, albumId, photo.sourceRevision, photo.previewRevision, "STALE_PREVIEW_REVISION",
      );
      if (!invalidated) return { status: "superseded", photoId };
    }
    if (photo.previewStatus === PreviewStatus.READY && photo.previewRevision === photo.sourceRevision) {
      try {
        const [thumbnail, preview] = await Promise.all([
          this.derivativeStore.read(identity, "thumbnail"),
          this.derivativeStore.read(identity, "preview"),
        ]);
        if (thumbnail !== null && preview !== null) return { status: "already-ready", photoId };
      } catch (error) {
        const invalidated = await this.invalidateReady(
          ownerId, photoId, albumId, photo.sourceRevision, photo.previewRevision, "STORAGE_UNAVAILABLE",
        );
        if (!invalidated) return { status: "superseded", photoId };
        return {
          status: "deferred",
          photoId,
          code: error instanceof DerivativeStoreError && error.code === "corrupt"
            ? "storage-corrupt"
            : "storage-unavailable",
        };
      }
      const invalidated = await this.invalidateReady(
        ownerId, photoId, albumId, photo.sourceRevision, photo.previewRevision, "STORAGE_UNAVAILABLE",
      );
      if (!invalidated) return { status: "superseded", photoId };
    }

    let reader: OriginalImageReader;
    try {
      reader = await this.readerForConnection(photo.album.driveConnectionId, ownerId);
    } catch {
      return this.recordNonReady(ownerId, photoId, albumId, photo.sourceRevision, "deferred", "reader-unavailable");
    }

    let prepared: PreviewPreparationResult;
    try {
      prepared = await preparePreview({
        photoId,
        driveFileId: photo.driveFileId,
        folderId: photo.album.driveFolderId,
        fileName: photo.fileName,
        mimeType: photo.mimeType,
        sourceRevision: photo.sourceRevision,
      }, reader, signal);
    } catch (error) {
      return this.recordNonReady(
        ownerId, photoId, albumId, photo.sourceRevision, "failed",
        error instanceof PreviewPreparationError ? "invalid-metadata" : "unexpected-error",
      );
    }

    if (prepared.status !== "ready") {
      return this.recordNonReady(ownerId, photoId, albumId, photo.sourceRevision, prepared.status, prepared.code);
    }

    if (signal?.aborted) return { status: "deferred", photoId, code: "cancelled" };

    try {
      await this.derivativeStore.publish(identity, {
        thumbnail: prepared.thumbnail,
        preview: prepared.preview,
      });
    } catch {
      return this.recordNonReady(ownerId, photoId, albumId, photo.sourceRevision, "deferred", "storage-unavailable");
    }

    if (signal?.aborted) return { status: "deferred", photoId, code: "cancelled" };

    const committed = await this.updateCurrentPhoto(ownerId, albumId, {
      where: { id: photoId, albumId, active: true, sourceRevision: photo.sourceRevision,
        album: { ownerId, status: { not: AlbumStatus.ARCHIVED } } },
      data: {
        previewStatus: PreviewStatus.READY,
        previewRevision: photo.sourceRevision,
        previewErrorCode: null,
      },
    });
    return committed.count === 1 ? { status: "ready", photoId } : { status: "superseded", photoId };
  }

  private async invalidateReady(
    ownerId: string,
    photoId: string,
    albumId: string,
    sourceRevision: string,
    previewRevision: string | null,
    errorCode: "STORAGE_UNAVAILABLE" | "STALE_PREVIEW_REVISION",
  ): Promise<boolean> {
    const result = await this.updateCurrentPhoto(ownerId, albumId, {
      where: {
        id: photoId,
        albumId,
        active: true,
        sourceRevision,
        previewStatus: PreviewStatus.READY,
        previewRevision,
        album: { ownerId, status: { not: AlbumStatus.ARCHIVED } },
      },
      data: { previewStatus: PreviewStatus.PENDING, previewRevision: null, previewErrorCode: errorCode },
    });
    return result.count === 1;
  }

  private async recordNonReady(
    ownerId: string,
    photoId: string,
    albumId: string,
    sourceRevision: string,
    status: "unsupported-variant" | "failed" | "stale-source" | "deferred",
    code: string,
  ): Promise<PreviewPublicationResult> {
    const previewStatus = status === "unsupported-variant"
      ? PreviewStatus.UNSUPPORTED_VARIANT
      : status === "failed" ? PreviewStatus.FAILED : PreviewStatus.PENDING;
    const errorCode = safeErrorCode(status, code);
    const committed = await this.updateCurrentPhoto(ownerId, albumId, {
      where: {
        id: photoId,
        albumId,
        active: true,
        sourceRevision,
        previewStatus: { not: PreviewStatus.READY },
        album: { ownerId, status: { not: AlbumStatus.ARCHIVED } },
      },
      data: { previewStatus, previewRevision: null, previewErrorCode: errorCode },
    });
    return committed.count === 1 ? { status, photoId, code } : { status: "superseded", photoId };
  }

  private async updateCurrentPhoto(ownerId: string, albumId: string, args: Prisma.PhotoUpdateManyArgs) {
    // Same lock order as archive/sync/selection. No provider, filesystem or
    // decoder operation runs in this short transaction.
    return this.database.$transaction(async (transaction) => {
      const albums = await transaction.$queryRaw<{ id: string; status: string }[]>`
        SELECT "id", "status" FROM "Album"
        WHERE "id" = ${albumId} AND "ownerId" = ${ownerId} FOR UPDATE
      `;
      if (albums[0] === undefined || albums[0].status === AlbumStatus.ARCHIVED) return { count: 0 };
      return transaction.photo.updateMany(args);
    }, { maxWait: 2_000, timeout: 5_000 });
  }
}
