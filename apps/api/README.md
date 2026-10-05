# `apps/api`

Express API and composition root for the modular monolith.

## Responsibilities

- Authentication/session integration and authorization middleware.
- Versioned REST routes and Zod boundary validation.
- Album, gallery, sync, selection, comment, submit, and export services.
- Drive provider coordination and image descriptor endpoints.
- Rate limiting, structured logging, health checks, and error mapping.

## Boundaries

- Use repositories from `packages/database`.
- Use Drive interfaces/implementation from `packages/google-drive`.
- Share API contracts through `packages/shared`.
- Route handlers should remain thin; business rules belong in application services.

## Implemented foundation

- Google photographer identity sign-in through the official authentication
  library with PKCE/state/nonce, verified ID tokens, subject-based account
  ownership, hashed twelve-hour PostgreSQL sessions, and logout. Configure it
  as described in `docs/LOCAL_SETUP.md`; it intentionally requests no Drive
  scope. Live Google/PostgreSQL verification is pending.
- Owner-authorized Google Drive connection routes use a separate offline
  `drive.file` consent flow, owner-bound encrypted callback proof, versioned
  AES-256-GCM refresh-token storage, narrow connection DTOs, explicit
  reauthorization state, and local-first disconnect/revocation. Folder access
  and album routes remain closed until the live scope pilot.

- Express application and server entry point with validated host/port configuration.
- `GET /health/live` for process liveness only; this is not a database or Drive readiness claim.
- `GET /api/v1/system` to expose the shared source-format catalog.
- Request IDs, route-scoped structured request logs, bounded JSON bodies, and consistent error envelopes.
- Focused HTTP tests for live health, catalog response, unknown routes, and invalid JSON.
- An owner-scoped `AlbumSyncService` that claims a bounded sync run, fetches a
  complete direct-child catalog through `StorageProvider`, then reconciles
  photo metadata in one transaction. It is not connected to an HTTP endpoint
  or OAuth credentials yet.
- An internal `AlbumCreationService` validates an owner connection and accessible
  folder, hashes the optional password outside transactions, and atomically
  creates a DRAFT album/selection after locking/rechecking the connection.
  `createOwnerAlbumCreator` supplies real owner-bound OAuth; neither is wired
  into a route, sync or publication. ADR-011/032 still gate existing-child access
  and import exposure. See ADR-041 and docs/IMPLEMENTATION_STATUS.md.
- A server-only `SelectionService` for draft selections, limit enforcement,
  comments, idempotent submission, owner review, and ordered filename export.
  Authorized guest routes now expose current-page state, select/deselect,
  comment, and submit through gallery slugs without returning album IDs.
  Mutations require a matching web Origin/Referer and an in-process
  60-per-minute address/gallery pilot limit. Owner review/export use the separate
  photographer-session-authorized workspace routes documented below.
- A server-only passwordless gallery listing service with bounded keyset pages,
  encrypted catalog-versioned cursors, client-safe metadata, and a random
  public-slug generator. The authorized layer additionally supports protected
  galleries with a valid password session; unpublished albums never list.
- A server-only gallery password hash/verify boundary using versioned, salted,
  asynchronous scrypt. An optional protected-gallery API session endpoint
  verifies a published gallery password, throttles attempts in one API process,
  and issues a 12-hour encrypted HttpOnly cookie. Both list and derivative
  reads recheck the current album password hash. Creation hashing now exists
  internally; create/password-update HTTP/UI is not wired. The web app has a bilingual password form and forwards the
  session cookie only for the matching gallery.
- A server-only source-byte preflight helper checks bounded common image
  container headers before decoding. RAW and ambiguous formats require
  a decoder probe.
- A server-only raster renderer converts JPEG, PNG, WebP, AVIF, GIF, and
  TIFF into bounded static WebP thumbnail/preview buffers with orientation,
  sRGB, and source metadata removal. It returns per-photo unsupported/failure
  results for HEIC/RAW, oversized, or invalid inputs. A trusted
  `preparePreview` boundary now connects this renderer to the bounded Drive
  reader for one indexed photo, skipping known unsupported formats before
  download and returning safe per-photo outcomes. An internal owner-scoped
  `PreviewPublicationService` can publish an atomic pair through the private
  `DerivativeStore` interface and conditionally mark the indexed photo READY
  only if its source revision still matches. The first filesystem store
  requires an explicitly configured private absolute root on a persistent
  single-instance volume. The explicit operator command uses owner-bound OAuth;
  no automatic processing trigger/worker exists. APNG variant behavior has not yet
  been verified.
- `GET /api/v1/galleries/:slug/photos` serves up to 100 metadata records from
  PostgreSQL for published authorized galleries. Optional `limit` defaults to
  50 and `cursor` continues the page. With a configured derivative store,
  current READY photos receive application thumbnail/preview descriptors, not
  Drive IDs or provider URLs. `GET /api/v1/galleries/:slug/images/:photoId/:variant/:token`
  rechecks publication, current password authorization, activity, READY state,
  and source revision before serving a stored WebP derivative. Unauthorized
  protected galleries return no image bytes. The route uses private browser revalidation, not a public
  immutable cache.

Run with `pnpm --filter @photographer-platform/api dev`. The default address is `127.0.0.1:4000`; set `API_HOST` and `API_PORT` in the process environment to override it.

To enable the gallery route, configure both `DATABASE_URL` and
`GALLERY_CURSOR_KEY` privately in the API process environment. The cursor key
must be 32 random bytes encoded as canonical base64url. Generate one with
`node -e 'console.log(require("node:crypto").randomBytes(32).toString("base64url"))'`.
Keep the key stable while cursors are in use: rotating it invalidates existing
page cursors. Apply the Prisma migration before starting against a new database.
With neither setting present, the API still starts and the route responds
`503 GALLERY_UNAVAILABLE`; configuring only one setting fails startup.
Set `DERIVATIVE_STORE_ROOT` to an absolute, private (0700), persistent
single-instance volume to enable derivative descriptors and reads. Do not put
original files there. Multi-instance/container-ephemeral deployment, retention,
and production egress have not been validated.

To enable protected-gallery API sessions, additionally set a distinct
`GALLERY_SESSION_KEY` (canonical base64url of 32 random bytes),
`PUBLIC_WEB_BASE_URL`, and `PUBLIC_API_BASE_URL`. Both public origins must have
the same host and scheme so a host-only cookie can reach web and API; only
loopback may use HTTP. Password proof is `POST /api/v1/galleries/:slug/session`
with a JSON `password` and an `Origin` matching the configured web origin.
Success sets an HttpOnly, SameSite=Lax, host-only, path `/` cookie (Secure on
HTTPS); no password or token is logged. The in-memory five-attempt/15-minute
IP+gallery limiter and four-concurrent-scrypt cap are pilot safeguards, not a
distributed production limiter. Configure an edge/shared limiter and proxy IP
policy before exposing this route publicly.

Private workspace routes (owner session required, all no-store):

Infrastructure health: `/health/live` checks the process only; `/health/ready`
returns a narrow 200/ready or 503/not-ready after checking configured auth/Drive/
guest boundaries, current PostgreSQL schema and an existing private derivative
root. Probes coalesce/cache for five seconds, bound database statements and
never call Google or read data rows. Readiness does not prove live OAuth or
product acceptance. See `docs/OPERATIONS.md`.

Private workspace endpoints:

- `GET /api/v1/workspace/albums?cursor=...`: up to 25 indexed album summaries.
- `GET /api/v1/workspace/albums/:albumId/selection?cursor=...`: up to 50 naturally
  ordered selected-photo comments/descriptors, preserving removed selections.
- `GET /api/v1/workspace/albums/:albumId/images/:photoId`: only a stored selected
  thumbnail, with owner/selection/revision checks (never a Drive original).
- `GET /api/v1/workspace/albums/:albumId/selection/export`: submitted/locked
  `text/plain` download, fixed `selected-filenames.txt` attachment name.
- `POST /api/v1/workspace/albums/:albumId/lock` or `/reopen`: strict JSON `{}`.
- `POST /api/v1/workspace/albums/:albumId/archive`: strict JSON
  `{"confirmation":"archive"}`. Idempotent, blocks active sync, retains all
  application history and never deletes Drive originals.

Private mutations additionally require the configured web Origin or Referer
and a pilot process-local throttle. New migrations must be applied first.

Existing indexed albums can be processed explicitly with the privileged
`preview:batch` operator command after building the API and its packages. It
uses owner-scoped OAuth, at most 25 serial photos, encrypted catalog continuation
and an exclusive private-volume lock. It is not an import endpoint or scheduler;
HEIC/RAW remain explicit unsupported outcomes. See `docs/LOCAL_SETUP.md` and
ADR-036 for exact arguments, retry/status semantics and crash-lock recovery.

Status: application foundation and private/guest selection routes implemented
and offline tested. Internal service SQL invariants pass against fresh isolated
PostgreSQL 17.11, including constraints, concurrency, sync and draft creation.
Internal draft creation now requires a stable request UUID and atomically writes
an owner-bound durable receipt. Matching retries return the original response
without Drive access; changed settings/passwords return request-conflict. Apply
`202610050001_album_creation_receipts` before using this internal service. Its
SQL race/rollback/ownership tests pass; no create HTTP contract is exposed yet.
Create/import,
publication and authorized sync HTTP/UI await the live Drive folder-access pilot.
Image delivery is limited to prepared derivatives.
Guest selection HTTP routes
require the gallery session/origin configuration and are pilot-only pending a
shared production abuse policy. Full HTTP/browser-to-database and actual
Google/device acceptance remain open; isolated service SQL tests are narrower
evidence. `pnpm test:postgres` and the exact safe target policy are documented
in LOCAL_SETUP.md (ADR-042).
