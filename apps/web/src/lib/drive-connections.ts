import {
  driveConnectionListSchema,
  ownerSessionCookieName,
  ownerSessionTokenSchema,
  type DriveConnectionSummary,
} from "@photographer-platform/shared";

import { resolveGalleryApiConfig } from "./gallery-api-config";

export type DriveConnectionsResult =
  | { status: "available"; connections: DriveConnectionSummary[] }
  | { status: "anonymous" | "unavailable" };

/** Server-only owner boundary; refresh/access tokens never enter the web process. */
export async function getDriveConnections(token?: string, fetcher: typeof fetch = fetch): Promise<DriveConnectionsResult> {
  const config = resolveGalleryApiConfig();
  if (config === null) return { status: "unavailable" };
  if (token === undefined || !ownerSessionTokenSchema.safeParse(token).success) return { status: "anonymous" };
  try {
    const response = await fetcher(new URL("/api/v1/drive/connections", config.internalApi), {
      headers: { Cookie: `${ownerSessionCookieName(config.web.protocol === "https:")}=${token}` },
      cache: "no-store",
      redirect: "manual",
      signal: AbortSignal.timeout(5000),
    });
    if (response.status === 401) return { status: "anonymous" };
    if (response.status !== 200) return { status: "unavailable" };
    const parsed = driveConnectionListSchema.safeParse(await response.json());
    return parsed.success ? { status: "available", connections: parsed.data.connections } : { status: "unavailable" };
  } catch { return { status: "unavailable" }; }
}
