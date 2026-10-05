import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

import { z } from "zod";

const tokenSchema = z.string().min(1).max(8192);

export class DriveTokenCipher {
  private readonly key: Buffer;

  constructor(key: Uint8Array, readonly keyVersion: string) {
    if (key.byteLength !== 32 || !/^[A-Za-z0-9._-]{1,32}$/.test(keyVersion)) {
      throw new Error("Drive token encryption requires a versioned 32-byte key.");
    }
    this.key = Buffer.from(key);
  }

  encrypt(refreshToken: string, ownerId: string, googleAccountId: string): Uint8Array<ArrayBuffer> {
    const token = tokenSchema.parse(refreshToken);
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", this.key, iv);
    cipher.setAAD(this.aad(ownerId, googleAccountId));
    const encrypted = Buffer.concat([cipher.update(token, "utf8"), cipher.final()]);
    return Uint8Array.from(Buffer.concat([iv, encrypted, cipher.getAuthTag()]));
  }

  decrypt(ciphertext: Uint8Array, storedKeyVersion: string, ownerId: string, googleAccountId: string): string {
    if (storedKeyVersion !== this.keyVersion || ciphertext.byteLength < 29 || ciphertext.byteLength > 16_384) {
      throw new Error("Stored Drive credentials cannot be decrypted.");
    }
    try {
      const bytes = Buffer.from(ciphertext);
      const decipher = createDecipheriv("aes-256-gcm", this.key, bytes.subarray(0, 12));
      decipher.setAAD(this.aad(ownerId, googleAccountId));
      decipher.setAuthTag(bytes.subarray(-16));
      return tokenSchema.parse(Buffer.concat([
        decipher.update(bytes.subarray(12, -16)), decipher.final(),
      ]).toString("utf8"));
    } catch {
      throw new Error("Stored Drive credentials cannot be decrypted.");
    }
  }

  private aad(ownerId: string, googleAccountId: string): Buffer {
    return Buffer.from(JSON.stringify(["photographer:drive-token:v1", ownerId, googleAccountId]));
  }
}
