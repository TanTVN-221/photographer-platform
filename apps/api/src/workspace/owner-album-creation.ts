import type { DatabaseClient } from "@photographer-platform/database";
import { GoogleDriveService } from "@photographer-platform/google-drive";

import type { DriveConnectionService } from "../drive/drive-connection.js";
import { AlbumCreationService } from "./album-creation.js";

/** Real server-only composition; not an import route or proof of child grants. */
export function createOwnerAlbumCreator(
  database: DatabaseClient,
  connections: Pick<DriveConnectionService, "getAccessToken">,
): AlbumCreationService {
  return new AlbumCreationService(database, (connectionId, ownerId) => new GoogleDriveService({
    getAccessToken: () => connections.getAccessToken(ownerId, connectionId),
  }));
}
