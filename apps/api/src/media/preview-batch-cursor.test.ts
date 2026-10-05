import { describe, expect, it } from "vitest";
import { GalleryCursorCodec } from "../gallery/gallery-cursor.js";
import { PreviewBatchCursorCodec } from "./preview-batch-cursor.js";

const key = Buffer.alloc(32, 3);
const position = { ownerId: "owner_123", albumId: "album_123", catalogVersion: 4, after: { sortOrder: 5, photoId: "photo_123" } };
describe("private preview continuation (SEC-001/002)", () => {
  it("encrypts randomized tokens with no identifiers exposed", () => {
    const codec = new PreviewBatchCursorCodec(key);
    const a = codec.encode(position), b = codec.encode(position);
    expect(a).not.toBe(b);
    expect(codec.decode(a)).toEqual(position);
    expect(Buffer.from(a, "base64url").toString()).not.toContain("owner_123");
  });
  it("rejects tampering, invalid encodings and other cursor domains", () => {
    const codec = new PreviewBatchCursorCodec(key);
    const token = codec.encode(position);
    const bytes = Buffer.from(token, "base64url"); bytes[15] = (bytes[15] ?? 0) ^ 1;
    const gallery = new GalleryCursorCodec(key).encode({ albumId: "album_123", catalogVersion: 4, sortOrder: 5, photoId: "photo_123" });
    for (const invalid of ["", "a".repeat(2049), `${token}=`, bytes.toString("base64url"), gallery]) {
      expect(() => codec.decode(invalid)).toThrow(expect.objectContaining({ code: "invalid-cursor" }));
    }
  });
  it("expires after one day, rejects future timestamps and wrong keys", () => {
    const token = new PreviewBatchCursorCodec(key, () => 1_000_000).encode(position);
    for (const codec of [new PreviewBatchCursorCodec(key, () => 90_000_000), new PreviewBatchCursorCodec(key, () => 0), new PreviewBatchCursorCodec(Buffer.alloc(32, 2))]) {
      expect(() => codec.decode(token)).toThrow(expect.objectContaining({ code: "invalid-cursor" }));
    }
    expect(() => new PreviewBatchCursorCodec(Buffer.alloc(20))).toThrow();
  });
});
