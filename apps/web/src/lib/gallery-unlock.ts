import { gallerySessionCookieName, galleryUnlockRequestSchema } from "@photographer-platform/shared";

import { resolveGalleryApiConfig } from "./gallery-api-config";

export type GalleryUnlockResult =
  | { readonly status: "success"; readonly token: string; readonly secure: boolean }
  | { readonly status: "invalid" | "denied" | "rate-limited" | "unavailable" };

/** Server-only bridge: no password or session token is returned to browser JS. */
export async function requestGalleryUnlock(input: unknown, fetcher: typeof fetch = fetch): Promise<GalleryUnlockResult> {
  const parsed = galleryUnlockRequestSchema.safeParse(input);
  if (!parsed.success) return { status: "invalid" };
  const config = resolveGalleryApiConfig();
  if (config === null) return { status: "unavailable" };
  const { slug, password } = parsed.data;
  try {
    const url = new URL(`/api/v1/galleries/${encodeURIComponent(slug)}/session`, config.internalApi);
    const response = await fetcher(url, {
      method: "POST",
      headers: { "content-type": "application/json", Origin: config.web.origin },
      body: JSON.stringify({ password }),
      cache: "no-store",
      redirect: "manual",
      signal: AbortSignal.timeout(5000),
    });
    if (response.status === 403) return { status: "denied" };
    if (response.status === 429) return { status: "rate-limited" };
    if (response.status !== 204) return { status: "unavailable" };
    const firstCookie = response.headers.get("set-cookie")?.split(";", 1)[0] ?? "";
    const name = gallerySessionCookieName(slug);
    if (!firstCookie.startsWith(`${name}=`)) return { status: "unavailable" };
    const token = firstCookie.slice(name.length + 1);
    if (token.length === 0 || token.length > 1024 || !/^[A-Za-z0-9_-]+$/.test(token)) {
      return { status: "unavailable" };
    }
    return { status: "success", token, secure: config.web.protocol === "https:" };
  } catch {
    return { status: "unavailable" };
  }
}
