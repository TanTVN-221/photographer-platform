import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { z } from "zod";

const positionSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("albums"), ownerId: z.string().min(1).max(128),
    albumId: z.string().min(1).max(128), createdAt: z.iso.datetime() }),
  z.strictObject({ kind: z.literal("review"), ownerId: z.string().min(1).max(128),
    albumId: z.string().min(1).max(128), photoId: z.string().min(1).max(128),
    snapshot: z.string().regex(/^[a-f0-9]{64}$/) }),
]);
const payloadSchema = z.strictObject({ position: positionSchema, issuedAt: z.number().int().nonnegative() });
const aad = Buffer.from("photographer-platform:owner-cursor:v1");
export type OwnerCursor = z.infer<typeof positionSchema>;

export class WorkspaceError extends Error {
  constructor(readonly code: "not-found" | "invalid-cursor" | "stale-cursor" | "conflict") {
    super(code === "not-found" ? "The album was not found." : code === "conflict" ?
      "The album cannot be changed right now." : "This page is invalid or has changed. Return to the first page.");
    this.name = "WorkspaceError";
  }
}

/** Uses the configured cursor key with domain-separated authenticated data. */
export class OwnerCursorCodec {
  private readonly key: Buffer;
  constructor(key: Uint8Array, private readonly now: () => number = Date.now) {
    if (key.byteLength !== 32) throw new Error("A 32-byte cursor key is required.");
    this.key = Buffer.from(key);
  }
  encode(position: OwnerCursor): string {
    const payload = payloadSchema.parse({ position, issuedAt: this.now() });
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", this.key, iv);
    cipher.setAAD(aad);
    const bytes = Buffer.concat([cipher.update(JSON.stringify(payload), "utf8"), cipher.final()]);
    return Buffer.concat([iv, bytes, cipher.getAuthTag()]).toString("base64url");
  }
  decode(token: string): OwnerCursor {
    try {
      if (!/^[A-Za-z0-9_-]{1,2048}$/.test(token)) throw new Error();
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
    } catch { throw new WorkspaceError("invalid-cursor"); }
  }
}
