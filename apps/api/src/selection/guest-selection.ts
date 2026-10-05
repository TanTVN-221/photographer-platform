import { AlbumStatus, type DatabaseClient } from "@photographer-platform/database";
import { publicGallerySlugSchema, publicPhotoIdSchema, type GuestSelectionState } from "@photographer-platform/shared";
import { z } from "zod";

import type { GallerySessionCodec } from "../gallery/gallery-session.js";
import { SelectionService, type SelectionState } from "./selection-service.js";

const stateInputSchema = z.strictObject({
  slug: publicGallerySlugSchema,
  photoIds: z.array(publicPhotoIdSchema).max(50).refine((ids) => new Set(ids).size === ids.length),
});
const itemInputSchema = z.strictObject({ slug: publicGallerySlugSchema, photoId: publicPhotoIdSchema });

export class GuestSelectionError extends Error {
  constructor(readonly code: "invalid-request" | "not-found" | "password-required") {
    super(code === "invalid-request"
      ? "The selection request is invalid."
      : code === "not-found"
        ? "The gallery was not found."
        : "This gallery requires a valid password session.");
    this.name = "GuestSelectionError";
  }
}

export class GuestSelectionService {
  constructor(
    private readonly database: DatabaseClient,
    private readonly selections: SelectionService,
    private readonly sessions?: GallerySessionCodec,
  ) {}

  private async authorize(slug: string, sessionToken: string | null) {
    const album = await this.database.album.findUnique({
      where: { publicSlug: slug },
      select: { id: true, status: true, passwordHash: true, selectionLimit: true },
    });
    if (album === null || album.status !== AlbumStatus.PUBLISHED) throw new GuestSelectionError("not-found");
    if (album.passwordHash !== null && (this.sessions === undefined ||
      !this.sessions.allows(sessionToken, { id: album.id, slug, passwordHash: album.passwordHash }))) {
      throw new GuestSelectionError("password-required");
    }
    return album;
  }

  async state(input: unknown, sessionToken: string | null): Promise<GuestSelectionState> {
    const parsed = stateInputSchema.safeParse(input);
    if (!parsed.success) throw new GuestSelectionError("invalid-request");
    const album = await this.authorize(parsed.data.slug, sessionToken);
    return this.selections.stateForGuest(album.id, album.selectionLimit, parsed.data.photoIds);
  }

  async select(input: unknown, sessionToken: string | null): Promise<SelectionState> {
    const parsed = itemInputSchema.safeParse(input);
    if (!parsed.success) throw new GuestSelectionError("invalid-request");
    const album = await this.authorize(parsed.data.slug, sessionToken);
    return this.selections.selectPhoto(album.id, parsed.data.photoId);
  }

  async deselect(input: unknown, sessionToken: string | null): Promise<SelectionState> {
    const parsed = itemInputSchema.safeParse(input);
    if (!parsed.success) throw new GuestSelectionError("invalid-request");
    const album = await this.authorize(parsed.data.slug, sessionToken);
    return this.selections.deselectPhoto(album.id, parsed.data.photoId);
  }

  async comment(input: unknown, comment: unknown, sessionToken: string | null): Promise<string | null> {
    const parsed = itemInputSchema.safeParse(input);
    if (!parsed.success || typeof comment !== "string") throw new GuestSelectionError("invalid-request");
    const album = await this.authorize(parsed.data.slug, sessionToken);
    return this.selections.setComment(album.id, parsed.data.photoId, comment);
  }

  async submit(slug: unknown, sessionToken: string | null): Promise<SelectionState> {
    const parsed = publicGallerySlugSchema.safeParse(slug);
    if (!parsed.success) throw new GuestSelectionError("invalid-request");
    const album = await this.authorize(parsed.data, sessionToken);
    return this.selections.submit(album.id);
  }
}
