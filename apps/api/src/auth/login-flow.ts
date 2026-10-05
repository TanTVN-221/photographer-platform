import { createCipheriv, createDecipheriv, createHash, randomBytes, timingSafeEqual } from "node:crypto";

import { z } from "zod";

export const LOGIN_FLOW_MAX_AGE_SECONDS = 10 * 60;
const randomValue = z.string().regex(/^[A-Za-z0-9_-]{43}$/);
const payloadSchema = z.strictObject({
  version: z.literal(1), state: randomValue, nonce: randomValue, verifier: randomValue,
  issuedAt: z.number().int().nonnegative(),
});

export class LoginFlowCodec {
  private readonly key: Buffer;
  private readonly aad: Buffer;

  constructor(key: Uint8Array, clientId: string, callbackUrl: string, private readonly now: () => number = Date.now) {
    if (key.byteLength !== 32) throw new Error("Login flow requires a dedicated 32-byte key.");
    this.key = Buffer.from(key);
    this.aad = Buffer.from(JSON.stringify(["photographer:login:v1", clientId, callbackUrl]));
  }

  issue() {
    const payload = {
      version: 1 as const,
      state: randomBytes(32).toString("base64url"),
      nonce: randomBytes(32).toString("base64url"),
      verifier: randomBytes(32).toString("base64url"),
      issuedAt: this.now(),
    };
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", this.key, iv);
    cipher.setAAD(this.aad);
    const encrypted = Buffer.concat([cipher.update(JSON.stringify(payload)), cipher.final()]);
    return {
      state: payload.state, nonce: payload.nonce,
      challenge: createHash("sha256").update(payload.verifier).digest("base64url"),
      cookie: Buffer.concat([iv, encrypted, cipher.getAuthTag()]).toString("base64url"),
    };
  }

  read(token: string | null, state: string): { nonce: string; verifier: string } | null {
    if (token === null || token.length > 2048 || !/^[A-Za-z0-9_-]+$/.test(token) || !randomValue.safeParse(state).success) return null;
    try {
      const bytes = Buffer.from(token, "base64url");
      if (bytes.length < 29 || bytes.toString("base64url") !== token) return null;
      const decipher = createDecipheriv("aes-256-gcm", this.key, bytes.subarray(0, 12));
      decipher.setAAD(this.aad);
      decipher.setAuthTag(bytes.subarray(-16));
      const value = payloadSchema.parse(JSON.parse(Buffer.concat([
        decipher.update(bytes.subarray(12, -16)), decipher.final(),
      ]).toString("utf8")));
      const age = this.now() - value.issuedAt;
      if (age < -60_000 || age >= LOGIN_FLOW_MAX_AGE_SECONDS * 1000 ||
        !timingSafeEqual(Buffer.from(value.state), Buffer.from(state))) return null;
      return { nonce: value.nonce, verifier: value.verifier };
    } catch { return null; }
  }
}

export function readAuthCookie(header: string | undefined, name: string): string | null {
  if (header === undefined || header.length > 8192) return null;
  const values = header.split(";").map((part) => part.trim()).filter((part) => part.startsWith(`${name}=`));
  if (values.length !== 1) return null;
  const token = values[0]!.slice(name.length + 1);
  return token.length > 0 && token.length <= 2048 && /^[A-Za-z0-9_-]+$/.test(token) ? token : null;
}
