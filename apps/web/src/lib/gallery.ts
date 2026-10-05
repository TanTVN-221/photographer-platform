import {
  galleryCursorTokenSchema,
  galleryPhotoPageSchema,
  gallerySessionCookieName,
  publicGallerySlugSchema,
  type GalleryPhotoPage,
} from "@photographer-platform/shared";

export type GalleryMetadataResult =
  | { readonly status: "available"; readonly data: GalleryPhotoPage }
  | { readonly status: "password-required" | "not-found" | "unavailable" | "stale" | "invalid" };

/** Server-only metadata fetch. It forwards only this gallery's validated session cookie. */
export async function getGalleryMetadata(slug: unknown, cursor: unknown, sessionToken?: unknown): Promise<GalleryMetadataResult> {
  const parsedSlug = publicGallerySlugSchema.safeParse(slug);
  const parsedCursor = cursor === undefined
    ? { success: true as const, data: undefined }
    : galleryCursorTokenSchema.safeParse(cursor);
  if (!parsedSlug.success || !parsedCursor.success) return { status: "invalid" };

  try {
    const url = new URL(`/api/v1/galleries/${encodeURIComponent(parsedSlug.data)}/photos`,
      process.env.API_BASE_URL ?? "http://127.0.0.1:4000");
    if (url.protocol !== "http:" && url.protocol !== "https:") return { status: "unavailable" };
    url.searchParams.set("limit", "50");
    if (parsedCursor.data !== undefined) url.searchParams.set("cursor", parsedCursor.data);

    const validSession = typeof sessionToken === "string" && sessionToken.length > 0 && sessionToken.length <= 1024 &&
      /^[A-Za-z0-9_-]+$/.test(sessionToken);
    const response = await fetch(url, {
      cache: "no-store",
      signal: AbortSignal.timeout(3000),
      ...(validSession ? { headers: { Cookie: `${gallerySessionCookieName(parsedSlug.data)}=${sessionToken}` } } : {}),
    });
    if (response.status === 403) return { status: "password-required" };
    if (response.status === 404) return { status: "not-found" };
    if (response.status === 409) return { status: "stale" };
    if (response.status === 400) return { status: "invalid" };
    if (!response.ok) return { status: "unavailable" };

    const parsedPage = galleryPhotoPageSchema.safeParse(await response.json());
    if (!parsedPage.success || parsedPage.data.photos.length > 50) return { status: "unavailable" };

    let publicApiBase: URL | null = null;
    try {
      const candidate = new URL(process.env.PUBLIC_API_BASE_URL ?? process.env.API_BASE_URL ?? "http://127.0.0.1:4000");
      if ((candidate.protocol === "https:" || candidate.protocol === "http:") &&
        candidate.username === "" && candidate.password === "" && candidate.pathname === "/") {
        publicApiBase = candidate;
      }
    } catch {
      // Metadata remains usable when the public browser origin is misconfigured.
    }

    return {
      status: "available",
      data: {
        ...parsedPage.data,
        photos: parsedPage.data.photos.map((photo) => ({
          ...photo,
          images: photo.images === null || publicApiBase === null ? null : {
            thumbnail: { ...photo.images.thumbnail, src: new URL(photo.images.thumbnail.src, publicApiBase).toString() },
            preview: { ...photo.images.preview, src: new URL(photo.images.preview.src, publicApiBase).toString() },
          },
        })),
      },
    };
  } catch {
    return { status: "unavailable" };
  }
}
