import type { DatabaseClient } from "@photographer-platform/database";
import type { DerivativeStore } from "../media/derivative-store.js";
import { WorkspaceError } from "./owner-cursor.js";

/** Only selected thumbnails; supports private/archived albums and retained items. */
export class OwnerReviewImageService {
  constructor(private readonly database: DatabaseClient, private readonly store: DerivativeStore) {}
  async read(ownerId: string, albumId: string, photoId: string): Promise<Buffer> {
    const item = await this.database.selectionItem.findFirst({
      where: { albumId, photoId, selection: { album: { ownerId } } },
      select: { photo: { select: { sourceRevision: true, previewRevision: true, previewStatus: true } } },
    });
    const photo = item?.photo;
    if (photo === undefined || photo.previewStatus !== "READY" || photo.sourceRevision === null ||
      photo.previewRevision !== photo.sourceRevision) throw new WorkspaceError("not-found");
    const image = await this.store.read({ photoId, sourceRevision: photo.sourceRevision }, "thumbnail");
    if (image === null) throw new WorkspaceError("not-found");
    return image.bytes;
  }
}
