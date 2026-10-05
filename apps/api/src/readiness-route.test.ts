import { readinessHealthSchema } from "@photographer-platform/shared";
import request from "supertest";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createApp } from "./app.js";
import { SelectionError } from "./selection/selection-service.js";

afterEach(() => vi.restoreAllMocks());
describe("readiness HTTP and redacted operations (OPS-002, SEC-004)", () => {
  it("keeps unconfigured infrastructure unavailable while process liveness remains healthy", async () => {
    const app = createApp();
    expect((await request(app).get("/health/live")).status).toBe(200);
    const response = await request(app).get("/health/ready");
    expect(response.status).toBe(503);
    expect(readinessHealthSchema.parse(response.body)).toEqual({ status: "not-ready", service: "photographer-platform-api" });
    expect(response.headers["cache-control"]).toBe("no-store");
  });
  it("returns a narrow ready status and never discloses raw dependency failures", async () => {
    const check = vi.fn().mockResolvedValueOnce(true).mockRejectedValueOnce(new Error("postgresql://secret/private"));
    const app = createApp({ readiness: { check } });
    expect((await request(app).get("/health/ready")).body.status).toBe("ready");
    const failure = await request(app).get("/health/ready");
    expect(failure.status).toBe(503); expect(failure.text).not.toContain("secret");
  });
  it("logs fixed operation and error codes, not path IDs, tokens, request headers or exceptions", async () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => undefined);
    const auth = { begin: vi.fn(), complete: vi.fn(), logout: vi.fn(), authenticate: vi.fn().mockResolvedValue({ id: "owner" }) };
    const workspace = { albums: vi.fn(), review: vi.fn(), archive: vi.fn() };
    const selections = { lockForOwner: vi.fn(), reopenForOwner: vi.fn(), exportSubmittedForOwner: vi.fn().mockRejectedValue(new SelectionError("not-submitted")) };
    const app = createApp({ ownerAuth: auth, ownerAuthConfig: { secure: false, webOrigin: "http://127.0.0.1:3000" },
      workspace, ownerSelections: selections });
    const response = await request(app).get("/api/v1/workspace/albums/private_album/selection/export")
      .set("Cookie", "pp-owner=secret-cookie").set("Authorization", "Bearer secret-auth");
    expect(response.status).toBe(409);
    const events = info.mock.calls.map(([value]) => JSON.parse(String(value)) as Record<string, unknown>);
    expect(events).toContainEqual(expect.objectContaining({ event: "http_request", status: 409,
      route: "/api/v1/workspace/albums/:albumId/selection/export", errorCode: "SELECTION_CONFLICT" }));
    expect(JSON.stringify(events)).not.toMatch(/secret-cookie|secret-auth|private_album|not-submitted/);
  });
});
