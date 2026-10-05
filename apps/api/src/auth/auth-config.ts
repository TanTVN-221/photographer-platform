import { z } from "zod";

import type { ApiRuntimeConfig } from "../runtime-config.js";

const schema = z.object({
  GOOGLE_CLIENT_ID: z.string().min(1).max(512).optional(),
  GOOGLE_CLIENT_SECRET: z.string().min(1).max(512).optional(),
  AUTH_FLOW_KEY: z.string().min(1).optional(),
  PUBLIC_WEB_BASE_URL: z.string().optional(),
  PUBLIC_API_BASE_URL: z.string().optional(),
});

export interface PhotographerAuthConfig {
  readonly clientId: string;
  readonly clientSecret: string;
  readonly flowKey: Buffer;
  readonly webOrigin: string;
  readonly callbackUrl: string;
  readonly secure: boolean;
}

export function parsePhotographerAuthConfig(input: unknown, base: ApiRuntimeConfig): PhotographerAuthConfig | null {
  const env = schema.parse(input);
  if (env.GOOGLE_CLIENT_ID === undefined && env.GOOGLE_CLIENT_SECRET === undefined && env.AUTH_FLOW_KEY === undefined) return null;
  if (base.databaseUrl === null || env.GOOGLE_CLIENT_ID === undefined || env.GOOGLE_CLIENT_SECRET === undefined ||
    env.AUTH_FLOW_KEY === undefined || env.PUBLIC_WEB_BASE_URL === undefined || env.PUBLIC_API_BASE_URL === undefined) {
    throw new Error("Photographer sign-in requires database, Google credentials, flow key, and public origins.");
  }
  const key = Buffer.from(env.AUTH_FLOW_KEY, "base64url");
  if (key.byteLength !== 32 || key.toString("base64url") !== env.AUTH_FLOW_KEY ||
    base.galleryCursorKey?.equals(key) || base.gallerySessionKey?.equals(key)) {
    throw new Error("AUTH_FLOW_KEY must be a distinct canonical base64url 32-byte key.");
  }
  const web = new URL(env.PUBLIC_WEB_BASE_URL);
  const api = new URL(env.PUBLIC_API_BASE_URL);
  for (const url of [web, api]) {
    if (!["https:", "http:"].includes(url.protocol) || url.username !== "" || url.password !== "" ||
      url.pathname !== "/" || url.search !== "" || url.hash !== "") throw new Error("Invalid authentication origin.");
  }
  if (web.hostname !== api.hostname || web.protocol !== api.protocol ||
    (web.protocol === "http:" && (!["127.0.0.1", "localhost", "[::1]"].includes(web.hostname) ||
      !["127.0.0.1", "localhost", "::1"].includes(base.host)))) throw new Error("Unsafe authentication origins.");
  return {
    clientId: env.GOOGLE_CLIENT_ID, clientSecret: env.GOOGLE_CLIENT_SECRET, flowKey: key,
    webOrigin: web.origin, callbackUrl: new URL("/api/v1/auth/google/callback", api).toString(),
    secure: web.protocol === "https:",
  };
}
