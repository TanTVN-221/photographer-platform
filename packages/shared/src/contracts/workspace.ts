import { z } from "zod";
import { publicGallerySlugSchema } from "./gallery.js";

export const ownerAlbumIdSchema = z.string().regex(/^[A-Za-z0-9_-]{1,128}$/);
export const ownerCursorSchema = z.string().min(1).max(2048).regex(/^[A-Za-z0-9_-]+$/);
export const ownerAlbumSummarySchema = z.strictObject({
  albumId: ownerAlbumIdSchema,
  title: z.string().min(1).max(500),
  publicSlug: publicGallerySlugSchema,
  status: z.enum(["DRAFT", "PUBLISHED", "ARCHIVED"]),
  passwordProtected: z.boolean(),
  photoCount: z.number().int().nonnegative(),
  selectedCount: z.number().int().nonnegative(),
  selectionStatus: z.enum(["DRAFT", "SUBMITTED", "LOCKED"]),
  selectionLimit: z.number().int().positive().nullable(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});
export const ownerAlbumPageSchema = z.strictObject({
  albums: z.array(ownerAlbumSummarySchema).max(25),
  nextCursor: ownerCursorSchema.nullable(),
});
export const ownerReviewPageSchema = z.strictObject({
  album: ownerAlbumSummarySchema,
  submittedAt: z.iso.datetime().nullable(),
  lockedAt: z.iso.datetime().nullable(),
  items: z.array(z.strictObject({
    photoId: ownerAlbumIdSchema,
    fileName: z.string().min(1).max(4096),
    active: z.boolean(),
    comment: z.string().max(2000).nullable(),
    thumbnail: z.strictObject({
      src: z.string().regex(/^\/api\/v1\/workspace\/albums\/[A-Za-z0-9_-]{1,128}\/images\/[A-Za-z0-9_-]{1,128}$/),
      width: z.number().int().positive().nullable(),
      height: z.number().int().positive().nullable(),
    }).nullable(),
  })).max(50),
  nextCursor: ownerCursorSchema.nullable(),
});
export const ownerSelectionLifecycleSchema = z.strictObject({
  status: z.enum(["DRAFT", "SUBMITTED", "LOCKED"]),
  submittedAt: z.iso.datetime().nullable(),
  lockedAt: z.iso.datetime().nullable(),
});
export type OwnerAlbumSummary = z.infer<typeof ownerAlbumSummarySchema>;
export type OwnerAlbumPage = z.infer<typeof ownerAlbumPageSchema>;
export type OwnerReviewPage = z.infer<typeof ownerReviewPageSchema>;
