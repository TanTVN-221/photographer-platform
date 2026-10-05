import request from "supertest";
import { describe, expect, it, vi } from "vitest";
import { createApp } from "./app.js";

function fixture(secure = false) {
  const origin = secure ? "https://photos.example.test" : "http://127.0.0.1:3000";
  const token = "a".repeat(43);
  const auth = {
    begin: vi.fn(() => ({ url: "https://accounts.google.com/o/oauth2/v2/auth?state=test", cookie: "flow-cookie" })),
    complete: vi.fn(async () => token),
    authenticate: vi.fn(async () => ({ id: "private-owner", email: "owner@example.test", displayName: "Owner" })),
    logout: vi.fn(async () => undefined),
  };
  return { app: createApp({ ownerAuth: auth, ownerAuthConfig: { secure, webOrigin: origin } }), auth, origin, token };
}

describe("Google sign-in routes (AUTH-001/002/004, SEC-001/004/005)", () => {
  it("exposes unavailable configuration safely", async () => {
    const app = createApp();
    expect((await request(app).get("/api/v1/auth/status")).body).toEqual({ configured: false });
    expect((await request(app).post("/api/v1/auth/google")).status).toBe(503);
  });
  it("rejects cross-origin login/logout and does not perform either action", async () => {
    const { app, auth } = fixture();
    expect((await request(app).post("/api/v1/auth/google").set("Origin", "https://attacker.test")).status).toBe(403);
    expect((await request(app).post("/api/v1/auth/logout")).status).toBe(403);
    expect(auth.begin).not.toHaveBeenCalled();
    expect(auth.logout).not.toHaveBeenCalled();
  });
  it.each([undefined, "null", "https://attacker.test", "http://localhost:3000",
    "http://127.0.0.1:4000", "http://127.0.0.1:3000/path"])(
    "rejects opaque, missing and mismatched login/logout origins: %s", async (origin) => {
      const { app, auth } = fixture();
      for (const path of ["/api/v1/auth/google", "/api/v1/auth/logout"]) {
        const call = request(app).post(path);
        if (origin !== undefined) call.set("Origin", origin);
        const response = await call;
        expect(response.status).toBe(403);
        expect(response.body.error.code).toBe("ORIGIN_REJECTED");
        expect(response.headers["set-cookie"]).toBeUndefined();
      }
      expect(auth.begin).not.toHaveBeenCalled();
      expect(auth.logout).not.toHaveBeenCalled();
    },
  );
  it("does not use a valid Referer to override an explicit opaque Origin", async () => {
    const { app, auth, origin } = fixture();
    const response = await request(app).post("/api/v1/auth/google")
      .set("Origin", "null").set("Referer", `${origin}/signin`);
    expect(response.status).toBe(403);
    expect(auth.begin).not.toHaveBeenCalled();
  });
  it("issues HttpOnly Secure host cookies and redirects only to configured destinations", async () => {
    const { app, origin, auth, token } = fixture(true);
    const start = await request(app).post("/api/v1/auth/google").set("Origin", origin);
    expect(start.status).toBe(303);
    expect(start.headers["set-cookie"]?.[0]).toContain("__Host-pp-login=flow-cookie");
    expect(start.headers["set-cookie"]?.[0]).toContain("HttpOnly; Secure; SameSite=Lax");
    const result = await request(app).get("/api/v1/auth/google/callback?code=private-code&state=test&returnTo=https://attacker.test")
      .set("Cookie", `__Host-pp-login=flow-cookie; __Host-pp-owner=${token}`);
    expect(result.status).toBe(303);
    expect(result.headers.location).toBe(`${origin}/workspace`);
    expect(result.headers["referrer-policy"]).toBe("no-referrer");
    expect(String(result.headers["set-cookie"])).toContain(`__Host-pp-owner=${token}`);
    expect(auth.complete.mock.calls[0]?.slice(1)).toEqual(["flow-cookie", token]);
  });
  it("clears callback proof and hides provider failures", async () => {
    const { app, auth, origin } = fixture();
    auth.complete.mockRejectedValueOnce(new Error("sensitive-provider-token"));
    const result = await request(app).get("/api/v1/auth/google/callback?code=private-code&state=test");
    expect(result.headers.location).toBe(`${origin}/signin?error=failed`);
    expect(result.headers["set-cookie"]?.[0]).toContain("pp-login=;");
    expect(result.text).not.toContain("sensitive-provider-token");
    auth.complete.mockClear();
    await request(app).get("/api/v1/auth/google/callback?error=access_denied");
    expect(auth.complete).not.toHaveBeenCalled();
  });
  it("returns only the authenticated profile and revokes the session on logout", async () => {
    const { app, auth, origin, token } = fixture();
    const profile = await request(app).get("/api/v1/auth/session").set("Cookie", `pp-owner=${token}`);
    expect(profile.body).toEqual({ email: "owner@example.test", displayName: "Owner" });
    expect(profile.headers["cache-control"]).toBe("no-store");
    const logout = await request(app).post("/api/v1/auth/logout").set("Origin", origin).set("Cookie", `pp-owner=${token}`);
    expect(logout.headers.location).toBe(`${origin}/signin`);
    expect(auth.logout).toHaveBeenCalledWith(token);
  });
});
