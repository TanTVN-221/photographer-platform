CREATE TYPE "DriveConnectionStatus" AS ENUM ('CONNECTED', 'REAUTH_REQUIRED', 'DISCONNECTED');

ALTER TABLE "DriveConnection"
  ADD COLUMN "googleAccountEmail" TEXT,
  ADD COLUMN "status" "DriveConnectionStatus" NOT NULL DEFAULT 'DISCONNECTED',
  ADD COLUMN "grantedScopes" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN "connectedAt" TIMESTAMPTZ(3),
  ADD COLUMN "disconnectedAt" TIMESTAMPTZ(3);

-- No earlier application phase wrote OAuth credentials. Clear any manually
-- populated legacy bytes because their encryption/version cannot be verified.
UPDATE "DriveConnection"
SET "refreshTokenCiphertext" = NULL, "refreshTokenKeyVersion" = NULL;

ALTER TABLE "DriveConnection"
  ADD CONSTRAINT "DriveConnection_credential_state_check" CHECK (
    ("status" = 'CONNECTED'
      AND "refreshTokenCiphertext" IS NOT NULL
      AND "refreshTokenKeyVersion" IS NOT NULL
      AND "refreshTokenKeyVersion" ~ '^[A-Za-z0-9._-]{1,32}$'
      AND "googleAccountEmail" IS NOT NULL
      AND 'https://www.googleapis.com/auth/drive.file' = ANY("grantedScopes")
      AND "connectedAt" IS NOT NULL
      AND "disconnectedAt" IS NULL)
    OR
    ("status" <> 'CONNECTED'
      AND "refreshTokenCiphertext" IS NULL
      AND "refreshTokenKeyVersion" IS NULL)
  );

CREATE INDEX "DriveConnection_ownerId_status_idx" ON "DriveConnection"("ownerId", "status");
