import {
  AlbumStatus,
  SelectionStatus,
  comparePhotosByNaturalName,
  type DatabaseClient,
  type Prisma,
} from "@photographer-platform/database";
import { z } from "zod";

type TransactionClient = Prisma.TransactionClient;

const commentSchema = z.string().max(2_000);
const MUTATION_TRANSACTION_OPTIONS = { maxWait: 10_000, timeout: 30_000 } as const;

interface LockedGalleryAlbum {
  id: string;
  status: (typeof AlbumStatus)[keyof typeof AlbumStatus];
  selectionLimit: number | null;
}

export type SelectionErrorCode =
  | "gallery-not-found"
  | "gallery-not-published"
  | "photo-not-found"
  | "not-editable"
  | "limit-reached"
  | "item-not-selected"
  | "empty-selection"
  | "invalid-comment"
  | "owner-not-found"
  | "not-submitted";

const errorMessages: Record<SelectionErrorCode, string> = {
  "gallery-not-found": "The gallery was not found.",
  "gallery-not-published": "This gallery is not open for selection.",
  "photo-not-found": "The photo is not available in this gallery.",
  "not-editable": "This selection can no longer be edited.",
  "limit-reached": "The gallery selection limit has been reached.",
  "item-not-selected": "Select this photo before adding a comment.",
  "empty-selection": "Select at least one photo before submitting.",
  "invalid-comment": "The comment is too long or invalid.",
  "owner-not-found": "The album was not found.",
  "not-submitted": "No submitted selection is available for export.",
};

export class SelectionError extends Error {
  constructor(readonly code: SelectionErrorCode) {
    super(errorMessages[code]);
    this.name = "SelectionError";
  }
}

export interface SelectionState {
  readonly status: (typeof SelectionStatus)[keyof typeof SelectionStatus];
  readonly selectedCount: number;
  readonly selectionLimit: number | null;
}

export interface SelectionReviewItem {
  readonly photoId: string;
  readonly fileName: string;
  readonly active: boolean;
  readonly comment: string | null;
}

export interface SelectionReview {
  readonly status: (typeof SelectionStatus)[keyof typeof SelectionStatus];
  readonly submittedAt: Date | null;
  readonly selectedCount: number;
  readonly items: readonly SelectionReviewItem[];
}

export interface SelectionLifecycleState {
  readonly status: (typeof SelectionStatus)[keyof typeof SelectionStatus];
  readonly submittedAt: Date | null;
  readonly lockedAt: Date | null;
}

export interface GuestSelectionState extends SelectionState {
  readonly selectedItems: { photoId: string; comment: string | null }[];
}

async function lockGalleryAlbum(
  transaction: TransactionClient,
  albumId: string,
): Promise<LockedGalleryAlbum> {
  const rows = await transaction.$queryRaw<LockedGalleryAlbum[]>`
    SELECT "id", "status", "selectionLimit"
    FROM "Album"
    WHERE "id" = ${albumId}
    FOR UPDATE
  `;
  const album = rows[0];
  if (album === undefined) throw new SelectionError("gallery-not-found");
  if (album.status !== AlbumStatus.PUBLISHED) {
    throw new SelectionError("gallery-not-published");
  }
  return album;
}

async function lockOwnerAlbum(
  transaction: TransactionClient,
  ownerId: string,
  albumId: string,
): Promise<void> {
  const rows = await transaction.$queryRaw<Pick<LockedGalleryAlbum, "id" | "status">[]>`
    SELECT "id", "status"
    FROM "Album"
    WHERE "id" = ${albumId} AND "ownerId" = ${ownerId}
    FOR UPDATE
  `;
  const album = rows[0];
  if (album === undefined) throw new SelectionError("owner-not-found");
  if (album.status !== AlbumStatus.PUBLISHED) throw new SelectionError("not-editable");
}

async function findSelection(transaction: TransactionClient, albumId: string) {
  return transaction.selection.findUnique({ where: { albumId } });
}

async function getOrCreateDraftSelection(transaction: TransactionClient, albumId: string) {
  const selection = await findSelection(transaction, albumId);
  if (selection !== null) {
    if (selection.status !== SelectionStatus.DRAFT) throw new SelectionError("not-editable");
    return selection;
  }
  return transaction.selection.create({ data: { albumId, status: SelectionStatus.DRAFT } });
}

function assertDraft(status: (typeof SelectionStatus)[keyof typeof SelectionStatus]): void {
  if (status !== SelectionStatus.DRAFT) throw new SelectionError("not-editable");
}

function escapeFilenameForLine(fileName: string): string {
  return fileName
    .replaceAll("\\", "\\\\")
    .replaceAll("\r", "\\r")
    .replaceAll("\n", "\\n")
    .replaceAll("\u2028", "\\u2028")
    .replaceAll("\u2029", "\\u2029");
}

async function loadSelectedItems(transaction: TransactionClient, selectionId: string) {
  const items = await transaction.selectionItem.findMany({
    where: { selectionId },
    select: {
      photoId: true,
      comment: true,
      photo: { select: { fileName: true, driveFileId: true, active: true } },
    },
  });
  return items.sort((left, right) => comparePhotosByNaturalName(left.photo, right.photo));
}

export class SelectionService {
  constructor(private readonly database: DatabaseClient) {}

  async stateForGuest(albumId: string, selectionLimit: number | null, photoIds: readonly string[]): Promise<GuestSelectionState> {
    return this.database.$transaction(async (transaction) => {
      const selection = await findSelection(transaction, albumId);
      if (selection === null) {
        return { status: SelectionStatus.DRAFT, selectedCount: 0, selectionLimit, selectedItems: [] };
      }
      const [selectedCount, items] = await Promise.all([
        transaction.selectionItem.count({ where: { selectionId: selection.id } }),
        transaction.selectionItem.findMany({
          where: { selectionId: selection.id, photoId: { in: [...photoIds] } },
          select: { photoId: true, comment: true },
        }),
      ]);
      const positions = new Map(photoIds.map((id, index) => [id, index]));
      return {
        status: selection.status,
        selectedCount,
        selectionLimit,
        selectedItems: items.sort((left, right) =>
          (positions.get(left.photoId) ?? 0) - (positions.get(right.photoId) ?? 0)),
      };
    }, { isolationLevel: "RepeatableRead" });
  }

  // These guest-facing methods are internal until a gallery access session and
  // mutation rate limiting are enforced by the future API boundary.
  async selectPhoto(albumId: string, photoId: string): Promise<SelectionState> {
    return this.database.$transaction(async (transaction) => {
      const album = await lockGalleryAlbum(transaction, albumId);
      const photo = await transaction.photo.findFirst({
        where: { id: photoId, albumId, active: true },
        select: { id: true },
      });
      if (photo === null) throw new SelectionError("photo-not-found");

      const selection = await getOrCreateDraftSelection(transaction, albumId);
      const existing = await transaction.selectionItem.findUnique({
        where: { selectionId_photoId: { selectionId: selection.id, photoId } },
        select: { id: true },
      });
      const currentCount = await transaction.selectionItem.count({
        where: { selectionId: selection.id },
      });
      if (existing !== null) {
        return {
          status: SelectionStatus.DRAFT,
          selectedCount: currentCount,
          selectionLimit: album.selectionLimit,
        };
      }
      if (album.selectionLimit !== null && currentCount >= album.selectionLimit) {
        throw new SelectionError("limit-reached");
      }
      await transaction.selectionItem.create({
        data: { selectionId: selection.id, photoId, albumId },
      });
      await transaction.selection.update({ where: { id: selection.id }, data: { revision: { increment: 1 } } });
      return {
        status: SelectionStatus.DRAFT,
        selectedCount: currentCount + 1,
        selectionLimit: album.selectionLimit,
      };
    }, MUTATION_TRANSACTION_OPTIONS);
  }

  async deselectPhoto(albumId: string, photoId: string): Promise<SelectionState> {
    return this.database.$transaction(async (transaction) => {
      const album = await lockGalleryAlbum(transaction, albumId);
      const selection = await findSelection(transaction, albumId);
      if (selection === null) {
        return { status: SelectionStatus.DRAFT, selectedCount: 0, selectionLimit: album.selectionLimit };
      }
      assertDraft(selection.status);
      const deleted = await transaction.selectionItem.deleteMany({
        where: { selectionId: selection.id, photoId, albumId },
      });
      if (deleted.count > 0) {
        await transaction.selection.update({ where: { id: selection.id }, data: { revision: { increment: 1 } } });
      }
      const selectedCount = await transaction.selectionItem.count({
        where: { selectionId: selection.id },
      });
      return { status: SelectionStatus.DRAFT, selectedCount, selectionLimit: album.selectionLimit };
    }, MUTATION_TRANSACTION_OPTIONS);
  }

  async setComment(albumId: string, photoId: string, comment: string): Promise<string | null> {
    const parsed = commentSchema.safeParse(comment);
    if (!parsed.success) throw new SelectionError("invalid-comment");
    const normalized = parsed.data.trim() === "" ? null : parsed.data;

    return this.database.$transaction(async (transaction) => {
      await lockGalleryAlbum(transaction, albumId);
      const selection = await findSelection(transaction, albumId);
      if (selection === null) throw new SelectionError("item-not-selected");
      assertDraft(selection.status);
      const result = await transaction.selectionItem.updateMany({
        where: { selectionId: selection.id, photoId, albumId },
        data: { comment: normalized },
      });
      if (result.count === 0) throw new SelectionError("item-not-selected");
      await transaction.selection.update({ where: { id: selection.id }, data: { revision: { increment: 1 } } });
      return normalized;
    }, MUTATION_TRANSACTION_OPTIONS);
  }

  async submit(albumId: string, now = new Date()): Promise<SelectionState> {
    return this.database.$transaction(async (transaction) => {
      const album = await lockGalleryAlbum(transaction, albumId);
      const selection = await findSelection(transaction, albumId);
      if (selection === null) throw new SelectionError("empty-selection");
      if (selection.status === SelectionStatus.LOCKED) throw new SelectionError("not-editable");
      const selectedCount = await transaction.selectionItem.count({
        where: { selectionId: selection.id },
      });
      if (selection.status === SelectionStatus.SUBMITTED) {
        return { status: SelectionStatus.SUBMITTED, selectedCount, selectionLimit: album.selectionLimit };
      }
      if (selectedCount === 0) throw new SelectionError("empty-selection");
      await transaction.selection.update({
        where: { id: selection.id },
        data: { status: SelectionStatus.SUBMITTED, submittedAt: now, revision: { increment: 1 } },
      });
      return { status: SelectionStatus.SUBMITTED, selectedCount, selectionLimit: album.selectionLimit };
    }, MUTATION_TRANSACTION_OPTIONS);
  }

  async reviewForOwner(ownerId: string, albumId: string): Promise<SelectionReview> {
    return this.database.$transaction(
      async (transaction) => {
        const album = await transaction.album.findFirst({
          where: { id: albumId, ownerId },
          select: { id: true },
        });
        if (album === null) throw new SelectionError("owner-not-found");
        const selection = await findSelection(transaction, albumId);
        if (selection === null) {
          return { status: SelectionStatus.DRAFT, submittedAt: null, selectedCount: 0, items: [] };
        }
        const items = await loadSelectedItems(transaction, selection.id);
        return {
          status: selection.status,
          submittedAt: selection.submittedAt,
          selectedCount: items.length,
          items: items.map((item) => ({
            photoId: item.photoId,
            fileName: item.photo.fileName,
            active: item.photo.active,
            comment: item.comment,
          })),
        };
      },
      { isolationLevel: "RepeatableRead" },
    );
  }

  async lockForOwner(ownerId: string, albumId: string, now = new Date()): Promise<SelectionLifecycleState> {
    return this.database.$transaction(async (transaction) => {
      await lockOwnerAlbum(transaction, ownerId, albumId);
      const selection = await findSelection(transaction, albumId);
      if (selection === null || selection.submittedAt === null || selection.status === SelectionStatus.DRAFT) {
        throw new SelectionError("not-submitted");
      }
      if (selection.status === SelectionStatus.LOCKED) {
        return { status: SelectionStatus.LOCKED, submittedAt: selection.submittedAt, lockedAt: selection.lockedAt };
      }
      const locked = await transaction.selection.update({
        where: { id: selection.id },
        data: { status: SelectionStatus.LOCKED, lockedAt: now, revision: { increment: 1 } },
      });
      return { status: locked.status, submittedAt: locked.submittedAt, lockedAt: locked.lockedAt };
    }, MUTATION_TRANSACTION_OPTIONS);
  }

  async reopenForOwner(ownerId: string, albumId: string): Promise<SelectionLifecycleState> {
    return this.database.$transaction(async (transaction) => {
      await lockOwnerAlbum(transaction, ownerId, albumId);
      const selection = await findSelection(transaction, albumId);
      if (selection === null || selection.status === SelectionStatus.DRAFT || selection.submittedAt === null) {
        throw new SelectionError("not-submitted");
      }
      const reopened = await transaction.selection.update({
        where: { id: selection.id },
        data: { status: SelectionStatus.DRAFT, submittedAt: null, lockedAt: null, revision: { increment: 1 } },
      });
      return { status: reopened.status, submittedAt: reopened.submittedAt, lockedAt: reopened.lockedAt };
    }, MUTATION_TRANSACTION_OPTIONS);
  }

  async exportSubmittedForOwner(ownerId: string, albumId: string): Promise<string> {
    return this.database.$transaction(
      async (transaction) => {
        const album = await transaction.album.findFirst({
          where: { id: albumId, ownerId },
          select: { id: true },
        });
        if (album === null) throw new SelectionError("owner-not-found");
        const selection = await findSelection(transaction, albumId);
        if (selection === null || selection.submittedAt === null ||
          (selection.status !== SelectionStatus.SUBMITTED && selection.status !== SelectionStatus.LOCKED)) {
          throw new SelectionError("not-submitted");
        }
        const items = await transaction.selectionItem.findMany({
          where: { selectionId: selection.id },
          select: { photo: { select: { fileName: true, driveFileId: true } } },
        });
        items.sort((left, right) => comparePhotosByNaturalName(left.photo, right.photo));
        return items.length === 0
          ? ""
          : items.map((item) => escapeFilenameForLine(item.photo.fileName)).join("\n") + "\n";
      },
      { isolationLevel: "RepeatableRead" },
    );
  }
}
