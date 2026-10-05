import { z } from "zod";

import type { ApiRuntimeConfig } from "../runtime-config.js";
import type { PhotographerAuthConfig } from "../auth/auth-config.js";

const schema = z.object({
  DRIVE_TOKEN_KEY: z.string().min(1).optional(),
  DRIVE_TOKEN_KEY_VERSION: z.string().regex(/^[A-Za-z0-9._-]{1,32}$/).optional(),
  PUBLIC_API_BASE_URL: z.string().optional(),
});

export interface DriveAuthorizationConfig {
  readonly clientId: string;
  readonly clientSecret: string;
  readonly flowKey: Buffer;
  readonly tokenKey: Buffer;
  readonly tokenKeyVersion: string;
  readonly webOrigin: string;
  readonly callbackUrl: string;
  readonly secure: boolean;
}

export function parseDriveAuthorizationConfig(
  input: unknown,
  base: ApiRuntimeConfig,
  auth: PhotographerAuthConfig | null,
): DriveAuthorizationConfig | null {
  const env = schema.parse(input);
  if (env.DRIVE_TOKEN_KEY === undefined && env.DRIVE_TOKEN_KEY_VERSION === undefined) return null;
  if (auth === null || base.databaseUrl === null || env.DRIVE_TOKEN_KEY === undefined ||
    env.DRIVE_TOKEN_KEY_VERSION === undefined || env.PUBLIC_API_BASE_URL === undefined) {
    throw new Error("Drive authorization requires photographer auth, database, and token encryption configuration.");
  }
  const tokenKey = Buffer.from(env.DRIVE_TOKEN_KEY, "base64url");
  if (tokenKey.byteLength !== 32 || tokenKey.toString("base64url") !== env.DRIVE_TOKEN_KEY ||
    tokenKey.equals(auth.flowKey) || (base.galleryCursorKey !== null && tokenKey.equals(base.galleryCursorKey)) ||
    (base.gallerySessionKey !== null && tokenKey.equals(base.gallerySessionKey))) {
    throw new Error("DRIVE_TOKEN_KEY must be a distinct canonical base64url 32-byte key.");
  }
  const api = new URL(env.PUBLIC_API_BASE_URL);
  return {
    clientId: auth.clientId,
    clientSecret: auth.clientSecret,
    flowKey: auth.flowKey,
    tokenKey,
    tokenKeyVersion: env.DRIVE_TOKEN_KEY_VERSION,
    webOrigin: auth.webOrigin,
    callbackUrl: new URL("/api/v1/drive/google/callback", api).toString(),
    secure: auth.secure,
  };
}
