import { ownerAlbumIdSchema, ownerAlbumPageSchema, ownerCursorSchema, ownerReviewPageSchema,
  ownerSelectionLifecycleSchema, ownerSessionCookieName, ownerSessionTokenSchema,
  type OwnerAlbumPage, type OwnerReviewPage } from "@photographer-platform/shared";
import { resolveGalleryApiConfig } from "./gallery-api-config";

export type WorkspaceResult<T> = { status: "available"; data: T } |
  { status: "anonymous" | "unavailable" | "not-found" | "stale" };
// Server-only boundary: never import from a Client Component. Only the owner
// cookie is forwarded, never the incoming request's headers or credential DTOs.
async function ownerRequest(path: string, token: string | undefined,
  fetcher: typeof fetch, body?: object): Promise<Response | null> {
  const config = resolveGalleryApiConfig();
  if (config === null || !ownerSessionTokenSchema.safeParse(token).success) return null;
  try {
    return await fetcher(new URL(path, config.internalApi), {
      method: body === undefined ? "GET" : "POST",
      headers: { Cookie: `${ownerSessionCookieName(config.web.protocol === "https:")}=${token}`,
        ...(body === undefined ? {} : { Origin: config.web.origin, "Content-Type": "application/json" }) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      cache: "no-store", redirect: "manual", signal: AbortSignal.timeout(5000),
    });
  } catch { return null; }
}
function unavailable(response: Response | null): WorkspaceResult<never> {
  return { status: response?.status === 401 ? "anonymous" : response?.status === 404 ? "not-found" :
    response?.status === 409 || response?.status === 400 ? "stale" : "unavailable" };
}
function cursorQuery(cursor?: string): string | null {
  if (cursor === undefined) return "";
  return ownerCursorSchema.safeParse(cursor).success ? `?${new URLSearchParams({ cursor })}` : null;
}
export async function getWorkspaceAlbums(token?: string, cursor?: string,
  fetcher: typeof fetch = fetch): Promise<WorkspaceResult<OwnerAlbumPage>> {
  if (!ownerSessionTokenSchema.safeParse(token).success) return { status: "anonymous" };
  const query = cursorQuery(cursor);
  if (query === null) return { status: "stale" };
  const response = await ownerRequest(`/api/v1/workspace/albums${query}`, token, fetcher);
  if (response?.status !== 200) return unavailable(response);
  try {
    const parsed = ownerAlbumPageSchema.safeParse(await response.json());
    return parsed.success ? { status: "available", data: parsed.data } : { status: "unavailable" };
  } catch { return { status: "unavailable" }; }
}
export async function getOwnerReview(albumId: string, token?: string, cursor?: string,
  fetcher: typeof fetch = fetch): Promise<WorkspaceResult<OwnerReviewPage>> {
  if (!ownerSessionTokenSchema.safeParse(token).success) return { status: "anonymous" };
  if (!ownerAlbumIdSchema.safeParse(albumId).success) return { status: "not-found" };
  const query = cursorQuery(cursor);
  if (query === null) return { status: "stale" };
  const response = await ownerRequest(`/api/v1/workspace/albums/${albumId}/selection${query}`, token, fetcher);
  if (response?.status !== 200) return unavailable(response);
  try {
    const parsed = ownerReviewPageSchema.safeParse(await response.json());
    return parsed.success ? { status: "available", data: parsed.data } : { status: "unavailable" };
  } catch { return { status: "unavailable" }; }
}
export async function changeOwnerAlbum(albumId: string, action: "lock" | "reopen" | "archive",
  token?: string, fetcher: typeof fetch = fetch): Promise<"success" | "anonymous" | "failed"> {
  if (!ownerSessionTokenSchema.safeParse(token).success) return "anonymous";
  if (!ownerAlbumIdSchema.safeParse(albumId).success) return "failed";
  const response = await ownerRequest(`/api/v1/workspace/albums/${albumId}/${action}`, token, fetcher,
    action === "archive" ? { confirmation: "archive" } : {});
  if (response?.status === 401) return "anonymous";
  if (action === "archive") return response?.status === 204 ? "success" : "failed";
  if (response?.status !== 200) return "failed";
  try {
    const parsed = ownerSelectionLifecycleSchema.safeParse(await response.json());
    return parsed.success && parsed.data.status === (action === "lock" ? "LOCKED" : "DRAFT") ? "success" : "failed";
  } catch { return "failed"; }
}
