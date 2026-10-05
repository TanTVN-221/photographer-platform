import type { Metadata } from "next";
import type { ReactNode } from "react";

import { pageCopy } from "../lib/i18n";
import { getPreferredLocale } from "../lib/server-locale";

import "./globals.css";

// A request nonce must never be reused from a static HTML shell/ISR cache.
export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  const locale = await getPreferredLocale();
  return {
    title: "Photographer Platform",
    description: pageCopy[locale].metadataDescription,
  };
}

export default async function RootLayout({ children }: { readonly children: ReactNode }) {
  const locale = await getPreferredLocale();
  return (
    <html lang={locale}>
      <body>{children}</body>
    </html>
  );
}
