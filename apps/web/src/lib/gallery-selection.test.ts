import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { getGuestSelectionState, requestGuestSelectionMutation } from "./gallery-selection";

const slug = "AbCdEfGhIjKlMnOpQrStUvWx";
const photoId = "photo_1";
const state = {
  status: "DRAFT", selectedCount: 1, selectionLimit: 2,
  selectedItems: [{ photoId, comment: "Favorite" }],
};

describe("server-only guest selection bridge (SEL-004/007/008, SEC-001/004/005, PERF-005)", () => {
  const fetcher = vi.fn<typeof fetch>();

  beforeEach(() => {
    fetcher.mockReset();
    vi.stubEnv("API_BASE_URL", "http://127.0.0.1:4000");
    vi.stubEnv("PUBLIC_API_BASE_URL", "http://127.0.0.1:4000");
    vi.stubEnv("PUBLIC_WEB_BASE_URL", "http://127.0.0.1:3000");
  });
  afterEach(() => vi.unstubAllEnvs());

  it("fetches only current-page selected items and forwards one validated cookie", async () => {
    fetcher.mockResolvedValueOnce(new Response(JSON.stringify(state), { status: 200 }));
    expect(await getGuestSelectionState(slug, [photoId], "opaque_token", fetcher)).toEqual({ status: "available", data: state });
    const [url, options] = fetcher.mock.calls[0]!;
    expect(new URL(String(url)).searchParams.getAll("photoId")).toEqual([photoId]);
    expect(options).toMatchObject({ cache: "no-store", headers: { Cookie: `pp_gallery_${slug}=opaque_token` } });
    expect(String(url)).not.toContain("opaque_token");
  });

  it("rejects invalid or overbroad state requests and private response fields", async () => {
    expect(await getGuestSelectionState(slug, Array(51).fill(photoId), undefined, fetcher)).toEqual({ status: "unavailable" });
    expect(await getGuestSelectionState(slug, [photoId, photoId], undefined, fetcher)).toEqual({ status: "unavailable" });
    expect(fetcher).not.toHaveBeenCalled();
    fetcher.mockResolvedValueOnce(new Response(JSON.stringify({ ...state, albumId: "private" }), { status: 200 }));
    expect(await getGuestSelectionState(slug, [photoId], undefined, fetcher)).toEqual({ status: "unavailable" });
    fetcher.mockResolvedValueOnce(new Response(JSON.stringify(state), { status: 200 }));
    expect(await getGuestSelectionState(slug, [], undefined, fetcher)).toEqual({ status: "unavailable" });
  });

  it("sends mutations with exact origin and only scoped session cookie", async () => {
    fetcher.mockResolvedValueOnce(new Response(JSON.stringify({ status: "DRAFT", selectedCount: 1, selectionLimit: 2 }), { status: 200 }));
    expect(await requestGuestSelectionMutation({ kind: "select", slug, photoId }, "opaque_token", fetcher))
      .toEqual({ status: "success", state: { status: "DRAFT", selectedCount: 1, selectionLimit: 2 } });
    const [url, options] = fetcher.mock.calls[0]!;
    expect(String(url)).toContain(`/api/v1/galleries/${slug}/selection/items/${photoId}`);
    expect(options).toMatchObject({ method: "PUT", cache: "no-store", redirect: "manual",
      headers: { Origin: "http://127.0.0.1:3000", Cookie: `pp_gallery_${slug}=opaque_token` } });
    fetcher.mockResolvedValueOnce(new Response(JSON.stringify({ comment: "Retouch" }), { status: 200 }));
    expect(await requestGuestSelectionMutation({ kind: "comment", slug, photoId, comment: "Retouch" }, undefined, fetcher))
      .toEqual({ status: "success", comment: "Retouch" });
    expect(fetcher.mock.calls[1]?.[1]).toMatchObject({ method: "PATCH", body: JSON.stringify({ comment: "Retouch" }) });
  });

  it("maps API conflicts and invalid input without trusting failure bodies", async () => {
    expect(await requestGuestSelectionMutation({ kind: "select", slug, photoId: "../x" }, undefined, fetcher))
      .toEqual({ status: "error", reason: "invalid" });
    expect(fetcher).not.toHaveBeenCalled();
    fetcher.mockResolvedValueOnce(new Response("secret", { status: 409 }));
    expect(await requestGuestSelectionMutation({ kind: "submit", slug }, undefined, fetcher))
      .toEqual({ status: "error", reason: "conflict" });
    fetcher.mockResolvedValueOnce(new Response("secret", { status: 429 }));
    expect(await requestGuestSelectionMutation({ kind: "submit", slug }, undefined, fetcher))
      .toEqual({ status: "error", reason: "rate-limited" });
  });
});
