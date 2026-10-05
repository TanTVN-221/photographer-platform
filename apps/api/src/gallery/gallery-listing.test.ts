import {
  AlbumStatus,
  PreviewStatus,
  type DatabaseClient,
} from "@photographer-platform/database";
import { describe, expect, it, vi } from "vitest";

import { GalleryCursorCodec, InvalidGalleryCursorError } from "./gallery-cursor.js";
import { GalleryListingService } from "./gallery-listing.js";
import { ApiDerivativeImageUrlProvider, type ImageUrlProvider } from "./image-url-provider.js";
import { GallerySessionCodec } from "./gallery-session.js";

const SLUG = "abcdefghijklmnopqrstuvwx";

interface TestPhoto {
  id: string;
  albumId: string;
  active: boolean;
  sortOrder: number;
  fileName: string;
  width: number;
  height: number;
  previewStatus: (typeof PreviewStatus)[keyof typeof PreviewStatus];
  sourceRevision: string | null;
  previewRevision: string | null;
  driveFileId: string;
}

interface PhotoQuery {
  where: {
    albumId: string;
    active: boolean;
    OR?: [
      { sortOrder: { gt: number } },
      { sortOrder: number; id: { gt: string } },
    ];
  };
  take: number;
  select: Record<string, boolean>;
  orderBy: readonly unknown[];
}

function fixture(count: number, imageUrls?: ImageUrlProvider, sessions?: GallerySessionCodec) {
  const album = {
    id: "album-1",
    publicSlug: SLUG,
    title: "Client gallery",
    status: AlbumStatus.PUBLISHED as (typeof AlbumStatus)[keyof typeof AlbumStatus],
    passwordHash: null as string | null,
    selectionLimit: 25,
    catalogVersion: 1,
    ownerId: "private-owner-id",
  };
  const photos: TestPhoto[] = Array.from({ length: count }, (_, index) => ({
    id: `photo-${String(index).padStart(5, "0")}`,
    albumId: album.id,
    active: true,
    sortOrder: index,
    fileName: `IMG_${index + 1}.jpg`,
    width: 3000,
    height: 2000,
    previewStatus: PreviewStatus.PENDING,
    sourceRevision: "version:1",
    previewRevision: null,
    driveFileId: `private-drive-${index}`,
  }));
  const transaction = {
    album: {
      findUnique: vi.fn(async ({ where }: { where: { publicSlug: string } }) =>
        where.publicSlug === album.publicSlug ? album : null,
      ),
    },
    photo: {
      findMany: vi.fn(async (untypedQuery: unknown) => {
        const query = untypedQuery as PhotoQuery;
        const position = query.where.OR;
        return photos
          .filter((photo) => photo.albumId === query.where.albumId && photo.active)
          .filter(
            (photo) =>
              position === undefined ||
              photo.sortOrder > position[0].sortOrder.gt ||
              (photo.sortOrder === position[1].sortOrder && photo.id > position[1].id.gt),
          )
          .sort((left, right) => left.sortOrder - right.sortOrder || left.id.localeCompare(right.id))
          .slice(0, query.take);
      }),
    },
  };
  const database = {
    $transaction: async <T>(callback: (tx: typeof transaction) => Promise<T>): Promise<T> =>
      callback(transaction),
  } as unknown as DatabaseClient;
  const service = new GalleryListingService(
    database,
    new GalleryCursorCodec(Buffer.alloc(32, 9), () => Date.UTC(2026, 8, 29)),
    imageUrls,
    sessions,
  );
  return { service, album, photos, transaction };
}

describe("GalleryListingService (DRIVE-006/013, PERF-001/005, GAL-002/007)", () => {
  it("continues through 5,000 active photos without offsets or duplicate rows", async () => {
    const { service, photos, transaction } = fixture(5_000);
    photos.push({
      id: "removed-photo",
      albumId: "album-1",
      active: false,
      sortOrder: 5000,
      fileName: "removed.jpg",
      width: 100,
      height: 100,
      previewStatus: PreviewStatus.PENDING,
      sourceRevision: "version:1",
      previewRevision: null,
      driveFileId: "private-removed-drive-id",
    });
    const received: string[] = [];
    let cursor: string | null = null;
    let pageCount = 0;
    do {
      const page = await service.listPasswordless({
        slug: SLUG,
        limit: 100,
        ...(cursor === null ? {} : { cursor }),
      });
      pageCount += 1;
      expect(page.photos.length).toBeLessThanOrEqual(100);
      expect(page.photos.every((photo) =>
        Object.keys(photo).sort().join(",") === "fileName,height,images,photoId,previewStatus,width"
      )).toBe(true);
      received.push(...page.photos.map((photo) => photo.photoId));
      cursor = page.nextCursor;
    } while (cursor !== null);

    expect(pageCount).toBe(50);
    expect(received).toHaveLength(5_000);
    expect(new Set(received).size).toBe(5_000);
    expect(received[0]).toBe("photo-00000");
    expect(received.at(-1)).toBe("photo-04999");
    expect(received).not.toContain("removed-photo");
    expect(transaction.photo.findMany).toHaveBeenCalledTimes(50);
    for (const call of transaction.photo.findMany.mock.calls) {
      const query = call[0] as PhotoQuery;
      expect(query.take).toBe(101);
      expect(query.orderBy).toEqual([{ sortOrder: "asc" }, { id: "asc" }]);
      expect(query.select.driveFileId).toBeUndefined();
      expect(query.select.sortOrder).toBe(true);
      expect(query.where.active).toBe(true);
      expect("skip" in query).toBe(false);
    }
  });

  it("rejects stale, tampered, and cross-gallery cursors", async () => {
    const { service, album } = fixture(3);
    const first = await service.listPasswordless({ slug: SLUG, limit: 1 });
    const token = first.nextCursor!;
    album.catalogVersion += 1;
    await expect(service.listPasswordless({ slug: SLUG, limit: 1, cursor: token })).rejects.toMatchObject({
      code: "stale-cursor",
    });
    album.catalogVersion -= 1;
    const altered = `${token.slice(0, 12)}${token[12] === "A" ? "B" : "A"}${token.slice(13)}`;
    await expect(service.listPasswordless({ slug: SLUG, limit: 1, cursor: altered })).rejects.toBeInstanceOf(
      InvalidGalleryCursorError,
    );
    album.id = "another-album";
    await expect(service.listPasswordless({ slug: SLUG, limit: 1, cursor: token })).rejects.toBeInstanceOf(
      InvalidGalleryCursorError,
    );
  });

  it("uses photo ID as a stable tie-breaker when ordinals match", async () => {
    const { service, photos } = fixture(2);
    photos[1]!.sortOrder = photos[0]!.sortOrder;

    const first = await service.listPasswordless({ slug: SLUG, limit: 1 });
    const second = await service.listPasswordless({ slug: SLUG, limit: 1, cursor: first.nextCursor! });
    expect(first.photos.map((photo) => photo.photoId)).toEqual(["photo-00000"]);
    expect(second.photos.map((photo) => photo.photoId)).toEqual(["photo-00001"]);
    expect(second.nextCursor).toBeNull();
  });

  it("never queries photos for protected or unpublished albums", async () => {
    const { service, album, transaction } = fixture(2);
    album.passwordHash = "hashed-password-only";
    await expect(service.listPasswordless({ slug: SLUG })).rejects.toMatchObject({ code: "password-required" });
    album.passwordHash = null;
    album.status = AlbumStatus.DRAFT;
    await expect(service.listPasswordless({ slug: SLUG })).rejects.toMatchObject({ code: "not-found" });
    expect(transaction.photo.findMany).not.toHaveBeenCalled();
  });

  it("lists a protected gallery only with a current password-bound session", async () => {
    const sessions = new GallerySessionCodec(Buffer.alloc(32, 7), () => 1_000_000);
    const { service, album, transaction } = fixture(2, undefined, sessions);
    album.passwordHash = "scrypt$v1$first";
    const token = sessions.issue({ id: album.id, slug: SLUG, passwordHash: album.passwordHash });
    await expect(service.listWithSession({ slug: SLUG }, null)).rejects.toMatchObject({ code: "password-required" });
    expect(transaction.photo.findMany).not.toHaveBeenCalled();
    const page = await service.listWithSession({ slug: SLUG }, token);
    expect(page.photos).toHaveLength(2);
    album.passwordHash = "scrypt$v1$changed";
    await expect(service.listWithSession({ slug: SLUG }, token)).rejects.toMatchObject({ code: "password-required" });
    expect(transaction.photo.findMany).toHaveBeenCalledTimes(1);
  });

  it("adds application image descriptors only for a current READY revision", async () => {
    const { service, photos } = fixture(3, new ApiDerivativeImageUrlProvider());
    photos[0]!.previewStatus = PreviewStatus.READY;
    photos[0]!.previewRevision = "version:1";
    photos[1]!.previewStatus = PreviewStatus.READY;
    photos[1]!.previewRevision = "version:old";

    const page = await service.listPasswordless({ slug: SLUG });
    expect(page.photos[0]?.images?.thumbnail.src).toMatch(/^\/api\/v1\/galleries\/.+\/thumbnail\/[A-Za-z0-9_-]{24}\.webp$/);
    expect(page.photos[1]?.images).toBeNull();
    expect(page.photos[2]?.images).toBeNull();
  });

  it("rejects invalid bounds before a database read and returns a narrow empty page", async () => {
    const { service, transaction } = fixture(0);
    await expect(service.listPasswordless({ slug: "short" })).rejects.toMatchObject({ code: "invalid-request" });
    await expect(service.listPasswordless({ slug: SLUG, limit: 101 })).rejects.toMatchObject({ code: "invalid-request" });
    await expect(service.listPasswordless({ slug: SLUG, limit: 0 })).rejects.toMatchObject({ code: "invalid-request" });
    expect(transaction.album.findUnique).not.toHaveBeenCalled();
    await expect(service.listPasswordless({ slug: SLUG })).resolves.toEqual({
      title: "Client gallery",
      selectionLimit: 25,
      photos: [],
      nextCursor: null,
    });
  });
});
