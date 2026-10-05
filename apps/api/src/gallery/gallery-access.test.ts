import { AlbumStatus, type DatabaseClient } from "@photographer-platform/database";
import { describe, expect, it, vi } from "vitest";

import { GalleryAccessService } from "./gallery-access.js";
import { hashGalleryPassword } from "./gallery-password.js";
import { GallerySessionCodec } from "./gallery-session.js";

const slug = "AbCdEfGhIjKlMnOpQrStUvWx";

describe("gallery password proof (GAL-002/003, SEC-001)", () => {
  it("issues a session only for a published gallery with the exact password", async () => {
    const passwordHash = await hashGalleryPassword("client passphrase");
    const album = { id: "album-1", publicSlug: slug, status: AlbumStatus.PUBLISHED, passwordHash };
    const database = { album: { findUnique: vi.fn().mockResolvedValue(album) } } as unknown as DatabaseClient;
    const sessions = new GallerySessionCodec(Buffer.alloc(32, 3), () => 1_000_000);
    const service = new GalleryAccessService(database, sessions);
    const token = await service.provePassword({ slug, password: "client passphrase" });
    expect(sessions.allows(token, { id: album.id, slug, passwordHash })).toBe(true);
    await expect(service.provePassword({ slug, password: "wrong" })).rejects.toMatchObject({ code: "denied" });
    expect(database.album.findUnique).toHaveBeenCalledWith({
      where: { publicSlug: slug },
      select: { id: true, publicSlug: true, status: true, passwordHash: true },
    });
  }, 15_000);

  it("fails closed for unpublished/passwordless/missing galleries and invalid input", async () => {
    const database = { album: { findUnique: vi.fn().mockResolvedValue(null) } } as unknown as DatabaseClient;
    const service = new GalleryAccessService(database, new GallerySessionCodec(Buffer.alloc(32, 3)));
    await expect(service.provePassword({ slug, password: "anything" })).rejects.toMatchObject({ code: "denied" });
    vi.mocked(database.album.findUnique).mockResolvedValueOnce({
      id: "album-1", publicSlug: slug, status: AlbumStatus.DRAFT, passwordHash: "hash",
    } as never);
    await expect(service.provePassword({ slug, password: "anything" })).rejects.toMatchObject({ code: "denied" });
    vi.mocked(database.album.findUnique).mockResolvedValueOnce({
      id: "album-1", publicSlug: slug, status: AlbumStatus.PUBLISHED, passwordHash: null,
    } as never);
    await expect(service.provePassword({ slug, password: "anything" })).rejects.toMatchObject({ code: "denied" });
    await expect(service.provePassword({ slug: "short", password: "anything" })).rejects.toMatchObject({ code: "invalid-request" });
    await expect(service.provePassword({ slug, password: "" })).rejects.toMatchObject({ code: "invalid-request" });
    await expect(service.provePassword({ slug, password: "a".repeat(1025) })).rejects.toMatchObject({ code: "invalid-request" });
    expect(database.album.findUnique).toHaveBeenCalledTimes(3);
  });
});
