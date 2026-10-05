import { AlbumStatus, type DatabaseClient } from "@photographer-platform/database";
import { galleryUnlockRequestSchema } from "@photographer-platform/shared";

import { verifyGalleryPassword } from "./gallery-password.js";
import { GallerySessionCodec } from "./gallery-session.js";

export class GalleryAccessError extends Error {
  constructor(readonly code: "invalid-request" | "denied") {
    super(code === "invalid-request" ? "The password request is invalid." : "The gallery password is incorrect or unavailable.");
    this.name = "GalleryAccessError";
  }
}

export class GalleryAccessService {
  constructor(
    private readonly database: DatabaseClient,
    private readonly sessions: GallerySessionCodec,
  ) {}

  async provePassword(input: unknown): Promise<string> {
    const parsed = galleryUnlockRequestSchema.safeParse(input);
    if (!parsed.success) throw new GalleryAccessError("invalid-request");
    const album = await this.database.album.findUnique({
      where: { publicSlug: parsed.data.slug },
      select: { id: true, publicSlug: true, status: true, passwordHash: true },
    });
    if (album === null || album.status !== AlbumStatus.PUBLISHED || album.passwordHash === null ||
      !(await verifyGalleryPassword(parsed.data.password, album.passwordHash))) {
      throw new GalleryAccessError("denied");
    }
    return this.sessions.issue({ id: album.id, slug: album.publicSlug, passwordHash: album.passwordHash });
  }
}
