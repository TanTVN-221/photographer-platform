import { randomBytes, randomUUID } from "node:crypto";
import { createDatabaseClient, type DatabaseClient, type Prisma } from "@photographer-platform/database";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { DriveProviderError, type DirectChildImageCatalog, type DriveImageMetadata } from "@photographer-platform/google-drive";
import { GalleryCursorCodec } from "./gallery/gallery-cursor.js";
import { GalleryListingService } from "./gallery/gallery-listing.js";
import { SelectionService } from "./selection/selection-service.js";
import { OwnerCursorCodec } from "./workspace/owner-cursor.js";
import { WorkspaceService } from "./workspace/workspace-service.js";
import { AlbumCreationService } from "./workspace/album-creation.js";
import { testDatabaseUrl } from "./testing/test-database.js";
import sharp from "sharp";
import { PreviewBatchService } from "./media/preview-batch.js";
import { PreviewBatchCursorCodec } from "./media/preview-batch-cursor.js";
import { PreviewPublicationService } from "./media/preview-publication.js";
import { DriveTokenCipher } from "./drive/drive-token-cipher.js";
import { AlbumSyncService, RUN_LEASE_MS } from "./sync/album-sync.js";
import * as publicSlugs from "./gallery/public-slug.js";

interface PlanNode {
  "Node Type": string;
  "Index Name"?: string;
  "Actual Rows": number;
  "Rows Removed by Filter"?: number;
  Plans?: PlanNode[];
}
interface ExplainRow {
  "QUERY PLAN": [{ Plan: PlanNode; "Execution Time": number }];
}
function planNodes(node: PlanNode): PlanNode[] {
  return [node, ...(node.Plans ?? []).flatMap(planNodes)];
}
function providerImage(driveFileId: string, fileName: string, revision = "first"): DriveImageMetadata {
  return { driveFileId, fileName, mimeType: "image/jpeg", formatId: "jpeg", supportLevel: "guaranteed",
    classificationWarnings: [], width: 1200, height: 800, rotation: null, sizeBytes: "1000",
    createdTime: null, modifiedTime: null, md5Checksum: revision, driveVersion: "1" };
}

const url = testDatabaseUrl(process.env);
// Unsafe explicit targets throw during collection; missing configuration skips
// clearly. No connection, migration, fixture or deletion is attempted on skip.
describe.skipIf(url === null)("real PostgreSQL invariants (DB-003/004/005, SEL-002/004/005/008, AUTH-004, ALB-001/002/003/006, DRIVE-007/008/009/018, PERF-006)", () => {
  let db: DatabaseClient;
  let selections: SelectionService;
  let workspace: WorkspaceService;
  const run = randomUUID().replaceAll("-", "");
  const ownerIds = [`pp_test_owner_${run}_1`, `pp_test_owner_${run}_2`];
  const connectionIds = ownerIds.map((id) => `${id}_drive`);
  const albumIds: string[] = [];

  beforeAll(async () => {
    db = createDatabaseClient(url!);
    await db.$connect();
    for (let index = 0; index < ownerIds.length; index++) {
      await db.photographer.create({ data: { id: ownerIds[index]!, email: `${ownerIds[index]}@example.test` } });
      await db.driveConnection.create({ data: { id: connectionIds[index]!, ownerId: ownerIds[index]!, googleAccountId: `test_${run}_${index}` } });
    }
    selections = new SelectionService(db);
    workspace = new WorkspaceService(db, new OwnerCursorCodec(randomBytes(32)));
  }, 30_000);

  afterAll(async () => {
    if (db === undefined) return;
    try {
      // Exact generated fixture ownership only. Never truncate/reset a database.
      await db.$transaction(async (tx) => {
        const albums = { albumId: { in: albumIds } };
        await tx.selectionItem.deleteMany({ where: albums });
        await tx.selection.deleteMany({ where: albums });
        await tx.photo.deleteMany({ where: albums });
        await tx.syncRun.deleteMany({ where: albums });
        await tx.albumCreationRequest.deleteMany({ where: albums });
        await tx.album.deleteMany({ where: { id: { in: albumIds }, ownerId: { in: ownerIds } } });
        await tx.driveConnection.deleteMany({ where: { id: { in: connectionIds }, ownerId: { in: ownerIds } } });
        await tx.photographer.deleteMany({ where: { id: { in: ownerIds } } });
      });
    } finally { await db.$disconnect(); }
  }, 30_000);

  async function fixture(count: number, limit: number | null = null, ownerIndex = 0) {
    const albumId = `pp_test_album_${run}_${albumIds.length}`;
    albumIds.push(albumId);
    const album = await db.album.create({ data: { id: albumId, ownerId: ownerIds[ownerIndex]!,
      driveConnectionId: connectionIds[ownerIndex]!, driveFolderId: `test_folder_${albumId}`,
      title: "Integration fixture, not a Drive import", publicSlug: publicSlugs.generatePublicGallerySlug(),
      status: "PUBLISHED", selectionLimit: limit } });
    const photos = Array.from({ length: count }, (_, index) => ({ id: `${albumId}_p${index + 1}`,
      albumId, driveFileId: `test_file_${index + 1}`, fileName: `IMG_${index + 1}.jpg`,
      mimeType: "image/jpeg", formatId: "jpeg", sortOrder: index, width: 1200, height: 800 }));
    for (let start = 0; start < photos.length; start += 500) await db.photo.createMany({ data: photos.slice(start, start + 500) });
    return { album, photos };
  }

  async function connectFixture(connectionId = connectionIds[0]!) {
    const connection = await db.driveConnection.findUniqueOrThrow({ where: { id: connectionId } });
    const cipher = new DriveTokenCipher(randomBytes(32), "sql-test-v1");
    await db.driveConnection.update({ where: { id: connectionId }, data: {
      status: "CONNECTED", googleAccountEmail: `${connection.ownerId}@example.test`,
      grantedScopes: ["https://www.googleapis.com/auth/drive.file"], connectedAt: new Date(), disconnectedAt: null,
      refreshTokenCiphertext: cipher.encrypt("synthetic-token-not-a-Google-credential", connection.ownerId, connection.googleAccountId),
      refreshTokenKeyVersion: cipher.keyVersion,
    } });
  }

  it("creates an owner-bound draft album with exactly one draft selection in real SQL", async () => {
    await connectFixture();
    const creator = new AlbumCreationService(db, () => ({
      readAccessibleFolder: async (folderId) => ({ folderId, name: "Read-only provider fixture" }),
    }));
    await expect(creator.createDraft(ownerIds[1]!, { requestId: randomUUID(), driveConnectionId: connectionIds[0]!,
      driveFolderId: "test_folder", title: "Not authorized" })).rejects.toMatchObject({ code: "connection-not-found" });
    const created = await creator.createDraft(ownerIds[0]!, { requestId: randomUUID(), driveConnectionId: connectionIds[0]!,
      driveFolderId: "test_folder", title: "  Draft import  ", selectionLimit: 8 });
    albumIds.push(created.albumId);
    const album = await db.album.findUniqueOrThrow({ where: { id: created.albumId }, include: { selection: true } });
    expect(album).toMatchObject({ ownerId: ownerIds[0], title: "Draft import", status: "DRAFT",
      publicSlug: created.publicSlug, publishedAt: null, passwordHash: null, selectionLimit: 8,
      selection: { status: "DRAFT", revision: 0, submittedAt: null } });
    expect(await db.selection.count({ where: { albumId: created.albumId } })).toBe(1);
    expect(await db.photo.count({ where: { albumId: created.albumId } })).toBe(0);
  });

  it("rolls back album/selection/receipt after insertion and allows a stable-key retry", async () => {
    await connectFixture();
    const before = await db.album.count({ where: { ownerId: ownerIds[0]! } });
    const input = { requestId: randomUUID(), driveConnectionId: connectionIds[0]!,
      driveFolderId: "test_rollback", title: "Rollback fixture" };
    let inserted = false;
    const wrapped = {
      driveConnection: db.driveConnection,
      albumCreationRequest: db.albumCreationRequest,
      $transaction: (fn: (tx: Prisma.TransactionClient) => Promise<unknown>) => db.$transaction(async (tx) => {
        const outcome = await fn(tx);
        expect(outcome).toMatchObject({ kind: "created" });
        expect(await tx.albumCreationRequest.count({ where: { album: { ownerId: ownerIds[0]!, driveFolderId: input.driveFolderId } } })).toBe(1);
        inserted = true;
        throw new Error("Synthetic post-insert transaction failure");
      }),
    } as unknown as DatabaseClient;
    const creator = new AlbumCreationService(wrapped, () => ({
      readAccessibleFolder: async (folderId) => ({ folderId, name: "Read-only provider fixture" }),
    }));
    await expect(creator.createDraft(ownerIds[0]!, input)).rejects.toMatchObject({ code: "unavailable" });
    expect(inserted).toBe(true);
    expect(await db.album.count({ where: { ownerId: ownerIds[0]! } })).toBe(before);
    expect(await db.selection.count({ where: { album: { ownerId: ownerIds[0]!, driveFolderId: "test_rollback" } } })).toBe(0);
    expect(await db.albumCreationRequest.count({ where: { album: { ownerId: ownerIds[0]!, driveFolderId: "test_rollback" } } })).toBe(0);
    const retryCreator = new AlbumCreationService(db, () => ({
      readAccessibleFolder: async (folderId) => ({ folderId, name: "Read-only provider fixture" }),
    }));
    const retry = await retryCreator.createDraft(ownerIds[0]!, input);
    albumIds.push(retry.albumId);
    expect(await db.albumCreationRequest.count({ where: { albumId: retry.albumId } })).toBe(1);
  });

  it("rejects a connection disconnected after the folder read before real SQL creation", async () => {
    await connectFixture();
    const before = await db.album.count({ where: { ownerId: ownerIds[0]! } });
    const creator = new AlbumCreationService(db, () => ({
      readAccessibleFolder: async (folderId) => {
        await db.driveConnection.update({ where: { id: connectionIds[0]! }, data: {
          status: "DISCONNECTED", refreshTokenCiphertext: null, refreshTokenKeyVersion: null, disconnectedAt: new Date(),
        } });
        return { folderId, name: "Read-only provider fixture" };
      },
    }));
    await expect(creator.createDraft(ownerIds[0]!, { requestId: randomUUID(), driveConnectionId: connectionIds[0]!,
      driveFolderId: "test_disconnected", title: "Disconnected fixture" })).rejects.toMatchObject({ code: "connection-changed" });
    expect(await db.album.count({ where: { ownerId: ownerIds[0]! } })).toBe(before);
  });

  it("retries a real public-slug unique violation without retaining the failed nested selection", async () => {
    await connectFixture();
    const occupied = await fixture(0);
    const fresh = publicSlugs.generatePublicGallerySlug();
    const generator = vi.spyOn(publicSlugs, "generatePublicGallerySlug")
      .mockReturnValueOnce(occupied.album.publicSlug).mockReturnValueOnce(fresh);
    try {
      const creator = new AlbumCreationService(db, () => ({
        readAccessibleFolder: async (folderId) => ({ folderId, name: "Read-only provider fixture" }),
      }));
      const created = await creator.createDraft(ownerIds[0]!, { requestId: randomUUID(), driveConnectionId: connectionIds[0]!,
        driveFolderId: "test_slug_collision", title: "Collision fixture" });
      albumIds.push(created.albumId);
      expect(created.publicSlug).toBe(fresh);
      expect(generator).toHaveBeenCalledTimes(2);
      expect(await db.album.count({ where: { ownerId: ownerIds[0]!, driveFolderId: "test_slug_collision" } })).toBe(1);
      expect(await db.selection.count({ where: { albumId: created.albumId } })).toBe(1);
    } finally { generator.mockRestore(); }
  });

  it("replays committed SQL creation after disconnect/archive and binds the original exact password/settings", async () => {
    await connectFixture();
    const read = vi.fn(async (folderId: string) => ({ folderId, name: "Read-only provider fixture" }));
    const creator = new AlbumCreationService(db, () => ({ readAccessibleFolder: read }));
    const input = { requestId: randomUUID(), driveConnectionId: connectionIds[0]!, driveFolderId: "test_replay",
      title: "  Stable draft  ", password: "mật khẩu", selectionLimit: 5 };
    const created = await creator.createDraft(ownerIds[0]!, input);
    albumIds.push(created.albumId);
    expect(await creator.createDraft(ownerIds[0]!, { ...input, title: "Stable draft" })).toEqual(created);
    await expect(creator.createDraft(ownerIds[0]!, { ...input, password: "mật khẩu " })).rejects.toMatchObject({ code: "request-conflict" });
    await expect(creator.createDraft(ownerIds[0]!, { ...input, title: "Changed" })).rejects.toMatchObject({ code: "request-conflict" });
    // Simulate later metadata edits without adding any settings/rotation route.
    await db.album.update({ where: { id: created.albumId }, data: {
      title: "Later title", publicSlug: publicSlugs.generatePublicGallerySlug(), passwordHash: null,
    } });
    await workspace.archive(ownerIds[0]!, created.albumId);
    await db.driveConnection.update({ where: { id: connectionIds[0]! }, data: { status: "DISCONNECTED",
      refreshTokenCiphertext: null, refreshTokenKeyVersion: null, disconnectedAt: new Date() } });
    expect(await creator.createDraft(ownerIds[0]!, input)).toEqual(created);
    expect(read).toHaveBeenCalledTimes(1);
    expect(await db.album.findUnique({ where: { id: created.albumId } })).toMatchObject({ status: "ARCHIVED" });
    const receipt = await db.albumCreationRequest.findUniqueOrThrow({ where: { albumId: created.albumId } });
    expect(receipt.keyHash).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(receipt)).not.toContain(input.requestId);
    expect(JSON.stringify(receipt)).not.toContain(input.password);
    expect(await db.selection.count({ where: { albumId: created.albumId } })).toBe(1);
    await expect(creator.createDraft(ownerIds[1]!, input)).rejects.toMatchObject({ code: "connection-not-found" });
  });

  it("commits one album/selection/receipt for 20 concurrent identical SQL creation requests", async () => {
    await connectFixture();
    let release!: () => void; let reads = 0;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const creator = new AlbumCreationService(db, () => ({ readAccessibleFolder: async (folderId) => {
      if (++reads === 20) release(); await gate; return { folderId, name: "Read-only provider fixture" };
    } }));
    const input = { requestId: randomUUID(), driveConnectionId: connectionIds[0]!, driveFolderId: "test_concurrent_create", title: "Concurrent draft" };
    const results = await Promise.all(Array.from({ length: 20 }, () => creator.createDraft(ownerIds[0]!, input)));
    albumIds.push(results[0]!.albumId);
    expect(new Set(results.map((result) => result.albumId)).size).toBe(1);
    expect(new Set(results.map((result) => result.publicSlug)).size).toBe(1);
    expect(await db.album.count({ where: { ownerId: ownerIds[0]!, driveFolderId: input.driveFolderId } })).toBe(1);
    expect(await db.selection.count({ where: { albumId: results[0]!.albumId } })).toBe(1);
    expect(await db.albumCreationRequest.count({ where: { albumId: results[0]!.albumId } })).toBe(1);
  }, 30_000);

  it("rolls back a conflicting same-key race across different SQL connection locks", async () => {
    await connectFixture();
    const otherId = `${ownerIds[0]}_other_drive`;
    connectionIds.push(otherId);
    await db.driveConnection.create({ data: { id: otherId, ownerId: ownerIds[0]!, googleAccountId: `test_${run}_other` } });
    await connectFixture(otherId);
    let release!: () => void; let reads = 0;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const creator = new AlbumCreationService(db, () => ({ readAccessibleFolder: async (folderId) => {
      if (++reads === 2) release(); await gate; return { folderId, name: "Read-only provider fixture" };
    } }));
    const requestId = randomUUID();
    const before = await db.album.count({ where: { ownerId: ownerIds[0]! } });
    const results = await Promise.allSettled([connectionIds[0]!, otherId].map((driveConnectionId) => creator.createDraft(ownerIds[0]!, {
      requestId, driveConnectionId, driveFolderId: "test_conflicting_create", title: "Competing request" } )));
    const succeeded = results.filter((result) => result.status === "fulfilled");
    for (const result of succeeded) if (result.status === "fulfilled") albumIds.push(result.value.albumId);
    expect(succeeded).toHaveLength(1);
    for (const result of results) if (result.status === "rejected") expect(result.reason).toMatchObject({ code: "request-conflict" });
    expect(await db.album.count({ where: { ownerId: ownerIds[0]! } })).toBe(before + 1);
    const albums = { album: { ownerId: ownerIds[0]!, driveFolderId: "test_conflicting_create" } };
    expect(await db.selection.count({ where: albums })).toBe(1);
    expect(await db.albumCreationRequest.count({ where: albums })).toBe(1);
  }, 30_000);

  it("binds creation receipts to their SQL owner and rejects malformed request-key digests and slugs", async () => {
    const foreign = await fixture(0, null, 1);
    await expect(db.albumCreationRequest.create({ data: { ownerId: ownerIds[0]!, albumId: foreign.album.id,
      keyHash: "a".repeat(64), requestHash: "b".repeat(64), publicSlug: foreign.album.publicSlug } })).rejects.toMatchObject({ code: "P2003" });
    const own = await fixture(0);
    await expect(db.albumCreationRequest.create({ data: { ownerId: ownerIds[0]!, albumId: own.album.id,
      keyHash: "not-a-digest", requestHash: "b".repeat(64), publicSlug: own.album.publicSlug } })).rejects.toThrow("AlbumCreationRequest_keyHash_check");
    await expect(db.albumCreationRequest.create({ data: { ownerId: ownerIds[0]!, albumId: own.album.id,
      keyHash: "a".repeat(64), requestHash: "b".repeat(64), publicSlug: "not-a-gallery-slug" } })).rejects.toThrow("AlbumCreationRequest_publicSlug_check");
    expect(await db.albumCreationRequest.count({ where: { albumId: own.album.id } })).toBe(0);
  });

  it("reconciles repeat/add/change/removal/reactivation while preserving SQL selection history", async () => {
    const { album } = await fixture(0);
    let catalog: DirectChildImageCatalog = { images: [providerImage("ten", "IMG_10.jpg"),
      providerImage("two", "IMG_2.jpg")], pageCount: 2, skippedCount: 3 };
    const providerForConnection = vi.fn(async () => ({ listDirectChildImages: async () => catalog }));
    const sync = new AlbumSyncService({ database: db, providerForConnection });
    await expect(sync.syncAlbum(ownerIds[1]!, album.id)).rejects.toMatchObject({ code: "not-found" });
    expect(providerForConnection).not.toHaveBeenCalled();
    await expect(sync.syncAlbum(ownerIds[0]!, album.id)).resolves.toMatchObject({ createdCount: 2, skippedCount: 3, pageCount: 2 });
    const initial = await db.photo.findMany({ where: { albumId: album.id }, orderBy: { sortOrder: "asc" } });
    expect(initial.map((photo) => photo.fileName)).toEqual(["IMG_2.jpg", "IMG_10.jpg"]);
    const retained = initial[0]!; const changed = initial[1]!;
    await selections.selectPhoto(album.id, retained.id);
    await selections.setComment(album.id, retained.id, "Retain across source removal");
    await selections.submit(album.id);
    await db.photo.update({ where: { id: changed.id }, data: { previewStatus: "READY", previewRevision: "md5:first" } });
    const version = (await db.album.findUniqueOrThrow({ where: { id: album.id } })).catalogVersion;
    await expect(sync.syncAlbum(ownerIds[0]!, album.id)).resolves.toMatchObject({ createdCount: 0,
      updatedCount: 0, removedCount: 0, unchangedCount: 2, catalogChanged: false });
    expect((await db.album.findUniqueOrThrow({ where: { id: album.id } })).catalogVersion).toBe(version);
    catalog = { images: [providerImage("ten", "IMG_10.jpg", "changed"), providerImage("three", "IMG_3.jpg")],
      pageCount: 1, skippedCount: 0 };
    await expect(sync.syncAlbum(ownerIds[0]!, album.id)).resolves.toMatchObject({ createdCount: 1, updatedCount: 1, removedCount: 1 });
    expect(await db.photo.findUnique({ where: { id: changed.id } })).toMatchObject({ sourceRevision: "md5:changed",
      previewStatus: "PENDING", previewRevision: null });
    expect(await db.photo.findUnique({ where: { id: retained.id } })).toMatchObject({ active: false, removedAt: expect.any(Date) });
    expect(await selections.exportSubmittedForOwner(ownerIds[0]!, album.id)).toBe("IMG_2.jpg\n");
    expect(await db.selectionItem.findFirst({ where: { photoId: retained.id } })).toMatchObject({ comment: "Retain across source removal" });
    catalog = { ...catalog, images: [providerImage("two", "IMG_2.jpg"), ...catalog.images] };
    await sync.syncAlbum(ownerIds[0]!, album.id);
    expect(await db.photo.findUnique({ where: { id: retained.id } })).toMatchObject({ active: true, removedAt: null });
    expect(await db.photo.count({ where: { albumId: album.id } })).toBe(3);
  });

  it("rolls back incomplete reconciliation and records provider failures without removing SQL photos", async () => {
    const { album, photos } = await fixture(2);
    const sync = new AlbumSyncService({ database: db,
      providerForConnection: async () => ({ listDirectChildImages: async () => ({ images: [], pageCount: 0, skippedCount: 0 }) }),
    });
    await expect(sync.syncAlbum(ownerIds[0]!, album.id)).rejects.toThrow("incomplete");
    const failed = new AlbumSyncService({ database: db, providerForConnection: async () => ({
      listDirectChildImages: async () => { throw new DriveProviderError("quota", "Synthetic provider quota"); },
    }) });
    await expect(failed.syncAlbum(ownerIds[0]!, album.id)).rejects.toMatchObject({ code: "quota" });
    expect(await db.photo.count({ where: { albumId: album.id, active: true } })).toBe(photos.length);
    expect(await db.album.findUnique({ where: { id: album.id } })).toMatchObject({ catalogVersion: album.catalogVersion, lastSyncedAt: null });
    expect((await db.syncRun.findMany({ where: { albumId: album.id } })).map((entry) => entry.errorCode).sort())
      .toEqual(["DRIVE_QUOTA", "SYNC_FAILED"]);
  });

  it("allows one live SQL sync claim and rejects concurrent sync/archive while listing outside the lock", async () => {
    const { album } = await fixture(0);
    let entered!: () => void; let release!: () => void;
    const listingEntered = new Promise<void>((resolve) => { entered = resolve; });
    const listingRelease = new Promise<void>((resolve) => { release = resolve; });
    const providerForConnection = vi.fn(async () => ({ listDirectChildImages: async () => {
      entered(); await listingRelease; return { images: [], pageCount: 1, skippedCount: 0 };
    } }));
    const sync = new AlbumSyncService({ database: db, providerForConnection });
    const first = sync.syncAlbum(ownerIds[0]!, album.id);
    try {
      await listingEntered;
      await expect(sync.syncAlbum(ownerIds[0]!, album.id)).rejects.toMatchObject({ code: "already-running" });
      await expect(workspace.archive(ownerIds[0]!, album.id)).rejects.toMatchObject({ code: "conflict" });
      expect(providerForConnection).toHaveBeenCalledTimes(1);
      expect(await db.syncRun.count({ where: { albumId: album.id, status: "RUNNING" } })).toBe(1);
    } finally { release(); await first; }
    expect(await db.syncRun.count({ where: { albumId: album.id, status: "SUCCEEDED" } })).toBe(1);
  }, 30_000);

  it("supersedes an expired SQL lease and prevents two RUNNING rows using the partial unique index", async () => {
    const { album } = await fixture(0);
    const now = new Date();
    const stale = await db.syncRun.create({ data: { albumId: album.id, status: "RUNNING",
      startedAt: new Date(now.getTime() - RUN_LEASE_MS - 1) } });
    await expect(db.syncRun.create({ data: { albumId: album.id, status: "RUNNING" } })).rejects.toMatchObject({ code: "P2002" });
    const sync = new AlbumSyncService({ database: db, now: () => now,
      providerForConnection: async () => ({ listDirectChildImages: async () => ({ images: [], pageCount: 1, skippedCount: 0 }) }),
    });
    await sync.syncAlbum(ownerIds[0]!, album.id);
    expect(await db.syncRun.findUnique({ where: { id: stale.id } })).toMatchObject({ status: "FAILED", errorCode: "STALE_RUN" });
    expect(await db.syncRun.count({ where: { albumId: album.id, status: "SUCCEEDED" } })).toBe(1);
  });

  it("serializes concurrent selections so the configured cap cannot be exceeded", async () => {
    const { album, photos } = await fixture(30, 5);
    const results = await Promise.allSettled(photos.map((photo) => selections.selectPhoto(album.id, photo.id)));
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(5);
    for (const result of results) if (result.status === "rejected") expect(result.reason).toMatchObject({ code: "limit-reached" });
    expect(await db.selectionItem.count({ where: { albumId: album.id } })).toBe(5);
    expect(await db.selection.findUnique({ where: { albumId: album.id } })).toMatchObject({ revision: 5 });
  }, 30_000);

  it("handles concurrent duplicate selects and repeated submits without duplicate items or transitions", async () => {
    const { album, photos } = await fixture(1, 1);
    await Promise.all(Array.from({ length: 20 }, () => selections.selectPhoto(album.id, photos[0]!.id)));
    expect(await db.selectionItem.count({ where: { albumId: album.id } })).toBe(1);
    const now = new Date("2026-10-04T00:00:00.000Z");
    await Promise.all(Array.from({ length: 20 }, () => selections.submit(album.id, now)));
    expect(await db.selection.findUnique({ where: { albumId: album.id } })).toMatchObject({ status: "SUBMITTED", submittedAt: now, revision: 2 });
  }, 30_000);

  it("enforces composite album foreign keys and unique selection membership in SQL", async () => {
    const first = await fixture(1); const other = await fixture(1, null, 1);
    await selections.selectPhoto(first.album.id, first.photos[0]!.id);
    const selection = await db.selection.findUniqueOrThrow({ where: { albumId: first.album.id } });
    await expect(db.selectionItem.create({ data: { selectionId: selection.id, photoId: other.photos[0]!.id, albumId: first.album.id } }))
      .rejects.toMatchObject({ code: "P2003" });
    await expect(db.selectionItem.create({ data: { selectionId: selection.id, photoId: first.photos[0]!.id, albumId: first.album.id } }))
      .rejects.toMatchObject({ code: "P2002" });
  });

  it("enforces album/file uniqueness and credential/dimension/limit checks in migrated SQL", async () => {
    const { album, photos } = await fixture(1);
    const photo = photos[0]!;
    await expect(db.photo.create({ data: { ...photo, id: `${photo.id}_duplicate` } })).rejects.toMatchObject({ code: "P2002" });
    await expect(db.photo.update({ where: { id: photo.id }, data: { width: 0 } })).rejects.toThrow("Photo_width_positive");
    await expect(db.album.update({ where: { id: album.id }, data: { selectionLimit: 0 } })).rejects.toThrow("Album_selectionLimit_positive");
    await expect(db.driveConnection.update({ where: { id: connectionIds[1]! }, data: { status: "CONNECTED" } }))
      .rejects.toThrow("DriveConnection_credential_state_check");
    expect(await db.photo.findUnique({ where: { id: photo.id } })).toMatchObject({ width: 1200 });
    expect(await db.album.findUnique({ where: { id: album.id } })).toMatchObject({ selectionLimit: null });
  });

  it("denies cross-owner review/export and exports retained filenames in natural order", async () => {
    const { album, photos } = await fixture(10);
    for (const index of [9, 1, 0]) await selections.selectPhoto(album.id, photos[index]!.id);
    await selections.setComment(album.id, photos[1]!.id, "Keep this comment");
    await selections.submit(album.id);
    await db.photo.update({ where: { id: photos[1]!.id }, data: { active: false, removedAt: new Date() } });
    await expect(workspace.review(ownerIds[1]!, album.id)).rejects.toMatchObject({ code: "not-found" });
    await expect(selections.exportSubmittedForOwner(ownerIds[1]!, album.id)).rejects.toMatchObject({ code: "owner-not-found" });
    expect(await selections.exportSubmittedForOwner(ownerIds[0]!, album.id)).toBe("IMG_1.jpg\nIMG_2.jpg\nIMG_10.jpg\n");
    expect((await workspace.review(ownerIds[0]!, album.id)).items[1]).toMatchObject({ active: false, comment: "Keep this comment" });
    const revision = (await db.selection.findUniqueOrThrow({ where: { albumId: album.id } })).revision;
    await selections.lockForOwner(ownerIds[0]!, album.id);
    expect((await db.selection.findUniqueOrThrow({ where: { albumId: album.id } })).revision).toBe(revision + 1);
    await selections.reopenForOwner(ownerIds[0]!, album.id);
    await expect(selections.exportSubmittedForOwner(ownerIds[0]!, album.id)).rejects.toMatchObject({ code: "not-submitted" });
  });

  it("rejects archive during running sync and preserves selected history after confirmed archive", async () => {
    const { album, photos } = await fixture(1);
    await selections.selectPhoto(album.id, photos[0]!.id); await selections.submit(album.id);
    const sync = await db.syncRun.create({ data: { albumId: album.id, status: "RUNNING" } });
    await expect(workspace.archive(ownerIds[0]!, album.id)).rejects.toMatchObject({ code: "conflict" });
    await db.syncRun.update({ where: { id: sync.id }, data: { status: "SUCCEEDED", finishedAt: new Date() } });
    await workspace.archive(ownerIds[0]!, album.id); await workspace.archive(ownerIds[0]!, album.id);
    expect(await db.album.findUnique({ where: { id: album.id } })).toMatchObject({ status: "ARCHIVED" });
    expect(await selections.exportSubmittedForOwner(ownerIds[0]!, album.id)).toBe("IMG_1.jpg\n");
    expect(await db.photo.count({ where: { albumId: album.id } })).toBe(1);
    await expect(selections.selectPhoto(album.id, photos[0]!.id)).rejects.toMatchObject({ code: "gallery-not-published" });
  });

  it("continues owner-bound preview batches across indexed SQL pages without duplicate work", async () => {
    const { album, photos } = await fixture(3);
    const visited: string[] = [];
    const batch = new PreviewBatchService(db, new PreviewBatchCursorCodec(randomBytes(32)), {
      processPhoto: async (_owner, _album, photoId) => { visited.push(photoId); return { status: "already-ready", photoId }; },
    });
    await expect(batch.processBatch({ ownerId: ownerIds[1]!, albumId: album.id })).rejects.toMatchObject({ code: "not-found" });
    let cursor: string | undefined;
    do {
      const page = await batch.processBatch({ ownerId: ownerIds[0]!, albumId: album.id, limit: 1, ...(cursor === undefined ? {} : { cursor }) });
      expect(page.outcomes).toHaveLength(1);
      cursor = page.nextCursor ?? undefined;
    } while (cursor !== undefined);
    expect(visited).toEqual(photos.map((photo) => photo.id));
  });

  it("does not commit READY if archive completes between publication and the SQL album lock", async () => {
    const { album, photos } = await fixture(1);
    const photoId = photos[0]!.id;
    await db.photo.update({ where: { id: photoId }, data: { sourceRevision: "version:5" } });
    const bytes = await sharp({ create: { width: 20, height: 10, channels: 3, background: "red" } }).jpeg().toBuffer();
    const publisher = new PreviewPublicationService({ database: db,
      readerForConnection: async () => ({ readOriginalImage: async () => ({ bytes, mimeType: "image/jpeg", sourceRevision: "version:5" }) }),
      derivativeStore: { read: async () => null, publish: async () => { await workspace.archive(ownerIds[0]!, album.id); } },
    });
    expect(await publisher.processPhoto(ownerIds[0]!, album.id, photoId)).toEqual({ status: "superseded", photoId });
    expect(await db.photo.findUnique({ where: { id: photoId } })).toMatchObject({ previewStatus: "PENDING", previewRevision: null });
  });

  it.each([500, 5000])("paginates every record in a %s-photo indexed gallery with bounded responses", async (count) => {
    const { album } = await fixture(count);
    const gallery = new GalleryListingService(db, new GalleryCursorCodec(randomBytes(32)));
    const ids = new Set<string>(); const latencies: number[] = [];
    let cursor: string | undefined;
    do {
      const start = performance.now();
      const page = await gallery.listPasswordless({ slug: album.publicSlug, limit: 100, ...(cursor === undefined ? {} : { cursor }) });
      latencies.push(performance.now() - start);
      expect(page.photos.length).toBeLessThanOrEqual(100);
      expect(page.photos.every((photo) => photo.images === null)).toBe(true);
      expect(JSON.stringify(page)).not.toContain("driveFileId");
      for (const photo of page.photos) { expect(ids.has(photo.photoId)).toBe(false); ids.add(photo.photoId); }
      cursor = page.nextCursor ?? undefined;
    } while (cursor !== undefined);
    expect(ids.size).toBe(count); expect(latencies).toHaveLength(count / 100);
    console.info(JSON.stringify({ event: "integration_gallery_metadata_timing", datasetPhotos: count,
      pages: latencies.length, firstPageMs: Math.round(latencies[0]!),
      maxPageMs: Math.round(Math.max(...latencies)), scope: "local-test-postgresql-not-production-browser-budget" }));
    // This equivalent SQL mirrors the production Prisma page predicate/projection.
    // ANALYZE and EXPLAIN execute only in the explicitly guarded disposable DB.
    await db.$executeRaw`ANALYZE "Photo"`;
    for (const ordinal of [0, count - 100]) {
      const rows = await db.$queryRaw<ExplainRow[]>`EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)
        SELECT "id", "fileName", "width", "height", "previewStatus", "sourceRevision", "previewRevision", "sortOrder"
        FROM "Photo" WHERE "albumId" = ${album.id} AND "active" = true
          AND ("sortOrder" > ${ordinal} OR ("sortOrder" = ${ordinal} AND "id" > ${""}))
        ORDER BY "sortOrder", "id" LIMIT 101`;
      const plan = rows[0]!["QUERY PLAN"][0];
      const nodes = planNodes(plan.Plan);
      if (count === 5000) expect(nodes.some((node) => node["Index Name"] === "Photo_albumId_active_sortOrder_id_idx")).toBe(true);
      expect(plan.Plan["Actual Rows"]).toBeLessThanOrEqual(101);
      console.info(JSON.stringify({ event: "integration_gallery_query_plan", datasetPhotos: count, cursorOrdinal: ordinal,
        indexes: nodes.flatMap((node) => node["Index Name"] ? [node["Index Name"]] : []),
        filteredRows: nodes.reduce((total, node) => total + (node["Rows Removed by Filter"] ?? 0), 0),
        executionMs: plan["Execution Time"], scope: "equivalent-local-sql-not-production-load-proof" }));
    }
  }, 60_000);
});
