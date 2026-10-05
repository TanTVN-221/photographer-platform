import { errorEnvelopeSchema, galleryPhotoPageSchema } from "@photographer-platform/shared";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";

import { createApp } from "./app.js";
import { InvalidGalleryCursorError } from "./gallery/gallery-cursor.js";
import { GalleryListingError } from "./gallery/gallery-listing.js";

const slug = "AbCdEfGhIjKlMnOpQrStUvWx";
const path = `/api/v1/galleries/${slug}/photos`;
const page = {
  title: "Wedding",
  selectionLimit: 20,
  photos: [{
    photoId: "photo-1",
    fileName: "IMG_001.CR3",
    width: 4000,
    height: 6000,
    previewStatus: "READY" as const,
    images: null,
  }],
  nextCursor: "next-page",
};

describe("gallery metadata route (GAL-001, GAL-002, GAL-007, PERF-005, SEC-001)", () => {
  it("reports unavailable without a configured database reader", async () => {
    const response = await request(createApp()).get(path);

    expect(response.status).toBe(503);
    expect(errorEnvelopeSchema.parse(response.body).error.code).toBe("GALLERY_UNAVAILABLE");
    expect(response.headers["cache-control"]).toBe("no-store");
  });

  it("returns a bounded, shared metadata contract and forwards validated query", async () => {
    const listPasswordless = vi.fn().mockResolvedValue(page);
    const response = await request(createApp({ galleryListing: { listPasswordless } }))
      .get(`${path}?limit=25&cursor=continuation`);

    expect(response.status).toBe(200);
    expect(response.body).toEqual(galleryPhotoPageSchema.parse(page));
    expect(listPasswordless).toHaveBeenCalledExactlyOnceWith({
      slug,
      limit: 25,
      cursor: "continuation",
    });
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(response.headers["x-content-type-options"]).toBe("nosniff");
  });

  it.each([
    `${path}?limit=0`,
    `${path}?limit=101`,
    `${path}?limit=1.5`,
    `${path}?limit=1&limit=2`,
    `${path}?cursor=`,
    `${path}?unexpected=1`,
    "/api/v1/galleries/short/photos",
  ])("rejects invalid URL input before reading metadata: %s", async (url) => {
    const listPasswordless = vi.fn();
    const response = await request(createApp({ galleryListing: { listPasswordless } })).get(url);

    expect(response.status).toBe(400);
    expect(errorEnvelopeSchema.parse(response.body).error.code).toBe("INVALID_REQUEST");
    expect(listPasswordless).not.toHaveBeenCalled();
  });

  it.each([
    [new GalleryListingError("not-found"), 404, "GALLERY_NOT_FOUND"],
    [new GalleryListingError("password-required"), 403, "PASSWORD_REQUIRED"],
    [new GalleryListingError("stale-cursor"), 409, "STALE_CURSOR"],
    [new InvalidGalleryCursorError(), 400, "INVALID_CURSOR"],
  ])("maps known listing errors to safe envelopes", async (error, status, code) => {
    const listPasswordless = vi.fn().mockRejectedValue(error);
    const response = await request(createApp({ galleryListing: { listPasswordless } })).get(path);

    expect(response.status).toBe(status);
    expect(errorEnvelopeSchema.parse(response.body).error.code).toBe(code);
    expect(response.body.error.requestId).toBe(response.headers["x-request-id"]);
  });

  it("rejects unexpected private fields instead of exposing them", async () => {
    const listPasswordless = vi.fn().mockResolvedValue({ ...page, driveFileId: "private-id" });
    const response = await request(createApp({ galleryListing: { listPasswordless } })).get(path);

    expect(response.status).toBe(500);
    expect(errorEnvelopeSchema.parse(response.body).error.code).toBe("INTERNAL_ERROR");
    expect(JSON.stringify(response.body)).not.toContain("private-id");
  });

  it("does not disclose an unexpected service error", async () => {
    const listPasswordless = vi.fn().mockRejectedValue(new Error("database connection secret"));
    const response = await request(createApp({ galleryListing: { listPasswordless } })).get(path);

    expect(response.status).toBe(500);
    expect(errorEnvelopeSchema.parse(response.body).error.code).toBe("INTERNAL_ERROR");
    expect(JSON.stringify(response.body)).not.toContain("database connection secret");
  });
});
