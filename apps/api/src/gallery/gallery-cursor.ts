import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

import { z } from "zod";

const CURSOR_VERSION = 1;
const CURSOR_TTL_MS = 24 * 60 * 60 * 1000;
const CLOCK_SKEW_MS = 5 * 60 * 1000;
const IV_BYTES = 12;
const TAG_BYTES = 16;
const CURSOR_AAD = Buffer.from("photographer-platform:gallery-cursor:v1");

const cursorSchema = z.strictObject({
  version: z.literal(CURSOR_VERSION),
  albumId: z.string().min(1).max(128),
  catalogVersion: z.number().int().nonnegative(),
  sortOrder: z.number().int().nonnegative(),
  photoId: z.string().min(1).max(128),
  issuedAt: z.number().int().nonnegative(),
});

export type GalleryCursor = Omit<z.infer<typeof cursorSchema>, "version" | "issuedAt">;

export class InvalidGalleryCursorError extends Error {
  constructor() {
    super("The gallery page cursor is invalid or expired. Reload the gallery.");
    this.name = "InvalidGalleryCursorError";
  }
}

export class GalleryCursorCodec {
  private readonly secret: Buffer;
  private readonly now: () => number;

  constructor(secret: Uint8Array, now: () => number = Date.now) {
    if (secret.byteLength !== 32) {
      throw new Error("A dedicated 32-byte gallery cursor key is required.");
    }
    this.secret = Buffer.from(secret);
    this.now = now;
  }

  encode(cursor: GalleryCursor): string {
    const payload = cursorSchema.parse({
      ...cursor,
      version: CURSOR_VERSION,
      issuedAt: this.now(),
    });
    const iv = randomBytes(IV_BYTES);
    const cipher = createCipheriv("aes-256-gcm", this.secret, iv);
    cipher.setAAD(CURSOR_AAD);
    const ciphertext = Buffer.concat([
      cipher.update(JSON.stringify(payload), "utf8"),
      cipher.final(),
    ]);
    return Buffer.concat([iv, ciphertext, cipher.getAuthTag()]).toString("base64url");
  }

  decode(token: string): GalleryCursor {
    if (token.length === 0 || token.length > 1024 || !/^[A-Za-z0-9_-]+$/.test(token)) {
      throw new InvalidGalleryCursorError();
    }
    try {
      const bytes = Buffer.from(token, "base64url");
      if (bytes.length <= IV_BYTES + TAG_BYTES) throw new InvalidGalleryCursorError();
      const iv = bytes.subarray(0, IV_BYTES);
      const tag = bytes.subarray(bytes.length - TAG_BYTES);
      const ciphertext = bytes.subarray(IV_BYTES, bytes.length - TAG_BYTES);
      const decipher = createDecipheriv("aes-256-gcm", this.secret, iv);
      decipher.setAAD(CURSOR_AAD);
      decipher.setAuthTag(tag);
      const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
      const payload = cursorSchema.parse(JSON.parse(plaintext.toString("utf8")));
      const now = this.now();
      if (payload.issuedAt > now + CLOCK_SKEW_MS || now - payload.issuedAt > CURSOR_TTL_MS) {
        throw new InvalidGalleryCursorError();
      }
      return {
        albumId: payload.albumId,
        catalogVersion: payload.catalogVersion,
        sortOrder: payload.sortOrder,
        photoId: payload.photoId,
      };
    } catch {
      throw new InvalidGalleryCursorError();
    }
  }
}
