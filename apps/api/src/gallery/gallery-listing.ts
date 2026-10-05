import { AlbumStatus, PreviewStatus, type DatabaseClient } from "@photographer-platform/database";
import {
  galleryCursorTokenSchema,
  publicGallerySlugSchema,
  type GalleryPhotoPage,
} from "@photographer-platform/shared";
import { z } from "zod";

import { GalleryCursorCodec, InvalidGalleryCursorError } from "./gallery-cursor.js";
import type { GallerySessionCodec } from "./gallery-session.js";
import type { ImageUrlProvider } from "./image-url-provider.js";

const MAX_PAGE_SIZE = 100;
const inputSchema = z.strictObject({
  slug: publicGallerySlugSchema,
  limit: z.number().int().min(1).max(MAX_PAGE_SIZE).optional(),
  cursor: galleryCursorTokenSchema.optional(),
});

export type GalleryListingErrorCode =
  | "invalid-request"
  | "not-found"
  | "password-required"
  | "stale-cursor";

const errorMessages: Record<GalleryListingErrorCode, string> = {
  "invalid-request": "The gallery page request is invalid.",
  "not-found": "The gallery was not found.",
  "password-required": "This gallery requires a password.",
  "stale-cursor": "The gallery changed. Reload it from the first page.",
};

export class GalleryListingError extends Error {
  constructor(readonly code: GalleryListingErrorCode) {
    super(errorMessages[code]);
    this.name = "GalleryListingError";
  }
}

export class GalleryListingService {
  constructor(
    private readonly database: DatabaseClient,
    private readonly cursors: GalleryCursorCodec,
    private readonly imageUrls?: ImageUrlProvider,
    private readonly sessions?: GallerySessionCodec,
  ) {}

  async listPasswordless(input: unknown): Promise<GalleryPhotoPage> {
    return this.listWithSession(input, null);
  }

  async listWithSession(input: unknown, sessionToken: string | null): Promise<GalleryPhotoPage> {
    const parsed = inputSchema.safeParse(input);
    if (!parsed.success) throw new GalleryListingError("invalid-request");
    const { slug, cursor } = parsed.data;
    const limit = parsed.data.limit ?? 50;

    return this.database.$transaction(
      async (transaction) => {
        const album = await transaction.album.findUnique({
          where: { publicSlug: slug },
          select: {
            id: true,
            title: true,
            status: true,
            passwordHash: true,
            selectionLimit: true,
            catalogVersion: true,
          },
        });
        if (album === null || album.status !== AlbumStatus.PUBLISHED) {
          throw new GalleryListingError("not-found");
        }
        if (album.passwordHash !== null &&
          (this.sessions === undefined || !this.sessions.allows(sessionToken, {
            id: album.id, slug, passwordHash: album.passwordHash,
          }))) {
          throw new GalleryListingError("password-required");
        }

        const position = cursor === undefined ? null : this.cursors.decode(cursor);
        if (position !== null && position.albumId !== album.id) {
          throw new InvalidGalleryCursorError();
        }
        if (position !== null && position.catalogVersion !== album.catalogVersion) {
          throw new GalleryListingError("stale-cursor");
        }

        const rows = await transaction.photo.findMany({
          where: {
            albumId: album.id,
            active: true,
            ...(position === null
              ? {}
              : {
                  OR: [
                    { sortOrder: { gt: position.sortOrder } },
                    { sortOrder: position.sortOrder, id: { gt: position.photoId } },
                  ],
                }),
          },
          select: {
            id: true,
            fileName: true,
            width: true,
            height: true,
            previewStatus: true,
            sourceRevision: true,
            previewRevision: true,
            sortOrder: true,
          },
          orderBy: [{ sortOrder: "asc" }, { id: "asc" }],
          take: limit + 1,
        });
        const visible = rows.slice(0, limit);
        const last = visible.at(-1);
        const nextCursor =
          rows.length > limit && last !== undefined
            ? this.cursors.encode({
                albumId: album.id,
                catalogVersion: album.catalogVersion,
                sortOrder: last.sortOrder,
                photoId: last.id,
              })
            : null;

        return {
          title: album.title,
          selectionLimit: album.selectionLimit,
          photos: visible.map((photo) => ({
            photoId: photo.id,
            fileName: photo.fileName,
            width: photo.width,
            height: photo.height,
            previewStatus: photo.previewStatus,
            images: this.imageUrls !== undefined && photo.previewStatus === PreviewStatus.READY &&
              photo.sourceRevision !== null && photo.previewRevision === photo.sourceRevision
              ? this.imageUrls.describe({
                  slug,
                  photoId: photo.id,
                  sourceRevision: photo.sourceRevision,
                  width: photo.width,
                  height: photo.height,
                })
              : null,
          })),
          nextCursor,
        };
      },
      { isolationLevel: "RepeatableRead" },
    );
  }
}
