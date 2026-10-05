-- Apply after initial metadata creation. This migration has never been deployed.
-- A single active run per album, even if a second application process attempts a claim.
-- Claims and stale-run recovery also lock the Album row before changing status.
CREATE UNIQUE INDEX "SyncRun_one_running_per_album_key"
ON "SyncRun" ("albumId")
WHERE "status" = 'RUNNING';
