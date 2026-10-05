import { z } from "zod";

export const publicGallerySlugSchema = z.string().regex(/^[A-Za-z0-9_-]{20,64}$/);
export const GALLERY_SESSION_COOKIE_PREFIX = "pp_gallery_";
export const GALLERY_SESSION_MAX_AGE_SECONDS = 12 * 60 * 60;
export const galleryPasswordSchema = z.string().min(1).max(1024).refine(
  (value) => new TextEncoder().encode(value).length <= 1024,
);
export const galleryUnlockRequestSchema = z.strictObject({
  slug: publicGallerySlugSchema,
  password: galleryPasswordSchema,
});

export function gallerySessionCookieName(slug: string): string {
  return `${GALLERY_SESSION_COOKIE_PREFIX}${publicGallerySlugSchema.parse(slug)}`;
}
export const galleryCursorTokenSchema = z.string().min(1).max(1024);

export const galleryImageDescriptorSchema = z.strictObject({
  src: z.string().startsWith("/api/v1/galleries/").max(512),
  width: z.number().int().positive().nullable(),
  height: z.number().int().positive().nullable(),
});

export const galleryImageSetSchema = z.strictObject({
  thumbnail: galleryImageDescriptorSchema,
  preview: galleryImageDescriptorSchema,
});

export const galleryPhotoListItemSchema = z.strictObject({
  photoId: z.string().min(1).max(128),
  fileName: z.string(),
  width: z.number().int().positive().nullable(),
  height: z.number().int().positive().nullable(),
  previewStatus: z.enum(["PENDING", "READY", "UNSUPPORTED_VARIANT", "FAILED"]),
  images: galleryImageSetSchema.nullable(),
});

export const galleryPhotoPageSchema = z.strictObject({
  title: z.string(),
  selectionLimit: z.number().int().positive().nullable(),
  photos: z.array(galleryPhotoListItemSchema).max(100),
  nextCursor: galleryCursorTokenSchema.nullable(),
});

export const publicPhotoIdSchema = z.string().regex(/^[A-Za-z0-9_-]{1,128}$/);
export const selectionStatusSchema = z.enum(["DRAFT", "SUBMITTED", "LOCKED"]);
export const selectionMutationStateSchema = z.strictObject({
  status: selectionStatusSchema,
  selectedCount: z.number().int().nonnegative(),
  selectionLimit: z.number().int().positive().nullable(),
});
export const guestSelectionStateSchema = selectionMutationStateSchema.extend({
  selectedItems: z.array(z.strictObject({
    photoId: publicPhotoIdSchema,
    comment: z.string().max(2_000).nullable(),
  })).max(50),
});
export const selectionCommentResponseSchema = z.strictObject({ comment: z.string().max(2_000).nullable() });
export const guestSelectionMutationSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("select"), slug: publicGallerySlugSchema, photoId: publicPhotoIdSchema }),
  z.strictObject({ kind: z.literal("deselect"), slug: publicGallerySlugSchema, photoId: publicPhotoIdSchema }),
  z.strictObject({ kind: z.literal("comment"), slug: publicGallerySlugSchema, photoId: publicPhotoIdSchema,
    comment: z.string().max(2_000) }),
  z.strictObject({ kind: z.literal("submit"), slug: publicGallerySlugSchema }),
]);

export type GalleryPhotoListItem = z.infer<typeof galleryPhotoListItemSchema>;
export type GalleryPhotoPage = z.infer<typeof galleryPhotoPageSchema>;
export type GalleryImageSet = z.infer<typeof galleryImageSetSchema>;
export type GuestSelectionState = z.infer<typeof guestSelectionStateSchema>;
export type SelectionMutationState = z.infer<typeof selectionMutationStateSchema>;
export type GuestSelectionMutation = z.infer<typeof guestSelectionMutationSchema>;
