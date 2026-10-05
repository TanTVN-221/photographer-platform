import {
  gallerySessionCookieName,
  guestSelectionMutationSchema,
  guestSelectionStateSchema,
  publicGallerySlugSchema,
  publicPhotoIdSchema,
  selectionCommentResponseSchema,
  selectionMutationStateSchema,
  type GuestSelectionState,
  type SelectionMutationState,
} from "@photographer-platform/shared";

import { resolveGalleryApiConfig } from "./gallery-api-config";

export type GuestSelectionResult =
  | { readonly status: "available"; readonly data: GuestSelectionState }
  | { readonly status: "password-required" | "not-found" | "unavailable" };

export type GuestSelectionMutationResult =
  | { readonly status: "success"; readonly state: SelectionMutationState }
  | { readonly status: "success"; readonly comment: string | null }
  | { readonly status: "error"; readonly reason: "invalid" | "authorization" | "rate-limited" | "conflict" | "unavailable" };

function cookieHeader(slug: string, token: unknown): { Cookie: string } | undefined {
  return typeof token === "string" && token.length > 0 && token.length <= 1024 && /^[A-Za-z0-9_-]+$/.test(token)
    ? { Cookie: `${gallerySessionCookieName(slug)}=${token}` }
    : undefined;
}

/** Server-only: request current-page selection state, never a gallery-wide item list. */
export async function getGuestSelectionState(
  slug: unknown, photoIds: unknown, sessionToken?: unknown, fetcher: typeof fetch = fetch,
): Promise<GuestSelectionResult> {
  const parsedSlug = publicGallerySlugSchema.safeParse(slug);
  if (!parsedSlug.success || !Array.isArray(photoIds) || photoIds.length > 50 ||
    new Set(photoIds).size !== photoIds.length || photoIds.some((id) => !publicPhotoIdSchema.safeParse(id).success)) {
    return { status: "unavailable" };
  }
  const config = resolveGalleryApiConfig();
  if (config === null) return { status: "unavailable" };
  try {
    const url = new URL(`/api/v1/galleries/${encodeURIComponent(parsedSlug.data)}/selection`, config.internalApi);
    for (const id of photoIds as string[]) url.searchParams.append("photoId", id);
    const cookie = cookieHeader(parsedSlug.data, sessionToken);
    const response = await fetcher(url, {
      cache: "no-store", signal: AbortSignal.timeout(3000),
      ...(cookie === undefined ? {} : { headers: cookie }),
    });
    if (response.status === 403) return { status: "password-required" };
    if (response.status === 404) return { status: "not-found" };
    if (!response.ok) return { status: "unavailable" };
    const parsed = guestSelectionStateSchema.safeParse(await response.json());
    if (!parsed.success || parsed.data.selectedItems.some((item) => !photoIds.includes(item.photoId))) {
      return { status: "unavailable" };
    }
    return { status: "available", data: parsed.data };
  } catch {
    return { status: "unavailable" };
  }
}

/** Server-action bridge; returns authoritative API state, never credentials. */
export async function requestGuestSelectionMutation(
  input: unknown, sessionToken?: unknown, fetcher: typeof fetch = fetch,
): Promise<GuestSelectionMutationResult> {
  const parsed = guestSelectionMutationSchema.safeParse(input);
  if (!parsed.success) return { status: "error", reason: "invalid" };
  const config = resolveGalleryApiConfig();
  if (config === null) return { status: "error", reason: "unavailable" };
  const mutation = parsed.data;
  const base = `/api/v1/galleries/${encodeURIComponent(mutation.slug)}/selection`;
  const path = mutation.kind === "submit" ? `${base}/submit`
    : mutation.kind === "comment" ? `${base}/items/${encodeURIComponent(mutation.photoId)}/comment`
      : `${base}/items/${encodeURIComponent(mutation.photoId)}`;
  const method = mutation.kind === "select" ? "PUT" : mutation.kind === "deselect" ? "DELETE"
    : mutation.kind === "comment" ? "PATCH" : "POST";
  const cookie = cookieHeader(mutation.slug, sessionToken);
  try {
    const response = await fetcher(new URL(path, config.internalApi), {
      method,
      headers: {
        Origin: config.web.origin,
        ...(cookie ?? {}),
        ...(mutation.kind === "comment" ? { "content-type": "application/json" } : {}),
      },
      ...(mutation.kind === "comment" ? { body: JSON.stringify({ comment: mutation.comment }) } : {}),
      cache: "no-store", redirect: "manual", signal: AbortSignal.timeout(5000),
    });
    if (response.status === 400) return { status: "error", reason: "invalid" };
    if (response.status === 403 || response.status === 404) return { status: "error", reason: "authorization" };
    if (response.status === 409) return { status: "error", reason: "conflict" };
    if (response.status === 429) return { status: "error", reason: "rate-limited" };
    if (response.status !== 200) return { status: "error", reason: "unavailable" };
    if (mutation.kind === "comment") {
      const body = selectionCommentResponseSchema.safeParse(await response.json());
      return body.success ? { status: "success", comment: body.data.comment } : { status: "error", reason: "unavailable" };
    }
    const body = selectionMutationStateSchema.safeParse(await response.json());
    return body.success ? { status: "success", state: body.data } : { status: "error", reason: "unavailable" };
  } catch {
    return { status: "error", reason: "unavailable" };
  }
}
