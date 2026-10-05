import Link from "next/link";

import { setLanguage } from "../../actions";
import type { GalleryMetadataResult } from "../../../lib/gallery";
import type { GuestSelectionResult } from "../../../lib/gallery-selection";
import { galleryCopy, type Locale } from "../../../lib/i18n";

import { GalleryViewer } from "./gallery-viewer";
import { unlockGallery } from "./unlock-action";

type GalleryIndexProps = {
  readonly slug: string;
  readonly locale: Locale;
  readonly result: GalleryMetadataResult;
  readonly unlockStatus: "denied" | "rate-limited" | "unavailable" | "invalid" | null;
  readonly selectionResult: GuestSelectionResult | null;
};

export function GalleryIndex({ slug, locale, result, unlockStatus, selectionResult }: GalleryIndexProps) {
  const copy = galleryCopy[locale];
  const title = result.status === "available" ? result.data.title : copy.fallbackTitle;
  const safePath = `/g/${encodeURIComponent(slug)}`;

  return (
    <main className="gallery-page">
      <header className="gallery-header">
        <Link href="/" className="gallery-brand" prefetch={false}>
          <span className="brand-mark" aria-hidden="true"><span /></span>
          <span>Photographer Platform</span>
        </Link>
        <form action={setLanguage} aria-label={copy.languageLabel} className="language-switch">
          <button type="submit" name="locale" value="en" aria-pressed={locale === "en"} data-active={locale === "en"} lang="en">English</button>
          <button type="submit" name="locale" value="vi" aria-pressed={locale === "vi"} data-active={locale === "vi"} lang="vi">Tiếng Việt</button>
        </form>
      </header>

      <section className="gallery-intro" aria-labelledby="gallery-title">
        <p className="eyebrow">{copy.eyebrow}</p>
        <h1 id="gallery-title">{title}</h1>
        {result.status === "available" ? (
          <>
            <p>{copy.galleryDescription}</p>
            <div className="gallery-facts">
              <span>{copy.pageCount(result.data.photos.length)}</span>
              {result.data.selectionLimit !== null && <span>{copy.selectionLimit(result.data.selectionLimit)}</span>}
            </div>
          </>
        ) : (
          <p role="status">{copy.states[result.status]}</p>
        )}
      </section>

      {result.status === "password-required" && (
        <section className="gallery-unlock" aria-labelledby="gallery-unlock-heading">
          <h2 id="gallery-unlock-heading">{copy.passwordLabel}</h2>
          <p id="gallery-password-hint">{copy.passwordHint}</p>
          {unlockStatus !== null && <p className="gallery-unlock-error" role="alert">{copy.unlockErrors[unlockStatus]}</p>}
          <form action={unlockGallery}>
            <input type="hidden" name="slug" value={slug} />
            <label htmlFor="gallery-password">{copy.passwordLabel}</label>
            <input id="gallery-password" name="password" type="password" required autoComplete="current-password"
              aria-describedby="gallery-password-hint" />
            <button type="submit">{copy.unlockButton}</button>
          </form>
        </section>
      )}

      {result.status === "available" && (
        <section className="gallery-index" aria-labelledby="photo-index-title">
          <div className="gallery-index-heading">
            <h2 id="photo-index-title">{copy.indexTitle}</h2>
            <span>{copy.noPreview}</span>
          </div>
          {result.data.photos.length === 0 ? (
            <p className="gallery-empty">{copy.empty}</p>
          ) : (
            <GalleryViewer key={`${result.data.photos[0]?.photoId ?? "empty"}:${result.data.photos.at(-1)?.photoId ?? "empty"}:${selectionResult?.status === "available" ? `${selectionResult.data.status}:${selectionResult.data.selectedCount}` : "unavailable"}`}
              photos={result.data.photos} locale={locale} slug={slug}
              selection={selectionResult?.status === "available" ? selectionResult.data : null} />
          )}
          <nav className="gallery-pagination" aria-label={copy.paginationLabel}>
            <Link href={safePath} prefetch={false}>{copy.firstPage}</Link>
            {result.data.nextCursor !== null && (
              <Link href={{ pathname: safePath, query: { cursor: result.data.nextCursor } }} prefetch={false}>
                {copy.nextPage} <span aria-hidden="true">→</span>
              </Link>
            )}
          </nav>
        </section>
      )}

      {result.status === "stale" && <Link href={safePath} prefetch={false} className="gallery-retry">{copy.firstPage}</Link>}
      <footer className="gallery-footer">{copy.originalsNote}</footer>
    </main>
  );
}
