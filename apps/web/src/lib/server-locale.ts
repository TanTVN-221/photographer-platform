import "server-only";

import { cookies } from "next/headers";

import { LOCALE_COOKIE, resolveLocale } from "./i18n";

export async function getPreferredLocale() {
  const cookieStore = await cookies();
  return resolveLocale(cookieStore.get(LOCALE_COOKIE)?.value);
}
