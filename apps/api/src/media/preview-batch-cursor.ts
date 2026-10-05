import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { z } from "zod";

export const previewBatchIdSchema = z.string().regex(/^[A-Za-z0-9_-]{1,128}$/);
export const previewBatchTokenSchema = z.string().regex(/^[A-Za-z0-9_-]{1,2048}$/);
const positionSchema = z.strictObject({
  ownerId: previewBatchIdSchema,
  albumId: previewBatchIdSchema,
  catalogVersion: z.number().int().nonnegative(),
  after: z.strictObject({ sortOrder: z.number().int().nonnegative(), photoId: previewBatchIdSchema }).nullable(),
});
const payloadSchema = z.strictObject({ position: positionSchema, issuedAt: z.number().int().nonnegative() });
const aad = Buffer.from("photographer-platform:preview-batch-cursor:v1");
export type PreviewBatchPosition = z.infer<typeof positionSchema>;

export class PreviewBatchError extends Error {
  constructor(readonly code: "invalid-request" | "invalid-cursor" | "stale-cursor" | "not-found" | "busy" | "storage-unavailable") {
    super("Preview processing could not proceed.");
    this.name = "PreviewBatchError";
  }
}

/** Private operator continuation; not an authorization credential. */
export class PreviewBatchCursorCodec {
  private readonly key: Buffer;
  constructor(key: Uint8Array, private readonly now: () => number = Date.now) {
    if (key.byteLength !== 32) throw new Error("A 32-byte cursor key is required.");
    this.key = Buffer.from(key);
  }
  encode(position: PreviewBatchPosition): string {
    const payload = payloadSchema.parse({ position, issuedAt: this.now() });
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", this.key, iv);
    cipher.setAAD(aad);
    return Buffer.concat([iv, cipher.update(JSON.stringify(payload), "utf8"), cipher.final(), cipher.getAuthTag()]).toString("base64url");
  }
  decode(token: string): PreviewBatchPosition {
    try {
      previewBatchTokenSchema.parse(token);
      const bytes = Buffer.from(token, "base64url");
      if (bytes.toString("base64url") !== token || bytes.length <= 28) throw new Error();
      const decipher = createDecipheriv("aes-256-gcm", this.key, bytes.subarray(0, 12));
      decipher.setAAD(aad);
      decipher.setAuthTag(bytes.subarray(-16));
      const payload = payloadSchema.parse(JSON.parse(Buffer.concat([
        decipher.update(bytes.subarray(12, -16)), decipher.final(),
      ]).toString("utf8")));
      const age = this.now() - payload.issuedAt;
      if (age < -300_000 || age > 86_400_000) throw new Error();
      return payload.position;
    } catch { throw new PreviewBatchError("invalid-cursor"); }
  }
}
