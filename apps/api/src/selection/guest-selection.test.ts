import { AlbumStatus, type DatabaseClient } from "@photographer-platform/database";
import { describe, expect, it, vi } from "vitest";

import { GallerySessionCodec } from "../gallery/gallery-session.js";
import { GuestSelectionService } from "./guest-selection.js";
import type { SelectionService } from "./selection-service.js";

const slug = "AbCdEfGhIjKlMnOpQrStUvWx";
const photoId = "photo-1";

function fixture() {
  const album = {
    id: "private-album-id",
    status: AlbumStatus.PUBLISHED as (typeof AlbumStatus)[keyof typeof AlbumStatus],
    passwordHash: null as string | null,
    selectionLimit: 2,
  };
  const database = { album: { findUnique: vi.fn().mockImplementation(async () => album) } } as unknown as DatabaseClient;
  const selections = {
    stateForGuest: vi.fn().mockResolvedValue({ status: "DRAFT", selectedCount: 0, selectionLimit: 2, selectedItems: [] }),
    selectPhoto: vi.fn().mockResolvedValue({ status: "DRAFT", selectedCount: 1, selectionLimit: 2 }),
    deselectPhoto: vi.fn().mockResolvedValue({ status: "DRAFT", selectedCount: 0, selectionLimit: 2 }),
    setComment: vi.fn().mockResolvedValue("Looks good"),
    submit: vi.fn().mockResolvedValue({ status: "SUBMITTED", selectedCount: 1, selectionLimit: 2 }),
  } as unknown as SelectionService;
  const sessions = new GallerySessionCodec(Buffer.alloc(32, 4), () => 1_000_000);
  const service = new GuestSelectionService(database, selections, sessions);
  return { album, database, selections, sessions, service };
}

describe("authorized guest selection facade (GAL-002/007, SEL-004–008, PERF-005)", () => {
  it("delegates passwordless actions using a private album ID without exposing it in state", async () => {
    const { service, selections } = fixture();
    expect(await service.state({ slug, photoIds: [photoId] }, null)).toEqual({
      status: "DRAFT", selectedCount: 0, selectionLimit: 2, selectedItems: [],
    });
    await service.select({ slug, photoId }, null);
    await service.deselect({ slug, photoId }, null);
    await service.comment({ slug, photoId }, "Looks good", null);
    await service.submit(slug, null);
    expect(selections.selectPhoto).toHaveBeenCalledWith("private-album-id", photoId);
    expect(selections.deselectPhoto).toHaveBeenCalledWith("private-album-id", photoId);
    expect(selections.setComment).toHaveBeenCalledWith("private-album-id", photoId, "Looks good");
    expect(selections.submit).toHaveBeenCalledWith("private-album-id");
  });

  it("denies protected or unpublished galleries before any selection read/mutation", async () => {
    const { service, album, sessions, selections } = fixture();
    album.passwordHash = "scrypt$v1$first";
    await expect(service.state({ slug, photoIds: [photoId] }, null)).rejects.toMatchObject({ code: "password-required" });
    await expect(service.select({ slug, photoId }, "invalid")).rejects.toMatchObject({ code: "password-required" });
    expect(selections.stateForGuest).not.toHaveBeenCalled();
    expect(selections.selectPhoto).not.toHaveBeenCalled();
    const token = sessions.issue({ id: album.id, slug, passwordHash: album.passwordHash });
    await expect(service.select({ slug, photoId }, token)).resolves.toMatchObject({ selectedCount: 1 });
    album.passwordHash = "scrypt$v1$changed";
    await expect(service.submit(slug, token)).rejects.toMatchObject({ code: "password-required" });
    album.status = AlbumStatus.ARCHIVED;
    await expect(service.state({ slug, photoIds: [] }, null)).rejects.toMatchObject({ code: "not-found" });
  });

  it("validates a bounded, unique current-page ID set before database access", async () => {
    const { service, database } = fixture();
    for (const input of [
      { slug: "short", photoIds: [] },
      { slug, photoIds: ["../secret"] },
      { slug, photoIds: [photoId, photoId] },
      { slug, photoIds: Array(51).fill(photoId) },
    ]) {
      await expect(service.state(input, null)).rejects.toMatchObject({ code: "invalid-request" });
    }
    await expect(service.select({ slug, photoId: "../secret" }, null)).rejects.toMatchObject({ code: "invalid-request" });
    expect(database.album.findUnique).not.toHaveBeenCalled();
  });
});
