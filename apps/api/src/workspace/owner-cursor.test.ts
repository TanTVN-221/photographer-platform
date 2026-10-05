import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { OwnerCursorCodec } from "./owner-cursor.js";
import { GalleryCursorCodec } from "../gallery/gallery-cursor.js";

describe("owner continuation tokens (AUTH-004, PERF-003, SEC-004)", () => {
  it("roundtrips encrypted positions and is nondeterministic", () => {
    const codec = new OwnerCursorCodec(randomBytes(32));
    const position = { kind: "albums" as const, ownerId: "owner", albumId: "album", createdAt: new Date().toISOString() };
    const first = codec.encode(position);
    expect(codec.decode(first)).toEqual(position);
    expect(codec.encode(position)).not.toBe(first);
    expect(first).not.toContain("owner");
  });
  it("rejects tampering, wrong keys, invalid encodings, expiry and future timestamps", () => {
    const key = randomBytes(32);
    let now = 1_800_000_000_000;
    const codec = new OwnerCursorCodec(key, () => now);
    const token = codec.encode({ kind: "review", ownerId: "owner", albumId: "album", photoId: "photo", snapshot: "a".repeat(64) });
    const bytes = Buffer.from(token, "base64url"); bytes[15] = bytes[15]! ^ 1;
    for (const invalid of ["", "a".repeat(2049), "../cursor", bytes.toString("base64url"), `${token}=`]) {
      expect(() => codec.decode(invalid)).toThrow();
    }
    expect(() => new OwnerCursorCodec(randomBytes(32)).decode(token)).toThrow();
    now += 86_400_001;
    expect(() => codec.decode(token)).toThrow();
    now -= 86_700_002;
    expect(() => codec.decode(token)).toThrow();
    expect(() => new OwnerCursorCodec(randomBytes(31))).toThrow();
  });
  it("cannot substitute guest gallery cursors even when the key is shared", () => {
    const key = randomBytes(32);
    const token = new GalleryCursorCodec(key).encode({ albumId: "album", catalogVersion: 1, sortOrder: 0, photoId: "photo" });
    expect(() => new OwnerCursorCodec(key).decode(token)).toThrow();
  });
});
