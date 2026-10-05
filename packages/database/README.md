# `packages/database`

Prisma 7/PostgreSQL metadata package. All six migrations have been applied to a
fresh isolated PostgreSQL 17.11 test database and the real SQL invariant suite
has passed. This is not production deployment or restore-drill acceptance.

## Responsibilities

- Prisma schema, initial migration, and generated client.
- A connection-string based Prisma client factory for later server-side services.
- Database constraints and indexes for encrypted Drive credential state, album,
  durable creation receipts, photo, sync, and selection workflows.
- Deterministic natural filename ordering before assigning `Photo.sortOrder`.

## Rules

- Do not store original image bytes.
- Enforce unique `(albumId, driveFileId)` and `(selectionId, photoId)` relationships.
- Preserve soft-removed photo history until a retention policy permits purge.
- Keep the real SQL concurrency/constraint checks green when mutation services change.

## Local commands

Run `pnpm --filter @photographer-platform/database db:validate` to validate the
schema and `pnpm --filter @photographer-platform/database db:generate` to generate
the ignored TypeScript client under `src/generated/prisma`. Provide a private
`DIRECT_DATABASE_URL` (or `DATABASE_URL`) in the repository-root `.env` or
export it in your shell before running `db:deploy` against a
PostgreSQL database. Application deployment remains an explicit operation;
startup never applies migrations. Use supported Node.js 22.13+ or 24 LTS.

The migrations add SQL check constraints for positive dimensions and selection
limits, nonnegative counters and ordinals, and a partial unique index allowing
only one running sync per album. Prisma's schema language does not represent
those constraints/indexes. Keep them intact when changing the migration history.
The Drive credential migration also constrains connected rows to encrypted
token/key/account metadata and requires disconnected/reauthorization rows to
contain no retained token ciphertext.
The owner-workspace migration adds `(ownerId, createdAt, id)` dashboard indexing
and a nonnegative monotonic Selection.revision for stable review snapshots.
The creation-receipt migration adds owner-scoped hashed request keys, one receipt
per album, digest/slug checks and a composite album/owner foreign key. Receipts
retain the original response slug and salted password verifier, never plaintext
passwords or a fast password digest. They remain with archived history; future
approved hard purge must account for their restrictive FK. Existing albums need
no backfill. Apply `202610050001_album_creation_receipts` before using the
upgraded internal creator; this has not been deployed to the application database.
All package Prisma commands explicitly load `prisma7.config.ts`.
The config reads the root `.env` relative to its own location, even when pnpm
runs from `packages/database`. Exported values override file values for each
variable; a nonblank `DIRECT_DATABASE_URL` takes precedence over `DATABASE_URL`.
Validation and client generation work without either URL; deployment requires
one. No URL or credential is supplied automatically.

## Isolated SQL acceptance

From the repository root, provide an absolute PostgreSQL 17 binary directory and
run `POSTGRES_BIN_DIR=/absolute/path/to/bin pnpm test:postgres` after building the
shared/database/Drive dependencies. The launcher initializes its own private
temporary cluster and generated loopback `_test` database, applies migrations,
runs the full suite, then stops and removes only that owned cluster. It never
uses application URLs, root `.env` or an existing cluster. See LOCAL_SETUP.md.

`prisma-test.config.ts` uses the shared `testDatabaseUrl` guard instead of the
application configuration: an explicit loopback `_test` URL without query
parameters is mandatory. Unsafe targets fail closed, and a missing target skips
the SQL suite in ordinary `pnpm test`. The API re-exports the same guard; do not
introduce a separate weaker migration/fixture policy.
