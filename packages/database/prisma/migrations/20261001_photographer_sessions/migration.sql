CREATE TABLE "PhotographerSession" (
    "tokenHash" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "PhotographerSession_pkey" PRIMARY KEY ("tokenHash"),
    CONSTRAINT "PhotographerSession_token_hash_check" CHECK ("tokenHash" ~ '^[a-f0-9]{64}$'),
    CONSTRAINT "PhotographerSession_expiry_check" CHECK ("expiresAt" > "createdAt")
);
CREATE INDEX "PhotographerSession_ownerId_idx" ON "PhotographerSession"("ownerId");
CREATE INDEX "PhotographerSession_expiresAt_idx" ON "PhotographerSession"("expiresAt");
ALTER TABLE "PhotographerSession" ADD CONSTRAINT "PhotographerSession_ownerId_fkey"
    FOREIGN KEY ("ownerId") REFERENCES "Photographer"("id") ON DELETE CASCADE ON UPDATE CASCADE;
