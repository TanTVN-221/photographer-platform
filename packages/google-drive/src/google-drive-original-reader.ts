import { createHash } from "node:crypto";

import { z } from "zod";

import type { GoogleDriveServiceOptions } from "./google-drive-service.js";
import { driveSourceRevision } from "./source-revision.js";
import {
  DriveProviderError,
  type DriveOperationEvent,
  type OriginalImageBytes,
  type OriginalImageReadRequest,
  type OriginalImageReader,
} from "./types.js";

const DRIVE_FILES_URL = "https://www.googleapis.com/drive/v3/files";
const METADATA_FIELDS = "id,mimeType,size,modifiedTime,md5Checksum,version,parents,trashed,capabilities(canDownload)";
const MAX_SOURCE_BYTES = 64 * 1024 * 1024;
const MAX_ATTEMPTS = 4;
const REQUEST_TIMEOUT_MS = 30_000;
const MAX_REDIRECTS = 2;

const idSchema = z.string().regex(/^[A-Za-z0-9_-]{1,256}$/);
const requestSchema = z.strictObject({
  driveFileId: idSchema,
  folderId: idSchema,
  expectedRevision: z.string().min(1).max(512).regex(/^(?:md5|version|fallback):/),
});
const metadataSchema = z.object({
  id: z.string().min(1),
  mimeType: z.string().min(1),
  size: z.string().regex(/^\d+$/).optional(),
  modifiedTime: z.iso.datetime({ offset: true }).optional(),
  md5Checksum: z.string().min(1).optional(),
  version: z.string().min(1).optional(),
  parents: z.array(z.string().min(1)),
  trashed: z.literal(false),
  capabilities: z.object({ canDownload: z.boolean() }),
});
const errorResponseSchema = z.object({
  error: z.object({ errors: z.array(z.object({ reason: z.string() })).optional() }),
});

type FileMetadata = z.infer<typeof metadataSchema>;

function metadataRevision(file: FileMetadata): string | null {
  return driveSourceRevision({
    md5Checksum: file.md5Checksum ?? null,
    driveVersion: file.version ?? null,
    modifiedTime: file.modifiedTime ?? null,
    sizeBytes: file.size ?? null,
  });
}

function mapResponseError(status: number, reason: string | null): DriveProviderError {
  if (status === 401) return new DriveProviderError("authentication", "Google Drive access has expired. Reconnect your account.", status);
  if (status === 403) {
    if (reason === "rateLimitExceeded" || reason === "userRateLimitExceeded") {
      return new DriveProviderError("rate-limit", "Google Drive is busy. Try again shortly.", status);
    }
    if (reason === "dailyLimitExceeded" || reason === "storageQuotaExceeded") {
      return new DriveProviderError("quota", "Google Drive quota has been reached.", status);
    }
    return new DriveProviderError("permission", "This account cannot download the Google Drive file.", status);
  }
  if (status === 404) return new DriveProviderError("not-found", "The Google Drive file was not found.", status);
  if (status === 408 || status === 429 || status >= 500) {
    return new DriveProviderError(status === 429 ? "rate-limit" : "transient", "Google Drive is temporarily unavailable. Try again shortly.", status);
  }
  return new DriveProviderError("invalid-request", "Google Drive rejected the file request.", status);
}

async function responseReason(response: Response): Promise<string | null> {
  try {
    const parsed = errorResponseSchema.safeParse(await response.json());
    return parsed.success ? (parsed.data.error.errors?.[0]?.reason ?? null) : null;
  } catch {
    return null;
  }
}

function isRedirect(response: Response): boolean {
  return [301, 302, 303, 307, 308].includes(response.status);
}

function safeRedirectUrl(location: string, base: URL): URL | null {
  try {
    const url = new URL(location, base);
    const host = url.hostname.toLowerCase();
    const googleHost = host.endsWith(".googleapis.com") || host.endsWith(".googleusercontent.com");
    return url.protocol === "https:" && googleHost && url.username === "" && url.password === "" &&
      (url.port === "" || url.port === "443")
      ? url
      : null;
  } catch {
    return null;
  }
}

export class GoogleDriveOriginalReader implements OriginalImageReader {
  private readonly getAccessToken: GoogleDriveServiceOptions["getAccessToken"];
  private readonly fetchImpl: typeof fetch;
  private readonly sleep: (milliseconds: number) => Promise<void>;
  private readonly random: () => number;
  private readonly onEvent: GoogleDriveServiceOptions["onEvent"];

  constructor(options: GoogleDriveServiceOptions) {
    this.getAccessToken = options.getAccessToken;
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.sleep = options.sleep ?? ((milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)));
    this.random = options.random ?? Math.random;
    this.onEvent = options.onEvent;
  }

  async readOriginalImage(input: OriginalImageReadRequest, signal?: AbortSignal): Promise<OriginalImageBytes> {
    const parsed = requestSchema.safeParse(input);
    if (!parsed.success) throw new DriveProviderError("invalid-request", "A valid Drive file, folder, and source revision are required.");
    const request = parsed.data;
    const initial = await this.getFileMetadata(request.driveFileId, signal);
    this.validateMetadata(initial, request);

    const bytes = await this.readMedia(request.driveFileId, signal);
    if (initial.size !== undefined && BigInt(initial.size) !== BigInt(bytes.byteLength)) {
      throw new DriveProviderError("stale-source", "The Google Drive file changed. Sync the album and retry.");
    }
    if (initial.md5Checksum !== undefined) {
      const checksum = createHash("md5").update(bytes).digest("hex");
      if (checksum.toLowerCase() !== initial.md5Checksum.toLowerCase()) {
        throw new DriveProviderError("stale-source", "The Google Drive file changed. Sync the album and retry.");
      }
    }

    const final = await this.getFileMetadata(request.driveFileId, signal);
    this.validateMetadata(final, request);
    if (final.mimeType !== initial.mimeType || final.size !== initial.size) {
      throw new DriveProviderError("stale-source", "The Google Drive file changed. Sync the album and retry.");
    }
    return { bytes, mimeType: initial.mimeType, sourceRevision: request.expectedRevision };
  }

  private validateMetadata(file: FileMetadata, request: OriginalImageReadRequest): void {
    if (file.id !== request.driveFileId || !file.parents.includes(request.folderId)) {
      throw new DriveProviderError("not-found", "The Google Drive file is no longer in this folder.");
    }
    if (file.capabilities.canDownload !== true) {
      throw new DriveProviderError("permission", "This account cannot download the Google Drive file.");
    }
    if (file.mimeType.startsWith("application/vnd.google-apps.")) {
      throw new DriveProviderError("invalid-response", "The Drive item is not a photograph file.");
    }
    if (metadataRevision(file) !== request.expectedRevision) {
      throw new DriveProviderError("stale-source", "The Google Drive file changed. Sync the album and retry.");
    }
    if (file.size !== undefined && BigInt(file.size) > BigInt(MAX_SOURCE_BYTES)) {
      throw new DriveProviderError("source-too-large", "This photograph exceeds the processing size limit.");
    }
  }

  private async getFileMetadata(fileId: string, signal?: AbortSignal): Promise<FileMetadata> {
    const url = new URL(`${DRIVE_FILES_URL}/${encodeURIComponent(fileId)}`);
    url.searchParams.set("fields", METADATA_FIELDS);
    url.searchParams.set("supportsAllDrives", "true");
    const response = await this.authorizedGet(url, "files.get", "application/json", false, signal);
    try {
      return metadataSchema.parse(await response.json());
    } catch {
      throw new DriveProviderError("invalid-response", "Google Drive returned invalid file metadata.");
    }
  }

  private async readMedia(fileId: string, signal?: AbortSignal): Promise<Buffer> {
    const url = new URL(`${DRIVE_FILES_URL}/${encodeURIComponent(fileId)}`);
    url.searchParams.set("alt", "media");
    url.searchParams.set("supportsAllDrives", "true");
    let response = await this.authorizedGet(url, "files.get.media", "*/*", true, signal);
    let currentUrl = url;
    let redirects = 0;
    while (isRedirect(response)) {
      if (redirects >= MAX_REDIRECTS) {
        throw new DriveProviderError("invalid-response", "Google Drive returned too many download redirects.");
      }
      const location = response.headers.get("location");
      const nextUrl = location === null ? null : safeRedirectUrl(location, currentUrl);
      if (nextUrl === null) {
        throw new DriveProviderError("invalid-response", "Google Drive returned an unsafe download redirect.");
      }
      currentUrl = nextUrl;
      redirects += 1;
      try {
        response = await this.fetchImpl(nextUrl, {
          method: "GET",
          headers: { Accept: "*/*" },
          redirect: "manual",
          signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(REQUEST_TIMEOUT_MS)]) : AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        });
      } catch {
        throw new DriveProviderError(signal?.aborted ? "cancelled" : "transient", "Google Drive download was interrupted.");
      }
      if (!response.ok && !isRedirect(response)) throw mapResponseError(response.status, null);
    }
    if (response.status !== 200 || response.body === null) {
      throw new DriveProviderError("invalid-response", "Google Drive returned an invalid download response.");
    }

    const declaredLength = response.headers.get("content-length");
    if (declaredLength !== null && /^\d+$/.test(declaredLength) && BigInt(declaredLength) > BigInt(MAX_SOURCE_BYTES)) {
      try {
        await response.body.cancel();
      } catch {
        // The size failure must remain authoritative if cancellation also fails.
      }
      throw new DriveProviderError("source-too-large", "This photograph exceeds the processing size limit.");
    }

    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let byteLength = 0;
    try {
      while (true) {
        const chunk = await reader.read();
        if (chunk.done) break;
        byteLength += chunk.value.byteLength;
        if (byteLength > MAX_SOURCE_BYTES) {
          try {
            await reader.cancel();
          } catch {
            // The size failure must remain authoritative if cancellation also fails.
          }
          throw new DriveProviderError("source-too-large", "This photograph exceeds the processing size limit.");
        }
        chunks.push(chunk.value);
      }
    } catch (error) {
      if (error instanceof DriveProviderError) throw error;
      throw new DriveProviderError(signal?.aborted ? "cancelled" : "transient", "Google Drive download was interrupted.");
    }
    if (byteLength === 0) throw new DriveProviderError("invalid-response", "Google Drive returned an empty photograph.");
    return Buffer.concat(chunks, byteLength);
  }

  private async authorizedGet(
    url: URL,
    operation: DriveOperationEvent["operation"],
    accept: string,
    allowRedirect: boolean,
    signal?: AbortSignal,
  ): Promise<Response> {
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
      if (signal?.aborted) throw new DriveProviderError("cancelled", "The Google Drive request was cancelled.");
      const startedAt = performance.now();
      let token: string;
      try {
        token = await this.getAccessToken();
      } catch {
        const error = new DriveProviderError("authentication", "Google Drive access is unavailable. Reconnect your account.");
        this.emit(operation, "error", error, attempt, startedAt);
        throw error;
      }
      if (token.trim().length === 0) {
        throw new DriveProviderError("authentication", "Google Drive access is unavailable. Reconnect your account.");
      }

      let response: Response;
      try {
        response = await this.fetchImpl(url, {
          method: "GET",
          headers: { Accept: accept, Authorization: `Bearer ${token}` },
          redirect: "manual",
          signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(REQUEST_TIMEOUT_MS)]) : AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        });
      } catch {
        const error = new DriveProviderError(signal?.aborted ? "cancelled" : "transient", "Google Drive is temporarily unavailable. Try again shortly.");
        if (error.retryable && attempt < MAX_ATTEMPTS) {
          this.emit(operation, "retry", error, attempt, startedAt);
          await this.waitBeforeRetry(attempt);
          continue;
        }
        this.emit(operation, "error", error, attempt, startedAt);
        throw error;
      }

      if (response.ok || (allowRedirect && isRedirect(response))) {
        this.emit(operation, "success", null, attempt, startedAt);
        return response;
      }
      const error = mapResponseError(response.status, await responseReason(response));
      if (error.retryable && attempt < MAX_ATTEMPTS) {
        this.emit(operation, "retry", error, attempt, startedAt);
        await this.waitBeforeRetry(attempt);
        continue;
      }
      this.emit(operation, "error", error, attempt, startedAt);
      throw error;
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
    startedAt: number,
  ): void {
    try {
      this.onEvent?.({ operation, outcome, category: error?.code ?? null, attempt, page: 1, durationMs: Math.round(performance.now() - startedAt) });
    } catch {
      // Observability must not alter provider behavior.
    }
  }
}
