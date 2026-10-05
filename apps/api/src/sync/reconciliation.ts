import { assignPhotoSortOrders, PreviewStatus, type Photo } from "@photographer-platform/database";
import { driveSourceRevision, type DirectChildImageCatalog } from "@photographer-platform/google-drive";

export type ExistingCatalogPhoto = Pick<
  Photo,
  | "id"
  | "driveFileId"
  | "fileName"
  | "mimeType"
  | "formatId"
  | "width"
  | "height"
  | "sizeBytes"
  | "driveCreatedTime"
  | "driveModifiedTime"
  | "driveVersion"
  | "md5Checksum"
  | "sourceRevision"
  | "sortOrder"
  | "active"
  | "previewStatus"
  | "previewRevision"
>;

export interface CatalogPhotoFields {
  readonly fileName: string;
  readonly mimeType: string;
  readonly formatId: string;
  readonly width: number | null;
  readonly height: number | null;
  readonly sizeBytes: bigint | null;
  readonly driveCreatedTime: Date | null;
  readonly driveModifiedTime: Date | null;
  readonly driveVersion: string | null;
  readonly md5Checksum: string | null;
  readonly sourceRevision: string | null;
  readonly sortOrder: number;
}

export interface PhotoCreation {
  readonly driveFileId: string;
  readonly fields: CatalogPhotoFields;
}

export interface PhotoUpdate {
  readonly id: string;
  readonly fields: CatalogPhotoFields;
  readonly invalidatePreview: boolean;
}

export interface ReconciliationPlan {
  readonly created: readonly PhotoCreation[];
  readonly updated: readonly PhotoUpdate[];
  readonly removedIds: readonly string[];
  readonly unchangedCount: number;
  readonly skippedCount: number;
  readonly pageCount: number;
  readonly catalogChanged: boolean;
}

function parseTimestamp(value: string | null): Date | null {
  if (value === null) return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error("Drive catalog contains an invalid timestamp.");
  }
  return parsed;
}

function parseSize(value: string | null): bigint | null {
  if (value === null) return null;
  const parsed = BigInt(value);
  if (parsed < 0n || parsed > 9_223_372_036_854_775_807n) {
    throw new Error("Drive catalog contains a size outside the PostgreSQL bigint range.");
  }
  return parsed;
}

function timestampEqual(left: Date | null, right: Date | null): boolean {
  return left?.getTime() === right?.getTime();
}

function sameFields(existing: ExistingCatalogPhoto, fields: CatalogPhotoFields): boolean {
  return (
    existing.active &&
    existing.fileName === fields.fileName &&
    existing.mimeType === fields.mimeType &&
    existing.formatId === fields.formatId &&
    existing.width === fields.width &&
    existing.height === fields.height &&
    existing.sizeBytes === fields.sizeBytes &&
    timestampEqual(existing.driveCreatedTime, fields.driveCreatedTime) &&
    timestampEqual(existing.driveModifiedTime, fields.driveModifiedTime) &&
    existing.driveVersion === fields.driveVersion &&
    existing.md5Checksum === fields.md5Checksum &&
    existing.sourceRevision === fields.sourceRevision &&
    existing.sortOrder === fields.sortOrder
  );
}

export function planAlbumReconciliation(
  catalog: DirectChildImageCatalog,
  existingPhotos: readonly ExistingCatalogPhoto[],
): ReconciliationPlan {
  if (!Number.isSafeInteger(catalog.skippedCount) || catalog.skippedCount < 0) {
    throw new Error("Drive catalog has an invalid skipped count.");
  }
  if (!Number.isSafeInteger(catalog.pageCount) || catalog.pageCount < 1) {
    throw new Error("Drive catalog is incomplete or has an invalid page count.");
  }

  const existingByDriveId = new Map(existingPhotos.map((photo) => [photo.driveFileId, photo]));
  const seenDriveIds = new Set<string>();
  const created: PhotoCreation[] = [];
  const updated: PhotoUpdate[] = [];
  let unchangedCount = 0;

  for (const image of assignPhotoSortOrders(catalog.images)) {
    seenDriveIds.add(image.driveFileId);
    const fields: CatalogPhotoFields = {
      fileName: image.fileName,
      mimeType: image.mimeType,
      formatId: image.formatId,
      width: image.width,
      height: image.height,
      sizeBytes: parseSize(image.sizeBytes),
      driveCreatedTime: parseTimestamp(image.createdTime),
      driveModifiedTime: parseTimestamp(image.modifiedTime),
      driveVersion: image.driveVersion,
      md5Checksum: image.md5Checksum,
      sourceRevision: driveSourceRevision(image),
      sortOrder: image.sortOrder,
    };
    const existing = existingByDriveId.get(image.driveFileId);
    if (existing === undefined) {
      created.push({ driveFileId: image.driveFileId, fields });
      continue;
    }

    const invalidatePreview =
      existing.sourceRevision !== fields.sourceRevision ||
      (fields.sourceRevision === null &&
        (existing.previewStatus !== PreviewStatus.PENDING || existing.previewRevision !== null));
    if (sameFields(existing, fields) && !invalidatePreview) {
      unchangedCount += 1;
    } else {
      updated.push({ id: existing.id, fields, invalidatePreview });
    }
  }

  const removedIds = existingPhotos
    .filter((photo) => photo.active && !seenDriveIds.has(photo.driveFileId))
    .map((photo) => photo.id);

  return {
    created,
    updated,
    removedIds,
    unchangedCount,
    skippedCount: catalog.skippedCount,
    pageCount: catalog.pageCount,
    catalogChanged: created.length > 0 || updated.length > 0 || removedIds.length > 0,
  };
}
