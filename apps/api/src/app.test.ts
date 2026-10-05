import { errorEnvelopeSchema, liveHealthSchema, systemInfoSchema } from "@photographer-platform/shared";
import request from "supertest";
import { describe, expect, it } from "vitest";

import { createApp } from "./app.js";

describe("application foundation (PROD-003, SEC-001, OPS-002)", () => {
  const app = createApp();

  it("exposes liveness without implying database or Drive readiness", async () => {
    const response = await request(app).get("/health/live");

    expect(response.status).toBe(200);
    expect(liveHealthSchema.parse(response.body)).toEqual({
      status: "ok",
      service: "photographer-platform-api",
    });
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(response.headers["x-request-id"]).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("serves the shared source-format catalog (DRIVE-011 partial)", async () => {
    const response = await request(app).get("/api/v1/system");
    const body = systemInfoSchema.parse(response.body);

    expect(response.status).toBe(200);
    expect(body.apiVersion).toBe("v1");
    expect(body.formats.some((format) => format.id === "cr3" && format.kind === "camera-raw")).toBe(true);
    expect(body.formats.some((format) => format.id === "heic" && format.supportLevel === "guaranteed")).toBe(true);
  });

  it("returns a correlated error envelope for unknown routes", async () => {
    const response = await request(app).get("/api/v1/unknown");
    const body = errorEnvelopeSchema.parse(response.body);

    expect(response.status).toBe(404);
    expect(body.error.code).toBe("NOT_FOUND");
    expect(body.error.requestId).toBe(response.headers["x-request-id"]);
  });

  it("rejects malformed JSON with a safe error envelope (SEC-001 partial)", async () => {
    const response = await request(app)
      .post("/api/v1/system")
      .set("Content-Type", "application/json")
      .send("{not valid json");

    expect(response.status).toBe(400);
    expect(errorEnvelopeSchema.parse(response.body).error.code).toBe("INVALID_JSON");
  });

  it("rejects an oversized JSON body with a bounded error", async () => {
    const response = await request(app)
      .post("/api/v1/system")
      .send({ value: "x".repeat(70_000) });

    expect(response.status).toBe(413);
    expect(errorEnvelopeSchema.parse(response.body).error.code).toBe("PAYLOAD_TOO_LARGE");
  });
});
