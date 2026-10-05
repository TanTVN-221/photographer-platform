import Link from "next/link";
import type { OwnerReviewPage } from "@photographer-platform/shared";
import type { Locale } from "../../../../lib/i18n";
import { workspaceCopy } from "../../../../lib/workspace-copy";
import { updateAlbum } from "./actions";
import { GalleryLink } from "./gallery-link";
import { SubmitButton } from "./submit-button";
import { ReviewThumbnail } from "./review-thumbnail";

export function OwnerAlbumReview({ data, locale, publicApi, webOrigin, cursor }: {
  data: OwnerReviewPage; locale: Locale; publicApi: string; webOrigin: string; cursor?: string;
}) {
  const { album } = data;
  const copy = workspaceCopy[locale];
  const submitted = album.selectionStatus !== "DRAFT";
  const editable = album.status === "PUBLISHED";
  const date = (value: string) => new Intl.DateTimeFormat(locale === "vi" ? "vi-VN" : "en-GB", {
    dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Ho_Chi_Minh",
  }).format(new Date(value));
  return <>
    <h1 className="mt-10 break-words text-4xl font-medium tracking-tight">{album.title}</h1>
    <p className="mt-4">{copy[album.status]} · {album.photoCount} {copy.photos} · {album.selectedCount} {copy.selected}</p>
    {album.passwordProtected && <p className="mt-2 text-sm text-[var(--muted)]">{copy.protected}</p>}
    {album.status === "PUBLISHED" && <GalleryLink locale={locale} url={new URL(`/g/${album.publicSlug}`, webOrigin).toString()} />}
    <section className="mt-10 border-t border-[var(--line)] pt-8" aria-labelledby="selection-heading">
      <h2 id="selection-heading" className="text-2xl font-medium">{copy.selection} · {copy[album.selectionStatus]}</h2>
      {data.submittedAt !== null && <p className="mt-3 text-sm">{copy.submitted}: {date(data.submittedAt)}</p>}
      {data.lockedAt !== null && <p className="mt-2 text-sm">{copy.locked}: {date(data.lockedAt)}</p>}
      <div className="mt-6 flex flex-wrap items-center gap-5">
        {submitted && <a className="underline underline-offset-4"
          href={new URL(`/api/v1/workspace/albums/${album.albumId}/selection/export`, publicApi).toString()}>{copy.export}</a>}
        {editable && album.selectionStatus === "SUBMITTED" && <form action={updateAlbum}>
          <input type="hidden" name="albumId" value={album.albumId} /><input type="hidden" name="action" value="lock" />
          <SubmitButton>{copy.lock}</SubmitButton>
        </form>}
      </div>
      {editable && submitted && <form action={updateAlbum} className="mt-6 space-y-3">
        <input type="hidden" name="albumId" value={album.albumId} /><input type="hidden" name="action" value="reopen" />
        <p className="max-w-2xl text-sm text-[var(--muted)]">{copy.reopenHelp}</p>
        <label className="flex items-start gap-3"><input type="checkbox" name="confirmation" value="reopen" required className="mt-1" />{copy.confirmReopen}</label>
        <SubmitButton>{copy.reopen}</SubmitButton>
      </form>}
      {data.items.length === 0 ? <p className="mt-8">{copy.noSelection}</p> : <ul className="mt-8 divide-y divide-[var(--line)]">
        {data.items.map((item) => <li key={item.photoId} className="flex flex-col gap-5 py-5 sm:flex-row">
          <ReviewThumbnail key={item.thumbnail?.src ?? item.photoId} src={item.thumbnail === null ? null : new URL(item.thumbnail.src, publicApi).toString()}
            fileName={item.fileName} unavailable={copy.previewUnavailable} width={item.thumbnail?.width ?? null} height={item.thumbnail?.height ?? null} />
          <div className="min-w-0 flex-1">
          <h3 className="break-all font-medium">{item.fileName}</h3>
          {!item.active && <p className="mt-1 text-sm text-[var(--muted)]">{copy.removed}</p>}
          <p className="mt-3 whitespace-pre-wrap break-words text-sm">{item.comment ?? copy.noComment}</p>
          </div>
        </li>)}
      </ul>}
      <nav className="mt-6 flex gap-6" aria-label={copy.selection}>
        {cursor !== undefined && <Link prefetch={false} href={`/workspace/albums/${album.albumId}`} className="underline">{copy.first}</Link>}
        {data.nextCursor !== null && <Link prefetch={false} className="underline"
          href={`/workspace/albums/${album.albumId}?${new URLSearchParams({ cursor: data.nextCursor })}`}>{copy.next}</Link>}
      </nav>
    </section>
    {album.status !== "ARCHIVED" && <section className="mt-12 border-t border-[var(--line)] pt-8">
      <h2 className="text-xl font-medium">{copy.archive}</h2>
      <p className="mt-3 max-w-2xl text-sm text-[var(--muted)]">{copy.archiveHelp}</p>
      <form action={updateAlbum} className="mt-5 space-y-4">
        <input type="hidden" name="albumId" value={album.albumId} /><input type="hidden" name="action" value="archive" />
        <label className="flex items-start gap-3"><input type="checkbox" name="confirmation" value="archive" required className="mt-1" />{copy.confirmArchive}</label>
        <SubmitButton>{copy.archive}</SubmitButton>
      </form>
    </section>}
  </>;
}
