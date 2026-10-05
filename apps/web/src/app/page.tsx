import { StatusPill } from "@photographer-platform/ui";
import Link from "next/link";

import { setLanguage } from "./actions";
import { getSystemInfo } from "../lib/api";
import { pageCopy } from "../lib/i18n";
import { getPreferredLocale } from "../lib/server-locale";
import { authCopy } from "../lib/auth-copy";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const [locale, system] = await Promise.all([getPreferredLocale(), getSystemInfo()]);
  const copy = pageCopy[locale];
  const guaranteed =
    system.status === "available"
      ? system.data.formats.filter((format) => format.supportLevel === "guaranteed")
      : [];
  const bestEffort =
    system.status === "available"
      ? system.data.formats.filter((format) => format.supportLevel === "best-effort")
      : [];

  return (
    <main className="mx-auto min-h-screen max-w-[1480px] px-5 pb-20 pt-5 sm:px-9 sm:pt-8 lg:px-14">
      <header className="flex flex-wrap items-center justify-between gap-4 border-b border-[var(--line)] pb-5">
        <div className="flex items-center gap-3" aria-label="Photographer Platform">
          <span className="brand-mark" aria-hidden="true">
            <span />
          </span>
          <div>
            <p className="font-semibold tracking-[-0.04em] text-[var(--ink)]">ChotAnh</p>
            <p className="text-xs tracking-[0.14em] text-[var(--muted)] uppercase">{copy.brandTagline}</p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <Link href="/workspace" className="text-sm underline underline-offset-4">{authCopy[locale].workspace}</Link>
          <form action={setLanguage} aria-label={copy.languageLabel} className="language-switch">
            <button type="submit" name="locale" value="en" aria-pressed={locale === "en"} data-active={locale === "en"} lang="en">
              English
            </button>
            <button type="submit" name="locale" value="vi" aria-pressed={locale === "vi"} data-active={locale === "vi"} lang="vi">
              Tiếng Việt
            </button>
          </form>
          <StatusPill tone={system.status === "available" ? "positive" : "warning"}>
            {system.status === "available" ? copy.connected : copy.unavailable}
          </StatusPill>
        </div>
      </header>

      <section className="grid gap-12 border-b border-[var(--line)] py-16 lg:grid-cols-[minmax(0,1.35fr)_minmax(280px,0.65fr)] lg:gap-20 lg:py-24">
        <div>
          <p className="eyebrow">{copy.introEyebrow}</p>
          <h1 className={`mt-6 max-w-[850px] font-medium text-[var(--ink)] ${locale === "vi" ? "text-[clamp(2.9rem,7vw,6.4rem)] leading-[1.06] tracking-[-0.06em]" : "text-[clamp(3.4rem,8vw,7.9rem)] leading-[0.91] tracking-[-0.085em]"}`}>
            {copy.hero}
          </h1>
        </div>
        <div className="flex flex-col justify-end gap-8 lg:pb-3">
          <p className="max-w-[370px] text-lg leading-7 text-[var(--muted)]">
            {copy.introduction}
          </p>
          <div className="border-l-2 border-[var(--accent)] pl-5">
            <p className="text-sm font-semibold text-[var(--ink)]">{copy.foundationTitle}</p>
            <p className="mt-1 text-sm leading-6 text-[var(--muted)]">
              {copy.foundationDetail}
            </p>
          </div>
        </div>
      </section>

      <section className="grid gap-10 border-b border-[var(--line)] py-12 lg:grid-cols-[minmax(220px,0.6fr)_minmax(0,1.4fr)] lg:py-16">
        <div>
          <p className="eyebrow">{copy.flowEyebrow}</p>
          <h2 className="mt-4 max-w-[300px] text-3xl leading-tight font-medium tracking-[-0.055em] text-[var(--ink)] sm:text-4xl">
            {copy.flowTitle}
          </h2>
        </div>
        <ol className="grid gap-0 sm:grid-cols-3">
          {copy.workflow.map((step, index) => (
            <li key={step.title} className="workflow-step">
              <span className="text-sm font-medium text-[var(--accent)]">{String(index + 1).padStart(2, "0")}</span>
              <h3 className="mt-10 text-xl font-medium tracking-[-0.04em] text-[var(--ink)]">
                {step.title}
              </h3>
              <p className="mt-2 max-w-[230px] text-sm leading-6 text-[var(--muted)]">
                {step.detail}
              </p>
            </li>
          ))}
        </ol>
      </section>

      <section className="grid gap-10 py-12 lg:grid-cols-[minmax(220px,0.6fr)_minmax(0,1.4fr)] lg:py-16">
        <div>
          <p className="eyebrow">{copy.sourceEyebrow}</p>
          <h2 className="mt-4 max-w-[320px] text-3xl leading-tight font-medium tracking-[-0.055em] text-[var(--ink)] sm:text-4xl">
            {copy.sourceTitle}
          </h2>
          <p className="mt-5 max-w-[330px] text-sm leading-6 text-[var(--muted)]">
            {copy.sourceDetail}
          </p>
        </div>
        {system.status === "available" ? (
          <div className="space-y-8">
            <div>
              <div className="flex items-baseline justify-between gap-4 border-b border-[var(--line)] pb-3">
                <h3 className="text-base font-medium text-[var(--ink)]">{copy.guaranteedHeading}</h3>
                <span className="text-xs tabular-nums text-[var(--muted)]">{guaranteed.length} {copy.formatsNoun}</span>
              </div>
              <ul className="mt-4 flex flex-wrap gap-2" aria-label={copy.guaranteedAriaLabel}>
                {guaranteed.map((format) => (
                  <li className="format-chip" key={format.id} title={format.extensions.map((extension) => `.${extension}`).join(", ")}>
                    {format.label}
                  </li>
                ))}
              </ul>
            </div>
            <div>
              <div className="flex items-baseline justify-between gap-4 border-b border-[var(--line)] pb-3">
                <h3 className="text-base font-medium text-[var(--ink)]">{copy.bestEffortHeading}</h3>
                <span className="text-xs tabular-nums text-[var(--muted)]">{bestEffort.length} {copy.formatsNoun}</span>
              </div>
              <ul className="mt-4 flex flex-wrap gap-2" aria-label={copy.bestEffortAriaLabel}>
                {bestEffort.map((format) => (
                  <li className="format-chip format-chip--muted" key={format.id} title={format.extensions.map((extension) => `.${extension}`).join(", ")}>
                    {format.label}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        ) : (
          <div className="flex min-h-48 items-center border border-[var(--line)] px-6 py-8 text-sm leading-6 text-[var(--muted)]">
            {copy.formatsUnavailable}
          </div>
        )}
      </section>

      <footer className="flex flex-wrap justify-between gap-3 border-t border-[var(--line)] pt-5 text-xs text-[var(--muted)]">
        <span>{copy.footerBuild}</span>
        <span>{copy.footerOriginals}</span>
      </footer>
    </main>
  );
}
