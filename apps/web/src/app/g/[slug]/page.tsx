import type { Metadata } from "next";
import { cookies } from "next/headers";

import { gallerySessionCookieName, publicGallerySlugSchema } from "@photographer-platform/shared";

import { getPreferredLocale } from "../../../lib/server-locale";
import { getGalleryMetadata } from "../../../lib/gallery";
import { getGuestSelectionState } from "../../../lib/gallery-selection";

import { GalleryIndex } from "./gallery-index";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { robots: { index: false, follow: false } };

type GalleryPageProps = {
  readonly params: Promise<{ slug: string }>;
  readonly searchParams: Promise<{ cursor?: string | string[]; unlock?: string | string[] }>;
};

export default async function GalleryPage({ params, searchParams }: GalleryPageProps) {
  const [{ slug }, query, locale, cookieStore] = await Promise.all([
    params,
    searchParams,
    getPreferredLocale(),
    cookies(),
  ]);
  const parsedSlug = publicGallerySlugSchema.safeParse(slug);
  const token = parsedSlug.success ? cookieStore.get(gallerySessionCookieName(parsedSlug.data))?.value : undefined;
  const result = await getGalleryMetadata(slug, query.cursor, token);
  const selectionResult = result.status === "available"
    ? await getGuestSelectionState(slug, result.data.photos.map((photo) => photo.photoId), token)
    : null;
  const unlockStatus = query.unlock === "denied" || query.unlock === "rate-limited" ||
    query.unlock === "unavailable" || query.unlock === "invalid" ? query.unlock : null;

  return <GalleryIndex slug={slug} locale={locale} result={result} unlockStatus={unlockStatus}
    selectionResult={selectionResult} />;
}
