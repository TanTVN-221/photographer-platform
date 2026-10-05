-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "AlbumStatus" AS ENUM ('DRAFT', 'PUBLISHED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "PreviewStatus" AS ENUM ('PENDING', 'READY', 'UNSUPPORTED_VARIANT', 'FAILED');

-- CreateEnum
CREATE TYPE "SelectionStatus" AS ENUM ('DRAFT', 'SUBMITTED', 'LOCKED');

-- CreateEnum
CREATE TYPE "SyncRunStatus" AS ENUM ('PENDING', 'RUNNING', 'SUCCEEDED', 'PARTIAL', 'FAILED');

-- CreateTable
CREATE TABLE "Photographer" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "googleSubject" TEXT,
    "displayName" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Photographer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DriveConnection" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "googleAccountId" TEXT NOT NULL,
    "refreshTokenCiphertext" BYTEA,
    "refreshTokenKeyVersion" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "DriveConnection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Album" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "driveConnectionId" TEXT NOT NULL,
    "driveFolderId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "publicSlug" TEXT NOT NULL,
    "status" "AlbumStatus" NOT NULL DEFAULT 'DRAFT',
    "passwordHash" TEXT,
    "selectionLimit" INTEGER,
    "catalogVersion" INTEGER NOT NULL DEFAULT 0,
    "lastSyncedAt" TIMESTAMPTZ(3),
    "publishedAt" TIMESTAMPTZ(3),
    "archivedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Album_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "Album_selectionLimit_positive" CHECK ("selectionLimit" IS NULL OR "selectionLimit" > 0),
    CONSTRAINT "Album_catalogVersion_nonnegative" CHECK ("catalogVersion" >= 0)
);

-- CreateTable
CREATE TABLE "Photo" (
    "id" TEXT NOT NULL,
    "albumId" TEXT NOT NULL,
    "driveFileId" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "formatId" TEXT NOT NULL,
    "width" INTEGER,
    "height" INTEGER,
    "sizeBytes" BIGINT,
    "driveCreatedTime" TIMESTAMPTZ(3),
    "driveModifiedTime" TIMESTAMPTZ(3),
    "driveVersion" TEXT,
    "md5Checksum" TEXT,
    "sourceRevision" TEXT,
    "sortOrder" INTEGER NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "removedAt" TIMESTAMPTZ(3),
    "previewStatus" "PreviewStatus" NOT NULL DEFAULT 'PENDING',
    "previewRevision" TEXT,
    "previewErrorCode" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Photo_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "Photo_width_positive" CHECK ("width" IS NULL OR "width" > 0),
    CONSTRAINT "Photo_height_positive" CHECK ("height" IS NULL OR "height" > 0),
    CONSTRAINT "Photo_sizeBytes_nonnegative" CHECK ("sizeBytes" IS NULL OR "sizeBytes" >= 0),
    CONSTRAINT "Photo_sortOrder_nonnegative" CHECK ("sortOrder" >= 0)
);

-- CreateTable
CREATE TABLE "Selection" (
    "id" TEXT NOT NULL,
    "albumId" TEXT NOT NULL,
    "status" "SelectionStatus" NOT NULL DEFAULT 'DRAFT',
    "submittedAt" TIMESTAMPTZ(3),
    "lockedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Selection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SelectionItem" (
    "id" TEXT NOT NULL,
    "selectionId" TEXT NOT NULL,
    "photoId" TEXT NOT NULL,
    "albumId" TEXT NOT NULL,
    "comment" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "SelectionItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SyncRun" (
    "id" TEXT NOT NULL,
    "albumId" TEXT NOT NULL,
    "status" "SyncRunStatus" NOT NULL DEFAULT 'PENDING',
    "createdCount" INTEGER NOT NULL DEFAULT 0,
    "updatedCount" INTEGER NOT NULL DEFAULT 0,
    "unchangedCount" INTEGER NOT NULL DEFAULT 0,
    "removedCount" INTEGER NOT NULL DEFAULT 0,
    "skippedCount" INTEGER NOT NULL DEFAULT 0,
    "failedCount" INTEGER NOT NULL DEFAULT 0,
    "errorCode" TEXT,
    "startedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMPTZ(3),

    CONSTRAINT "SyncRun_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "SyncRun_counts_nonnegative" CHECK (
        "createdCount" >= 0 AND
        "updatedCount" >= 0 AND
        "unchangedCount" >= 0 AND
        "removedCount" >= 0 AND
        "skippedCount" >= 0 AND
        "failedCount" >= 0
    )
);

-- CreateIndex
CREATE UNIQUE INDEX "Photographer_email_key" ON "Photographer"("email");

-- CreateIndex
CREATE UNIQUE INDEX "Photographer_googleSubject_key" ON "Photographer"("googleSubject");

-- CreateIndex
CREATE INDEX "DriveConnection_ownerId_idx" ON "DriveConnection"("ownerId");

-- CreateIndex
CREATE UNIQUE INDEX "DriveConnection_ownerId_googleAccountId_key" ON "DriveConnection"("ownerId", "googleAccountId");

-- CreateIndex
CREATE UNIQUE INDEX "DriveConnection_id_ownerId_key" ON "DriveConnection"("id", "ownerId");

-- CreateIndex
CREATE UNIQUE INDEX "Album_publicSlug_key" ON "Album"("publicSlug");

-- CreateIndex
CREATE INDEX "Album_ownerId_status_updatedAt_idx" ON "Album"("ownerId", "status", "updatedAt");

-- CreateIndex
CREATE INDEX "Album_driveConnectionId_driveFolderId_idx" ON "Album"("driveConnectionId", "driveFolderId");

-- CreateIndex
CREATE INDEX "Photo_albumId_active_sortOrder_id_idx" ON "Photo"("albumId", "active", "sortOrder", "id");

-- CreateIndex
CREATE INDEX "Photo_albumId_previewStatus_idx" ON "Photo"("albumId", "previewStatus");

-- CreateIndex
CREATE UNIQUE INDEX "Photo_albumId_driveFileId_key" ON "Photo"("albumId", "driveFileId");

-- CreateIndex
CREATE UNIQUE INDEX "Photo_id_albumId_key" ON "Photo"("id", "albumId");

-- CreateIndex
CREATE UNIQUE INDEX "Selection_albumId_key" ON "Selection"("albumId");

-- CreateIndex
CREATE UNIQUE INDEX "Selection_id_albumId_key" ON "Selection"("id", "albumId");

-- CreateIndex
CREATE INDEX "SelectionItem_selectionId_createdAt_idx" ON "SelectionItem"("selectionId", "createdAt");

-- CreateIndex
CREATE INDEX "SelectionItem_photoId_albumId_idx" ON "SelectionItem"("photoId", "albumId");

-- CreateIndex
CREATE UNIQUE INDEX "SelectionItem_selectionId_photoId_key" ON "SelectionItem"("selectionId", "photoId");

-- CreateIndex
CREATE INDEX "SyncRun_albumId_startedAt_idx" ON "SyncRun"("albumId", "startedAt" DESC);

-- CreateIndex
CREATE INDEX "SyncRun_status_startedAt_idx" ON "SyncRun"("status", "startedAt");

-- AddForeignKey
ALTER TABLE "DriveConnection" ADD CONSTRAINT "DriveConnection_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "Photographer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Album" ADD CONSTRAINT "Album_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "Photographer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Album" ADD CONSTRAINT "Album_driveConnectionId_ownerId_fkey" FOREIGN KEY ("driveConnectionId", "ownerId") REFERENCES "DriveConnection"("id", "ownerId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Photo" ADD CONSTRAINT "Photo_albumId_fkey" FOREIGN KEY ("albumId") REFERENCES "Album"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Selection" ADD CONSTRAINT "Selection_albumId_fkey" FOREIGN KEY ("albumId") REFERENCES "Album"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SelectionItem" ADD CONSTRAINT "SelectionItem_selectionId_albumId_fkey" FOREIGN KEY ("selectionId", "albumId") REFERENCES "Selection"("id", "albumId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SelectionItem" ADD CONSTRAINT "SelectionItem_photoId_albumId_fkey" FOREIGN KEY ("photoId", "albumId") REFERENCES "Photo"("id", "albumId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SyncRun" ADD CONSTRAINT "SyncRun_albumId_fkey" FOREIGN KEY ("albumId") REFERENCES "Album"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
