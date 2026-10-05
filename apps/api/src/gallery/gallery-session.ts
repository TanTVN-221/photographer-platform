import { createCipheriv, createDecipheriv, createHash, randomBytes, timingSafeEqual } from "node:crypto";

import { GALLERY_SESSION_MAX_AGE_SECONDS, gallerySessionCookieName, publicGallerySlugSchema } from "@photographer-platform/shared";
import { z } from "zod";

const SESSION_TTL_MS = GALLERY_SESSION_MAX_AGE_SECONDS * 1000;
const CLOCK_SKEW_MS = 5 * 60 * 1000;
const IV_BYTES = 12;
const TAG_BYTES = 16;
const AAD = Buffer.from("photographer-platform:gallery-session:v1");
const payloadSchema = z.strictObject({
  version: z.literal(1),
  albumId: z.string().min(1).max(128),
  slug: publicGallerySlugSchema,
  passwordFingerprint: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
  issuedAt: z.number().int().nonnegative(),
});

export { gallerySessionCookieName } from "@photographer-platform/shared";

/** Reject ambiguous duplicate cookies; never decode arbitrary cookie values. */
export function readGallerySessionCookie(header: string | undefined, slug: string): string | null {
  if (header === undefined || header.length > 8192) return null;
  const name = gallerySessionCookieName(slug);
  const matches = header.split(";").map((part) => part.trim()).filter((part) => part.startsWith(`${name}=`));
  if (matches.length !== 1) return null;
  const token = matches[0]!.slice(name.length + 1);
  return token.length > 0 && token.length <= 1024 && /^[A-Za-z0-9_-]+$/.test(token) ? token : null;
}

function fingerprint(passwordHash: string): Buffer {
  return createHash("sha256").update(passwordHash, "utf8").digest();
}

export class GallerySessionCodec {
  private readonly secret: Buffer;

  constructor(secret: Uint8Array, private readonly now: () => number = Date.now) {
    if (secret.byteLength !== 32) throw new Error("A dedicated 32-byte gallery session key is required.");
    this.secret = Buffer.from(secret);
  }

  issue(album: { readonly id: string; readonly slug: string; readonly passwordHash: string }): string {
    const payload = payloadSchema.parse({
      version: 1,
      albumId: album.id,
      slug: album.slug,
      passwordFingerprint: fingerprint(album.passwordHash).toString("base64url"),
      issuedAt: this.now(),
    });
    const iv = randomBytes(IV_BYTES);
    const cipher = createCipheriv("aes-256-gcm", this.secret, iv);
    cipher.setAAD(AAD);
    const ciphertext = Buffer.concat([cipher.update(JSON.stringify(payload), "utf8"), cipher.final()]);
    return Buffer.concat([iv, ciphertext, cipher.getAuthTag()]).toString("base64url");
  }

  allows(token: string | null, album: { readonly id: string; readonly slug: string; readonly passwordHash: string }): boolean {
    if (token === null || token.length > 1024 || !/^[A-Za-z0-9_-]+$/.test(token)) return false;
    try {
      const bytes = Buffer.from(token, "base64url");
      if (bytes.toString("base64url") !== token || bytes.length <= IV_BYTES + TAG_BYTES) return false;
      const iv = bytes.subarray(0, IV_BYTES);
      const tag = bytes.subarray(bytes.length - TAG_BYTES);
      const ciphertext = bytes.subarray(IV_BYTES, bytes.length - TAG_BYTES);
      const decipher = createDecipheriv("aes-256-gcm", this.secret, iv);
      decipher.setAAD(AAD);
      decipher.setAuthTag(tag);
      const payload = payloadSchema.parse(JSON.parse(Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8")));
      const now = this.now();
      if (payload.issuedAt > now + CLOCK_SKEW_MS || now - payload.issuedAt > SESSION_TTL_MS) return false;
      const actual = Buffer.from(payload.passwordFingerprint, "base64url");
      const expected = fingerprint(album.passwordHash);
      return payload.albumId === album.id && payload.slug === album.slug &&
        actual.length === expected.length && timingSafeEqual(actual, expected);
    } catch {
      return false;
    }
  }
}

export { GALLERY_SESSION_MAX_AGE_SECONDS } from "@photographer-platform/shared";
