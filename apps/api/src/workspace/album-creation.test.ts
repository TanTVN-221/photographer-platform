import { createHash } from "node:crypto";
import { DriveConnectionStatus, Prisma, type DatabaseClient } from "@photographer-platform/database";
import { DriveProviderError, type DriveErrorCode } from "@photographer-platform/google-drive";
import { afterEach, describe, expect, it, vi } from "vitest";
import { verifyGalleryPassword } from "../gallery/gallery-password.js";
import * as slugs from "../gallery/public-slug.js";
import { AlbumCreationService } from "./album-creation.js";
import { createOwnerAlbumCreator } from "./owner-album-creation.js";

const date = new Date("2026-10-05T00:00:00Z");
const request = { requestId: "88a24e25-5e31-4f58-b100-7a31b65102f4", driveConnectionId: "connection_123", driveFolderId: "folder_123", title: "  Wedding  " };
function fixture() {
  const connection = { id: "connection_123", updatedAt: date };
  const locked = { ...connection, status: DriveConnectionStatus.CONNECTED };
  const tx = {
    $queryRaw: vi.fn().mockResolvedValue([locked]),
    albumCreationRequest: { findUnique: vi.fn().mockResolvedValue(null) },
    album: { create: vi.fn(async (args: { data: { publicSlug: string } }) => ({ id: "album_123", publicSlug: args.data.publicSlug })) },
  };
  const findFirst = vi.fn().mockResolvedValue(connection);
  const transaction = vi.fn(async <T>(fn: (client: typeof tx) => Promise<T>) => fn(tx));
  const receipts = { findUnique: vi.fn().mockResolvedValue(null) };
  const database = { driveConnection: { findFirst }, albumCreationRequest: receipts, $transaction: transaction } as unknown as DatabaseClient;
  const reader = { readAccessibleFolder: vi.fn(async (_id: string, _signal?: AbortSignal) => ({ folderId: "folder_123", name: "Drive name" })) };
  const readerFactory = vi.fn(async (_connectionId: string, _ownerId: string) => reader);
  return { service: new AlbumCreationService(database, readerFactory), database, tx, receipts, findFirst, transaction, reader, readerFactory };
}
function uniqueError(target: unknown) {
  return new Prisma.PrismaClientKnownRequestError("private database detail", {
    code: "P2002", clientVersion: "7.10.0", meta: { target },
  });
}
afterEach(() => vi.restoreAllMocks());

describe("internal draft album creation (ALB-001/002/003, GAL-003, PROD-002)", () => {
  it("owner-checks before Drive and atomically creates only an unpublished album and draft selection", async () => {
    const { service, tx, transaction, reader, readerFactory, findFirst } = fixture();
    const result = await service.createDraft("owner_123", request);
    expect(result).toEqual({ albumId: "album_123", publicSlug: expect.stringMatching(/^[A-Za-z0-9_-]{24}$/), status: "DRAFT" });
    expect(findFirst).toHaveBeenCalledWith({ where: { id: request.driveConnectionId, ownerId: "owner_123", status: "CONNECTED" }, select: { id: true, updatedAt: true } });
    expect(readerFactory).toHaveBeenCalledWith("connection_123", "owner_123");
    expect(reader.readAccessibleFolder).toHaveBeenCalledWith("folder_123", undefined);
    expect(tx.album.create).toHaveBeenCalledWith({ data: {
      ownerId: "owner_123", driveConnectionId: "connection_123", driveFolderId: "folder_123", title: "Wedding",
      publicSlug: result.publicSlug, status: "DRAFT", passwordHash: null, selectionLimit: null,
      selection: { create: { status: "DRAFT" } },
      creationRequest: { create: { keyHash: expect.stringMatching(/^[0-9a-f]{64}$/),
        requestHash: expect.stringMatching(/^[0-9a-f]{64}$/), passwordHash: null, publicSlug: result.publicSlug } },
    }, select: { id: true, publicSlug: true } });
    expect(transaction).toHaveBeenCalledWith(expect.any(Function), { maxWait: 5000, timeout: 5000 });
    const [sql, ...values] = tx.$queryRaw.mock.calls[0]!;
    expect((sql as TemplateStringsArray).join("?")).toMatch(/FROM "DriveConnection"[\s\S]*"ownerId" = \?[\s\S]*FOR UPDATE/);
    expect(values).toEqual(["connection_123", "owner_123"]);
    expect(findFirst.mock.invocationCallOrder[0]).toBeLessThan(reader.readAccessibleFolder.mock.invocationCallOrder[0]!);
    expect(reader.readAccessibleFolder.mock.invocationCallOrder[0]).toBeLessThan(transaction.mock.invocationCallOrder[0]!);
    expect(JSON.stringify(result)).not.toMatch(/owner_123|folder_123|connection_123|password|selection/);
  });
  it("stores a salted hash, not the password, and the configured limit", async () => {
    const { service, tx } = fixture();
    await service.createDraft("owner_123", { ...request, password: "mật khẩu", selectionLimit: 24 });
    const saved = tx.album.create.mock.calls[0]?.[0].data as unknown as { passwordHash: string; selectionLimit: number };
    expect(saved.passwordHash).not.toContain("mật khẩu");
    expect(await verifyGalleryPassword("mật khẩu", saved.passwordHash)).toBe(true);
    expect(saved.selectionLimit).toBe(24);
    expect(tx.album.create).toHaveBeenCalledTimes(1);
  });
  it.each([
    { requestId: undefined }, { requestId: "invalid" }, { requestId: 3 },
    { title: "   " }, { title: "a".repeat(201) }, { title: 42 }, { driveFolderId: "folder/id" },
    { driveFolderId: "" }, { driveConnectionId: "connection/id" }, { selectionLimit: 0 },
    { selectionLimit: -1 }, { selectionLimit: 1.5 }, { selectionLimit: "10" },
    { selectionLimit: 2_147_483_648 }, { password: "" }, { password: "ắ".repeat(342) },
    { ownerId: "other" }, { status: "PUBLISHED" }, { publicSlug: "caller-controlled" },
  ])("rejects invalid or caller-controlled creation input before any side effect %#", async (override) => {
    const { service, findFirst, readerFactory, transaction } = fixture();
    await expect(service.createDraft("owner_123", { ...request, ...override })).rejects.toMatchObject({ code: "invalid-request" });
    expect(findFirst).not.toHaveBeenCalled();
    expect(readerFactory).not.toHaveBeenCalled();
    expect(transaction).not.toHaveBeenCalled();
  });
  it("rejects untrusted invalid owner IDs before database reads", async () => {
    const { service, findFirst } = fixture();
    await expect(service.createDraft("", request)).rejects.toMatchObject({ code: "invalid-request" });
    expect(findFirst).not.toHaveBeenCalled();
  });
  it("does not read Drive or create albums for an absent, disconnected or other-owner connection", async () => {
    const { service, findFirst, readerFactory, transaction } = fixture();
    findFirst.mockResolvedValue(null);
    await expect(service.createDraft("other-owner", request)).rejects.toMatchObject({ code: "connection-not-found" });
    expect(findFirst.mock.calls[0]?.[0].where).toMatchObject({ ownerId: "other-owner", status: "CONNECTED" });
    expect(readerFactory).not.toHaveBeenCalled();
    expect(transaction).not.toHaveBeenCalled();
  });
  it.each([{ rows: [] }, { rows: [{ id: "connection_123", status: "DISCONNECTED", updatedAt: date }] },
    { rows: [{ id: "connection_123", status: "REAUTH_REQUIRED", updatedAt: date }] },
    { rows: [{ id: "connection_123", status: "CONNECTED", updatedAt: new Date(date.getTime() + 1) }] }])(
    "rejects deleted, disconnected or reconnected credential snapshots %#", async ({ rows }) => {
      const { service, tx } = fixture();
      tx.$queryRaw.mockResolvedValue(rows);
      await expect(service.createDraft("owner_123", request)).rejects.toMatchObject({ code: "connection-changed" });
      expect(tx.album.create).not.toHaveBeenCalled();
    });
  it.each([
    ["authentication", "drive-authentication"], ["permission", "drive-permission"], ["not-found", "drive-not-found"],
    ["quota", "drive-quota"], ["rate-limit", "drive-rate-limit"], ["transient", "drive-unavailable"],
    ["invalid-response", "drive-unavailable"], ["invalid-request", "invalid-request"], ["cancelled", "cancelled"],
  ] as const)("exposes safe actionable %s errors without provider details or writes", async (providerCode, code) => {
    const { service, reader, transaction } = fixture();
    reader.readAccessibleFolder.mockRejectedValue(new DriveProviderError(providerCode as DriveErrorCode, "private token/folder detail"));
    try { await service.createDraft("owner_123", request); throw new Error("expected rejection"); }
    catch (error) { expect(error).toMatchObject({ code }); expect(String(error)).not.toContain("private"); }
    expect(transaction).not.toHaveBeenCalled();
  });
  it("does not trust a mismatched provider folder identity", async () => {
    const { service, reader, transaction } = fixture();
    reader.readAccessibleFolder.mockResolvedValue({ folderId: "another", name: "Drive name" });
    await expect(service.createDraft("owner_123", request)).rejects.toMatchObject({ code: "drive-unavailable" });
    expect(transaction).not.toHaveBeenCalled();
  });
  it("cancels before reads, after Drive, and after the connection lock", async () => {
    const before = fixture();
    await expect(before.service.createDraft("owner_123", request, AbortSignal.abort())).rejects.toMatchObject({ code: "cancelled" });
    expect(before.findFirst).not.toHaveBeenCalled();
    const after = fixture();
    const controller = new AbortController();
    after.reader.readAccessibleFolder.mockImplementation(async () => { controller.abort(); return { folderId: "folder_123", name: "Drive name" }; });
    await expect(after.service.createDraft("owner_123", request, controller.signal)).rejects.toMatchObject({ code: "cancelled" });
    expect(after.transaction).not.toHaveBeenCalled();
    const locked = fixture();
    const lockController = new AbortController();
    locked.tx.$queryRaw.mockImplementation(async () => { lockController.abort(); return [{ id: "connection_123", status: "CONNECTED", updatedAt: date }]; });
    await expect(locked.service.createDraft("owner_123", request, lockController.signal)).rejects.toMatchObject({ code: "cancelled" });
    expect(locked.tx.album.create).not.toHaveBeenCalled();
  });
  it.each([["publicSlug"], "Album_publicSlug_key"])("retries only known public-slug collisions with a fresh slug %#", async (target) => {
    const { service, tx, reader, transaction } = fixture();
    const slug = vi.spyOn(slugs, "generatePublicGallerySlug").mockReturnValueOnce("a".repeat(24)).mockReturnValueOnce("b".repeat(24));
    tx.album.create.mockRejectedValueOnce(uniqueError(target));
    const result = await service.createDraft("owner_123", request);
    expect(result.publicSlug).toBe("b".repeat(24));
    expect(slug).toHaveBeenCalledTimes(2);
    expect(transaction).toHaveBeenCalledTimes(2);
    expect(reader.readAccessibleFolder).toHaveBeenCalledTimes(1);
  });
  it("bounds collision retries to three fresh transactions", async () => {
    const { service, tx, transaction } = fixture();
    tx.album.create.mockRejectedValue(uniqueError(["publicSlug"]));
    await expect(service.createDraft("owner_123", request)).rejects.toMatchObject({ code: "unavailable" });
    expect(transaction).toHaveBeenCalledTimes(3);
  });
  it.each([{ index: "Album_publicSlug_key" }, { fields: ["publicSlug"] }])(
    "recognizes the installed Prisma 7 pg adapter constraint shape %#", async (constraint) => {
      const { service, tx, transaction } = fixture();
      tx.album.create.mockRejectedValueOnce(new Prisma.PrismaClientKnownRequestError("private database detail", {
        code: "P2002", clientVersion: "7.10.0", meta: { driverAdapterError: { cause: {
          kind: "UniqueConstraintViolation", table: "Album", constraint,
        } } },
      }));
      await expect(service.createDraft("owner_123", request)).resolves.toMatchObject({ status: "DRAFT" });
      expect(transaction).toHaveBeenCalledTimes(2);
    });
  it.each([uniqueError(["ownerId"]), uniqueError(undefined), new Error("private database detail")])(
    "does not blindly retry other persistence errors %#", async (error) => {
      const { service, tx, transaction } = fixture();
      tx.album.create.mockRejectedValue(error);
      await expect(service.createDraft("owner_123", request)).rejects.toMatchObject({ code: "unavailable" });
      expect(transaction).toHaveBeenCalledTimes(1);
    });
  it("composes the real Google reader with owner-bound token refresh, not caller credentials", async () => {
    const { database, tx } = fixture();
    const connections = { getAccessToken: vi.fn(async () => "private-token") };
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({
      id: "folder_123", name: "Folder", mimeType: "application/vnd.google-apps.folder", trashed: false,
      capabilities: { canListChildren: true },
    })));
    await expect(createOwnerAlbumCreator(database, connections).createDraft("owner_123", request)).resolves.toMatchObject({ status: "DRAFT" });
    expect(connections.getAccessToken).toHaveBeenCalledWith("owner_123", "connection_123");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(tx.album.create).toHaveBeenCalledTimes(1);
  });
});

function savedReceipt(passwordHash: string | null = null, overrides: Record<string, unknown> = {}) {
  const requestHash = createHash("sha256").update(JSON.stringify(["draft-album-settings:v1", request.driveConnectionId,
    request.driveFolderId, "Wedding", null, passwordHash !== null])).digest("hex");
  return { requestHash, passwordHash, publicSlug: "a".repeat(24), album: { id: "original_album" }, ...overrides };
}

describe("durable creation replay (ALB-001/002, DRIVE-014, DB-005, SEC-002/004)", () => {
  it("returns the original identity before Drive/connection checks, normalizing title/null options/UUID case", async () => {
    const { service, receipts, readerFactory, findFirst, transaction } = fixture();
    receipts.findUnique.mockResolvedValue(savedReceipt());
    await expect(service.createDraft("owner_123", { ...request, requestId: request.requestId.toUpperCase(),
      title: "Wedding", password: null, selectionLimit: null })).resolves.toEqual({
      albumId: "original_album", publicSlug: "a".repeat(24), status: "DRAFT",
    });
    expect(findFirst).not.toHaveBeenCalled(); expect(readerFactory).not.toHaveBeenCalled();
    expect(transaction).not.toHaveBeenCalled();
    expect(receipts.findUnique.mock.calls[0]?.[0].where.ownerId_keyHash).toMatchObject({ ownerId: "owner_123" });
    expect(JSON.stringify(receipts.findUnique.mock.calls)).not.toContain(request.requestId);
  });
  it.each([{ title: "Changed" }, { driveFolderId: "other_folder" }, { driveConnectionId: "other_connection" },
    { selectionLimit: 3 }, { password: "new password" }])("rejects changed settings without provider work %#", async (override) => {
      const { service, receipts, transaction, readerFactory } = fixture();
      receipts.findUnique.mockResolvedValue(savedReceipt());
      await expect(service.createDraft("owner_123", { ...request, ...override })).rejects.toMatchObject({ code: "request-conflict" });
      expect(transaction).not.toHaveBeenCalled(); expect(readerFactory).not.toHaveBeenCalled();
    });
  it("binds exact password bytes with the original salted hash and never exposes/stores a fast password digest", async () => {
    const created = fixture();
    await created.service.createDraft("owner_123", { ...request, password: "mật khẩu" });
    const data = created.tx.album.create.mock.calls[0]![0].data as unknown as {
      passwordHash: string; creationRequest: { create: { passwordHash: string; keyHash: string; requestHash: string } };
    };
    expect(data.creationRequest.create.passwordHash).toBe(data.passwordHash);
    expect(JSON.stringify(data)).not.toContain("mật khẩu");
    const replay = fixture();
    replay.receipts.findUnique.mockResolvedValue(savedReceipt(data.passwordHash));
    await expect(replay.service.createDraft("owner_123", { ...request, password: "mật khẩu" })).resolves.toMatchObject({ albumId: "original_album" });
    await expect(replay.service.createDraft("owner_123", { ...request, password: "mật khẩu " })).rejects.toMatchObject({ code: "request-conflict" });
    await expect(replay.service.createDraft("owner_123", request)).rejects.toMatchObject({ code: "request-conflict" });
    expect(replay.readerFactory).not.toHaveBeenCalled(); expect(replay.transaction).not.toHaveBeenCalled();
    const another = fixture();
    await another.service.createDraft("owner_123", { ...request, password: "different password" });
    const second = another.tx.album.create.mock.calls[0]![0].data as unknown as typeof data;
    expect(second.creationRequest.create.requestHash).toBe(data.creationRequest.create.requestHash);
    expect(second.creationRequest.create.passwordHash).not.toBe(data.creationRequest.create.passwordHash);
  });
  it("uses the receipt found after waiting for the connection lock instead of creating another album", async () => {
    const { service, tx, transaction } = fixture();
    tx.albumCreationRequest.findUnique.mockResolvedValue(savedReceipt());
    await expect(service.createDraft("owner_123", request)).resolves.toMatchObject({ albumId: "original_album" });
    expect(transaction).toHaveBeenCalledTimes(1); expect(tx.album.create).not.toHaveBeenCalled();
  });
  it.each([{ target: ["ownerId", "keyHash"] }, { target: "AlbumCreationRequest_pkey" },
    { driverAdapterError: { cause: { kind: "UniqueConstraintViolation", table: "AlbumCreationRequest", constraint: { fields: ["ownerId", "keyHash"] } } } }])(
    "recovers only a known receipt-key race after its transaction rolled back %#", async (meta) => {
      const { service, tx, receipts, transaction } = fixture();
      tx.album.create.mockRejectedValue(new Prisma.PrismaClientKnownRequestError("private database detail", {
        code: "P2002", clientVersion: "7.10.0", meta,
      }));
      receipts.findUnique.mockResolvedValueOnce(null).mockResolvedValueOnce(savedReceipt());
      await expect(service.createDraft("owner_123", request)).resolves.toMatchObject({ albumId: "original_album" });
      expect(transaction).toHaveBeenCalledTimes(1); expect(tx.album.create).toHaveBeenCalledTimes(1);
    });
  it("rejects a conflicting concurrent winner and fails closed if a known collision has no committed receipt", async () => {
    const conflict = fixture();
    conflict.tx.album.create.mockRejectedValue(uniqueError("AlbumCreationRequest_pkey"));
    conflict.receipts.findUnique.mockResolvedValueOnce(null).mockResolvedValueOnce(savedReceipt(null, { requestHash: "b".repeat(64) }));
    await expect(conflict.service.createDraft("owner_123", request)).rejects.toMatchObject({ code: "request-conflict" });
    const absent = fixture();
    absent.tx.album.create.mockRejectedValue(uniqueError("AlbumCreationRequest_pkey"));
    await expect(absent.service.createDraft("owner_123", request)).rejects.toMatchObject({ code: "unavailable" });
    expect(absent.transaction).toHaveBeenCalledTimes(1);
  });
  it("recovers a lost successful response on retry and honors cancellation before replay", async () => {
    const { service, transaction, receipts, tx } = fixture();
    transaction.mockRejectedValueOnce(new Error("Synthetic response loss after commit"));
    await expect(service.createDraft("owner_123", request)).rejects.toMatchObject({ code: "unavailable" });
    receipts.findUnique.mockResolvedValue(savedReceipt());
    await expect(service.createDraft("owner_123", request)).resolves.toMatchObject({ albumId: "original_album" });
    await expect(service.createDraft("owner_123", request, AbortSignal.abort())).rejects.toMatchObject({ code: "cancelled" });
    expect(transaction).toHaveBeenCalledTimes(1); expect(tx.album.create).not.toHaveBeenCalled();
  });
  it("redacts lookup errors and never falls through to creation after uncertain receipt state", async () => {
    const { service, receipts, transaction, readerFactory } = fixture();
    receipts.findUnique.mockRejectedValue(new Error("private DB URL/password"));
    await expect(service.createDraft("owner_123", request)).rejects.toMatchObject({ code: "unavailable" });
    expect(transaction).not.toHaveBeenCalled(); expect(readerFactory).not.toHaveBeenCalled();
  });
});
