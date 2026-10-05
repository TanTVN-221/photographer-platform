import { createDatabaseClient, type DatabaseClient } from "@photographer-platform/database";
import { GoogleDriveAuthorizationService, GoogleIdentityService } from "@photographer-platform/google-drive";

import { createApp } from "./app.js";
import { GalleryCursorCodec } from "./gallery/gallery-cursor.js";
import { GalleryAccessService } from "./gallery/gallery-access.js";
import { GalleryImageService } from "./gallery/gallery-image.js";
import { GalleryListingService } from "./gallery/gallery-listing.js";
import { ApiDerivativeImageUrlProvider } from "./gallery/image-url-provider.js";
import { GallerySessionCodec } from "./gallery/gallery-session.js";
import { FileSystemDerivativeStore } from "./media/derivative-store.js";
import { parseApiRuntimeConfig } from "./runtime-config.js";
import { GuestSelectionService } from "./selection/guest-selection.js";
import { SelectionService } from "./selection/selection-service.js";
import { parsePhotographerAuthConfig } from "./auth/auth-config.js";
import { LoginFlowCodec } from "./auth/login-flow.js";
import { OwnerAuthService } from "./auth/owner-auth.js";
import { parseDriveAuthorizationConfig } from "./drive/drive-config.js";
import { DriveConnectionService } from "./drive/drive-connection.js";
import { DriveFlowCodec } from "./drive/drive-flow.js";
import { DriveTokenCipher } from "./drive/drive-token-cipher.js";
import { WorkspaceService } from "./workspace/workspace-service.js";
import { OwnerCursorCodec } from "./workspace/owner-cursor.js";
import { OwnerReviewImageService } from "./workspace/owner-review-image.js";
import { ApiReadinessService } from "./readiness.js";

async function startServer(): Promise<void> {
  let database: DatabaseClient | null = null;
  try {
    const environment = parseApiRuntimeConfig(process.env);
    const authConfig = parsePhotographerAuthConfig(process.env, environment);
    const driveConfig = parseDriveAuthorizationConfig(process.env, environment, authConfig);
    if (environment.databaseUrl !== null && environment.galleryCursorKey !== null) {
      database = createDatabaseClient(environment.databaseUrl);
      await database.$connect();
    }
    const derivativeStore = environment.derivativeStoreRoot === null
      ? undefined
      : new FileSystemDerivativeStore(environment.derivativeStoreRoot);
    const gallerySessions = environment.gallerySessionKey === null
      ? undefined
      : new GallerySessionCodec(environment.gallerySessionKey);
    const galleryListing =
      database !== null && environment.galleryCursorKey !== null
        ? new GalleryListingService(
            database,
            new GalleryCursorCodec(environment.galleryCursorKey),
            derivativeStore === undefined ? undefined : new ApiDerivativeImageUrlProvider(),
            gallerySessions,
          )
        : undefined;
    const galleryImages = database !== null && derivativeStore !== undefined
      ? new GalleryImageService(database, derivativeStore, gallerySessions)
      : undefined;
    const galleryAccess = database !== null && gallerySessions !== undefined
      ? new GalleryAccessService(database, gallerySessions)
      : undefined;
    const guestSelections = database !== null && gallerySessions !== undefined && environment.passwordOrigin !== null
      ? new GuestSelectionService(database, new SelectionService(database), gallerySessions)
      : undefined;
    const ownerAuth = database !== null && authConfig !== null
      ? new OwnerAuthService(database,
          new GoogleIdentityService(authConfig.clientId, authConfig.clientSecret, authConfig.callbackUrl),
          new LoginFlowCodec(authConfig.flowKey, authConfig.clientId, authConfig.callbackUrl))
      : undefined;
    const driveConnections = database !== null && ownerAuth !== undefined && driveConfig !== null
      ? new DriveConnectionService(
          database,
          new GoogleDriveAuthorizationService(driveConfig.clientId, driveConfig.clientSecret, driveConfig.callbackUrl),
          new DriveFlowCodec(driveConfig.flowKey, driveConfig.clientId, driveConfig.callbackUrl),
          new DriveTokenCipher(driveConfig.tokenKey, driveConfig.tokenKeyVersion),
        )
      : undefined;
    const server = createApp({
      readiness: new ApiReadinessService(database, derivativeStore,
        ownerAuth !== undefined && driveConnections !== undefined && galleryListing !== undefined &&
        gallerySessions !== undefined && guestSelections !== undefined),
      ...(database === null || ownerAuth === undefined || environment.galleryCursorKey === null ? {} : {
        workspace: new WorkspaceService(database, new OwnerCursorCodec(environment.galleryCursorKey), derivativeStore !== undefined),
        ownerSelections: new SelectionService(database),
        ...(derivativeStore === undefined ? {} : { ownerReviewImages: new OwnerReviewImageService(database, derivativeStore) }),
      }),
      ...(ownerAuth === undefined || authConfig === null ? {} : { ownerAuth, ownerAuthConfig: authConfig }),
      ...(driveConnections === undefined || ownerAuth === undefined || driveConfig === null ? {} : {
        driveConnections, driveOwnerAuth: ownerAuth, driveAuthorizationConfig: driveConfig,
      }),
      ...(galleryListing === undefined ? {} : { galleryListing }),
      ...(galleryImages === undefined ? {} : { galleryImages }),
      ...(galleryAccess === undefined ? {} : { galleryAccess }),
      ...(guestSelections === undefined ? {} : { guestSelections }),
      ...(environment.passwordOrigin === null ? {} : { passwordOrigin: environment.passwordOrigin }),
      ...(environment.galleryCookieSecure === null ? {} : { galleryCookieSecure: environment.galleryCookieSecure }),
    }).listen(
      environment.port,
      environment.host,
      () => {
        console.info(
          JSON.stringify({
            event: "server_listening",
            host: environment.host,
            port: environment.port,
            galleryMetadataConfigured: galleryListing !== undefined,
            galleryImagesConfigured: galleryImages !== undefined,
            protectedGalleryAccessConfigured: galleryAccess !== undefined,
            guestSelectionConfigured: guestSelections !== undefined,
            photographerSignInConfigured: ownerAuth !== undefined,
            googleDriveAuthorizationConfigured: driveConnections !== undefined,
          }),
        );
      },
    );

    server.once("error", () => {
      console.error(JSON.stringify({ event: "server_listen_failed" }));
      process.exitCode = 1;
      void database?.$disconnect();
    });

    const shutdown = (signal: string) => {
      console.info(JSON.stringify({ event: "server_stopping", signal }));
      server.close((error) => {
        void database?.$disconnect().finally(() => {
          if (error) {
            console.error(JSON.stringify({ event: "server_stop_failed" }));
            process.exitCode = 1;
          }
        });
      });
    };
    process.once("SIGINT", () => shutdown("SIGINT"));
    process.once("SIGTERM", () => shutdown("SIGTERM"));
  } catch {
    await database?.$disconnect().catch(() => undefined);
    console.error(JSON.stringify({ event: "server_start_failed", code: "CONFIGURATION_OR_DATABASE_UNAVAILABLE" }));
    process.exitCode = 1;
  }
}

void startServer();
