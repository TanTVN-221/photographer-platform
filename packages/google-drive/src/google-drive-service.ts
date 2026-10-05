import { classifySourceImage } from "@photographer-platform/shared";
import { z } from "zod";

import {
  DriveProviderError,
  type AccessibleDriveFolder,
  type DirectChildImageCatalog,
  type DriveFolderReader,
  type DriveImageMetadata,
  type DriveOperationEvent,
  type StorageProvider,
} from "./types.js";

const DRIVE_FILES_URL = "https://www.googleapis.com/drive/v3/files";
const DRIVE_FILE_FIELDS =
  "nextPageToken,incompleteSearch,files(id,name,mimeType,size,createdTime,modifiedTime,md5Checksum,version,imageMediaMetadata(width,height,rotation))";
const DRIVE_FOLDER_FIELDS = "id,name,mimeType,trashed,capabilities(canListChildren)";
const PAGE_SIZE = 1000;
const MAX_PAGES = 10_000;
const MAX_ATTEMPTS = 4;
const REQUEST_TIMEOUT_MS = 15_000;

const folderIdSchema = z.string().regex(/^[A-Za-z0-9_-]{1,256}$/);
const folderResponseSchema = z.object({
  id: folderIdSchema,
  name: z.string(),
  mimeType: z.string().min(1),
  trashed: z.boolean(),
  capabilities: z.object({ canListChildren: z.boolean().optional() }).optional(),
});
const timestampSchema = z.iso.datetime({ offset: true });
const fileSchema = z.object({
  id: z.string().min(1),
  name: z.string(),
  mimeType: z.string().min(1),
  size: z.string().regex(/^\d+$/).optional(),
  createdTime: timestampSchema.optional(),
  modifiedTime: timestampSchema.optional(),
  md5Checksum: z.string().optional(),
  version: z.string().optional(),
  imageMediaMetadata: z
    .object({
      width: z.number().int().positive().optional(),
      height: z.number().int().positive().optional(),
      rotation: z.number().int().nonnegative().optional(),
    })
    .optional(),
});
const listResponseSchema = z.object({
  files: z.array(fileSchema).default([]),
  nextPageToken: z.string().min(1).optional(),
  incompleteSearch: z.boolean().optional(),
});
const errorResponseSchema = z.object({
  error: z.object({
    errors: z.array(z.object({ reason: z.string() })).optional(),
  }),
});

type DriveFile = z.infer<typeof fileSchema>;

export interface GoogleDriveServiceOptions {
  readonly getAccessToken: () => Promise<string>;
  readonly fetchImpl?: typeof fetch;
  readonly sleep?: (milliseconds: number) => Promise<void>;
  readonly random?: () => number;
  readonly onEvent?: (event: DriveOperationEvent) => void;
}

function mapDriveError(status: number, reason: string | null): DriveProviderError {
  if (status === 401) {
    return new DriveProviderError(
      "authentication",
      "Google Drive access has expired. Reconnect your account and try again.",
      status,
    );
  }
  if (status === 403) {
    if (reason === "rateLimitExceeded" || reason === "userRateLimitExceeded") {
      return new DriveProviderError("rate-limit", "Google Drive is busy. Try again shortly.", status);
    }
    if (reason === "dailyLimitExceeded" || reason === "storageQuotaExceeded") {
      return new DriveProviderError("quota", "Google Drive quota has been reached.", status);
    }
    return new DriveProviderError(
      "permission",
      "This account cannot access the Google Drive folder.",
      status,
    );
  }
  if (status === 404) {
    return new DriveProviderError("not-found", "The Google Drive folder was not found.", status);
  }
  if (status === 429) {
    return new DriveProviderError("rate-limit", "Google Drive is busy. Try again shortly.", status);
  }
  if (status === 408 || status >= 500) {
    return new DriveProviderError(
      "transient",
      "Google Drive is temporarily unavailable. Try again shortly.",
      status,
    );
  }
  return new DriveProviderError("invalid-request", "Google Drive rejected the folder request.", status);
}

async function readDriveErrorReason(response: Response): Promise<string | null> {
  try {
    const parsed = errorResponseSchema.safeParse(await response.json());
    return parsed.success ? (parsed.data.error.errors?.[0]?.reason ?? null) : null;
  } catch {
    return null;
  }
}

function mapImage(file: DriveFile): DriveImageMetadata | null {
  // Google Workspace documents are not photograph bytes, even if their names end in .jpg.
  if (file.mimeType.startsWith("application/vnd.google-apps.")) {
    return null;
  }

  const classification = classifySourceImage({
    fileName: file.name,
    mimeType: file.mimeType,
  });
  if (classification.status === "unrecognized") {
    return null;
  }

  return {
    driveFileId: file.id,
    fileName: file.name,
    mimeType: file.mimeType,
    formatId: classification.format.id,
    supportLevel: classification.format.supportLevel,
    classificationWarnings: classification.warnings,
    width: file.imageMediaMetadata?.width ?? null,
    height: file.imageMediaMetadata?.height ?? null,
    rotation: file.imageMediaMetadata?.rotation ?? null,
    sizeBytes: file.size ?? null,
    createdTime: file.createdTime ?? null,
    modifiedTime: file.modifiedTime ?? null,
    md5Checksum: file.md5Checksum ?? null,
    driveVersion: file.version ?? null,
  };
}

export class GoogleDriveService implements StorageProvider, DriveFolderReader {
  private readonly getAccessToken: () => Promise<string>;
  private readonly fetchImpl: typeof fetch;
  private readonly sleep: (milliseconds: number) => Promise<void>;
  private readonly random: () => number;
  private readonly onEvent: ((event: DriveOperationEvent) => void) | undefined;

  constructor(options: GoogleDriveServiceOptions) {
    this.getAccessToken = options.getAccessToken;
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.sleep = options.sleep ?? ((milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)));
    this.random = options.random ?? Math.random;
    this.onEvent = options.onEvent;
  }

  async readAccessibleFolder(folderId: string, signal?: AbortSignal): Promise<AccessibleDriveFolder> {
    if (!folderIdSchema.safeParse(folderId).success) {
      throw new DriveProviderError("invalid-request", "A valid Google Drive folder ID is required.");
    }
    const url = new URL(`${DRIVE_FILES_URL}/${folderId}`);
    url.searchParams.set("fields", DRIVE_FOLDER_FIELDS);
    url.searchParams.set("supportsAllDrives", "true");
    const folder = await this.fetchMetadata(url, folderResponseSchema, "files.get", 1, signal);
    if (signal?.aborted) throw new DriveProviderError("cancelled", "The Google Drive request was cancelled.");
    if (folder.id !== folderId) {
      throw new DriveProviderError("invalid-response", "Google Drive returned an unexpected folder.");
    }
    if (folder.trashed) {
      throw new DriveProviderError("not-found", "The Google Drive folder is not available.");
    }
    if (folder.mimeType !== "application/vnd.google-apps.folder") {
      throw new DriveProviderError("invalid-request", "Choose a Google Drive folder, not a file or shortcut.");
    }
    if (folder.capabilities?.canListChildren !== true) {
      throw new DriveProviderError("permission", "This account cannot list the Google Drive folder.");
    }
    return { folderId: folder.id, name: folder.name };
  }

  async listDirectChildImages(
    folderId: string,
    signal?: AbortSignal,
  ): Promise<DirectChildImageCatalog> {
    if (!folderIdSchema.safeParse(folderId).success) {
      throw new DriveProviderError("invalid-request", "A valid Google Drive folder ID is required.");
    }

    const files = new Map<string, DriveFile>();
    const seenPageTokens = new Set<string>();
    let pageToken: string | undefined;
    let pageCount = 0;
    let paginationRestarts = 0;

    while (true) {
      if (pageCount >= MAX_PAGES) {
        throw new DriveProviderError("invalid-response", "Google Drive returned too many pages.");
      }

      const url = new URL(DRIVE_FILES_URL);
      url.searchParams.set("q", `'${folderId}' in parents and trashed = false`);
      url.searchParams.set("fields", DRIVE_FILE_FIELDS);
      url.searchParams.set("pageSize", String(PAGE_SIZE));
      url.searchParams.set("orderBy", "name_natural");
      url.searchParams.set("supportsAllDrives", "true");
      url.searchParams.set("includeItemsFromAllDrives", "true");
      if (pageToken !== undefined) {
        url.searchParams.set("pageToken", pageToken);
      }

      let page: z.infer<typeof listResponseSchema>;
      try {
        page = await this.fetchMetadata(url, listResponseSchema, "files.list", pageCount + 1, signal);
      } catch (error) {
        // Drive can invalidate a continuation token when a folder changes mid-list.
        // Discard the partial catalog and make one fresh pass from page one.
        if (
          pageToken !== undefined &&
          paginationRestarts === 0 &&
          error instanceof DriveProviderError &&
          error.code === "invalid-request" &&
          error.httpStatus === 400
        ) {
          files.clear();
          seenPageTokens.clear();
          pageToken = undefined;
          pageCount = 0;
          paginationRestarts += 1;
          continue;
        }
        throw error;
      }
      pageCount += 1;
      if (page.incompleteSearch === true) {
        throw new DriveProviderError(
          "invalid-response",
          "Google Drive returned an incomplete folder listing. Try syncing again.",
        );
      }
      for (const file of page.files) {
        files.set(file.id, file);
      }

      pageToken = page.nextPageToken;
      if (pageToken === undefined) {
        break;
      }
      if (seenPageTokens.has(pageToken)) {
        throw new DriveProviderError(
          "invalid-response",
          "Google Drive repeated a page token. Try syncing again.",
        );
      }
      seenPageTokens.add(pageToken);
    }

    const images: DriveImageMetadata[] = [];
    let skippedCount = 0;
    for (const file of files.values()) {
      const image = mapImage(file);
      if (image === null) {
        skippedCount += 1;
      } else {
        images.push(image);
      }
    }

    return { images, skippedCount, pageCount };
  }

  private async fetchMetadata<T>(
    url: URL,
    schema: z.ZodType<T>,
    operation: DriveOperationEvent["operation"],
    page: number,
    signal?: AbortSignal,
  ): Promise<T> {
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
      if (signal?.aborted) {
        throw new DriveProviderError("cancelled", "The Google Drive request was cancelled.");
      }

      const startedAt = performance.now();
      let token: string;
      try {
        token = await this.getAccessToken();
      } catch {
        const error = new DriveProviderError(
          "authentication",
          "Google Drive access is unavailable. Reconnect your account and try again.",
        );
        this.emit(operation, "error", error, attempt, page, startedAt);
        throw error;
      }
      if (token.trim().length === 0) {
        const error = new DriveProviderError(
          "authentication",
          "Google Drive access is unavailable. Reconnect your account and try again.",
        );
        this.emit(operation, "error", error, attempt, page, startedAt);
        throw error;
      }

      let response: Response;
      try {
        if (signal?.aborted) throw new Error("cancelled");
        const requestSignal = signal
          ? AbortSignal.any([signal, AbortSignal.timeout(REQUEST_TIMEOUT_MS)])
          : AbortSignal.timeout(REQUEST_TIMEOUT_MS);
        response = await this.fetchImpl(url, {
          method: "GET",
          headers: { Accept: "application/json", Authorization: `Bearer ${token}` },
          signal: requestSignal,
          redirect: "error",
        });
      } catch {
        const error = signal?.aborted
          ? new DriveProviderError("cancelled", "The Google Drive request was cancelled.")
          : new DriveProviderError(
              "transient",
              "Google Drive is temporarily unavailable. Try again shortly.",
            );
        if (error.retryable && attempt < MAX_ATTEMPTS) {
          this.emit(operation, "retry", error, attempt, page, startedAt);
          await this.waitBeforeRetry(attempt);
          continue;
        }
        this.emit(operation, "error", error, attempt, page, startedAt);
        throw error;
      }

      if (!response.ok) {
        const reason = await readDriveErrorReason(response);
        const error = mapDriveError(response.status, reason);
        if (error.retryable && attempt < MAX_ATTEMPTS) {
          this.emit(operation, "retry", error, attempt, page, startedAt);
          await this.waitBeforeRetry(attempt);
          continue;
        }
        this.emit(operation, "error", error, attempt, page, startedAt);
        throw error;
      }

      try {
        const parsed = schema.parse(await response.json());
        this.emit(operation, "success", null, attempt, page, startedAt);
        return parsed;
      } catch {
        const error = new DriveProviderError(
          "invalid-response",
          "Google Drive returned invalid folder metadata. Try syncing again.",
        );
        this.emit(operation, "error", error, attempt, page, startedAt);
        throw error;
      }
    }

    throw new DriveProviderError("transient", "Google Drive is temporarily unavailable.");
  }

  private async waitBeforeRetry(attempt: number): Promise<void> {
    const jitter = Math.floor(Math.max(0, Math.min(1, this.random())) * 100);
    await this.sleep(Math.min(250 * 2 ** (attempt - 1), 2_000) + jitter);
  }

  private emit(
    operation: DriveOperationEvent["operation"],
    outcome: DriveOperationEvent["outcome"],
    error: DriveProviderError | null,
    attempt: number,
    page: number,
    startedAt: number,
  ): void {
    try {
      this.onEvent?.({
        operation,
        outcome,
        category: error?.code ?? null,
        attempt,
        page,
        durationMs: Math.round(performance.now() - startedAt),
      });
    } catch {
      // Observability must not turn a successful provider request into a failure.
    }
  }
}
