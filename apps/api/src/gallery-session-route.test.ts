import { errorEnvelopeSchema } from "@photographer-platform/shared";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";

import { createApp } from "./app.js";
import { GalleryAccessError } from "./gallery/gallery-access.js";
import { gallerySessionCookieName } from "./gallery/gallery-session.js";

const slug = "AbCdEfGhIjKlMnOpQrStUvWx";
const path = `/api/v1/galleries/${slug}/session`;
const origin = "http://127.0.0.1:3000";

describe("protected gallery session route (GAL-002/003, SEC-001/003/005)", () => {
  it("issues an HttpOnly same-site cookie after validated same-origin password proof", async () => {
    const provePassword = vi.fn().mockResolvedValue("opaque-session-token");
    const response = await request(createApp({
      galleryAccess: { provePassword }, passwordOrigin: origin, galleryCookieSecure: false,
    })).post(path).set("Origin", origin).send({ password: "client passphrase" });
    expect(response.status).toBe(204);
    expect(provePassword).toHaveBeenCalledExactlyOnceWith({ slug, password: "client passphrase" });
    const cookie = String(response.headers["set-cookie"]);
    expect(cookie).toContain(`${gallerySessionCookieName(slug)}=opaque-session-token`);
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("SameSite=Lax");
    expect(cookie).toContain("Path=/");
    expect(cookie).not.toContain("client passphrase");
    expect(response.headers["cache-control"]).toBe("no-store");
  });

  it("rejects cross-origin, absent origin, and invalid input before password verification", async () => {
    const provePassword = vi.fn();
    const app = createApp({ galleryAccess: { provePassword }, passwordOrigin: origin, galleryCookieSecure: true });
    for (const [url, requestOrigin, body, expected] of [
      [path, "https://attacker.example", { password: "valid" }, 403],
      [path, null, { password: "valid" }, 403],
      [path, origin, { password: "" }, 400],
      [`/api/v1/galleries/short/session`, origin, { password: "valid" }, 400],
    ] as const) {
      const call = request(app).post(url);
      if (requestOrigin !== null) call.set("Origin", requestOrigin);
      const response = await call.send(body);
      expect(response.status).toBe(expected);
      expect(response.headers["set-cookie"]).toBeUndefined();
    }
    expect(provePassword).not.toHaveBeenCalled();
  });

  it("limits attempts before expensive verification and emits a retry interval", async () => {
    const provePassword = vi.fn().mockRejectedValue(new GalleryAccessError("denied"));
    const app = createApp({ galleryAccess: { provePassword }, passwordOrigin: origin, galleryCookieSecure: false });
    for (let index = 0; index < 5; index += 1) {
      const response = await request(app).post(path).set("Origin", origin).send({ password: "wrong" });
      expect(response.status).toBe(403);
      expect(errorEnvelopeSchema.parse(response.body).error.code).toBe("PASSWORD_DENIED");
    }
    const limited = await request(app).post(path).set("Origin", origin).send({ password: "wrong" });
    expect(limited.status).toBe(429);
    expect(limited.headers["retry-after"]).toBeDefined();
    expect(provePassword).toHaveBeenCalledTimes(5);
  });

  it("forwards only the bounded slug-specific cookie to metadata and image readers", async () => {
    const listWithSession = vi.fn().mockResolvedValue({ title: "Wedding", selectionLimit: null, photos: [], nextCursor: null });
    const readWithSession = vi.fn().mockResolvedValue({ bytes: Buffer.from("RIFFxxxxWEBP"), etag: '"hash"' });
    const app = createApp({
      galleryListing: { listPasswordless: vi.fn(), listWithSession },
      galleryImages: { readPasswordless: vi.fn(), readWithSession },
    });
    const cookie = `${gallerySessionCookieName(slug)}=opaque_token; other=ignored`;
    await request(app).get(`/api/v1/galleries/${slug}/photos`).set("Cookie", cookie).expect(200);
    expect(listWithSession).toHaveBeenCalledWith({ slug }, "opaque_token");
    await request(app).get(`/api/v1/galleries/${slug}/images/photo_1/thumbnail/abcdefghijklmnopqrstuvwx.webp`)
      .set("Cookie", cookie).expect(200);
    expect(readWithSession).toHaveBeenCalledWith({
      slug, photoId: "photo_1", variant: "thumbnail", token: "abcdefghijklmnopqrstuvwx.webp",
    }, "opaque_token");
  });
});
