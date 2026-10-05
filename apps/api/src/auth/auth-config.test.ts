import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { parseApiRuntimeConfig } from "../runtime-config.js";
import { parsePhotographerAuthConfig } from "./auth-config.js";

const env = {
  DATABASE_URL: "postgresql://localhost/test", GALLERY_CURSOR_KEY: randomBytes(32).toString("base64url"),
  GOOGLE_CLIENT_ID: "test-client", GOOGLE_CLIENT_SECRET: "test-secret", AUTH_FLOW_KEY: randomBytes(32).toString("base64url"),
  PUBLIC_WEB_BASE_URL: "http://127.0.0.1:3000", PUBLIC_API_BASE_URL: "http://127.0.0.1:4000",
};
describe("photographer auth configuration (SEC-002, AUTH-004)", () => {
  it("disables auth when credentials are absent and derives the exact callback URL when configured", () => {
    expect(parsePhotographerAuthConfig({}, parseApiRuntimeConfig({}))).toBeNull();
    expect(parsePhotographerAuthConfig(env, parseApiRuntimeConfig(env))).toMatchObject({
      callbackUrl: "http://127.0.0.1:4000/api/v1/auth/google/callback", secure: false,
    });
  });
  it.each([
    { GOOGLE_CLIENT_SECRET: undefined }, { AUTH_FLOW_KEY: env.GALLERY_CURSOR_KEY },
    { PUBLIC_API_BASE_URL: "https://other.example.test" }, { PUBLIC_WEB_BASE_URL: "http://photos.example.test" },
    { PUBLIC_API_BASE_URL: "http://127.0.0.1:4000/api" }, { AUTH_FLOW_KEY: "invalid" },
  ])("rejects partial, reused-key and unsafe-origin configuration", (override) => {
    expect(() => parsePhotographerAuthConfig({ ...env, ...override }, parseApiRuntimeConfig(env))).toThrow();
  });
});
