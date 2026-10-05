import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";

import { parsePhotographerAuthConfig } from "../auth/auth-config.js";
import { parseApiRuntimeConfig } from "../runtime-config.js";
import { parseDriveAuthorizationConfig } from "./drive-config.js";

const env = {
  DATABASE_URL: "postgresql://localhost/test",
  GALLERY_CURSOR_KEY: randomBytes(32).toString("base64url"),
  GALLERY_SESSION_KEY: randomBytes(32).toString("base64url"),
  GOOGLE_CLIENT_ID: "client",
  GOOGLE_CLIENT_SECRET: "secret",
  AUTH_FLOW_KEY: randomBytes(32).toString("base64url"),
  DRIVE_TOKEN_KEY: randomBytes(32).toString("base64url"),
  DRIVE_TOKEN_KEY_VERSION: "v1",
  PUBLIC_WEB_BASE_URL: "http://127.0.0.1:3000",
  PUBLIC_API_BASE_URL: "http://127.0.0.1:4000",
};

function configs(input: Record<string, unknown> = env) {
  const runtime = parseApiRuntimeConfig(input);
  const auth = parsePhotographerAuthConfig(input, runtime);
  return { runtime, auth };
}

describe("Drive authorization configuration (DRIVE-004, SEC-002)", () => {
  it("is disabled without its encryption key and derives an exact callback when enabled", () => {
    const base = configs(env);
    expect(parseDriveAuthorizationConfig({}, parseApiRuntimeConfig({}), null)).toBeNull();
    expect(parseDriveAuthorizationConfig(env, base.runtime, base.auth)).toMatchObject({
      tokenKeyVersion: "v1",
      callbackUrl: "http://127.0.0.1:4000/api/v1/drive/google/callback",
      secure: false,
    });
  });

  it.each([
    { DRIVE_TOKEN_KEY_VERSION: undefined },
    { DRIVE_TOKEN_KEY: env.AUTH_FLOW_KEY },
    { DRIVE_TOKEN_KEY: env.GALLERY_CURSOR_KEY },
    { DRIVE_TOKEN_KEY: env.GALLERY_SESSION_KEY },
    { DRIVE_TOKEN_KEY: "invalid" },
    { DRIVE_TOKEN_KEY_VERSION: "invalid version" },
  ])("rejects partial, reused, or malformed key configuration", (override) => {
    const input = { ...env, ...override };
    const base = configs(env);
    expect(() => parseDriveAuthorizationConfig(input, base.runtime, base.auth)).toThrow();
  });
});
