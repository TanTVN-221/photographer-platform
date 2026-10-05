import { describe, expect, it } from "vitest";

import { GalleryCursorCodec, InvalidGalleryCursorError } from "./gallery-cursor.js";
import { generatePublicGallerySlug } from "./public-slug.js";

const NOW = Date.UTC(2026, 8, 29);
const POSITION = {
  albumId: "private-album-id",
  catalogVersion: 7,
  sortOrder: 42,
  photoId: "private-photo-id",
};

describe("GalleryCursorCodec", () => {
  it("round-trips an opaque, authenticated cursor", () => {
    const codec = new GalleryCursorCodec(Buffer.alloc(32, 1), () => NOW);
    const token = codec.encode(POSITION);

    expect(token).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(token).not.toContain(POSITION.albumId);
    expect(Buffer.from(token, "base64url").toString("utf8")).not.toContain(POSITION.photoId);
    expect(codec.decode(token)).toEqual(POSITION);
    expect(codec.encode(POSITION)).not.toBe(token);
  });

  it("rejects tampering, another key, malformed input, and an undersized secret", () => {
    const codec = new GalleryCursorCodec(Buffer.alloc(32, 2), () => NOW);
    const token = codec.encode(POSITION);
    const altered = `${token.slice(0, 10)}${token[10] === "A" ? "B" : "A"}${token.slice(11)}`;

    expect(() => codec.decode(altered)).toThrow(InvalidGalleryCursorError);
    expect(() => new GalleryCursorCodec(Buffer.alloc(32, 3), () => NOW).decode(token)).toThrow(
      InvalidGalleryCursorError,
    );
    expect(() => codec.decode("%not-base64%")).toThrow(InvalidGalleryCursorError);
    expect(() => codec.decode("A".repeat(1025))).toThrow(InvalidGalleryCursorError);
    expect(() => new GalleryCursorCodec(Buffer.alloc(16))).toThrow("32-byte");
  });

  it("expires after 24 hours and rejects future-issued tokens", () => {
    const token = new GalleryCursorCodec(Buffer.alloc(32, 4), () => NOW).encode(POSITION);
    expect(() => new GalleryCursorCodec(Buffer.alloc(32, 4), () => NOW + 24 * 60 * 60 * 1000 + 1).decode(token)).toThrow(
      InvalidGalleryCursorError,
    );
    expect(() => new GalleryCursorCodec(Buffer.alloc(32, 4), () => NOW - 6 * 60 * 1000).decode(token)).toThrow(
      InvalidGalleryCursorError,
    );
  });
});

describe("generatePublicGallerySlug (ALB-003)", () => {
  it("produces non-sequential random URL-safe 24-character slugs", () => {
    const slugs = Array.from({ length: 1_000 }, generatePublicGallerySlug);
    expect(new Set(slugs).size).toBe(slugs.length);
    expect(slugs.every((slug) => /^[A-Za-z0-9_-]{24}$/.test(slug))).toBe(true);
  });
});
