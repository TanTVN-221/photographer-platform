import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { getGalleryMetadata } from "./gallery";

const slug = "AbCdEfGhIjKlMnOpQrStUvWx";
const page = {
  title: "Wedding",
  selectionLimit: null,
  photos: [{
    photoId: "photo-1",
    fileName: "IMG_001.CR3",
    width: 4000,
    height: 6000,
    previewStatus: "PENDING",
    images: null,
  }],
  nextCursor: "opaque-next",
};

describe("server gallery metadata client (GAL-001, GAL-002, PERF-001, SEC-001)", () => {
  const fetchMock = vi.fn<typeof fetch>();

  beforeEach(() => {
    vi.stubGlobal("fetch", fetchMock);
    vi.stubEnv("API_BASE_URL", "http://127.0.0.1:4000");
    fetchMock.mockReset();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it("fetches one bounded page without cookies, caches, or images", async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify(page), { status: 200 }));

    const result = await getGalleryMetadata(slug, "opaque-previous");

    expect(result).toEqual({ status: "available", data: page });
    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, options] = fetchMock.mock.calls[0]!;
    expect(new URL(String(url)).pathname).toBe(`/api/v1/galleries/${slug}/photos`);
    expect(new URL(String(url)).searchParams.get("limit")).toBe("50");
    expect(new URL(String(url)).searchParams.get("cursor")).toBe("opaque-previous");
    expect(options).toMatchObject({ cache: "no-store" });
    expect(options).not.toHaveProperty("headers");
  });

  it.each([
    [403, "password-required"],
    [404, "not-found"],
    [409, "stale"],
    [400, "invalid"],
    [503, "unavailable"],
  ] as const)("maps HTTP %i to %s without reading an error body", async (status, expected) => {
    fetchMock.mockResolvedValue(new Response("", { status }));
    expect(await getGalleryMetadata(slug, undefined)).toEqual({ status: expected });
  });

  it("rejects malformed slugs and cursor arrays before making a request", async () => {
    expect(await getGalleryMetadata("short", undefined)).toEqual({ status: "invalid" });
    expect(await getGalleryMetadata(slug, ["a", "b"])).toEqual({ status: "invalid" });
    expect(await getGalleryMetadata(slug, "x".repeat(1025))).toEqual({ status: "invalid" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects unexpected private fields and pages larger than the requested limit", async () => {
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ ...page, driveFileId: "private-id" }), { status: 200 }));
    expect(await getGalleryMetadata(slug, undefined)).toEqual({ status: "unavailable" });

    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ ...page, photos: Array(51).fill(page.photos[0]) }), { status: 200 }));
    expect(await getGalleryMetadata(slug, undefined)).toEqual({ status: "unavailable" });
  });

  it("treats network failures and invalid API base URLs as unavailable", async () => {
    fetchMock.mockRejectedValueOnce(new Error("connection refused"));
    expect(await getGalleryMetadata(slug, undefined)).toEqual({ status: "unavailable" });

    vi.stubEnv("API_BASE_URL", "file:///tmp/private");
    expect(await getGalleryMetadata(slug, undefined)).toEqual({ status: "unavailable" });
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("turns application image paths into browser-reachable URLs without Drive details", async () => {
    const imagePath = `/api/v1/galleries/${slug}/images/photo-1/thumbnail/abcdefghijklmnopqrstuvwx.webp`;
    const imagePage = {
      ...page,
      photos: [{ ...page.photos[0], images: {
        thumbnail: { src: imagePath, width: 4000, height: 6000 },
        preview: { src: imagePath.replace("thumbnail", "preview"), width: 4000, height: 6000 },
      } }],
    };
    vi.stubEnv("PUBLIC_API_BASE_URL", "https://api.example.test");
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify(imagePage), { status: 200 }));
    const result = await getGalleryMetadata(slug, undefined);
    expect(result.status).toBe("available");
    if (result.status !== "available") return;
    expect(result.data.photos[0]?.images?.thumbnail.src).toBe(`https://api.example.test${imagePath}`);

    vi.stubEnv("PUBLIC_API_BASE_URL", "file:///private/path");
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify(imagePage), { status: 200 }));
    const fallback = await getGalleryMetadata(slug, undefined);
    expect(fallback.status === "available" && fallback.data.photos[0]?.images).toBeNull();
  });

  it("rejects a provider image URL in place of an application descriptor", async () => {
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({
      ...page,
      photos: [{ ...page.photos[0], images: {
        thumbnail: { src: "https://drive.google.com/private-original", width: 4000, height: 6000 },
        preview: { src: "https://drive.google.com/private-original", width: 4000, height: 6000 },
      } }],
    }), { status: 200 }));
    expect(await getGalleryMetadata(slug, undefined)).toEqual({ status: "unavailable" });
  });

  it("forwards only a valid, slug-specific HttpOnly gallery session to metadata", async () => {
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify(page), { status: 200 }));
    await getGalleryMetadata(slug, undefined, "opaque_token");
    expect(fetchMock.mock.calls[0]?.[1]?.headers).toEqual({ Cookie: `pp_gallery_${slug}=opaque_token` });

    fetchMock.mockResolvedValueOnce(new Response("", { status: 403 }));
    expect(await getGalleryMetadata(slug, undefined, "bad%3D")).toEqual({ status: "password-required" });
    expect(fetchMock.mock.calls[1]?.[1]).not.toHaveProperty("headers");
  });
});
