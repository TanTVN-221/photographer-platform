"use server";

import { cookies } from "next/headers";

import { isLocale, LOCALE_COOKIE } from "../lib/i18n";
import { resolveGalleryApiConfig } from "../lib/gallery-api-config";

export async function setLanguage(formData: FormData): Promise<void> {
  const requestedLocale = formData.get("locale");
  if (!isLocale(requestedLocale)) {
    return;
  }

  const config = resolveGalleryApiConfig();
  (await cookies()).set(LOCALE_COOKIE, requestedLocale, {
    httpOnly: true,
    maxAge: 60 * 60 * 24 * 365,
    path: "/",
    sameSite: "lax",
    secure: config?.web.protocol === "https:" || (config === null && process.env.NODE_ENV === "production"),
  });
}
