import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { requestGalleryUnlock } from "./gallery-unlock";

const slug = "AbCdEfGhIjKlMnOpQrStUvWx";
const cookieName = `pp_gallery_${slug}`;

describe("server-only gallery unlock bridge (GAL-002/003, SEC-001/004/005)", () => {
  const fetcher = vi.fn<typeof fetch>();

  beforeEach(() => {
    fetcher.mockReset();
    vi.stubEnv("API_BASE_URL", "http://127.0.0.1:4000");
    vi.stubEnv("PUBLIC_API_BASE_URL", "http://127.0.0.1:4000");
    vi.stubEnv("PUBLIC_WEB_BASE_URL", "http://127.0.0.1:3000");
  });

  afterEach(() => vi.unstubAllEnvs());

  it("posts a password only in a no-store body and extracts an opaque cookie", async () => {
    fetcher.mockResolvedValue(new Response(null, {
      status: 204,
      headers: { "set-cookie": `${cookieName}=opaque_token; Max-Age=43200; HttpOnly; SameSite=Lax; Path=/` },
    }));
    expect(await requestGalleryUnlock({ slug, password: "private passphrase" }, fetcher)).toEqual({
      status: "success", token: "opaque_token", secure: false,
    });
    const [url, options] = fetcher.mock.calls[0]!;
    expect(String(url)).toBe(`http://127.0.0.1:4000/api/v1/galleries/${slug}/session`);
    expect(options).toMatchObject({
      method: "POST", cache: "no-store", redirect: "manual",
      headers: { "content-type": "application/json", Origin: "http://127.0.0.1:3000" },
      body: JSON.stringify({ password: "private passphrase" }),
    });
    expect(String(url)).not.toContain("private passphrase");
  });

  it("maps denial and throttling without reading or displaying the password", async () => {
    fetcher.mockResolvedValueOnce(new Response(null, { status: 403 }));
    expect(await requestGalleryUnlock({ slug, password: "wrong" }, fetcher)).toEqual({ status: "denied" });
    fetcher.mockResolvedValueOnce(new Response(null, { status: 429 }));
    expect(await requestGalleryUnlock({ slug, password: "wrong" }, fetcher)).toEqual({ status: "rate-limited" });
    fetcher.mockRejectedValueOnce(new Error("network secret"));
    expect(await requestGalleryUnlock({ slug, password: "wrong" }, fetcher)).toEqual({ status: "unavailable" });
  });

  it("rejects invalid input, unsafe origins, and missing/malformed session cookies", async () => {
    expect(await requestGalleryUnlock({ slug: "short", password: "x" }, fetcher)).toEqual({ status: "invalid" });
    expect(await requestGalleryUnlock({ slug, password: "" }, fetcher)).toEqual({ status: "invalid" });
    expect(fetcher).not.toHaveBeenCalled();
    vi.stubEnv("PUBLIC_API_BASE_URL", "https://api.example.test");
    expect(await requestGalleryUnlock({ slug, password: "x" }, fetcher)).toEqual({ status: "unavailable" });
    vi.stubEnv("PUBLIC_WEB_BASE_URL", "http://photos.example.test");
    vi.stubEnv("PUBLIC_API_BASE_URL", "http://photos.example.test");
    expect(await requestGalleryUnlock({ slug, password: "x" }, fetcher)).toEqual({ status: "unavailable" });
    vi.stubEnv("PUBLIC_WEB_BASE_URL", "http://127.0.0.1:3000");
    vi.stubEnv("PUBLIC_API_BASE_URL", "http://127.0.0.1:4000");
    fetcher.mockResolvedValueOnce(new Response(null, { status: 204, headers: { "set-cookie": "other=token; HttpOnly" } }));
    expect(await requestGalleryUnlock({ slug, password: "x" }, fetcher)).toEqual({ status: "unavailable" });
    fetcher.mockResolvedValueOnce(new Response(null, { status: 204, headers: { "set-cookie": `${cookieName}=bad%3D; HttpOnly` } }));
    expect(await requestGalleryUnlock({ slug, password: "x" }, fetcher)).toEqual({ status: "unavailable" });
  });

  it("marks an HTTPS same-host session cookie Secure", async () => {
    vi.stubEnv("PUBLIC_WEB_BASE_URL", "https://photos.example.test");
    vi.stubEnv("PUBLIC_API_BASE_URL", "https://photos.example.test");
    fetcher.mockResolvedValueOnce(new Response(null, {
      status: 204, headers: { "set-cookie": `${cookieName}=opaque_token; Secure; HttpOnly` },
    }));
    expect(await requestGalleryUnlock({ slug, password: "valid" }, fetcher)).toEqual({
      status: "success", token: "opaque_token", secure: true,
    });
  });
});
