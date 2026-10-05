"use server";

import { gallerySessionCookieName, guestSelectionMutationSchema } from "@photographer-platform/shared";
import { cookies } from "next/headers";

import { requestGuestSelectionMutation, type GuestSelectionMutationResult } from "../../../lib/gallery-selection";

export async function mutateGallerySelection(input: unknown): Promise<GuestSelectionMutationResult> {
  const parsed = guestSelectionMutationSchema.safeParse(input);
  if (!parsed.success) return { status: "error", reason: "invalid" };
  const token = (await cookies()).get(gallerySessionCookieName(parsed.data.slug))?.value;
  return requestGuestSelectionMutation(parsed.data, token);
}
