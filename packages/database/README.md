# `packages/database`

Planned Prisma and PostgreSQL package.

## Responsibilities

- Prisma schema, migrations, and generated client.
- Transaction boundaries and repository implementations.
- Database constraints and indexes for album, photo, sync, and selection workflows.
- Test fixtures and representative large-gallery datasets.

## Rules

- Do not store original image bytes.
- Enforce unique `(albumId, driveFileId)` and `(selectionId, photoId)` relationships.
- Preserve soft-removed photo history until a retention policy permits purge.
- Prove selection-limit concurrency behavior with tests.

Status: directory placeholder; schema design begins in Phase 2.

