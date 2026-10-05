import { DriveConnectionStatus, type DatabaseClient } from "@photographer-platform/database";
import {
  GoogleDriveAuthorizationError,
  type GoogleDriveAuthorizationProvider,
} from "@photographer-platform/google-drive";
import { driveConnectionListSchema, type DriveConnectionSummary } from "@photographer-platform/shared";
import { z } from "zod";

import type { DriveFlowCodec } from "./drive-flow.js";
import type { DriveTokenCipher } from "./drive-token-cipher.js";

const callbackSchema = z.strictObject({
  code: z.string().min(1).max(4096),
  state: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
});

export class DriveConnectionError extends Error {
  constructor(readonly code: "invalid-request" | "not-found" | "conflict" | "unavailable" | "reauth-required") {
    super(code === "not-found" ? "Drive connection not found." :
      code === "conflict" ? "The Drive connection changed. Try again." :
      code === "reauth-required" ? "Reconnect Google Drive to continue." :
      code === "unavailable" ? "Google Drive is temporarily unavailable." :
      "Google Drive authorization could not be completed.");
    this.name = "DriveConnectionError";
  }
}

export class DriveConnectionService {
  constructor(
    private readonly database: DatabaseClient,
    private readonly authorization: GoogleDriveAuthorizationProvider,
    private readonly flows: DriveFlowCodec,
    private readonly tokens: DriveTokenCipher,
    private readonly now: () => number = Date.now,
  ) {}

  begin(owner: { readonly id: string; readonly email: string }) {
    const flow = this.flows.issue(owner.id);
    return {
      url: this.authorization.authorizationUrl({ ...flow, loginHint: owner.email }),
      cookie: flow.cookie,
    };
  }

  async complete(ownerId: string, query: unknown, flowCookie: string | null): Promise<string> {
    const input = callbackSchema.safeParse(query);
    if (!input.success) throw new DriveConnectionError("invalid-request");
    const flow = this.flows.read(flowCookie, input.data.state, ownerId);
    if (flow === null) throw new DriveConnectionError("invalid-request");
    const grant = await this.authorization.exchange({ code: input.data.code, ...flow });
    const encrypted = this.tokens.encrypt(grant.refreshToken, ownerId, grant.googleAccountId);
    const now = new Date(this.now());
    const connection = await this.database.driveConnection.upsert({
      where: { ownerId_googleAccountId: { ownerId, googleAccountId: grant.googleAccountId } },
      create: {
        ownerId,
        googleAccountId: grant.googleAccountId,
        googleAccountEmail: grant.accountEmail,
        status: DriveConnectionStatus.CONNECTED,
        grantedScopes: [...grant.grantedScopes],
        refreshTokenCiphertext: encrypted,
        refreshTokenKeyVersion: this.tokens.keyVersion,
        connectedAt: now,
        disconnectedAt: null,
      },
      update: {
        googleAccountEmail: grant.accountEmail,
        status: DriveConnectionStatus.CONNECTED,
        grantedScopes: [...grant.grantedScopes],
        refreshTokenCiphertext: encrypted,
        refreshTokenKeyVersion: this.tokens.keyVersion,
        connectedAt: now,
        disconnectedAt: null,
      },
      select: { id: true },
    });
    return connection.id;
  }

  async list(ownerId: string): Promise<{ connections: DriveConnectionSummary[] }> {
    const rows = await this.database.driveConnection.findMany({
      where: { ownerId, googleAccountEmail: { not: null }, connectedAt: { not: null } },
      orderBy: [{ updatedAt: "desc" }, { id: "asc" }],
      take: 20,
      select: { id: true, googleAccountEmail: true, status: true, connectedAt: true },
    });
    return driveConnectionListSchema.parse({ connections: rows.map((row) => ({
      connectionId: row.id,
      accountEmail: row.googleAccountEmail,
      status: row.status === DriveConnectionStatus.CONNECTED ? "connected" :
        row.status === DriveConnectionStatus.REAUTH_REQUIRED ? "reauth-required" : "disconnected",
      scopeMode: "drive-file" as const,
      connectedAt: row.connectedAt?.toISOString(),
    })) });
  }

  async disconnect(ownerId: string, connectionId: string): Promise<{ revocationConfirmed: boolean }> {
    const row = await this.database.driveConnection.findFirst({
      where: { id: connectionId, ownerId },
      select: {
        id: true, ownerId: true, googleAccountId: true, status: true,
        refreshTokenCiphertext: true, refreshTokenKeyVersion: true, updatedAt: true,
      },
    });
    if (row === null) throw new DriveConnectionError("not-found");
    if (row.status !== DriveConnectionStatus.CONNECTED || row.refreshTokenCiphertext === null ||
      row.refreshTokenKeyVersion === null) {
      await this.database.driveConnection.updateMany({
        where: { id: row.id, ownerId },
        data: { status: DriveConnectionStatus.DISCONNECTED, refreshTokenCiphertext: null,
          refreshTokenKeyVersion: null, disconnectedAt: new Date(this.now()) },
      });
      return { revocationConfirmed: true };
    }
    let refreshToken: string | null = null;
    try {
      refreshToken = this.tokens.decrypt(
        row.refreshTokenCiphertext,
        row.refreshTokenKeyVersion,
        row.ownerId,
        row.googleAccountId,
      );
    } catch {
      // The owner must still be able to remove undecryptable local material.
    }
    const cleared = await this.database.driveConnection.updateMany({
      where: { id: row.id, ownerId, status: DriveConnectionStatus.CONNECTED, updatedAt: row.updatedAt },
      data: { status: DriveConnectionStatus.DISCONNECTED, refreshTokenCiphertext: null,
        refreshTokenKeyVersion: null, disconnectedAt: new Date(this.now()) },
    });
    if (cleared.count !== 1) throw new DriveConnectionError("conflict");
    if (refreshToken === null) return { revocationConfirmed: false };
    try {
      await this.authorization.revoke(refreshToken);
      return { revocationConfirmed: true };
    } catch {
      // Local credentials are already removed. The UI directs the owner to
      // Google Account permissions when remote revocation cannot be confirmed.
      return { revocationConfirmed: false };
    }
  }

  async getAccessToken(ownerId: string, connectionId: string): Promise<string> {
    const row = await this.database.driveConnection.findFirst({
      where: { id: connectionId, ownerId, status: DriveConnectionStatus.CONNECTED },
      select: { id: true, ownerId: true, googleAccountId: true,
        refreshTokenCiphertext: true, refreshTokenKeyVersion: true, updatedAt: true },
    });
    if (row === null) throw new DriveConnectionError("not-found");
    if (row.refreshTokenCiphertext === null || row.refreshTokenKeyVersion === null) {
      throw new DriveConnectionError("reauth-required");
    }
    let refreshToken: string;
    try {
      refreshToken = this.tokens.decrypt(
        row.refreshTokenCiphertext,
        row.refreshTokenKeyVersion,
        row.ownerId,
        row.googleAccountId,
      );
    } catch {
      throw new DriveConnectionError("unavailable");
    }
    try {
      return await this.authorization.refreshAccessToken(refreshToken);
    } catch (error) {
      if (error instanceof GoogleDriveAuthorizationError && error.code === "reauth-required") {
        await this.database.driveConnection.updateMany({
          where: { id: row.id, ownerId, status: DriveConnectionStatus.CONNECTED, updatedAt: row.updatedAt },
          data: { status: DriveConnectionStatus.REAUTH_REQUIRED, refreshTokenCiphertext: null,
            refreshTokenKeyVersion: null, disconnectedAt: new Date(this.now()) },
        });
        throw new DriveConnectionError("reauth-required");
      }
      throw new DriveConnectionError("unavailable");
    }
  }
}
