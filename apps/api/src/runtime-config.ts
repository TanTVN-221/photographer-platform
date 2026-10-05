import { z } from "zod";

const environmentSchema = z.object({
  API_PORT: z.coerce.number().int().min(1).max(65535).default(4000),
  API_HOST: z.string().min(1).default("127.0.0.1"),
  DATABASE_URL: z.string().min(1).optional(),
  GALLERY_CURSOR_KEY: z.string().min(1).optional(),
  GALLERY_SESSION_KEY: z.string().min(1).optional(),
  PUBLIC_WEB_BASE_URL: z.string().min(1).optional(),
  PUBLIC_API_BASE_URL: z.string().min(1).optional(),
  DERIVATIVE_STORE_ROOT: z.string().min(1).optional(),
});

export interface ApiRuntimeConfig {
  readonly host: string;
  readonly port: number;
  readonly databaseUrl: string | null;
  readonly galleryCursorKey: Buffer | null;
  readonly gallerySessionKey: Buffer | null;
  readonly passwordOrigin: string | null;
  readonly galleryCookieSecure: boolean | null;
  readonly derivativeStoreRoot: string | null;
}

export function parseApiRuntimeConfig(input: unknown): ApiRuntimeConfig {
  const parsed = environmentSchema.parse(input);
  const databaseUrl = parsed.DATABASE_URL ?? null;
  const encodedKey = parsed.GALLERY_CURSOR_KEY ?? null;
  if ((databaseUrl === null) !== (encodedKey === null)) {
    throw new Error("DATABASE_URL and GALLERY_CURSOR_KEY must be configured together.");
  }
  const derivativeStoreRoot = parsed.DERIVATIVE_STORE_ROOT ?? null;
  if (derivativeStoreRoot !== null && databaseUrl === null) {
    throw new Error("DERIVATIVE_STORE_ROOT requires the gallery database configuration.");
  }

  let galleryCursorKey: Buffer | null = null;
  if (encodedKey !== null) {
    if (!/^[A-Za-z0-9_-]+$/.test(encodedKey)) {
      throw new Error("GALLERY_CURSOR_KEY must be a canonical base64url-encoded 32-byte key.");
    }
    galleryCursorKey = Buffer.from(encodedKey, "base64url");
    if (
      galleryCursorKey.byteLength !== 32 ||
      galleryCursorKey.toString("base64url") !== encodedKey
    ) {
      throw new Error("GALLERY_CURSOR_KEY must be a canonical base64url-encoded 32-byte key.");
    }
  }

  const encodedSessionKey = parsed.GALLERY_SESSION_KEY ?? null;
  let gallerySessionKey: Buffer | null = null;
  let passwordOrigin: string | null = null;
  let galleryCookieSecure: boolean | null = null;
  if (encodedSessionKey !== null) {
    if (databaseUrl === null || parsed.PUBLIC_WEB_BASE_URL === undefined || parsed.PUBLIC_API_BASE_URL === undefined ||
      !/^[A-Za-z0-9_-]+$/.test(encodedSessionKey)) {
      throw new Error("Gallery sessions require database and validated same-host web/API origins and a dedicated key.");
    }
    gallerySessionKey = Buffer.from(encodedSessionKey, "base64url");
    if (gallerySessionKey.byteLength !== 32 || gallerySessionKey.toString("base64url") !== encodedSessionKey ||
      galleryCursorKey?.equals(gallerySessionKey)) {
      throw new Error("GALLERY_SESSION_KEY must be a distinct canonical base64url-encoded 32-byte key.");
    }
    const web = new URL(parsed.PUBLIC_WEB_BASE_URL);
    const api = new URL(parsed.PUBLIC_API_BASE_URL);
    for (const origin of [web, api]) {
      if (!(["http:", "https:"].includes(origin.protocol)) || origin.username !== "" || origin.password !== "" ||
        origin.pathname !== "/" || origin.search !== "" || origin.hash !== "") {
        throw new Error("Gallery session origins must be bare HTTP(S) origins without credentials.");
      }
    }
    if (web.hostname !== api.hostname || web.protocol !== api.protocol) {
      throw new Error("Gallery session web and API origins must share a host and scheme.");
    }
    if (web.protocol === "http:" &&
      (!(["127.0.0.1", "localhost", "[::1]"].includes(web.hostname)) ||
        !(["127.0.0.1", "localhost", "::1"].includes(parsed.API_HOST)))) {
      throw new Error("Insecure gallery session cookies are permitted only on loopback.");
    }
    passwordOrigin = web.origin;
    galleryCookieSecure = web.protocol === "https:";
  }

  return {
    host: parsed.API_HOST,
    port: parsed.API_PORT,
    databaseUrl,
    galleryCursorKey,
    gallerySessionKey,
    passwordOrigin,
    galleryCookieSecure,
    derivativeStoreRoot,
  };
}
