import { createHash } from "node:crypto";

import { AlbumStatus, PreviewStatus, type DatabaseClient } from "@photographer-platform/database";
import { publicGallerySlugSchema } from "@photographer-platform/shared";
import { z } from "zod";

import type { DerivativeStore } from "../media/derivative-store.js";
import type { GallerySessionCodec } from "./gallery-session.js";
import { imageRevisionToken } from "./image-url-provider.js";

const inputSchema = z.strictObject({
  slug: publicGallerySlugSchema,
  photoId: z.string().regex(/^[A-Za-z0-9_-]{1,128}$/),
  variant: z.enum(["thumbnail", "preview"]),
  token: z.string().regex(/^[A-Za-z0-9_-]{24}\.webp$/),
});

export type GalleryImageErrorCode = "invalid-request" | "not-found" | "unavailable";

export class GalleryImageError extends Error {
  constructor(readonly code: GalleryImageErrorCode) {
    super(code === "invalid-request"
      ? "The gallery image request is invalid."
      : code === "not-found"
        ? "The gallery image was not found."
        : "The gallery image is temporarily unavailable.");
    this.name = "GalleryImageError";
  }
}

export interface GalleryImageResponse {
  readonly bytes: Buffer;
  readonly etag: string;
}

/** Public only for published passwordless galleries; never reads a Drive original. */
export class GalleryImageService {
  constructor(
    private readonly database: DatabaseClient,
    private readonly store: DerivativeStore,
    private readonly sessions?: GallerySessionCodec,
  ) {}

  async readPasswordless(input: unknown): Promise<GalleryImageResponse> {
    return this.readWithSession(input, null);
  }

  async readWithSession(input: unknown, sessionToken: string | null): Promise<GalleryImageResponse> {
    const parsed = inputSchema.safeParse(input);
    if (!parsed.success) throw new GalleryImageError("invalid-request");
    const { slug, photoId, variant, token } = parsed.data;

    const photo = await this.database.photo.findFirst({
      where: {
        id: photoId,
        active: true,
        album: {
          publicSlug: slug,
          status: AlbumStatus.PUBLISHED,
          ...(sessionToken === null ? { passwordHash: null } : {}),
        },
      },
      select: {
        sourceRevision: true,
        previewRevision: true,
        previewStatus: true,
        ...(sessionToken === null ? {} : { album: { select: { id: true, passwordHash: true } } }),
      },
    });
    if (photo === null) throw new GalleryImageError("not-found");
    if (sessionToken !== null) {
      if (!("album" in photo) || photo.album === null) throw new GalleryImageError("not-found");
      if (photo.album.passwordHash !== null &&
        (this.sessions === undefined || !this.sessions.allows(sessionToken, {
          id: photo.album.id, slug, passwordHash: photo.album.passwordHash,
        }))) throw new GalleryImageError("not-found");
    }
    if (photo.previewStatus !== PreviewStatus.READY || photo.sourceRevision === null ||
      photo.previewRevision !== photo.sourceRevision ||
      token !== `${imageRevisionToken(photoId, photo.sourceRevision)}.webp`) {
      throw new GalleryImageError("not-found");
    }

    try {
      const image = await this.store.read({ photoId, sourceRevision: photo.sourceRevision }, variant);
      if (image === null) throw new GalleryImageError("unavailable");
      const hash = createHash("sha256").update(image.bytes).digest("base64url");
      return { bytes: image.bytes, etag: `"${hash}"` };
    } catch {
      throw new GalleryImageError("unavailable");
    }
  }
}
