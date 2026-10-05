import type { DatabaseClient } from "@photographer-platform/database";
import { GoogleDriveOriginalReader } from "@photographer-platform/google-drive";

import type { DriveConnectionService } from "../drive/drive-connection.js";
import type { DerivativeStore } from "./derivative-store.js";
import { PreviewPublicationService } from "./preview-publication.js";

/** Real provider composition shared by operator work and future authorized jobs. */
export function createOwnerPreviewPublisher(
  database: DatabaseClient,
  derivativeStore: DerivativeStore,
  connections: Pick<DriveConnectionService, "getAccessToken">,
): PreviewPublicationService {
  return new PreviewPublicationService({
    database,
    derivativeStore,
    readerForConnection: async (connectionId, ownerId) => new GoogleDriveOriginalReader({
      // Recheck connection state for every request, including before/after media.
      // No access token cache can outlive an owner disconnect in this pilot.
      getAccessToken: () => connections.getAccessToken(ownerId, connectionId),
    }),
  });
}
