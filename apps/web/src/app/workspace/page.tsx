import type { Metadata } from "next";
import Link from "next/link";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { ownerSessionCookieName } from "@photographer-platform/shared";

import { setLanguage } from "../actions";
import { authCopy } from "../../lib/auth-copy";
import { resolveGalleryApiConfig } from "../../lib/gallery-api-config";
import { getOwnerSession } from "../../lib/owner-auth";
import { getDriveConnections } from "../../lib/drive-connections";
import { getPreferredLocale } from "../../lib/server-locale";
import { getWorkspaceAlbums } from "../../lib/workspace-api";
import { AlbumList } from "./album-list";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { robots: { index: false, follow: false } };

const driveNotice = (value: string | string[] | undefined) => Array.isArray(value) ? value[0] : value;

export default async function WorkspacePage({ searchParams }: { searchParams: Promise<{ drive?: string | string[]; cursor?: string | string[] }> }) {
  const [locale, jar] = await Promise.all([getPreferredLocale(), cookies()]);
  const config = resolveGalleryApiConfig();
  const ownerToken = jar.get(ownerSessionCookieName(config?.web.protocol === "https:"))?.value;
  const [session, query] = await Promise.all([getOwnerSession(ownerToken), searchParams]);
  if (session.status === "anonymous") redirect("/signin");
  const copy = authCopy[locale];
  const cursor = Array.isArray(query.cursor) ? "" : query.cursor;
  const [drive, albums] = session.status === "authenticated" ? await Promise.all([
    getDriveConnections(ownerToken), getWorkspaceAlbums(ownerToken, cursor),
  ]) : [{ status: "unavailable" as const }, { status: "unavailable" as const }];
  if (albums.status === "anonymous" || drive.status === "anonymous") redirect("/signin");
  const notice = driveNotice(query.drive);
  const noticeCopy = notice === "connected" ? copy.driveConnectedNotice :
    notice === "disconnected" ? copy.driveDisconnectedNotice :
    notice === "revocation-warning" ? copy.driveRevocationWarning :
    notice === "failed" ? copy.driveFailedNotice : null;
  return (
    <main className="mx-auto min-h-screen max-w-5xl px-6 py-10 sm:py-16">
      <header className="flex flex-wrap items-center justify-between gap-4 border-b border-[var(--line)] pb-6">
        <Link href="/" className="underline underline-offset-4">{copy.home}</Link>
        <form action={setLanguage} className="language-switch" aria-label={copy.language}>
          <button name="locale" value="en" aria-pressed={locale === "en"} data-active={locale === "en"} lang="en">English</button>
          <button name="locale" value="vi" aria-pressed={locale === "vi"} data-active={locale === "vi"} lang="vi">Tiếng Việt</button>
        </form>
        {config !== null && session.status === "authenticated" && (
          <form action={new URL("/api/v1/auth/logout", config.publicApi).toString()} method="post">
            <button className="underline underline-offset-4">{copy.signout}</button>
          </form>
        )}
      </header>
      <section className="py-12">
        <h1 className="text-4xl font-medium tracking-tight">{copy.welcome}</h1>
        {session.status === "authenticated" ? <>
          <p className="mt-6">{copy.account} {session.owner.displayName ?? session.owner.email}</p>
          <p className="mt-2 text-[var(--muted)]">{session.owner.email}</p>
          {noticeCopy !== null && <p role="status" className="mt-8 border border-[var(--line)] p-4">{noticeCopy}</p>}
          <AlbumList result={albums} locale={locale} {...(cursor === undefined ? {} : { cursor })} />
          <section className="mt-12 border-t border-[var(--line)] pt-8" aria-labelledby="drive-heading">
            <h2 id="drive-heading" className="text-2xl font-medium">{copy.driveHeading}</h2>
            <p className="mt-3 max-w-2xl text-[var(--muted)]">{copy.driveDetail}</p>
            {drive.status !== "available" ? <p role="status" className="mt-6">{copy.driveUnavailable}</p> : <>
              <div className="mt-6 space-y-4">
                {drive.connections.map((connection) => <article key={connection.connectionId} className="border border-[var(--line)] p-5">
                  <p>{copy.connectedAs} <strong>{connection.accountEmail}</strong></p>
                  <p className="mt-2 text-sm text-[var(--muted)]">
                    {connection.status === "connected" ? copy.connected :
                      connection.status === "reauth-required" ? copy.reauthRequired : copy.disconnected}
                  </p>
                  {connection.status === "connected" && config !== null ?
                    <form className="mt-4" action={new URL(`/api/v1/drive/connections/${connection.connectionId}/disconnect`, config.publicApi).toString()} method="post">
                      <button className="underline underline-offset-4">{copy.disconnectDrive}</button>
                    </form> : null}
                </article>)}
              </div>
              {config !== null && <form className="mt-6" action={new URL("/api/v1/drive/google", config.publicApi).toString()} method="post">
                <button className="border border-[var(--ink)] px-5 py-3 font-medium">
                  {drive.connections.some((item) => item.status !== "connected") ? copy.reconnectDrive : copy.connectDrive}
                </button>
              </form>}
              <p className="mt-5 max-w-2xl text-sm text-[var(--muted)]">{copy.scopePilot}</p>
              <p className="mt-3 text-sm text-[var(--muted)]">{copy.preparing}</p>
            </>}
          </section>
        </> : <>
          <p role="status" className="mt-6">{copy.sessionUnavailable}</p>
          <a href="/workspace" className="mt-5 inline-block underline">{copy.retry}</a>
        </>}
      </section>
    </main>
  );
}
