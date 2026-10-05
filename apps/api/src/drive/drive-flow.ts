import { createCipheriv, createDecipheriv, createHash, randomBytes, timingSafeEqual } from "node:crypto";

import { z } from "zod";

export const DRIVE_FLOW_MAX_AGE_SECONDS = 10 * 60;
const randomValue = z.string().regex(/^[A-Za-z0-9_-]{43}$/);
const payloadSchema = z.strictObject({
  version: z.literal(1),
  ownerId: z.string().min(1).max(128),
  state: randomValue,
  nonce: randomValue,
  verifier: randomValue,
  issuedAt: z.number().int().nonnegative(),
});

export class DriveFlowCodec {
  private readonly key: Buffer;
  private readonly aad: Buffer;

  constructor(key: Uint8Array, clientId: string, callbackUrl: string, private readonly now: () => number = Date.now) {
    if (key.byteLength !== 32) throw new Error("Drive flow requires a 32-byte key.");
    this.key = Buffer.from(key);
    this.aad = Buffer.from(JSON.stringify(["photographer:drive-flow:v1", clientId, callbackUrl]));
  }

  issue(ownerId: string) {
    const payload = {
      version: 1 as const,
      ownerId,
      state: randomBytes(32).toString("base64url"),
      nonce: randomBytes(32).toString("base64url"),
      verifier: randomBytes(32).toString("base64url"),
      issuedAt: this.now(),
    };
    payloadSchema.parse(payload);
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", this.key, iv);
    cipher.setAAD(this.aad);
    const encrypted = Buffer.concat([cipher.update(JSON.stringify(payload)), cipher.final()]);
    return {
      state: payload.state,
      nonce: payload.nonce,
      challenge: createHash("sha256").update(payload.verifier).digest("base64url"),
      cookie: Buffer.concat([iv, encrypted, cipher.getAuthTag()]).toString("base64url"),
    };
  }

  read(token: string | null, state: string, ownerId: string): { nonce: string; verifier: string } | null {
    if (token === null || token.length > 2048 || !/^[A-Za-z0-9_-]+$/.test(token) || !randomValue.safeParse(state).success) return null;
    try {
      const bytes = Buffer.from(token, "base64url");
      if (bytes.length < 29 || bytes.toString("base64url") !== token) return null;
      const decipher = createDecipheriv("aes-256-gcm", this.key, bytes.subarray(0, 12));
      decipher.setAAD(this.aad);
      decipher.setAuthTag(bytes.subarray(-16));
      const payload = payloadSchema.parse(JSON.parse(Buffer.concat([
        decipher.update(bytes.subarray(12, -16)), decipher.final(),
      ]).toString("utf8")));
      const age = this.now() - payload.issuedAt;
      if (age < -60_000 || age >= DRIVE_FLOW_MAX_AGE_SECONDS * 1000 || payload.ownerId !== ownerId ||
        !timingSafeEqual(Buffer.from(payload.state), Buffer.from(state))) return null;
      return { nonce: payload.nonce, verifier: payload.verifier };
    } catch { return null; }
  }
}
