import type {
  SourceImageClassificationWarning,
  SourceImageFormatId,
  SourceImageSupportLevel,
} from "@photographer-platform/shared";

export interface DriveImageMetadata {
  readonly driveFileId: string;
  readonly fileName: string;
  readonly mimeType: string;
  readonly formatId: SourceImageFormatId;
  readonly supportLevel: SourceImageSupportLevel;
  readonly classificationWarnings: readonly SourceImageClassificationWarning[];
  readonly width: number | null;
  readonly height: number | null;
  readonly rotation: number | null;
  readonly sizeBytes: string | null;
  readonly createdTime: string | null;
  readonly modifiedTime: string | null;
  readonly md5Checksum: string | null;
  readonly driveVersion: string | null;
}

export interface DirectChildImageCatalog {
  readonly images: readonly DriveImageMetadata[];
  readonly skippedCount: number;
  readonly pageCount: number;
}

export interface StorageProvider {
  listDirectChildImages(folderId: string, signal?: AbortSignal): Promise<DirectChildImageCatalog>;
}

export interface AccessibleDriveFolder {
  readonly folderId: string;
  readonly name: string;
}

/** Folder metadata access does not prove the app can read existing child files. */
export interface DriveFolderReader {
  readAccessibleFolder(folderId: string, signal?: AbortSignal): Promise<AccessibleDriveFolder>;
}

export interface OriginalImageReadRequest {
  readonly driveFileId: string;
  readonly folderId: string;
  readonly expectedRevision: string;
}

export interface OriginalImageBytes {
  readonly bytes: Buffer;
  readonly mimeType: string;
  readonly sourceRevision: string;
}

/** Only a trusted processing caller may use this; never expose it on a gallery route. */
export interface OriginalImageReader {
  readOriginalImage(request: OriginalImageReadRequest, signal?: AbortSignal): Promise<OriginalImageBytes>;
}

export type DriveErrorCode =
  | "authentication"
  | "permission"
  | "not-found"
  | "quota"
  | "rate-limit"
  | "transient"
  | "invalid-request"
  | "invalid-response"
  | "source-too-large"
  | "stale-source"
  | "cancelled";

export class DriveProviderError extends Error {
  readonly code: DriveErrorCode;
  readonly retryable: boolean;
  readonly httpStatus: number | null;

  constructor(code: DriveErrorCode, message: string, httpStatus: number | null = null) {
    super(message);
    this.name = "DriveProviderError";
    this.code = code;
    this.retryable = code === "rate-limit" || code === "transient";
    this.httpStatus = httpStatus;
  }
}

export interface DriveOperationEvent {
  readonly operation: "files.list" | "files.get" | "files.get.media";
  readonly outcome: "success" | "retry" | "error";
  readonly category: DriveErrorCode | null;
  readonly attempt: number;
  readonly page: number;
  readonly durationMs: number;
}
