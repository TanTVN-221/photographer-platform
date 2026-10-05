import type { Metadata } from "next";
import Link from "next/link";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { ownerSessionCookieName } from "@photographer-platform/shared";
import { setLanguage } from "../../../actions";
import { resolveGalleryApiConfig } from "../../../../lib/gallery-api-config";
import { getPreferredLocale } from "../../../../lib/server-locale";
import { getOwnerReview } from "../../../../lib/workspace-api";
import { workspaceCopy } from "../../../../lib/workspace-copy";
import { authCopy } from "../../../../lib/auth-copy";
import { OwnerAlbumReview } from "./review";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { robots: { index: false, follow: false } };
export default async function OwnerAlbumPage({ params, searchParams }: {
  params: Promise<{ albumId: string }>;
  searchParams: Promise<{ cursor?: string | string[]; notice?: string | string[] }>;
}) {
  const [{ albumId }, query, locale, jar] = await Promise.all([params, searchParams, getPreferredLocale(), cookies()]);
  const config = resolveGalleryApiConfig();
  const token = jar.get(ownerSessionCookieName(config?.web.protocol === "https:"))?.value;
  const cursor = Array.isArray(query.cursor) ? "" : query.cursor;
  const result = await getOwnerReview(albumId, token, cursor);
  if (result.status === "anonymous") redirect("/signin");
  const copy = workspaceCopy[locale];
  return <main className="mx-auto min-h-screen max-w-5xl px-6 py-10 sm:py-16">
    <header className="flex flex-wrap items-center justify-between gap-4 border-b border-[var(--line)] pb-6">
      <Link href="/workspace" prefetch={false} className="underline">{copy.back}</Link>
      <form action={setLanguage} className="language-switch" aria-label={authCopy[locale].language}>
        <button name="locale" value="en" aria-pressed={locale === "en"} data-active={locale === "en"} lang="en">English</button>
        <button name="locale" value="vi" aria-pressed={locale === "vi"} data-active={locale === "vi"} lang="vi">Tiếng Việt</button>
      </form>
    </header>
    {query.notice === "changed" || query.notice === "failed" ? <p role="status" className="mt-6 border border-[var(--line)] p-4">
      {query.notice === "changed" ? copy.changed : copy.failed}
    </p> : null}
    {result.status === "available" && config !== null ? <OwnerAlbumReview data={result.data} locale={locale}
      publicApi={config.publicApi.toString()} webOrigin={config.web.origin} {...(cursor === undefined ? {} : { cursor })} /> : <>
      <p role="status" className="mt-8">{result.status === "not-found" ? copy.notFound : result.status === "stale" ? copy.stale : copy.unavailable}</p>
      <Link href={`/workspace/albums/${encodeURIComponent(albumId)}`} prefetch={false} className="mt-5 inline-block underline">{copy.first}</Link>
    </>}
  </main>;
}
