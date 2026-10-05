import { describe, expect, it } from "vitest";

import { GallerySessionCodec, gallerySessionCookieName, readGallerySessionCookie } from "./gallery-session.js";

const slug = "AbCdEfGhIjKlMnOpQrStUvWx";
const album = { id: "album-1", slug, passwordHash: "scrypt$v1$hash-one" };

describe("gallery session codec (GAL-002/007, SEC-005)", () => {
  it("binds an opaque, encrypted token to one gallery and password revision", () => {
    const codec = new GallerySessionCodec(Buffer.alloc(32, 1), () => 1_000_000);
    const token = codec.issue(album);
    expect(token).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(token).not.toContain(album.id);
    expect(token).not.toContain(album.passwordHash);
    expect(codec.allows(token, album)).toBe(true);
    expect(codec.allows(token, { ...album, id: "album-2" })).toBe(false);
    expect(codec.allows(token, { ...album, passwordHash: "scrypt$v1$hash-two" })).toBe(false);
    expect(codec.allows(token, { ...album, slug: "ZbCdEfGhIjKlMnOpQrStUvWx" })).toBe(false);
  });

  it("rejects tampering, expiry, noncanonical encoding, and a different key", () => {
    let now = 1_000_000;
    const codec = new GallerySessionCodec(Buffer.alloc(32, 1), () => now);
    const token = codec.issue(album);
    expect(codec.allows(`${token.slice(0, -1)}${token.at(-1) === "A" ? "B" : "A"}`, album)).toBe(false);
    expect(codec.allows(`${token}=`, album)).toBe(false);
    expect(new GallerySessionCodec(Buffer.alloc(32, 2), () => now).allows(token, album)).toBe(false);
    now += 12 * 60 * 60 * 1000 + 1;
    expect(codec.allows(token, album)).toBe(false);
    expect(codec.allows(null, album)).toBe(false);
  });

  it("reads only one bounded, slug-specific cookie", () => {
    const name = gallerySessionCookieName(slug);
    expect(readGallerySessionCookie(`${name}=abc_DEF-123; locale=vi`, slug)).toBe("abc_DEF-123");
    expect(readGallerySessionCookie(`${name}=one; ${name}=two`, slug)).toBeNull();
    expect(readGallerySessionCookie(`${name}=bad%3D`, slug)).toBeNull();
    expect(readGallerySessionCookie(`pp_gallery_other=abc`, slug)).toBeNull();
  });
});
