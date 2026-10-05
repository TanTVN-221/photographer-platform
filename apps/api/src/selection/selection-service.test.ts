import {
  AlbumStatus,
  SelectionStatus,
  type DatabaseClient,
} from "@photographer-platform/database";
import { describe, expect, it, vi } from "vitest";

import { SelectionService } from "./selection-service.js";

interface TestPhoto {
  id: string;
  albumId: string;
  active: boolean;
  fileName: string;
  driveFileId: string;
}

interface TestItem {
  photoId: string;
  selectionId: string;
  albumId: string;
  comment: string | null;
}

function fixture(selectionLimit: number | null = 2) {
  const album = {
    id: "album-1",
    ownerId: "owner-1",
    status: AlbumStatus.PUBLISHED as (typeof AlbumStatus)[keyof typeof AlbumStatus],
    selectionLimit,
  };
  const photos = new Map<string, TestPhoto>([
    ["photo-1", { id: "photo-1", albumId: "album-1", active: true, fileName: "IMG_10.jpg", driveFileId: "drive-10" }],
    ["photo-2", { id: "photo-2", albumId: "album-1", active: true, fileName: "IMG_2.jpg", driveFileId: "drive-2" }],
    ["photo-3", { id: "photo-3", albumId: "album-1", active: true, fileName: "IMG_3.jpg", driveFileId: "drive-3" }],
  ]);
  const items = new Map<string, TestItem>();
  let selection: {
    id: string;
    albumId: string;
    status: (typeof SelectionStatus)[keyof typeof SelectionStatus];
    submittedAt: Date | null;
    lockedAt: Date | null;
    revision: number;
  } | null = null;

  const transaction = {
    $queryRaw: vi.fn(async (_strings: TemplateStringsArray, queriedAlbumId: string, queriedOwnerId?: string) =>
      queriedAlbumId === album.id && (queriedOwnerId === undefined || queriedOwnerId === album.ownerId)
        ? [{ id: album.id, status: album.status, selectionLimit: album.selectionLimit }]
        : [],
    ),
    album: {
      findFirst: vi.fn(async ({ where }: { where: { id: string; ownerId: string } }) =>
        where.id === album.id && where.ownerId === album.ownerId ? { id: album.id } : null,
      ),
    },
    photo: {
      findFirst: vi.fn(async ({ where }: { where: { id: string; albumId: string; active: boolean } }) => {
        const photo = photos.get(where.id);
        return photo?.albumId === where.albumId && photo.active === where.active
          ? { id: photo.id }
          : null;
      }),
    },
    selection: {
      findUnique: vi.fn(async () => selection),
      create: vi.fn(async () => {
        selection = {
          id: "selection-1",
          albumId: album.id,
          status: SelectionStatus.DRAFT,
          submittedAt: null,
          lockedAt: null,
          revision: 0,
        };
        return selection;
      }),
      update: vi.fn(async ({ data }: { data: {
        status?: (typeof SelectionStatus)[keyof typeof SelectionStatus];
        revision?: { increment: number };
        submittedAt?: Date | null;
        lockedAt?: Date | null;
      } }) => {
        if (selection === null) throw new Error("Test selection was not created.");
        if (data.status !== undefined) selection.status = data.status;
        if (data.revision !== undefined) selection.revision += data.revision.increment;
        if (data.submittedAt !== undefined) selection.submittedAt = data.submittedAt;
        if (data.lockedAt !== undefined) selection.lockedAt = data.lockedAt;
        return selection;
      }),
    },
    selectionItem: {
      findUnique: vi.fn(async ({ where }: { where: { selectionId_photoId: { photoId: string } } }) =>
        items.has(where.selectionId_photoId.photoId) ? { id: "item" } : null,
      ),
      count: vi.fn(async () => items.size),
      create: vi.fn(async ({ data }: { data: Omit<TestItem, "comment"> }) => {
        const item = { ...data, comment: null };
        items.set(data.photoId, item);
        return item;
      }),
      deleteMany: vi.fn(async ({ where }: { where: { photoId: string } }) => ({
        count: items.delete(where.photoId) ? 1 : 0,
      })),
      updateMany: vi.fn(async ({ where, data }: { where: { photoId: string }; data: { comment: string | null } }) => {
        const item = items.get(where.photoId);
        if (item === undefined) return { count: 0 };
        item.comment = data.comment;
        return { count: 1 };
      }),
      findMany: vi.fn(async (query?: { where?: { photoId?: { in: string[] } }; select?: { photo?: boolean } }) =>
        [...items.values()]
          .filter((item) => query?.where?.photoId === undefined || query.where.photoId.in.includes(item.photoId))
          .map((item) => query?.select?.photo
            ? { photoId: item.photoId, comment: item.comment, photo: photos.get(item.photoId)! }
            : { photoId: item.photoId, comment: item.comment }),
      ),
    },
  };
  const database = {
    $transaction: async <T>(callback: (tx: typeof transaction) => Promise<T>): Promise<T> =>
      callback(transaction),
  } as unknown as DatabaseClient;

  return {
    service: new SelectionService(database),
    album,
    photos,
    items,
    transaction,
    getSelection: () => selection,
    setSelectionStatus: (status: (typeof SelectionStatus)[keyof typeof SelectionStatus]) => {
      if (selection === null) throw new Error("Test selection was not created.");
      selection.status = status;
    },
  };
}

describe("SelectionService (SEL-004–008, SEL-010, EXP-001–003)", () => {
  it("returns only selected items from the requested page plus the total count", async () => {
    const { service, transaction } = fixture(3);
    await service.selectPhoto("album-1", "photo-1");
    await service.selectPhoto("album-1", "photo-2");
    await service.setComment("album-1", "photo-2", "Retouch this");
    expect(await service.stateForGuest("album-1", 3, ["photo-3", "photo-2"])).toEqual({
      status: SelectionStatus.DRAFT,
      selectedCount: 2,
      selectionLimit: 3,
      selectedItems: [{ photoId: "photo-2", comment: "Retouch this" }],
    });
    expect(transaction.selectionItem.findMany).toHaveBeenCalledWith({
      where: { selectionId: "selection-1", photoId: { in: ["photo-3", "photo-2"] } },
      select: { photoId: true, comment: true },
    });
  });

  it("selects idempotently, enforces a limit, and allows deselection at the limit", async () => {
    const { service, items, transaction } = fixture(1);

    await expect(service.selectPhoto("album-1", "photo-1")).resolves.toMatchObject({ selectedCount: 1 });
    await expect(service.selectPhoto("album-1", "photo-1")).resolves.toMatchObject({ selectedCount: 1 });
    await expect(service.selectPhoto("album-1", "photo-2")).rejects.toMatchObject({ code: "limit-reached" });
    expect(items.size).toBe(1);
    await expect(service.deselectPhoto("album-1", "photo-1")).resolves.toMatchObject({ selectedCount: 0 });
    await expect(service.selectPhoto("album-1", "photo-2")).resolves.toMatchObject({ selectedCount: 1 });
    expect(transaction.$queryRaw).toHaveBeenCalledTimes(5);
  });

  it("rejects inactive or cross-album photos and unpublished galleries", async () => {
    const { service, album, photos } = fixture();
    photos.get("photo-1")!.active = false;
    await expect(service.selectPhoto("album-1", "photo-1")).rejects.toMatchObject({ code: "photo-not-found" });
    photos.get("photo-2")!.albumId = "another-album";
    await expect(service.selectPhoto("album-1", "photo-2")).rejects.toMatchObject({ code: "photo-not-found" });
    album.status = AlbumStatus.ARCHIVED;
    await expect(service.selectPhoto("album-1", "photo-3")).rejects.toMatchObject({ code: "gallery-not-published" });
  });

  it("edits comments only on selected photos and submits exactly once", async () => {
    const { service, getSelection, transaction } = fixture();
    await expect(service.submit("album-1")).rejects.toMatchObject({ code: "empty-selection" });
    await expect(service.setComment("album-1", "photo-1", "hello")).rejects.toMatchObject({ code: "item-not-selected" });
    await service.selectPhoto("album-1", "photo-1");
    await expect(service.setComment("album-1", "photo-1", "Looks great")).resolves.toBe("Looks great");
    await expect(service.setComment("album-1", "photo-1", " ")).resolves.toBeNull();
    await expect(service.setComment("album-1", "photo-1", "x".repeat(2_001))).rejects.toMatchObject({ code: "invalid-comment" });

    const submittedAt = new Date("2026-09-29T01:00:00Z");
    transaction.selection.update.mockClear();
    await expect(service.submit("album-1", submittedAt)).resolves.toMatchObject({
      status: SelectionStatus.SUBMITTED,
      selectedCount: 1,
    });
    await expect(service.submit("album-1", new Date("2026-09-29T02:00:00Z"))).resolves.toMatchObject({
      status: SelectionStatus.SUBMITTED,
    });
    expect(transaction.selection.update).toHaveBeenCalledTimes(1);
    expect(getSelection()?.submittedAt).toEqual(submittedAt);
    await expect(service.deselectPhoto("album-1", "photo-1")).rejects.toMatchObject({ code: "not-editable" });
    await expect(service.setComment("album-1", "photo-1", "late")).rejects.toMatchObject({ code: "not-editable" });
  });

  it("rejects edits and submit when the selection is locked", async () => {
    const { service, setSelectionStatus } = fixture();
    await service.selectPhoto("album-1", "photo-1");
    setSelectionStatus(SelectionStatus.LOCKED);
    await expect(service.selectPhoto("album-1", "photo-2")).rejects.toMatchObject({ code: "not-editable" });
    await expect(service.submit("album-1")).rejects.toMatchObject({ code: "not-editable" });
  });

  it("owner review and export use the explicit submitted selection in natural order", async () => {
    const { service } = fixture();
    await service.selectPhoto("album-1", "photo-1");
    await service.selectPhoto("album-1", "photo-2");
    await service.setComment("album-1", "photo-2", "Favorite");
    await expect(service.exportSubmittedForOwner("owner-1", "album-1")).rejects.toMatchObject({ code: "not-submitted" });
    await service.submit("album-1");

    await expect(service.reviewForOwner("owner-1", "album-1")).resolves.toMatchObject({
      status: SelectionStatus.SUBMITTED,
      selectedCount: 2,
      items: [
        { fileName: "IMG_2.jpg", comment: "Favorite" },
        { fileName: "IMG_10.jpg", comment: null },
      ],
    });
    await expect(service.exportSubmittedForOwner("owner-1", "album-1")).resolves.toBe(
      "IMG_2.jpg\nIMG_10.jpg\n",
    );
    await expect(service.reviewForOwner("wrong-owner", "album-1")).rejects.toMatchObject({ code: "owner-not-found" });
    await expect(service.exportSubmittedForOwner("wrong-owner", "album-1")).rejects.toMatchObject({ code: "owner-not-found" });
  });

  it("escapes line breaks and backslashes so export keeps one photo per line", async () => {
    const { service, photos } = fixture();
    photos.get("photo-2")!.fileName = "A\\B\nC.jpg";
    await service.selectPhoto("album-1", "photo-2");
    await service.submit("album-1");
    await expect(service.exportSubmittedForOwner("owner-1", "album-1")).resolves.toBe(
      "A\\\\B\\nC.jpg\n",
    );
  });

  it("keeps a selected photo in owner review and export after Drive soft-removal", async () => {
    const { service, photos } = fixture();
    await service.selectPhoto("album-1", "photo-1");
    photos.get("photo-1")!.active = false;
    await service.submit("album-1");

    await expect(service.reviewForOwner("owner-1", "album-1")).resolves.toMatchObject({
      items: [{ fileName: "IMG_10.jpg", active: false }],
    });
    await expect(service.exportSubmittedForOwner("owner-1", "album-1")).resolves.toBe(
      "IMG_10.jpg\n",
    );
  });

  it("allows only the owner to lock an explicit submission, keeps locked export, and reopens for edits", async () => {
    const { service, transaction } = fixture();
    await service.selectPhoto("album-1", "photo-1");
    await expect(service.lockForOwner("owner-1", "album-1")).rejects.toMatchObject({ code: "not-submitted" });
    const submittedAt = new Date("2026-09-29T01:00:00Z");
    await service.submit("album-1", submittedAt);
    const lockedAt = new Date("2026-09-29T02:00:00Z");
    await expect(service.lockForOwner("wrong-owner", "album-1", lockedAt)).rejects.toMatchObject({ code: "owner-not-found" });
    await expect(service.lockForOwner("owner-1", "album-1", lockedAt)).resolves.toEqual({
      status: SelectionStatus.LOCKED, submittedAt, lockedAt,
    });
    const ownerLockQuery = transaction.$queryRaw.mock.calls.find((call) => call[2] === "owner-1");
    expect(ownerLockQuery?.[0].join(" ")).toContain("FOR UPDATE");
    expect(ownerLockQuery?.slice(1)).toEqual(["album-1", "owner-1"]);
    await expect(service.lockForOwner("owner-1", "album-1", new Date("2026-09-29T03:00:00Z"))).resolves.toEqual({
      status: SelectionStatus.LOCKED, submittedAt, lockedAt,
    });
    expect(transaction.selection.update).toHaveBeenCalledTimes(3);
    await expect(service.exportSubmittedForOwner("owner-1", "album-1")).resolves.toBe("IMG_10.jpg\n");
    await expect(service.selectPhoto("album-1", "photo-2")).rejects.toMatchObject({ code: "not-editable" });
    await expect(service.reopenForOwner("wrong-owner", "album-1")).rejects.toMatchObject({ code: "owner-not-found" });
    await expect(service.reopenForOwner("owner-1", "album-1")).resolves.toEqual({
      status: SelectionStatus.DRAFT, submittedAt: null, lockedAt: null,
    });
    await expect(service.exportSubmittedForOwner("owner-1", "album-1")).rejects.toMatchObject({ code: "not-submitted" });
    await expect(service.selectPhoto("album-1", "photo-2")).resolves.toMatchObject({ selectedCount: 2 });
  });

  it("does not reopen an unsubmitted selection or mutate an archived album", async () => {
    const { service, album, transaction } = fixture();
    await expect(service.reopenForOwner("owner-1", "album-1")).rejects.toMatchObject({ code: "not-submitted" });
    await service.selectPhoto("album-1", "photo-1");
    await expect(service.reopenForOwner("owner-1", "album-1")).rejects.toMatchObject({ code: "not-submitted" });
    await service.submit("album-1");
    album.status = AlbumStatus.ARCHIVED;
    await expect(service.lockForOwner("owner-1", "album-1")).rejects.toMatchObject({ code: "not-editable" });
    await expect(service.reopenForOwner("owner-1", "album-1")).rejects.toMatchObject({ code: "not-editable" });
    expect(transaction.selection.update).toHaveBeenCalledTimes(2);
  });
  it("increments review revision atomically for mutations but not idempotent toggles/submission (SEL-010)", async () => {
    const { service, getSelection } = fixture();
    await service.selectPhoto("album-1", "photo-1");
    expect(getSelection()?.revision).toBe(1);
    await service.selectPhoto("album-1", "photo-1");
    await service.deselectPhoto("album-1", "unselected");
    expect(getSelection()?.revision).toBe(1);
    await service.setComment("album-1", "photo-1", "first");
    await service.setComment("album-1", "photo-1", "second");
    expect(getSelection()?.revision).toBe(3);
    await service.submit("album-1");
    await service.submit("album-1");
    expect(getSelection()?.revision).toBe(4);
    await service.lockForOwner("owner-1", "album-1");
    await service.lockForOwner("owner-1", "album-1");
    expect(getSelection()?.revision).toBe(5);
    await service.reopenForOwner("owner-1", "album-1");
    await service.deselectPhoto("album-1", "photo-1");
    expect(getSelection()?.revision).toBe(7);
  });
});
