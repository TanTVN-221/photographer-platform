import type { Metadata } from "next";
import Link from "next/link";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { ownerSessionCookieName } from "@photographer-platform/shared";

import { setLanguage } from "../actions";
import { authCopy } from "../../lib/auth-copy";
import { resolveGalleryApiConfig } from "../../lib/gallery-api-config";
import { getOwnerSession, getSignInUrl } from "../../lib/owner-auth";
import { getPreferredLocale } from "../../lib/server-locale";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { robots: { index: false, follow: false } };

export default async function SignInPage({ searchParams }: { searchParams: Promise<{ error?: string | string[] }> }) {
  const [locale, jar, query] = await Promise.all([getPreferredLocale(), cookies(), searchParams]);
  const config = resolveGalleryApiConfig();
  const session = await getOwnerSession(jar.get(ownerSessionCookieName(config?.web.protocol === "https:"))?.value);
  if (session.status === "authenticated") redirect("/workspace");
  const action = await getSignInUrl();
  const copy = authCopy[locale];
  return (
    <main className="mx-auto min-h-screen max-w-3xl px-6 py-10 sm:py-16">
      <header className="flex flex-wrap items-center justify-between gap-4 border-b border-[var(--line)] pb-6">
        <Link href="/" className="underline underline-offset-4">{copy.home}</Link>
        <form action={setLanguage} className="language-switch" aria-label={copy.language}>
          <button name="locale" value="en" aria-pressed={locale === "en"} data-active={locale === "en"} lang="en">English</button>
          <button name="locale" value="vi" aria-pressed={locale === "vi"} data-active={locale === "vi"} lang="vi">Tiếng Việt</button>
        </form>
      </header>
      <section className="py-16">
        <h1 className="text-4xl font-medium tracking-tight">{copy.signin}</h1>
        <p className="mt-5 max-w-xl text-lg leading-7 text-[var(--muted)]">{copy.detail}</p>
        {query.error !== undefined && <p role="alert" className="mt-6">{copy.failed}</p>}
        {action === null ? <p role="status" className="mt-8">{copy.unavailable}</p> : (
          <form action={action} method="post" className="mt-8">
            <button className="rounded-full bg-[var(--ink)] px-7 py-3 text-[var(--paper)] focus-visible:outline-2 focus-visible:outline-offset-4">
              {copy.google}
            </button>
          </form>
        )}
        <p className="mt-5 text-sm leading-6 text-[var(--muted)]">{copy.identityOnly}</p>
      </section>
    </main>
  );
}
