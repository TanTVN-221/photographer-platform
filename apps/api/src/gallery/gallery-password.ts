import { randomBytes, scrypt, timingSafeEqual } from "node:crypto";

import { z } from "zod";

// OWASP's comparable 32 MiB scrypt setting; keep parameters fixed on verify
// so a database value cannot request unbounded CPU or memory.
const COST = 1 << 15;
const BLOCK_SIZE = 8;
const PARALLELIZATION = 3;
const KEY_BYTES = 32;
const SALT_BYTES = 16;
const MAX_MEMORY_BYTES = 64 * 1024 * 1024;
const HASH_PREFIX = `scrypt$v1$${COST}$${BLOCK_SIZE}$${PARALLELIZATION}`;

const passwordSchema = z.string().min(1).refine(
  (value) => Buffer.byteLength(value, "utf8") <= 1024,
  { message: "Gallery passwords must be at most 1024 UTF-8 bytes." },
);

function derive(password: string, salt: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(password, salt, KEY_BYTES, {
      N: COST,
      r: BLOCK_SIZE,
      p: PARALLELIZATION,
      maxmem: MAX_MEMORY_BYTES,
    }, (error, key) => {
      if (error !== null) reject(error);
      else resolve(key);
    });
  });
}

function decodeCanonical(value: string, expectedBytes: number): Buffer | null {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) return null;
  const decoded = Buffer.from(value, "base64url");
  return decoded.byteLength === expectedBytes && decoded.toString("base64url") === value
    ? decoded
    : null;
}

/** Returns only a versioned, salted hash suitable for Album.passwordHash. */
export async function hashGalleryPassword(input: unknown): Promise<string> {
  const password = passwordSchema.parse(input);
  const salt = randomBytes(SALT_BYTES);
  const key = await derive(password, salt);
  return `${HASH_PREFIX}$${salt.toString("base64url")}$${key.toString("base64url")}`;
}

/** Malformed hashes and invalid guesses fail closed, without logging either. */
export async function verifyGalleryPassword(input: unknown, storedHash: unknown): Promise<boolean> {
  const parsed = passwordSchema.safeParse(input);
  if (!parsed.success || typeof storedHash !== "string") return false;
  const parts = storedHash.split("$");
  if (parts.length !== 7 || parts.slice(0, 5).join("$") !== HASH_PREFIX) return false;
  const salt = decodeCanonical(parts[5]!, SALT_BYTES);
  const expected = decodeCanonical(parts[6]!, KEY_BYTES);
  if (salt === null || expected === null) return false;
  const actual = await derive(parsed.data, salt);
  return timingSafeEqual(actual, expected);
}
