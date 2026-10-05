import Link from "next/link";
import type { OwnerAlbumPage } from "@photographer-platform/shared";
import type { Locale } from "../../lib/i18n";
import type { WorkspaceResult } from "../../lib/workspace-api";
import { workspaceCopy } from "../../lib/workspace-copy";

export function AlbumList({ result, locale, cursor }: {
  result: WorkspaceResult<OwnerAlbumPage>; locale: Locale; cursor?: string;
}) {
  const copy = workspaceCopy[locale];
  const date = (value: string) => new Intl.DateTimeFormat(locale === "vi" ? "vi-VN" : "en-GB", {
    dateStyle: "medium", timeZone: "Asia/Ho_Chi_Minh",
  }).format(new Date(value));
  return <section className="mt-12 border-t border-[var(--line)] pt-8" aria-labelledby="albums-heading">
    <h2 id="albums-heading" className="text-2xl font-medium">{copy.albums}</h2>
    {result.status !== "available" ? <p role="status" className="mt-5">
      {result.status === "stale" ? copy.stale : copy.unavailable}
    </p> : result.data.albums.length === 0 ? <p className="mt-5 text-[var(--muted)]">{copy.empty}</p> :
      <ul className="mt-5 divide-y divide-[var(--line)]">
        {result.data.albums.map((album) => <li key={album.albumId} className="py-6">
          <div className="flex flex-wrap justify-between gap-4">
            <h3 className="break-words text-xl font-medium"><Link href={`/workspace/albums/${album.albumId}`} prefetch={false}
              className="underline underline-offset-4">{album.title}</Link></h3>
            <span className="text-sm text-[var(--muted)]">{copy[album.status]} · {copy[album.selectionStatus]}</span>
          </div>
          <p className="mt-3">{album.photoCount} {copy.photos} · {album.selectedCount} {copy.selected}</p>
          <p className="mt-2 text-sm text-[var(--muted)]">{copy.created}: {date(album.createdAt)} · {copy.updated}: {date(album.updatedAt)}</p>
        </li>)}
      </ul>}
    <nav className="mt-5 flex gap-6" aria-label={copy.albums}>
      {cursor !== undefined && <Link href="/workspace" prefetch={false} className="underline">{copy.first}</Link>}
      {result.status === "available" && result.data.nextCursor !== null && <Link prefetch={false}
        href={`/workspace?${new URLSearchParams({ cursor: result.data.nextCursor })}`} className="underline">{copy.next}</Link>}
    </nav>
  </section>;
}
