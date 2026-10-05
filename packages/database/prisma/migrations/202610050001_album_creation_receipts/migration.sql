-- Existing albums remain unchanged and do not receive invented request IDs.
CREATE UNIQUE INDEX "Album_id_ownerId_key" ON "Album"("id", "ownerId");

CREATE TABLE "AlbumCreationRequest" (
  "ownerId" TEXT NOT NULL,
  "keyHash" TEXT NOT NULL,
  "requestHash" TEXT NOT NULL,
  "passwordHash" TEXT,
  "publicSlug" TEXT NOT NULL,
  "albumId" TEXT NOT NULL,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "AlbumCreationRequest_pkey" PRIMARY KEY ("ownerId", "keyHash"),
  CONSTRAINT "AlbumCreationRequest_keyHash_check" CHECK ("keyHash" ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "AlbumCreationRequest_requestHash_check" CHECK ("requestHash" ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "AlbumCreationRequest_publicSlug_check" CHECK ("publicSlug" ~ '^[A-Za-z0-9_-]{24}$')
);

CREATE UNIQUE INDEX "AlbumCreationRequest_albumId_key" ON "AlbumCreationRequest"("albumId");
CREATE UNIQUE INDEX "AlbumCreationRequest_albumId_ownerId_key" ON "AlbumCreationRequest"("albumId", "ownerId");

ALTER TABLE "AlbumCreationRequest"
  ADD CONSTRAINT "AlbumCreationRequest_albumId_ownerId_fkey"
  FOREIGN KEY ("albumId", "ownerId") REFERENCES "Album"("id", "ownerId")
  ON DELETE RESTRICT ON UPDATE CASCADE;
