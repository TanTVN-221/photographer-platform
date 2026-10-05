import type { DatabaseClient } from "@photographer-platform/database";
import { describe, expect, it, vi } from "vitest";
import type { DerivativeStore } from "../media/derivative-store.js";
import { OwnerReviewImageService } from "./owner-review-image.js";

function fixture() {
  const findFirst = vi.fn().mockResolvedValue({ photo: { sourceRevision: "revision", previewRevision: "revision", previewStatus: "READY" } });
  const read = vi.fn().mockResolvedValue({ bytes: Buffer.from("thumbnail") });
  const service = new OwnerReviewImageService({ selectionItem: { findFirst } } as unknown as DatabaseClient,
    { read } as unknown as DerivativeStore);
  return { service, findFirst, read };
}
describe("private owner review thumbnails (IMG-001, AUTH-004, SEL-010)", () => {
  it("requires selection membership and ownership, reads only a derivative, and supports archived/removed items", async () => {
    const { service, findFirst, read } = fixture();
    expect(await service.read("owner", "album", "photo")).toEqual(Buffer.from("thumbnail"));
    expect(findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: {
      albumId: "album", photoId: "photo", selection: { album: { ownerId: "owner" } },
    } }));
    expect(read).toHaveBeenCalledWith({ photoId: "photo", sourceRevision: "revision" }, "thumbnail");
  });
  it("does not touch storage for unavailable, stale or unauthorized metadata", async () => {
    const { service, findFirst, read } = fixture();
    for (const item of [null, { photo: { previewStatus: "PENDING", sourceRevision: "revision", previewRevision: null } },
      { photo: { previewStatus: "READY", sourceRevision: "new", previewRevision: "old" } }]) {
      findFirst.mockResolvedValueOnce(item);
      await expect(service.read("other", "album", "photo")).rejects.toMatchObject({ code: "not-found" });
    }
    expect(read).not.toHaveBeenCalled();
  });
  it("handles missing retained derivatives without exposing storage paths", async () => {
    const { service, read } = fixture();
    read.mockResolvedValueOnce(null);
    await expect(service.read("owner", "album", "photo")).rejects.toMatchObject({ code: "not-found" });
  });
});
