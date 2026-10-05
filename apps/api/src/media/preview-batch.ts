import { AlbumStatus, type DatabaseClient } from "@photographer-platform/database";
import { z } from "zod";

import { PreviewBatchCursorCodec, PreviewBatchError, previewBatchIdSchema, previewBatchTokenSchema } from "./preview-batch-cursor.js";
import { PreviewPublicationError, type PreviewPublicationResult, type PreviewPublicationService } from "./preview-publication.js";

const requestSchema = z.strictObject({
  ownerId: previewBatchIdSchema,
  albumId: previewBatchIdSchema,
  limit: z.number().int().min(1).max(25).default(10),
  cursor: previewBatchTokenSchema.optional(),
});

export interface PreviewBatchResult {
  readonly status: "complete" | "page-full" | "blocked" | "cancelled" | "catalog-changed";
  readonly outcomes: readonly PreviewPublicationResult[];
  readonly nextCursor: string | null;
}

/** Explicit bounded work only. The caller must hold the single-volume operator lock. */
export class PreviewBatchService {
  private running = false;
  constructor(
    private readonly database: DatabaseClient,
    private readonly cursors: PreviewBatchCursorCodec,
    private readonly publisher: Pick<PreviewPublicationService, "processPhoto">,
  ) {}

  async processBatch(input: unknown, signal?: AbortSignal): Promise<PreviewBatchResult> {
    const parsed = requestSchema.safeParse(input);
    if (!parsed.success) throw new PreviewBatchError("invalid-request");
    if (this.running) throw new PreviewBatchError("busy");
    this.running = true;
    try {
      const { ownerId, albumId, limit, cursor } = parsed.data;
      const position = cursor === undefined ? null : this.cursors.decode(cursor);
      if (position !== null && (position.ownerId !== ownerId || position.albumId !== albumId)) {
        throw new PreviewBatchError("invalid-cursor");
      }
      // A catalog snapshot is read without any provider/decoder work inside it.
      const page = await this.database.$transaction(async (transaction) => {
        const album = await transaction.album.findFirst({
          where: { id: albumId, ownerId, status: { not: AlbumStatus.ARCHIVED } },
          select: { catalogVersion: true },
        });
        if (album === null) throw new PreviewBatchError("not-found");
        if (position !== null && position.catalogVersion !== album.catalogVersion) throw new PreviewBatchError("stale-cursor");
        const after = position?.after;
        const rows = await transaction.photo.findMany({
          where: { albumId, active: true, ...(after == null ? {} : {
            OR: [{ sortOrder: { gt: after.sortOrder } }, { sortOrder: after.sortOrder, id: { gt: after.photoId } }],
          }) },
          select: { id: true, sortOrder: true },
          orderBy: [{ sortOrder: "asc" }, { id: "asc" }],
          take: limit + 1,
        });
        return { rows, catalogVersion: album.catalogVersion };
      }, { isolationLevel: "RepeatableRead", maxWait: 2_000, timeout: 5_000 });

      const outcomes: PreviewPublicationResult[] = [];
      let after = position?.after ?? null;
      const continuation = () => this.cursors.encode({ ownerId, albumId, catalogVersion: page.catalogVersion, after });
      const currentCatalog = async () => this.database.album.findFirst({
        where: { id: albumId, ownerId, status: { not: AlbumStatus.ARCHIVED } },
        select: { catalogVersion: true },
      });
      const changed = (): PreviewBatchResult => ({ status: "catalog-changed", outcomes, nextCursor: null });
      for (const row of page.rows.slice(0, limit)) {
        if (signal?.aborted) return { status: "cancelled", outcomes, nextCursor: continuation() };
        if ((await currentCatalog())?.catalogVersion !== page.catalogVersion) return changed();
        let result: PreviewPublicationResult;
        try {
          result = await this.publisher.processPhoto(ownerId, albumId, row.id, signal);
        } catch (error) {
          if (error instanceof PreviewPublicationError && error.code === "not-found") return changed();
          // Database faults must not be treated as a completed item or lose the
          // previous continuation. The operator can safely retry the same page.
          throw error;
        }
        outcomes.push(result);
        if ((await currentCatalog())?.catalogVersion !== page.catalogVersion) return changed();
        if (result.status === "deferred") {
          return { status: signal?.aborted || result.code === "cancelled" ? "cancelled" : "blocked", outcomes, nextCursor: continuation() };
        }
        after = { photoId: row.id, sortOrder: row.sortOrder };
      }
      if ((await currentCatalog())?.catalogVersion !== page.catalogVersion) return changed();
      return {
        status: page.rows.length > limit ? "page-full" : "complete",
        outcomes,
        nextCursor: page.rows.length > limit ? continuation() : null,
      };
    } finally { this.running = false; }
  }
}
