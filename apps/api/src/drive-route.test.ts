import request from "supertest";
import { describe, expect, it, vi } from "vitest";

import { createApp } from "./app.js";

const ownerToken = "a".repeat(43);
const origin = "http://127.0.0.1:3000";
const connection = {
  connectionId: "connection_1",
  accountEmail: "drive@example.test",
  status: "connected" as const,
  scopeMode: "drive-file" as const,
  connectedAt: "2026-10-01T12:00:00.000Z",
};

function fixture(authenticated = true, secure = false) {
  const webOrigin = secure ? "https://photos.example.test" : origin;
  const driveConnections = {
    begin: vi.fn(() => ({ url: "https://accounts.google.com/o/oauth2/v2/auth?state=test", cookie: "drive-flow" })),
    complete: vi.fn(async () => "connection_1"),
    list: vi.fn(async () => ({ connections: [connection] })),
    disconnect: vi.fn(async () => ({ revocationConfirmed: true })),
  };
  const driveOwnerAuth = {
    authenticate: vi.fn(async () => authenticated
      ? { id: "owner-1", email: "owner@example.test", displayName: "Owner" }
      : null),
  };
  return {
    driveConnections,
    driveOwnerAuth,
    webOrigin,
    app: createApp({ driveConnections, driveOwnerAuth, driveAuthorizationConfig: { webOrigin, secure } }),
  };
}

describe("Drive connection routes (AUTH-001/004, DRIVE-004/015)", () => {
  it("fails closed when configuration or the owner session is absent", async () => {
    expect((await request(createApp()).get("/api/v1/drive/connections")).status).toBe(503);
    const signedOut = fixture(false).app;
    expect((await request(signedOut).get("/api/v1/drive/connections").set("Cookie", `pp-owner=${ownerToken}`)).status).toBe(401);
    const callback = await request(signedOut).get("/api/v1/drive/google/callback?code=code&state=state")
      .set("Cookie", "pp-drive-flow=drive-flow");
    expect(callback.headers.location).toBe(`${origin}/signin?error=failed`);
    expect(callback.headers["set-cookie"]?.[0]).toContain("pp-drive-flow=;");
  });

  it("returns only the authenticated owner's narrow connection DTO", async () => {
    const { app, driveConnections } = fixture();
    const result = await request(app).get("/api/v1/drive/connections").set("Cookie", `pp-owner=${ownerToken}`);
    expect(result.status).toBe(200);
    expect(result.body).toEqual({ connections: [connection] });
    expect(result.headers["cache-control"]).toBe("no-store");
    expect(driveConnections.list).toHaveBeenCalledWith("owner-1");
  });

  it("requires the configured origin before starting consent", async () => {
    const { app, driveConnections } = fixture();
    const denied = await request(app).post("/api/v1/drive/google")
      .set("Cookie", `pp-owner=${ownerToken}`).set("Origin", "https://attacker.test");
    expect(denied.status).toBe(403);
    expect(driveConnections.begin).not.toHaveBeenCalled();
    const started = await request(app).post("/api/v1/drive/google")
      .set("Cookie", `pp-owner=${ownerToken}`).set("Origin", origin);
    expect(started.status).toBe(303);
    expect(started.headers.location).toContain("accounts.google.com");
    expect(started.headers["set-cookie"]?.[0]).toContain("pp-drive-flow=drive-flow");
    expect(started.headers["set-cookie"]?.[0]).toContain("HttpOnly; SameSite=Lax");
  });

  it("uses a Secure host-only flow cookie on HTTPS", async () => {
    const { app, webOrigin } = fixture(true, true);
    const started = await request(app).post("/api/v1/drive/google")
      .set("Cookie", `__Host-pp-owner=${ownerToken}`).set("Origin", webOrigin);
    const cookie = started.headers["set-cookie"]?.[0];
    expect(cookie).toContain("__Host-pp-drive-flow=drive-flow");
    for (const attribute of ["Path=/", "HttpOnly", "Secure", "SameSite=Lax"]) expect(cookie).toContain(attribute);
  });

  it("binds callback completion to the authenticated owner and fixed redirect", async () => {
    const { app, driveConnections } = fixture();
    const result = await request(app).get("/api/v1/drive/google/callback?code=code&state=state&returnTo=https://attacker.test")
      .set("Cookie", `pp-owner=${ownerToken}; pp-drive-flow=drive-flow`);
    expect(result.status).toBe(303);
    expect(result.headers.location).toBe(`${origin}/workspace?drive=connected`);
    expect(driveConnections.complete).toHaveBeenCalledWith("owner-1", expect.objectContaining({ code: "code", state: "state" }), "drive-flow");
    expect(result.headers["set-cookie"]?.[0]).toContain("pp-drive-flow=;");
  });

  it("origin-checks and owner-scopes disconnect without returning credentials", async () => {
    const { app, driveConnections } = fixture();
    expect((await request(app).post("/api/v1/drive/connections/connection_1/disconnect")
      .set("Cookie", `pp-owner=${ownerToken}`)).status).toBe(403);
    const result = await request(app).post("/api/v1/drive/connections/connection_1/disconnect")
      .set("Cookie", `pp-owner=${ownerToken}`).set("Origin", origin);
    expect(result.status).toBe(303);
    expect(result.headers.location).toBe(`${origin}/workspace?drive=disconnected`);
    expect(driveConnections.disconnect).toHaveBeenCalledWith("owner-1", "connection_1");
    expect(result.text).not.toContain("token");
  });

  it("reports a remote revocation warning after local credential deletion", async () => {
    const { app, driveConnections } = fixture();
    driveConnections.disconnect.mockResolvedValueOnce({ revocationConfirmed: false });
    const result = await request(app).post("/api/v1/drive/connections/connection_1/disconnect")
      .set("Cookie", `pp-owner=${ownerToken}`).set("Origin", origin);
    expect(result.headers.location).toBe(`${origin}/workspace?drive=revocation-warning`);
  });
});
