import { createHash } from "node:crypto";
import {
  AlbumStatus,
  DriveConnectionStatus,
  Prisma,
  SelectionStatus,
  type DatabaseClient,
} from "@photographer-platform/database";
import { DriveProviderError, type DriveFolderReader } from "@photographer-platform/google-drive";
import { z } from "zod";

import { hashGalleryPassword, verifyGalleryPassword } from "../gallery/gallery-password.js";
import { generatePublicGallerySlug } from "../gallery/public-slug.js";

const resourceIdSchema = z.string().regex(/^[A-Za-z0-9_-]{1,128}$/);
const creationSchema = z.strictObject({
  requestId: z.string().uuid().transform((value) => value.toLowerCase()),
  driveConnectionId: resourceIdSchema,
  driveFolderId: z.string().regex(/^[A-Za-z0-9_-]{1,256}$/),
  title: z.string().trim().min(1).max(200),
  password: z.string().min(1).refine((value) => Buffer.byteLength(value, "utf8") <= 1024).nullish(),
  selectionLimit: z.number().int().positive().max(2_147_483_647).nullish(),
});
const TRANSACTION_OPTIONS = { maxWait: 5_000, timeout: 5_000 } as const;
const SLUG_ATTEMPTS = 3;
const adapterCollisionSchema = z.object({
  cause: z.object({
    kind: z.literal("UniqueConstraintViolation"),
    table: z.string().optional(),
    constraint: z.object({ index: z.string().optional(), fields: z.array(z.string()).optional() }),
  }),
});

export type AlbumCreationErrorCode =
  | "invalid-request" | "connection-not-found" | "connection-changed"
  | "drive-authentication" | "drive-permission" | "drive-not-found"
  | "drive-quota" | "drive-rate-limit" | "drive-unavailable"
  | "cancelled" | "unavailable" | "request-conflict";

const messages: Record<AlbumCreationErrorCode, string> = {
  "invalid-request": "Provide a request UUID, folder ID, title, valid optional password and positive selection limit.",
  "request-conflict": "This creation request was already used with different settings. Start a new request.",
  "connection-not-found": "Connect Google Drive before creating this album.",
  "connection-changed": "The Drive connection changed. Check the connection and try again.",
  "drive-authentication": "Reconnect Google Drive and try again.",
  "drive-permission": "This app cannot access the selected Drive folder. Check the folder authorization.",
  "drive-not-found": "The selected Drive folder is not available to this app.",
  "drive-quota": "Google Drive quota has been reached. Try again after the quota resets.",
  "drive-rate-limit": "Google Drive is busy. Try again shortly.",
  "drive-unavailable": "Google Drive is temporarily unavailable. Try again shortly.",
  cancelled: "Album creation was cancelled.",
  unavailable: "The draft album could not be created. Check album status before retrying.",
};

export class AlbumCreationError extends Error {
  constructor(readonly code: AlbumCreationErrorCode) {
    super(messages[code]);
    this.name = "AlbumCreationError";
  }
}

export interface CreatedDraftAlbum {
  readonly albumId: string;
  readonly publicSlug: string;
  /** Original creation response; replay never changes a later lifecycle state. */
  readonly status: "DRAFT";
}

const receiptSelect = { requestHash: true, passwordHash: true, publicSlug: true,
  album: { select: { id: true } } } as const;
type CreationReceipt = Prisma.AlbumCreationRequestGetPayload<{ select: typeof receiptSelect }>;
type CreationInput = z.infer<typeof creationSchema>;

function digest(parts: readonly unknown[]): string {
  return createHash("sha256").update(JSON.stringify(parts)).digest("hex");
}

function requestDigest(input: CreationInput): string {
  // Password content must never be a fast digest, even in a private database.
  return digest(["draft-album-settings:v1", input.driveConnectionId, input.driveFolderId,
    input.title, input.selectionLimit ?? null, input.password != null]);
}

async function replayReceipt(receipt: CreationReceipt, input: CreationInput, signal?: AbortSignal): Promise<CreatedDraftAlbum> {
  checkCancellation(signal);
  if (receipt.requestHash !== requestDigest(input) ||
    (input.password == null ? receipt.passwordHash !== null :
      !await verifyGalleryPassword(input.password, receipt.passwordHash))) {
    throw new AlbumCreationError("request-conflict");
  }
  checkCancellation(signal);
  return { albumId: receipt.album.id, publicSlug: receipt.publicSlug, status: "DRAFT" };
}

interface LockedConnection {
  readonly id: string;
  readonly status: (typeof DriveConnectionStatus)[keyof typeof DriveConnectionStatus];
  readonly updatedAt: Date;
}

function checkCancellation(signal?: AbortSignal): void {
  if (signal?.aborted) throw new AlbumCreationError("cancelled");
}

function isUniqueCollision(error: unknown, index: string, fields: readonly string[], tableName: string): boolean {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== "P2002") return false;
  const target = error.meta?.target;
  if ((Array.isArray(target) && target.length === fields.length && target.every((field, i) => field === fields[i])) ||
    target === index) return true;
  // Prisma 7's pg adapter carries the constraint in driverAdapterError, not target.
  const adapter = adapterCollisionSchema.safeParse(error.meta?.driverAdapterError);
  if (!adapter.success) return false;
  const { constraint, table } = adapter.data.cause;
  return constraint.index === index ||
    (table === tableName && constraint.fields?.length === fields.length && constraint.fields.every((field, i) => field === fields[i]));
}

function safeError(error: unknown): AlbumCreationError {
  if (error instanceof AlbumCreationError) return error;
  if (!(error instanceof DriveProviderError)) return new AlbumCreationError("unavailable");
  switch (error.code) {
    case "authentication": return new AlbumCreationError("drive-authentication");
    case "permission": return new AlbumCreationError("drive-permission");
    case "not-found": return new AlbumCreationError("drive-not-found");
    case "quota": return new AlbumCreationError("drive-quota");
    case "rate-limit": return new AlbumCreationError("drive-rate-limit");
    case "cancelled": return new AlbumCreationError("cancelled");
    case "invalid-request": return new AlbumCreationError("invalid-request");
    default: return new AlbumCreationError("drive-unavailable");
  }
}

/** Internal only. ADR-011/032 still gate HTTP/UI exposure and child-file access. */
export class AlbumCreationService {
  constructor(
    private readonly database: DatabaseClient,
    private readonly folderReaderForConnection: (
      connectionId: string, ownerId: string,
    ) => DriveFolderReader | Promise<DriveFolderReader>,
  ) {}

  /** ownerId must come from a trusted authenticated session, never request input. */
  async createDraft(ownerId: string, request: unknown, signal?: AbortSignal): Promise<CreatedDraftAlbum> {
    const input = creationSchema.safeParse(request);
    if (!resourceIdSchema.safeParse(ownerId).success || !input.success) {
      throw new AlbumCreationError("invalid-request");
    }
    try {
      checkCancellation(signal);
      const keyHash = digest(["draft-album-request:v1", ownerId, input.data.requestId]);
      const receiptWhere = { ownerId_keyHash: { ownerId, keyHash } };
      const completed = await this.database.albumCreationRequest.findUnique({ where: receiptWhere, select: receiptSelect });
      if (completed !== null) return await replayReceipt(completed, input.data, signal);
      checkCancellation(signal);
      const connection = await this.database.driveConnection.findFirst({
        where: { id: input.data.driveConnectionId, ownerId, status: DriveConnectionStatus.CONNECTED },
        select: { id: true, updatedAt: true },
      });
      if (connection === null) throw new AlbumCreationError("connection-not-found");
      checkCancellation(signal);
      const reader = await this.folderReaderForConnection(connection.id, ownerId);
      const folder = await reader.readAccessibleFolder(input.data.driveFolderId, signal);
      if (folder.folderId !== input.data.driveFolderId) throw new AlbumCreationError("drive-unavailable");
      checkCancellation(signal);
      const passwordHash = input.data.password == null ? null : await hashGalleryPassword(input.data.password);
      checkCancellation(signal);

      // Network/KDF work is finished before locking. Nested selection creation is atomic.
      for (let attempt = 1; attempt <= SLUG_ATTEMPTS; attempt++) {
        const publicSlug = generatePublicGallerySlug();
        try {
          const outcome = await this.database.$transaction(async (transaction) => {
            checkCancellation(signal);
            const rows = await transaction.$queryRaw<LockedConnection[]>`
              SELECT "id", "status", "updatedAt" FROM "DriveConnection"
              WHERE "id" = ${connection.id} AND "ownerId" = ${ownerId}
              FOR UPDATE
            `;
            const current = rows[0];
            // Recheck after serialization; password verification stays outside the lock.
            const receipt = await transaction.albumCreationRequest.findUnique({ where: receiptWhere, select: receiptSelect });
            if (receipt !== null) return { kind: "replay" as const, receipt };
            if (current === undefined || current.status !== DriveConnectionStatus.CONNECTED ||
              current.updatedAt.getTime() !== connection.updatedAt.getTime()) {
              throw new AlbumCreationError("connection-changed");
            }
            checkCancellation(signal);
            const album = await transaction.album.create({
              data: {
                ownerId,
                driveConnectionId: connection.id,
                driveFolderId: folder.folderId,
                title: input.data.title,
                publicSlug,
                status: AlbumStatus.DRAFT,
                passwordHash,
                selectionLimit: input.data.selectionLimit ?? null,
                selection: { create: { status: SelectionStatus.DRAFT } },
                creationRequest: { create: { keyHash, requestHash: requestDigest(input.data), passwordHash, publicSlug } },
              },
              select: { id: true, publicSlug: true },
            });
            return { kind: "created" as const, albumId: album.id, publicSlug: album.publicSlug, status: "DRAFT" as const };
          }, TRANSACTION_OPTIONS);
          if (outcome.kind === "replay") return await replayReceipt(outcome.receipt, input.data, signal);
          return { albumId: outcome.albumId, publicSlug: outcome.publicSlug, status: outcome.status };
        } catch (error) {
          if (isUniqueCollision(error, "AlbumCreationRequest_pkey", ["ownerId", "keyHash"], "AlbumCreationRequest")) {
            // Different connection locks can race; the losing nested create rolls back.
            const receipt = await this.database.albumCreationRequest.findUnique({ where: receiptWhere, select: receiptSelect });
            if (receipt === null) throw new AlbumCreationError("unavailable");
            return await replayReceipt(receipt, input.data, signal);
          }
          if (!isUniqueCollision(error, "Album_publicSlug_key", ["publicSlug"], "Album") || attempt === SLUG_ATTEMPTS) throw error;
          checkCancellation(signal);
        }
      }
      throw new AlbumCreationError("unavailable");
    } catch (error) {
      // Neither provider exceptions, Prisma diagnostics, passwords nor hashes escape.
      throw safeError(error);
    }
  }
}
