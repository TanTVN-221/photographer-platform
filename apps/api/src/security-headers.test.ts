import request from "supertest";
import { describe, expect, it } from "vitest";

import { createApp } from "./app.js";

describe("API browser isolation (SEC-005, AUTH-004, GAL-007)", () => {
  it.each(["/health/live", "/health/ready", "/api/v1/system", "/api/v1/workspace/albums", "/unknown"])("protects successful and failed responses for %s", async (path) => {
    const response = await request(createApp()).get(path).set("Origin", "https://evil.example.test");
    expect(response.headers["content-security-policy"]).toBe("default-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'");
    expect(response.headers["x-content-type-options"]).toBe("nosniff");
    expect(response.headers["x-frame-options"]).toBe("DENY");
    expect(response.headers["referrer-policy"]).toBe("no-referrer");
    expect(response.headers["cross-origin-resource-policy"]).toBe("same-site");
    expect(response.headers["cross-origin-opener-policy"]).toBe("same-origin");
    expect(response.headers["permissions-policy"]).toContain("camera=()");
    expect(response.headers["access-control-allow-origin"]).toBeUndefined();
    expect(response.headers["access-control-allow-credentials"]).toBeUndefined();
    expect(response.headers["strict-transport-security"]).toBeUndefined();
    expect(response.headers["x-powered-by"]).toBeUndefined();
  });

  it("protects JSON parse failures before the request reaches any handler", async () => {
    const response = await request(createApp()).post("/api/v1/system").set("Content-Type", "application/json").send("{invalid");
    expect(response.status).toBe(400);
    expect(response.headers["x-content-type-options"]).toBe("nosniff");
    expect(response.headers["content-security-policy"]).toContain("default-src 'none'");
  });

  it("does not grant credentialed cross-origin fetches during preflight", async () => {
    const response = await request(createApp()).options("/api/v1/workspace/albums")
      .set("Origin", "https://evil.example.test").set("Access-Control-Request-Method", "POST");
    expect(response.headers["access-control-allow-origin"]).toBeUndefined();
    expect(response.headers["access-control-allow-credentials"]).toBeUndefined();
    expect(response.headers["cross-origin-resource-policy"]).toBe("same-site");
  });

  it("preserves same-site image delivery and security headers on conditional 304 reads", async () => {
    const app = createApp({ galleryImages: { readPasswordless: async () => ({ bytes: Buffer.from("stored-webp-fixture"), etag: '"stored-revision"' }) } });
    const path = `/api/v1/galleries/${"a".repeat(24)}/images/photo_123/thumbnail/${"b".repeat(24)}.webp`;
    const image = await request(app).get(path);
    expect(image.status).toBe(200);
    expect(image.headers["content-type"]).toContain("image/webp");
    expect(image.headers["cross-origin-resource-policy"]).toBe("same-site");
    expect(image.headers["cache-control"]).toBe("private, no-cache");
    const revalidated = await request(app).get(path).set("If-None-Match", '"stored-revision"');
    expect(revalidated.status).toBe(304);
    expect(revalidated.headers["x-content-type-options"]).toBe("nosniff");
    expect(revalidated.headers["cross-origin-resource-policy"]).toBe("same-site");
    expect(revalidated.headers["access-control-allow-origin"]).toBeUndefined();
  });
});
