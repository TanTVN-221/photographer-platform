# Photographer Drive + Client Proofing Platform

A starter repository for a photographer-oriented Digital Asset Management (DAM) and client proofing platform. The product keeps original photographs in Google Drive, indexes metadata in PostgreSQL, and provides a faster browsing and selection experience for large galleries.

This repository contains the product plan, runnable web and API foundations, a tested Google Drive metadata-listing package, a Prisma/PostgreSQL metadata schema, and server-side sync, selection, and gallery-listing services. The API exposes system status, the shared source-image format catalog, and configurable gallery metadata and stored-derivative endpoints. The web gallery can unlock a protected album, browse generated previews, and submit one client selection when configured; the photographer workflow and live end-to-end proof remain unfinished.

## Product goals

1. Browse folders and galleries containing hundreds or thousands of photographs quickly.
2. Keep infrastructure and bandwidth costs low.
3. Keep Google Drive as the source of truth for original files during the MVP.
4. Provide a clean photographer workspace and a simple client proofing flow.
5. Preserve a migration path to a SaaS product and a future CDN/object-storage image layer.

## Repository map

```text
.
├── AGENTS.md
├── README.md
├── docs/
│   ├── PRODUCT_SPEC.md
│   ├── REQUIREMENTS.md
│   ├── MVP_SCOPE.md
│   ├── ARCHITECTURE.md
│   └── DECISIONS.md
├── .agent/
│   ├── PLANS.md
│   └── CURRENT_PLAN.md
├── apps/
│   ├── web/
│   └── api/
└── packages/
    ├── database/
    ├── shared/
    ├── google-drive/
    └── ui/
```

## Proposed stack

- pnpm workspaces
- Next.js, React, TypeScript, Tailwind CSS
- Node.js, Express, TypeScript, Zod
- PostgreSQL and Prisma
- Google Drive API v3 behind the `packages/google-drive` provider boundary
- Auth.js or an equivalent Google sign-in solution for photographer accounts

## Start here

1. Read `AGENTS.md`.
2. Read `docs/PRODUCT_SPEC.md` and `docs/MVP_SCOPE.md`.
3. Review the open questions in `docs/DECISIONS.md`.
4. Use `.agent/PLANS.md` to write an execution plan.
5. Review the active phase in `.agent/CURRENT_PLAN.md` before adding product features.

## Run locally

Use supported Node.js 22 LTS (22.13+) or 24 LTS and pnpm 11.19.0:

```bash
pnpm install
pnpm dev
```

Open `http://127.0.0.1:3000` for the web app. The API listens at `http://127.0.0.1:4000`; `GET /health/live` checks only that the process is responding, and `GET /api/v1/system` serves the current shared format catalog. Both development commands load an optional root `.env`, with exported values taking precedence; restart after edits. See `.env.example` and [local setup](docs/LOCAL_SETUP.md) for PostgreSQL, private previews and Google settings. Do not mix `localhost` and `127.0.0.1` cookie hosts. No Google or database credentials are needed for the foundation routes.

Run `pnpm build`, `pnpm typecheck`, `pnpm test`, and `pnpm lint` to verify the workspace. To run the built applications separately, use `pnpm --filter @photographer-platform/api start` and `pnpm --filter @photographer-platform/web start`. Production start/build and SQL tests do not implicitly load root `.env`; supply their environments explicitly.

## Current status

See [the full remaining-work register](docs/IMPLEMENTATION_STATUS.md) for all
82 requirement IDs, missing implementation, acceptance checks and required setup.
The complete MVP is not yet ready for a private pilot.

- Google photographer identity sign-in: implemented with PKCE/state/nonce,
  verified Google ID tokens, twelve-hour hashed database sessions and logout.
  `/signin` and `/workspace` are bilingual. Real Google/PostgreSQL validation
  is pending; sign-in does not grant Drive access. See `docs/LOCAL_SETUP.md`.
- Google Drive authorization: implemented as a separate owner-bound offline
  `drive.file` grant with encrypted refresh-token storage, reconnect state,
  disconnect/revocation, and bilingual workspace controls. A real Picker/folder
  pilot must validate existing-child access before album import is enabled.
- Product requirements: drafted
- Owner workspace: indexed 25-album dashboard, naturally ordered 50-selection
  review with private stored thumbnails/comments, copy/open gallery, submitted
  or locked text export, lock/reopen and confirmed non-destructive archive are
  implemented and tested. Isolated SQL ownership/archive/export checks pass;
  populated real-account/browser acceptance remains pending.
- MVP boundaries: drafted
- Reference architecture: drafted and awaiting validation
- Shared media-format contract: implemented and unit tested
- Web and API foundations: running with a versioned shared contract
- Google Drive direct-child metadata provider: implemented and tested; the
  access-token boundary is connected to encrypted OAuth credentials, while
  folder selection and authorized sync routes remain pending
- Database metadata schema and migrations: implemented and validated; the
  configured local runtime passes schema readiness. Disposable SQL fixture and
  SQL migrations/constraints/concurrency pass on fresh PostgreSQL 17.11; CI,
  staging and restore evidence remain pending. Migrations are never automatic on startup.
- Owner-scoped album sync service: unit and real SQL tests pass for repeat/add/
  change/removal/reactivation/lease recovery; authorized HTTP/UI and real Drive
  access still await the existing-folder pilot
- Internal draft album creation: validates an accessible Drive folder, owner
  connection, optional password and limit; atomically creates a DRAFT album,
  selection and owner-bound receipt. A stable request UUID makes matching retries
  recover the original result; changed settings/passwords conflict. Offline and
  real SQL creation/rollback/collision/concurrent replay tests pass;
  import/publication HTTP/UI await the folder-child access gate. Folder metadata
  alone is not a successful import.
- Selection and filename-export service: implemented and unit tested; guest
  state/select/deselect/comment/submit routes now check the gallery session,
  origin, and pilot mutation throttle. Owner review/export/lifecycle routes are
  session-authorized; real SQL concurrent-cap/duplicate-submit checks pass.
  Real-account browser and production-load acceptance remain open
- Gallery browsing: bounded cursor pagination and password-session safety gate,
  with optional application image descriptors and read-only generated WebP
  thumbnail/preview delivery. The `/g/[slug]` page lazy-loads current-page
  thumbnails and opens one bounded preview in a lightbox. Protected-gallery
  unlock is wired through a bilingual form; select/deselect, comments, and
  submission are wired through server actions. Local SQL page traversal/query
  plans pass at 500/5,000 records; actual device/network budgets remain open
- Image decoding and preview processing: a tested raster renderer produces
  bounded static WebP thumbnail/preview buffers for JPEG, PNG, WebP,
  AVIF, GIF, and TIFF. An internal owner-scoped publisher now connects the
  bounded Drive reader, preparation boundary, private filesystem derivative
  store, and revision-checked database status update. An explicit privileged
  `preview:batch` command now uses owner-scoped OAuth for at most 25 serial
  photos with encrypted continuation and a private-volume lock. It is not a
  scheduler/import route; only stored derivatives have a public read route. HEIC/RAW
  processing and production
  shared-storage delivery are not implemented
- Shared, Drive, database, web, and API tests: configured
- Application CI: a pinned-action, read-only GitHub Actions workflow checks all
  builds/types/lint/tests and applies migrations to an ephemeral PostgreSQL
  service. An opt-in guarded SQL suite covers concurrency/constraints and
  500/5,000-photo pagination. Local SQL tests are skipped without an explicit
  disposable TEST_DATABASE_URL. `POSTGRES_BIN_DIR=/absolute/pg17/bin pnpm test:postgres`
  instead creates, migrates, tests and cleans up a new private loopback cluster,
  without reading private configuration. Phase 3H passed 657 tests, including 22
  real SQL checks after all six migrations, with zero skips;
  remote CI has not been run here.
- Production deployment: not configured
- Operational readiness: a safe no-store `/health/ready` probe checks configured
  private workflow boundaries, migrated schema and private preview volume.
  Fixed operation/error codes support redacted logs. Backup/restore, rollback,
  retention and incident procedures are documented in `docs/OPERATIONS.md`;
  actual hosting/monitoring/restore drills remain pending.

## Current implementation task

```text
Read AGENTS.md, the files in docs/, and .agent/CURRENT_PLAN.md. Continue only the
coherent phase recorded in the current plan, preserve requirement traceability,
and do not represent format classification as completed image decoding.
```
