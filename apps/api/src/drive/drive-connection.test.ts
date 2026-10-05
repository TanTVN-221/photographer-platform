import { randomBytes } from "node:crypto";

import { DriveConnectionStatus, type DatabaseClient } from "@photographer-platform/database";
import { GoogleDriveAuthorizationError, type GoogleDriveAuthorizationProvider } from "@photographer-platform/google-drive";
import { DRIVE_FILE_SCOPE } from "@photographer-platform/shared";
import { describe, expect, it, vi } from "vitest";

import { DriveConnectionError, DriveConnectionService } from "./drive-connection.js";
import { DriveFlowCodec } from "./drive-flow.js";
import { DriveTokenCipher } from "./drive-token-cipher.js";

function fixture() {
  const now = Date.parse("2026-10-01T12:00:00.000Z");
  const cipher = new DriveTokenCipher(randomBytes(32), "v1");
  const flows = new DriveFlowCodec(randomBytes(32), "client", "https://photos.test/callback", () => now);
  const authorization: GoogleDriveAuthorizationProvider = {
    authorizationUrl: vi.fn(() => "https://accounts.google.com/o/oauth2/v2/auth"),
    exchange: vi.fn(async () => ({
      googleAccountId: "google-account",
      accountEmail: "drive@example.test",
      refreshToken: "private-refresh-token",
      grantedScopes: [DRIVE_FILE_SCOPE],
    })),
    refreshAccessToken: vi.fn(async () => "short-lived-access"),
    revoke: vi.fn(async () => undefined),
  };
  const database = {
    driveConnection: {
      upsert: vi.fn(async () => ({ id: "connection_1" })),
      findMany: vi.fn(async () => []),
      findFirst: vi.fn(async () => null),
      updateMany: vi.fn(async () => ({ count: 1 })),
    },
  } as unknown as DatabaseClient;
  return { now, cipher, flows, authorization, database,
    service: new DriveConnectionService(database, authorization, flows, cipher, () => now) };
}

describe("owner Drive connection service (PROD-002, DRIVE-004/015)", () => {
  it("binds the callback to its owner and persists ciphertext instead of the refresh token", async () => {
    const { service, flows, database, cipher } = fixture();
    const flow = flows.issue("owner-1");
    await expect(service.complete("owner-2", { code: "code", state: flow.state }, flow.cookie))
      .rejects.toMatchObject({ code: "invalid-request" });
    await expect(service.complete("owner-1", { code: "code", state: flow.state }, flow.cookie))
      .resolves.toBe("connection_1");
    const call = vi.mocked(database.driveConnection.upsert).mock.calls[0]?.[0];
    expect(JSON.stringify(call)).not.toContain("private-refresh-token");
    expect(call?.create).toMatchObject({ ownerId: "owner-1", status: DriveConnectionStatus.CONNECTED,
      googleAccountEmail: "drive@example.test", refreshTokenKeyVersion: "v1" });
    expect(cipher.decrypt(call!.create.refreshTokenCiphertext!, "v1", "owner-1", "google-account"))
      .toBe("private-refresh-token");
  });

  it("lists only narrow owner-scoped connection summaries", async () => {
    const { service, database } = fixture();
    vi.mocked(database.driveConnection.findMany).mockResolvedValueOnce([{
      id: "connection_1", googleAccountEmail: "drive@example.test", status: DriveConnectionStatus.CONNECTED,
      connectedAt: new Date("2026-10-01T12:00:00.000Z"),
    }] as never);
    await expect(service.list("owner-1")).resolves.toEqual({ connections: [{
      connectionId: "connection_1", accountEmail: "drive@example.test", status: "connected",
      scopeMode: "drive-file", connectedAt: "2026-10-01T12:00:00.000Z",
    }] });
    expect(vi.mocked(database.driveConnection.findMany).mock.calls[0]?.[0]?.where).toMatchObject({ ownerId: "owner-1" });
  });

  it("clears local credentials even when remote revocation cannot be confirmed", async () => {
    const { service, database, authorization, cipher } = fixture();
    const updatedAt = new Date("2026-10-01T11:00:00.000Z");
    vi.mocked(database.driveConnection.findFirst).mockResolvedValueOnce({
      id: "connection_1", ownerId: "owner-1", googleAccountId: "google-account",
      status: DriveConnectionStatus.CONNECTED, refreshTokenCiphertext: cipher.encrypt("private-refresh-token", "owner-1", "google-account"),
      refreshTokenKeyVersion: "v1", updatedAt,
    } as never);
    vi.mocked(authorization.revoke).mockRejectedValueOnce(new GoogleDriveAuthorizationError("revocation"));
    await expect(service.disconnect("owner-1", "connection_1")).resolves.toEqual({ revocationConfirmed: false });
    expect(database.driveConnection.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ ownerId: "owner-1", updatedAt }),
      data: expect.objectContaining({ status: DriveConnectionStatus.DISCONNECTED,
        refreshTokenCiphertext: null, refreshTokenKeyVersion: null }),
    }));
  });

  it("still clears undecryptable local credentials without attempting revocation", async () => {
    const { service, database, authorization } = fixture();
    const otherCipher = new DriveTokenCipher(randomBytes(32), "v1");
    vi.mocked(database.driveConnection.findFirst).mockResolvedValueOnce({
      id: "connection_1", ownerId: "owner-1", googleAccountId: "google-account",
      status: DriveConnectionStatus.CONNECTED,
      refreshTokenCiphertext: otherCipher.encrypt("private-refresh-token", "owner-1", "google-account"),
      refreshTokenKeyVersion: "v1", updatedAt: new Date("2026-10-01T11:00:00.000Z"),
    } as never);
    await expect(service.disconnect("owner-1", "connection_1")).resolves.toEqual({ revocationConfirmed: false });
    expect(database.driveConnection.updateMany).toHaveBeenCalled();
    expect(authorization.revoke).not.toHaveBeenCalled();
  });

  it("marks a revoked refresh token as requiring reauthorization", async () => {
    const { service, database, authorization, cipher } = fixture();
    vi.mocked(database.driveConnection.findFirst).mockResolvedValueOnce({
      id: "connection_1", ownerId: "owner-1", googleAccountId: "google-account",
      refreshTokenCiphertext: cipher.encrypt("private-refresh-token", "owner-1", "google-account"),
      refreshTokenKeyVersion: "v1", updatedAt: new Date("2026-10-01T11:00:00.000Z"),
    } as never);
    vi.mocked(authorization.refreshAccessToken).mockRejectedValueOnce(new GoogleDriveAuthorizationError("reauth-required"));
    await expect(service.getAccessToken("owner-1", "connection_1"))
      .rejects.toEqual(new DriveConnectionError("reauth-required"));
    expect(database.driveConnection.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: DriveConnectionStatus.REAUTH_REQUIRED,
        refreshTokenCiphertext: null, refreshTokenKeyVersion: null }),
    }));
  });

  it("keeps encrypted credentials on a transient refresh failure", async () => {
    const { service, database, authorization, cipher } = fixture();
    vi.mocked(database.driveConnection.findFirst).mockResolvedValueOnce({
      id: "connection_1", ownerId: "owner-1", googleAccountId: "google-account",
      refreshTokenCiphertext: cipher.encrypt("private-refresh-token", "owner-1", "google-account"),
      refreshTokenKeyVersion: "v1", updatedAt: new Date("2026-10-01T11:00:00.000Z"),
    } as never);
    vi.mocked(authorization.refreshAccessToken).mockRejectedValueOnce(new GoogleDriveAuthorizationError("transient"));
    await expect(service.getAccessToken("owner-1", "connection_1")).rejects.toMatchObject({ code: "unavailable" });
    expect(database.driveConnection.updateMany).not.toHaveBeenCalled();
  });

  it("never permits an owner to address another owner's connection", async () => {
    const { service } = fixture();
    await expect(service.disconnect("owner-2", "connection_1")).rejects.toMatchObject({ code: "not-found" });
    await expect(service.getAccessToken("owner-2", "connection_1")).rejects.toMatchObject({ code: "not-found" });
  });
});
