import { describe, expect, it, vi } from "vitest";
import { changeOwnerAlbum, getOwnerReview, getWorkspaceAlbums } from "./workspace-api";

const token = "a".repeat(43);
const album = { albumId: "album", title: "Wedding", publicSlug: "a".repeat(24), status: "PUBLISHED",
  passwordProtected: true, photoCount: 2, selectedCount: 1, selectionStatus: "SUBMITTED", selectionLimit: null,
  createdAt: "2026-10-04T00:00:00.000Z", updatedAt: "2026-10-04T00:00:00.000Z" };
const review = { album, submittedAt: album.createdAt, lockedAt: null, nextCursor: null,
  items: [{ photoId: "photo", fileName: "IMG_2.jpg", active: true, comment: "Nice", thumbnail: null }] };
describe("server-only workspace bridge (AUTH-004, ALB-004/005, SEC-004/005)", () => {
  it("forwards only owner cookie, encodes continuation and uses no-store/manual redirects", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({ albums: [album], nextCursor: null })));
    expect(await getWorkspaceAlbums(token, "opaque", fetcher)).toMatchObject({ status: "available", data: { albums: [album] } });
    expect(String(fetcher.mock.calls[0]?.[0])).toBe("http://127.0.0.1:4000/api/v1/workspace/albums?cursor=opaque");
    expect(fetcher.mock.calls[0]?.[1]).toMatchObject({ cache: "no-store", redirect: "manual", headers: { Cookie: `pp-owner=${token}` } });
    fetcher.mockResolvedValueOnce(new Response(JSON.stringify(review)));
    expect(await getOwnerReview("album", token, undefined, fetcher)).toEqual({ status: "available", data: review });
  });
  it("rejects invalid session/IDs/cursors before network access", async () => {
    const fetcher = vi.fn<typeof fetch>();
    expect(await getWorkspaceAlbums("invalid", undefined, fetcher)).toEqual({ status: "anonymous" });
    expect(await getWorkspaceAlbums(token, "../cursor", fetcher)).toEqual({ status: "stale" });
    expect(await getOwnerReview("../album", token, undefined, fetcher)).toEqual({ status: "not-found" });
    expect(await changeOwnerAlbum("../album", "archive", token, fetcher)).toBe("failed");
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("rejects credential-bearing DTOs and non-application image URLs", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(new Response(JSON.stringify({ albums: [{ ...album, passwordHash: "secret" }], nextCursor: null })));
    expect(await getWorkspaceAlbums(token, undefined, fetcher)).toEqual({ status: "unavailable" });
    fetcher.mockResolvedValueOnce(new Response(JSON.stringify({ ...review, items: [{ ...review.items[0],
      thumbnail: { src: "https://drive.google.com/private-original", width: 1200, height: 800 } }] })));
    expect(await getOwnerReview("album", token, undefined, fetcher)).toEqual({ status: "unavailable" });
  });
  it.each([[401, "anonymous"], [404, "not-found"], [409, "stale"], [400, "stale"], [503, "unavailable"], [302, "unavailable"]] as const)("maps %s safely", async (status, expected) => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status }));
    expect(await getOwnerReview("album", token, undefined, fetcher)).toEqual({ status: expected });
  });
  it("handles malformed JSON and network errors without exposing details", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(new Response("not json")).mockRejectedValueOnce(new Error("private detail"));
    expect(await getWorkspaceAlbums(token, undefined, fetcher)).toEqual({ status: "unavailable" });
    expect(await getOwnerReview("album", token, undefined, fetcher)).toEqual({ status: "unavailable" });
  });
  it("uses backend-authenticated origin-checked mutations with exact success validation", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(new Response(null, { status: 204 }));
    expect(await changeOwnerAlbum("album", "archive", token, fetcher)).toBe("success");
    expect(fetcher.mock.calls[0]?.[1]).toMatchObject({ method: "POST", body: '{"confirmation":"archive"}',
      headers: { Cookie: `pp-owner=${token}`, Origin: "http://127.0.0.1:3000", "Content-Type": "application/json" } });
    fetcher.mockResolvedValueOnce(new Response(JSON.stringify({ status: "LOCKED", submittedAt: album.createdAt, lockedAt: album.createdAt })));
    expect(await changeOwnerAlbum("album", "lock", token, fetcher)).toBe("success");
    fetcher.mockResolvedValueOnce(new Response(JSON.stringify({ status: "LOCKED", submittedAt: album.createdAt, lockedAt: album.createdAt })));
    expect(await changeOwnerAlbum("album", "reopen", token, fetcher)).toBe("failed");
    fetcher.mockResolvedValueOnce(new Response(null, { status: 401 }));
    expect(await changeOwnerAlbum("album", "archive", token, fetcher)).toBe("anonymous");
  });
});
