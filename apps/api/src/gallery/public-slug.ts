import { randomBytes } from "node:crypto";

// The Album.publicSlug unique index remains the final collision guard.
export function generatePublicGallerySlug(): string {
  return randomBytes(18).toString("base64url");
}
