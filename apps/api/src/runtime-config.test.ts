import { randomBytes } from "node:crypto";

import { describe, expect, it } from "vitest";

import { parseApiRuntimeConfig } from "./runtime-config.js";

describe("API runtime configuration (SEC-002, OPS-004)", () => {
  it("runs the public foundation without database credentials", () => {
    expect(parseApiRuntimeConfig({})).toEqual({
      host: "127.0.0.1",
      port: 4000,
      databaseUrl: null,
      galleryCursorKey: null,
      gallerySessionKey: null,
      passwordOrigin: null,
      galleryCookieSecure: null,
      derivativeStoreRoot: null,
    });
  });

  it("accepts a paired database URL and canonical 32-byte cursor key", () => {
    const key = randomBytes(32);
    expect(parseApiRuntimeConfig({
      API_HOST: "0.0.0.0",
      API_PORT: "4200",
      DATABASE_URL: "postgresql://local@127.0.0.1:5432/photographer_platform",
      GALLERY_CURSOR_KEY: key.toString("base64url"),
    })).toEqual({
      host: "0.0.0.0",
      port: 4200,
      databaseUrl: "postgresql://local@127.0.0.1:5432/photographer_platform",
      galleryCursorKey: key,
      gallerySessionKey: null,
      passwordOrigin: null,
      galleryCookieSecure: null,
      derivativeStoreRoot: null,
    });
  });

  it("accepts an optional private derivative root only with database configuration", () => {
    const key = randomBytes(32).toString("base64url");
    expect(parseApiRuntimeConfig({
      DATABASE_URL: "postgresql://local/db",
      GALLERY_CURSOR_KEY: key,
      DERIVATIVE_STORE_ROOT: "/private/persistent/derivatives",
    }).derivativeStoreRoot).toBe("/private/persistent/derivatives");
  });

  it("enables sessions only with a distinct key and same-host web/API origins", () => {
    const cursorKey = randomBytes(32).toString("base64url");
    const sessionKey = randomBytes(32);
    expect(parseApiRuntimeConfig({
      DATABASE_URL: "postgresql://local/db",
      GALLERY_CURSOR_KEY: cursorKey,
      GALLERY_SESSION_KEY: sessionKey.toString("base64url"),
      PUBLIC_WEB_BASE_URL: "http://127.0.0.1:3000",
      PUBLIC_API_BASE_URL: "http://127.0.0.1:4000",
    })).toMatchObject({
      gallerySessionKey: sessionKey,
      passwordOrigin: "http://127.0.0.1:3000",
      galleryCookieSecure: false,
    });
  });

  it("marks HTTPS gallery cookies Secure", () => {
    expect(parseApiRuntimeConfig({
      API_HOST: "0.0.0.0",
      DATABASE_URL: "postgresql://local/db",
      GALLERY_CURSOR_KEY: randomBytes(32).toString("base64url"),
      GALLERY_SESSION_KEY: randomBytes(32).toString("base64url"),
      PUBLIC_WEB_BASE_URL: "https://photos.example.test",
      PUBLIC_API_BASE_URL: "https://photos.example.test",
    }).galleryCookieSecure).toBe(true);
  });

  it.each([
    { DATABASE_URL: "postgresql://local@127.0.0.1:5432/db" },
    { GALLERY_CURSOR_KEY: randomBytes(32).toString("base64url") },
    { DATABASE_URL: "postgresql://local/db", GALLERY_CURSOR_KEY: "short" },
    { DATABASE_URL: "postgresql://local/db", GALLERY_CURSOR_KEY: `${randomBytes(32).toString("base64url")}=` },
    { DERIVATIVE_STORE_ROOT: "/private/store" },
    { GALLERY_SESSION_KEY: randomBytes(32).toString("base64url") },
    { DATABASE_URL: "postgresql://local/db", GALLERY_CURSOR_KEY: randomBytes(32).toString("base64url"),
      GALLERY_SESSION_KEY: randomBytes(32).toString("base64url"), PUBLIC_WEB_BASE_URL: "https://web.example.test",
      PUBLIC_API_BASE_URL: "https://api.example.test" },
    { API_HOST: "0.0.0.0", DATABASE_URL: "postgresql://local/db", GALLERY_CURSOR_KEY: randomBytes(32).toString("base64url"),
      GALLERY_SESSION_KEY: randomBytes(32).toString("base64url"), PUBLIC_WEB_BASE_URL: "http://127.0.0.1:3000",
      PUBLIC_API_BASE_URL: "http://127.0.0.1:4000" },
  ])("rejects incomplete or invalid private configuration", (input) => {
    expect(() => parseApiRuntimeConfig(input)).toThrow();
  });
});
