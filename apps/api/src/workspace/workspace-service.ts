import { createHash } from "node:crypto";
import { comparePhotosByNaturalName, type DatabaseClient, type Prisma } from "@photographer-platform/database";
import { ownerAlbumPageSchema, ownerAlbumSummarySchema, ownerReviewPageSchema,
  type OwnerAlbumPage, type OwnerReviewPage } from "@photographer-platform/shared";
import { OwnerCursorCodec, WorkspaceError } from "./owner-cursor.js";
import { RUN_LEASE_MS } from "../sync/album-sync.js";

const albumSelect = {
  id: true, title: true, publicSlug: true, status: true, passwordHash: true,
  selectionLimit: true, createdAt: true, updatedAt: true, catalogVersion: true,
  _count: { select: { photos: { where: { active: true } } } },
  selection: { select: { id: true, status: true, revision: true, submittedAt: true, lockedAt: true,
    _count: { select: { items: true } } } },
} satisfies Prisma.AlbumSelect;
type AlbumRow = Prisma.AlbumGetPayload<{ select: typeof albumSelect }>;
function summary(album: AlbumRow) {
  return ownerAlbumSummarySchema.parse({ albumId: album.id, title: album.title,
    publicSlug: album.publicSlug, status: album.status, passwordProtected: album.passwordHash !== null,
    photoCount: album._count.photos, selectedCount: album.selection?._count.items ?? 0,
    selectionStatus: album.selection?.status ?? "DRAFT", selectionLimit: album.selectionLimit,
    createdAt: album.createdAt.toISOString(), updatedAt: album.updatedAt.toISOString() });
}

export class WorkspaceService {
  constructor(private readonly database: DatabaseClient, private readonly cursors: OwnerCursorCodec,
    private readonly imagesAvailable = false, private readonly now: () => Date = () => new Date()) {}

  async albums(ownerId: string, token?: string): Promise<OwnerAlbumPage> {
    const cursor = token === undefined ? null : this.cursors.decode(token);
    if (cursor !== null && (cursor.kind !== "albums" || cursor.ownerId !== ownerId)) {
      throw new WorkspaceError("invalid-cursor");
    }
    const position = cursor?.kind === "albums" ? cursor : null;
    const rows = await this.database.album.findMany({
      where: { ownerId, ...(position === null ? {} : { OR: [
        { createdAt: { lt: new Date(position.createdAt) } },
        { createdAt: new Date(position.createdAt), id: { lt: position.albumId } },
      ] }) },
      select: albumSelect, orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: 26,
    });
    const albums = rows.slice(0, 25);
    const last = albums.at(-1);
    return ownerAlbumPageSchema.parse({ albums: albums.map(summary),
      nextCursor: rows.length > 25 && last !== undefined ? this.cursors.encode({
        kind: "albums", ownerId, albumId: last.id, createdAt: last.createdAt.toISOString(),
      }) : null });
  }

  async review(ownerId: string, albumId: string, token?: string): Promise<OwnerReviewPage> {
    const cursor = token === undefined ? null : this.cursors.decode(token);
    if (cursor !== null && (cursor.kind !== "review" || cursor.ownerId !== ownerId || cursor.albumId !== albumId)) {
      throw new WorkspaceError("invalid-cursor");
    }
    return this.database.$transaction(async (tx) => {
      const album = await tx.album.findFirst({ where: { id: albumId, ownerId }, select: albumSelect });
      if (album === null) throw new WorkspaceError("not-found");
      // Inactive selections retain historical sort ordinals, so use the same
      // natural comparator as export. Read only ordering/version metadata, not
      // every 2KB comment or image, then retrieve at most 50 page comments.
      const keys = album.selection === null ? [] : await tx.selectionItem.findMany({
        where: { selectionId: album.selection.id },
        select: { photoId: true, updatedAt: true,
          photo: { select: { fileName: true, driveFileId: true, active: true } } },
      });
      keys.sort((a, b) => comparePhotosByNaturalName(a.photo, b.photo));
      const snapshot = createHash("sha256").update(JSON.stringify([
        album.catalogVersion, album.status, album.selection?.status, album.selection?.revision,
        album.selection?.submittedAt, album.selection?.lockedAt,
        keys.map((item) => [item.photoId, item.updatedAt.toISOString(), item.photo]),
      ])).digest("hex");
      let start = 0;
      if (cursor?.kind === "review") {
        if (cursor.snapshot !== snapshot) throw new WorkspaceError("stale-cursor");
        const index = keys.findIndex((item) => item.photoId === cursor.photoId);
        if (index === -1) throw new WorkspaceError("stale-cursor");
        start = index + 1;
      }
      const page = keys.slice(start, start + 50);
      const details = page.length === 0 ? [] : await tx.selectionItem.findMany({
        where: { selectionId: album.selection!.id, photoId: { in: page.map((item) => item.photoId) } },
        select: { photoId: true, comment: true, photo: { select: {
          width: true, height: true, sourceRevision: true, previewRevision: true, previewStatus: true,
        } } },
      });
      const selectedDetails = new Map(details.map((item) => [item.photoId, item]));
      const last = page.at(-1);
      return ownerReviewPageSchema.parse({ album: summary(album),
        submittedAt: album.selection?.submittedAt?.toISOString() ?? null,
        lockedAt: album.selection?.lockedAt?.toISOString() ?? null,
        items: page.map((item) => {
          const detail = selectedDetails.get(item.photoId);
          const photo = detail?.photo;
          const ready = this.imagesAvailable && photo?.previewStatus === "READY" &&
            photo.sourceRevision !== null && photo.previewRevision === photo.sourceRevision;
          return { photoId: item.photoId, fileName: item.photo.fileName,
            active: item.photo.active, comment: detail?.comment ?? null,
            thumbnail: ready ? { src: `/api/v1/workspace/albums/${albumId}/images/${item.photoId}`,
              width: photo.width, height: photo.height } : null };
        }),
        nextCursor: start + page.length < keys.length && last !== undefined ? this.cursors.encode({
          kind: "review", ownerId, albumId, photoId: last.photoId, snapshot,
        }) : null });
    }, { isolationLevel: "RepeatableRead" });
  }

  async archive(ownerId: string, albumId: string): Promise<void> {
    await this.database.$transaction(async (tx) => {
      const rows = await tx.$queryRaw<{ id: string; status: string }[]>`
        SELECT "id", "status" FROM "Album"
        WHERE "id" = ${albumId} AND "ownerId" = ${ownerId} FOR UPDATE
      `;
      const album = rows[0];
      if (album === undefined) throw new WorkspaceError("not-found");
      if (album.status === "ARCHIVED") return;
      // Do not race an already claimed sync whose reconciliation is pending.
      const now = this.now();
      const running = await tx.syncRun.findFirst({ where: { albumId, status: "RUNNING" }, select: { id: true, startedAt: true } });
      if (running !== null) {
        if (now.getTime() - running.startedAt.getTime() < RUN_LEASE_MS) throw new WorkspaceError("conflict");
        // Use the existing lease policy: a crashed/expired run must not strand
        // archive forever. Its late reconciliation cannot commit after archive.
        await tx.syncRun.update({ where: { id: running.id }, data: {
          status: "FAILED", finishedAt: now, errorCode: "STALE_RUN",
        } });
      }
      await tx.album.update({ where: { id: albumId }, data: { status: "ARCHIVED", archivedAt: now } });
    }, { maxWait: 10_000, timeout: 30_000 });
  }
}
