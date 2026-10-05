"use server";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { ownerAlbumIdSchema, ownerSessionCookieName } from "@photographer-platform/shared";
import { resolveGalleryApiConfig } from "../../../../lib/gallery-api-config";
import { changeOwnerAlbum } from "../../../../lib/workspace-api";

export async function updateAlbum(form: FormData): Promise<void> {
  const parsed = ownerAlbumIdSchema.safeParse(form.get("albumId"));
  const action = form.get("action");
  if (!parsed.success || (action !== "lock" && action !== "reopen" && action !== "archive")) redirect("/workspace");
  const albumId = parsed.data;
  if ((action === "archive" || action === "reopen") && form.get("confirmation") !== action) {
    redirect(`/workspace/albums/${albumId}?notice=failed`);
  }
  const config = resolveGalleryApiConfig();
  const jar = await cookies();
  const token = jar.get(ownerSessionCookieName(config?.web.protocol === "https:"))?.value;
  const result = await changeOwnerAlbum(albumId, action, token);
  if (result === "anonymous") redirect("/signin");
  redirect(`/workspace/albums/${albumId}?notice=${result === "success" ? "changed" : "failed"}`);
}
