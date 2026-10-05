-- ALB-004/PERF-003: owner equality followed by stable dashboard continuation.
CREATE INDEX "Album_ownerId_createdAt_id_idx" ON "Album"("ownerId", "createdAt", "id");
-- Monotonic selection snapshots avoid same-millisecond timestamp collisions.
ALTER TABLE "Selection" ADD COLUMN "revision" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Selection" ADD CONSTRAINT "Selection_revision_nonnegative" CHECK ("revision" >= 0);
