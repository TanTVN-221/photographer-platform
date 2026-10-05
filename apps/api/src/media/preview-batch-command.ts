import { createDatabaseClient } from "@photographer-platform/database";
import { GoogleDriveAuthorizationService } from "@photographer-platform/google-drive";
import { z } from "zod";

import { parsePhotographerAuthConfig } from "../auth/auth-config.js";
import { parseDriveAuthorizationConfig } from "../drive/drive-config.js";
import { DriveConnectionService } from "../drive/drive-connection.js";
import { DriveFlowCodec } from "../drive/drive-flow.js";
import { DriveTokenCipher } from "../drive/drive-token-cipher.js";
import { parseApiRuntimeConfig } from "../runtime-config.js";
import { FileSystemDerivativeStore } from "./derivative-store.js";
import { PreviewBatchCursorCodec, PreviewBatchError, previewBatchIdSchema, previewBatchTokenSchema } from "./preview-batch-cursor.js";
import { withPreviewBatchLock } from "./preview-batch-lock.js";
import { PreviewBatchService, type PreviewBatchResult } from "./preview-batch.js";
import { createOwnerPreviewPublisher } from "./owner-preview-publication.js";

const argumentsSchema = z.strictObject({
  owner: previewBatchIdSchema,
  album: previewBatchIdSchema,
  limit: z.string().regex(/^\d{1,2}$/).transform(Number).pipe(z.number().int().min(1).max(25)).default(10),
  cursor: previewBatchTokenSchema.optional(),
  confirm: z.literal("processing"),
});

export function parsePreviewBatchArguments(argv: readonly string[]) {
  const values: Record<string, string> = {};
  for (const argument of argv) {
    const match = /^--([a-z]+)=(.*)$/.exec(argument);
    if (match === null || match[1] === undefined || match[2] === undefined || match[1] in values) {
      throw new PreviewBatchError("invalid-request");
    }
    values[match[1]] = match[2];
  }
  const parsed = argumentsSchema.safeParse(values);
  if (!parsed.success) throw new PreviewBatchError("invalid-request");
  return parsed.data;
}

/** Privileged operator entry, never accepts an HTTP/browser-supplied owner. */
export async function executePreviewBatchCommand(argv: readonly string[], environment: NodeJS.ProcessEnv, signal?: AbortSignal): Promise<PreviewBatchResult> {
  const args = parsePreviewBatchArguments(argv);
  const base = parseApiRuntimeConfig(environment);
  const auth = parsePhotographerAuthConfig(environment, base);
  const config = parseDriveAuthorizationConfig(environment, base, auth);
  if (base.databaseUrl === null || base.galleryCursorKey === null || base.derivativeStoreRoot === null || config === null) {
    throw new PreviewBatchError("invalid-request");
  }
  const { databaseUrl, galleryCursorKey, derivativeStoreRoot } = base;
  return withPreviewBatchLock(derivativeStoreRoot, async () => {
    const database = createDatabaseClient(databaseUrl);
    try {
      await database.$connect();
      const connections = new DriveConnectionService(database,
        new GoogleDriveAuthorizationService(config.clientId, config.clientSecret, config.callbackUrl),
        new DriveFlowCodec(config.flowKey, config.clientId, config.callbackUrl),
        new DriveTokenCipher(config.tokenKey, config.tokenKeyVersion));
      const publisher = createOwnerPreviewPublisher(database, new FileSystemDerivativeStore(derivativeStoreRoot), connections);
      return await new PreviewBatchService(database, new PreviewBatchCursorCodec(galleryCursorKey), publisher).processBatch({
        ownerId: args.owner, albumId: args.album, limit: args.limit,
        ...(args.cursor === undefined ? {} : { cursor: args.cursor }),
      }, signal);
    } finally { await database.$disconnect(); }
  });
}
