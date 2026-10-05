"use server";

import { GALLERY_SESSION_MAX_AGE_SECONDS, gallerySessionCookieName, publicGallerySlugSchema } from "@photographer-platform/shared";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { requestGalleryUnlock } from "../../../lib/gallery-unlock";

export async function unlockGallery(formData: FormData): Promise<void> {
  const parsedSlug = publicGallerySlugSchema.safeParse(formData.get("slug"));
  if (!parsedSlug.success) redirect("/");
  const slug = parsedSlug.data;
  const result = await requestGalleryUnlock({ slug, password: formData.get("password") });
  if (result.status === "success") {
    (await cookies()).set(gallerySessionCookieName(slug), result.token, {
      httpOnly: true,
      secure: result.secure,
      sameSite: "lax",
      path: "/",
      maxAge: GALLERY_SESSION_MAX_AGE_SECONDS,
    });
    redirect(`/g/${encodeURIComponent(slug)}`);
  }
  redirect(`/g/${encodeURIComponent(slug)}?unlock=${result.status}`);
}
