import { errorEnvelopeSchema, guestSelectionStateSchema } from "@photographer-platform/shared";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";

import { createApp } from "./app.js";
import { gallerySessionCookieName } from "./gallery/gallery-session.js";
import { GuestSelectionError } from "./selection/guest-selection.js";
import { SelectionError } from "./selection/selection-service.js";

const slug = "AbCdEfGhIjKlMnOpQrStUvWx";
const origin = "http://127.0.0.1:3000";
const base = `/api/v1/galleries/${slug}/selection`;
const photoId = "photo_1";

function fixture() {
  const guestSelections = {
    state: vi.fn().mockResolvedValue({
      status: "DRAFT", selectedCount: 1, selectionLimit: 3,
      selectedItems: [{ photoId, comment: "Retouch" }],
    }),
    select: vi.fn().mockResolvedValue({ status: "DRAFT", selectedCount: 1, selectionLimit: 3 }),
    deselect: vi.fn().mockResolvedValue({ status: "DRAFT", selectedCount: 0, selectionLimit: 3 }),
    comment: vi.fn().mockResolvedValue("Retouch"),
    submit: vi.fn().mockResolvedValue({ status: "SUBMITTED", selectedCount: 1, selectionLimit: 3 }),
  };
  return { guestSelections, app: createApp({ guestSelections, passwordOrigin: origin }) };
}

describe("guest selection routes (GAL-002/007, SEL-004–008, SEC-001/003/005)", () => {
  it("returns a narrow, current-page state and forwards only a slug cookie", async () => {
    const { app, guestSelections } = fixture();
    const cookie = `${gallerySessionCookieName(slug)}=opaque_token; unrelated=ignored`;
    const response = await request(app).get(`${base}?photoId=${photoId}`).set("Cookie", cookie);
    expect(response.status).toBe(200);
    expect(response.body).toEqual(guestSelectionStateSchema.parse(response.body));
    expect(JSON.stringify(response.body)).not.toContain("private-album-id");
    expect(guestSelections.state).toHaveBeenCalledWith({ slug, photoIds: [photoId] }, "opaque_token");
    expect(response.headers["cache-control"]).toBe("no-store");
  });

  it("dispatches select, deselect, comment, and submit only from the configured web origin", async () => {
    const { app, guestSelections } = fixture();
    await request(app).put(`${base}/items/${photoId}`).set("Origin", origin).expect(200);
    await request(app).delete(`${base}/items/${photoId}`).set("Origin", origin).expect(200);
    await request(app).patch(`${base}/items/${photoId}/comment`).set("Origin", origin)
      .send({ comment: "Retouch" }).expect(200);
    await request(app).post(`${base}/submit`).set("Origin", origin).expect(200);
    expect(guestSelections.select).toHaveBeenCalledWith({ slug, photoId }, null);
    expect(guestSelections.deselect).toHaveBeenCalledWith({ slug, photoId }, null);
    expect(guestSelections.comment).toHaveBeenCalledWith({ slug, photoId }, "Retouch", null);
    expect(guestSelections.submit).toHaveBeenCalledWith(slug, null);
  });

  it("rejects cross-origin, invalid IDs/comments, and unexpected state before mutation", async () => {
    const { app, guestSelections } = fixture();
    const crossOrigin = await request(app).put(`${base}/items/${photoId}`).set("Origin", "https://attacker.example");
    expect(crossOrigin.status).toBe(403);
    expect(errorEnvelopeSchema.parse(crossOrigin.body).error.code).toBe("ORIGIN_REJECTED");
    await request(app).put(`${base}/items/bad%2Fid`).set("Origin", origin).expect(400);
    await request(app).patch(`${base}/items/${photoId}/comment`).set("Origin", origin)
      .send({ comment: "x".repeat(2_001) }).expect(400);
    await request(app).get(`${base}?photoId=${photoId}&photoId=${photoId}`).expect(400);
    expect(guestSelections.select).not.toHaveBeenCalled();
    expect(guestSelections.comment).not.toHaveBeenCalled();
    expect(guestSelections.state).not.toHaveBeenCalled();
  });

  it("maps session and selection conflicts to safe public envelopes", async () => {
    const { app, guestSelections } = fixture();
    guestSelections.state.mockRejectedValueOnce(new GuestSelectionError("password-required"));
    const denied = await request(app).get(base);
    expect(denied.status).toBe(403);
    expect(errorEnvelopeSchema.parse(denied.body).error.code).toBe("PASSWORD_REQUIRED");
    guestSelections.select.mockRejectedValueOnce(new SelectionError("limit-reached"));
    const limited = await request(app).put(`${base}/items/${photoId}`).set("Origin", origin);
    expect(limited.status).toBe(409);
    expect(errorEnvelopeSchema.parse(limited.body).error.code).toBe("SELECTION_CONFLICT");
  });

  it("throttles repeated mutations before invoking the selection service", async () => {
    const { app, guestSelections } = fixture();
    for (let index = 0; index < 60; index += 1) {
      await request(app).put(`${base}/items/${photoId}`).set("Origin", origin).expect(200);
    }
    const response = await request(app).put(`${base}/items/${photoId}`).set("Origin", origin);
    expect(response.status).toBe(429);
    expect(response.headers["retry-after"]).toBeDefined();
    expect(errorEnvelopeSchema.parse(response.body).error.code).toBe("MUTATION_RATE_LIMITED");
    expect(guestSelections.select).toHaveBeenCalledTimes(60);
  });

  it("does not expose a selection route without authorization composition", async () => {
    const response = await request(createApp()).get(base);
    expect(response.status).toBe(503);
    expect(errorEnvelopeSchema.parse(response.body).error.code).toBe("GALLERY_UNAVAILABLE");
  });
});
