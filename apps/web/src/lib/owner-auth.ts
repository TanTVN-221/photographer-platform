import { authenticationStatusSchema, ownerProfileSchema, ownerSessionCookieName, ownerSessionTokenSchema,
  type OwnerProfile } from "@photographer-platform/shared";

import { resolveGalleryApiConfig } from "./gallery-api-config";

export type OwnerSessionResult = { status: "authenticated"; owner: OwnerProfile } |
  { status: "anonymous" | "unavailable" };

/** Called by server components only; the session token never enters client props. */
export async function getOwnerSession(token?: string, fetcher: typeof fetch = fetch): Promise<OwnerSessionResult> {
  const config = resolveGalleryApiConfig();
  if (config === null) return { status: "unavailable" };
  if (token === undefined || !ownerSessionTokenSchema.safeParse(token).success) return { status: "anonymous" };
  try {
    const response = await fetcher(new URL("/api/v1/auth/session", config.internalApi), {
      headers: { Cookie: `${ownerSessionCookieName(config.web.protocol === "https:")}=${token}` },
      cache: "no-store", redirect: "manual", signal: AbortSignal.timeout(5000),
    });
    if (response.status === 401) return { status: "anonymous" };
    if (response.status !== 200) return { status: "unavailable" };
    const parsed = ownerProfileSchema.safeParse(await response.json());
    return parsed.success ? { status: "authenticated", owner: parsed.data } : { status: "unavailable" };
  } catch { return { status: "unavailable" }; }
}

export async function getSignInUrl(fetcher: typeof fetch = fetch): Promise<string | null> {
  const config = resolveGalleryApiConfig();
  if (config === null) return null;
  try {
    const response = await fetcher(new URL("/api/v1/auth/status", config.internalApi), {
      cache: "no-store", redirect: "manual", signal: AbortSignal.timeout(5000),
    });
    if (response.status !== 200) return null;
    const parsed = authenticationStatusSchema.safeParse(await response.json());
    return parsed.success && parsed.data.configured ? new URL("/api/v1/auth/google", config.publicApi).toString() : null;
  } catch { return null; }
}
