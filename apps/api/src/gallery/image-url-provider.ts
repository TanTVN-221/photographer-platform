import { createHash } from "node:crypto";

import type { GalleryImageSet } from "@photographer-platform/shared";

export type GalleryImageVariant = "thumbnail" | "preview";

export interface ImageUrlProvider {
  describe(photo: {
    readonly slug: string;
    readonly photoId: string;
    readonly sourceRevision: string;
    readonly width: number | null;
    readonly height: number | null;
  }): GalleryImageSet;
}

/** Non-secret cache identity; authorization is always checked by the route. */
export function imageRevisionToken(photoId: string, sourceRevision: string): string {
  return createHash("sha256").update(photoId).update("\0").update(sourceRevision).digest("base64url").slice(0, 24);
}

export class ApiDerivativeImageUrlProvider implements ImageUrlProvider {
  describe(photo: {
    readonly slug: string;
    readonly photoId: string;
    readonly sourceRevision: string;
    readonly width: number | null;
    readonly height: number | null;
  }): GalleryImageSet {
    const version = imageRevisionToken(photo.photoId, photo.sourceRevision);
    const base = `/api/v1/galleries/${encodeURIComponent(photo.slug)}/images/${encodeURIComponent(photo.photoId)}`;
    const descriptor = (variant: GalleryImageVariant) => ({
      src: `${base}/${variant}/${version}.webp`,
      width: photo.width,
      height: photo.height,
    });
    return { thumbnail: descriptor("thumbnail"), preview: descriptor("preview") };
  }
}
