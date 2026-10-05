# Reference Architecture

Status: Draft for Phase 1 validation
Rule: This document describes the proposed MVP architecture. Decisions marked open must be resolved before the affected implementation begins.

## 1. System shape

Use a modular monolith deployed as two application processes plus PostgreSQL:

```text
Photographer / Client Browser
             |
             v
       Next.js Web App
             |
             | versioned REST + secure cookies/tokens
             v
        Express API
       /     |      \
      v      v       v
PostgreSQL  Drive API  ImageUrlProvider
 metadata   + OAuth    -> Drive first, CDN later
```

The web app owns presentation and browser interaction. The API owns authorization, validation, business rules, persistence, Drive coordination, and image-descriptor policy. PostgreSQL is the fast query model for routine browsing. Google Drive remains the source of truth for original files.

## 2. Monorepo boundaries

```text
apps/web                 Next.js pages, layouts, gallery and dashboard UI
apps/api                 Express composition root, routes, middleware, jobs
packages/database        Prisma schema/client, migrations, repositories
packages/shared          Zod contracts, domain values, shared utilities
packages/google-drive    Drive provider interfaces and Google implementation
packages/ui              Reusable accessible presentation components
```

Dependencies should point inward:

- Apps may depend on packages.
- `google-drive` may depend on shared contracts but not on app routes or UI.
- `database` must not depend on Express or React.
- `shared` must remain lightweight and browser-safe where exported to web.
- `ui` must not call Drive or Prisma directly.

## 3. Runtime modules

### Identity and access

- Photographer sign-in and application session.
- Drive connection lifecycle and encrypted token storage.
- Owner/tenant authorization policy.
- Public gallery authorization and password session.

Photographer identity now uses Google's official library for authorization-code
sign-in with identity scopes only. The API validates callback proof and issues
revocable database sessions whose random tokens are stored only as hashes.
ADR-031 defines the cookie, CSRF, expiry and account-linking policy. The web
checks the API session on every workspace page; live Google/PostgreSQL proof
and Drive authorization remain separate integration gates.

Drive consent is now a second, owner-session-bound OAuth flow. It requests
`drive.file` with offline access plus the OpenID claims needed to identify the
connected Google account. State, nonce, PKCE and an encrypted ten-minute flow
cookie bind the callback to the owner that initiated it. Only the refresh token
is retained, encrypted with a dedicated versioned AES-256-GCM key and
owner/account authenticated data. Access and ID tokens are discarded. Private
status/disconnect routes return narrow DTOs and enforce owner/session/origin
checks. Revoked refresh credentials become `REAUTH_REQUIRED`; disconnect clears
local ciphertext before attempting provider revocation. ADR-032 records this
boundary. Folder selection and album import remain disabled until an authorized
live pilot resolves ADR-011's existing-folder child-access question.

### Drive workspace

- Provider-neutral `StorageProvider` contract.
- Google OAuth client, encrypted refresh-token lifecycle, and owner-scoped
  short-lived access-token source.
- Folder/file listing and narrow metadata mapping.
- Future folder mutations and upload.

### Albums and catalog

- Album creation, publication, archive, and listing.
- Album-scoped `Photo` metadata and cursor queries.
- Natural sort keys.
- Dashboard summaries.

The internal draft creator in ADR-041 now owner-checks a connected Drive account,
validates narrow accessible-folder metadata through DriveFolderReader, and hashes
an optional password outside its short transaction. A connection-row lock rechecks
local state before atomic DRAFT album/selection/receipt creation. ADR-043 adds a
validated owner-scoped request UUID and durable hashed receipt key. Replays
verify canonical settings and the original salted password hash outside locks,
then recover the original ID/slug/response without another Drive call or lifecycle
change. The composite owner FK and unique key fence same-key creation races.
It is not wired into
HTTP/UI, sync or publication. Folder metadata/canListChildren does not prove the
app's OAuth grant covers existing child files; ADR-011/032 remain open.

### Synchronization

- Album sync orchestration.
- Complete Drive pagination.
- Idempotent reconciliation.
- Soft removal and sync audit record.
- Safe retries, duplicate sync prevention, and result reporting.

### Galleries and image delivery

- Public gallery lookup by random slug.
- Password verification and short-lived authorized gallery session.
- Paginated client-safe DTOs.
- `ImageUrlProvider` output with thumbnail/preview descriptors and expiry where applicable.

Current implementation: the Express metadata route for published galleries
uses the indexed PostgreSQL listing service and a
shared strict DTO. It is composed only when `DATABASE_URL` and a private
32-byte `GALLERY_CURSOR_KEY` are both set; otherwise it returns 503. When a
private `DERIVATIVE_STORE_ROOT` is also configured, current READY photos get
application image descriptors, and a read-only route rechecks the gallery,
photo, and revision before serving stored WebP bytes. Password-protected
galleries require a separate session key and same-host web/API origin config.
The password POST applies pilot in-process rate/concurrency limits and issues
an encrypted, password-revision-bound, HttpOnly cookie; listing and image
reads check it against current album state. A live database query plan and end-to-end latency,
bandwidth, and failure-rate checks remain pending.

The Next.js `/g/[slug]` route renders one server-fetched, 50-row page with
opaque-cursor continuation. A bounded client grid lazy-loads application-owned
thumbnails and opens one generated preview at a time in a native dialog with
keyboard and touch-sized controls. It does not accumulate pages or request
original bytes. Protected galleries show a localized password form; a server
action proves the password and forwards only its per-gallery HttpOnly cookie
  on later metadata fetches. The bounded gallery now fetches page-scoped
  selection state and uses server actions for select/deselect, comments, and
  confirmed submission. The generated-preview stage now supports completed
  single-finger horizontal swipes within that same page. Vertical pan/pinch
  zoom stay native; taps, multi-touch, cancelled pointers and zoomed viewport
  gestures do not navigate. Modal focus, scroll restoration and deliberate
  outside-tap dismissal are independent of selection mutations. ADR-038 records
  the interaction policy; real handset and measured mobile performance remain
  separate acceptance work.

### Media inspection and preview processing

- Shared source-format classification for Drive discovery.
- Byte-signature and decoder validation at the processing boundary.
- Metadata extraction, orientation, and color normalization.
- Embedded-preview extraction for RAW sources before full demosaic fallback.
- Bounded thumbnail/preview derivative generation tied to the Drive source revision.
- Explicit pending, ready, unsupported-variant, and failed processing states.

### Selections

- Draft selection creation or retrieval.
- Transactional add/remove/comment.
- Selection-limit enforcement.
- Submit, lock, and reopen policy.
- Photographer review and filename export.

The selection service implements owner-checked review, completed-selection
export, and album-row-serialized lock/reopen transitions (ADR-030). ADR-033's
private HTTP/workspace UI resolve real photographer sessions rather than trusting
caller-supplied owner IDs. Isolated real SQL ownership/concurrency/archive checks
pass (ADR-042); full two-owner Google/browser workflow acceptance remains pending.

## 4. Proposed domain data

The initial Prisma schema is in `packages/database/prisma/schema.prisma`. It
models these MVP relationships (fresh migrations and isolated real SQL invariant
checks pass; deployed/restore acceptance remains pending):

```text
Photographer 1---n DriveConnection
Photographer 1---n Album
Album        1---n Photo
Album        1---0..1 Selection
Selection    1---n SelectionItem n---1 Photo
Album        1---n SyncRun
```

Important constraints:

- Unique photographer email or provider account identity.
- Unique album `publicSlug`.
- Unique `(albumId, driveFileId)`.
- Unique `(selectionId, photoId)`.
- A selection item photo must belong to the same album as its selection; the initial schema enforces this with composite foreign keys.
- Soft-deactivated photos remain addressable for history but are excluded from active gallery listing.
- Selection mutations use a transaction and an album-row `FOR UPDATE` lock;
  ADR-021 records the MVP policy. Isolated PostgreSQL concurrent-cap and
  duplicate-select/submit tests pass; production-load proof is separate.

Candidate statuses:

```text
Album: DRAFT | PUBLISHED | ARCHIVED
Selection: DRAFT | SUBMITTED | LOCKED
SyncRun: PENDING | RUNNING | SUCCEEDED | PARTIAL | FAILED
```

## 5. Google OAuth and scopes

Use Google sign-in and Drive authorization as conceptually separate grants even if the UX combines them. Request the minimum scopes required by the operations actually shipped.

Before implementation:

1. Verify current Google scope semantics and verification requirements.
2. Decide whether the proofing MVP can use file-picker/file-specific access or requires broader Drive metadata access.
3. Document disconnect/revocation behavior.
4. Define envelope encryption or a managed key service for refresh tokens.

Do not store refresh tokens in logs, client state, or browser-readable storage.

## 6. Metadata indexing and sync

### Initial import

1. Validate the folder identifier and photographer authorization.
2. Create an album in a non-published/importing state.
3. Fetch direct children with a narrow Drive `fields` projection and follow every `nextPageToken`.
4. Filter supported MIME types and non-trashed items.
5. Map provider data to application metadata.
6. Generate deterministic natural-order information.
7. Reconcile additions in bounded batches and update changed photos under the
   unique album/file constraint.
8. Mark unseen previously-active photos inactive only after a complete successful listing.
9. Store sync counts and publish the album when policy allows.

### Incremental strategy

For the first MVP, a complete manual folder reconciliation is simpler and safer than a distributed webhook system. Future optimization may use the Drive Changes API and periodic reconciliation. Do not mark items removed when a partial listing fails.

### Idempotency and concurrency

- Reject or coalesce concurrent syncs for the same album.
- Use a sync-run lease/status with timeout recovery. ADR-020 records the first
  implementation: one claimed run per album, a bounded listing deadline, and
  a short reconciliation transaction.
- Upsert by `(albumId, driveFileId)`.
- Commit reconciliation state only when the listing is known to be complete.
- Keep client selections attached to soft-deactivated photos for audit/export decisions.

## 7. Image delivery contract

The frontend receives descriptors rather than constructing Drive URLs:

```ts
type ImageDescriptor = {
  src: string;
  width: number | null;
  height: number | null;
  expiresAt?: string;
  refreshStrategy?: "none" | "reload-page" | "request-new-descriptor";
};

interface ImageUrlProvider {
  getThumbnail(photoId: string, requestedWidth: number): Promise<ImageDescriptor>;
  getPreview(photoId: string, requestedWidth: number): Promise<ImageDescriptor>;
}
```

The TypeScript is illustrative, not implementation.

### Strategy gate

Phase 1 must test and document:

- Official Drive `thumbnailLink` behavior and expiry.
- Auth requirements for private files.
- Browser CORS/hotlink behavior.
- Cache-control and whether a URL can be shared safely.
- Drive quota impact.
- A limited backend thumbnail proxy/cache and its bandwidth/cost/privacy trade-off.
- Failure and refresh behavior in the gallery.
- Generated derivative storage, retention, invalidation, and delivery cost.
- HEIC decoder deployment and patent/licensing implications.
- RAW decoder compatibility, embedded-preview quality, and fallback behavior.

Do not proxy originals by default. If a thumbnail proxy is chosen, constrain sizes, authenticate private access, stream safely, set cache policy deliberately, and prevent it from becoming an open proxy.

For sources that are not reliably browser-displayable, a processor may download the original to bounded ephemeral storage, validate and decode it, publish only browser-safe derivatives, and then remove the temporary original. Derivatives are not authoritative copies and must be invalidated when the Drive source revision changes. Processing must not occur in a gallery-list request.

The first server-only `inspectSourcePrefix` preflight now compares a bounded
prefix with filename/MIME discovery. It recognizes common raster container
signatures, rejects clear conflicts and disguised HTML/SVG, and explicitly
requires a decoder-specific probe for ambiguous RAW/ISO BMFF variants. A
prefix match is not full-file validation, decoder compatibility, or a ready
preview. The server-only raster renderer now calls this preflight, validates
the decoder's format and dimensions, and creates bounded static WebP
thumbnail/preview buffers for the supported raster subset. A separate
`OriginalImageReader` in `packages/google-drive` now checks folder membership,
download capability, size, and source revision before and after a bounded
`files.get?alt=media` read. It returns temporary bytes only to a trusted
server-side caller; it does not authorize albums or persist data. The
server-only `preparePreview` boundary now connects a trusted indexed candidate
to this reader and the raster renderer, yielding derivative buffers tied to
the source revision or a safe per-photo outcome. It skips known unsupported
formats before download. The internal `PreviewPublicationService` now owner-
checks a photo, publishes the pair through `DerivativeStore`, and conditionally
marks READY only if the active indexed source revision remains unchanged. The
first store uses an explicitly configured private filesystem root for a
single-instance persistent-volume pilot. Stored-derivative API reads are now
authorized through gallery/owner sessions. An explicit operator command now
coordinates owner-scoped OAuth-backed preview batches of at most 25 photos,
serially and outside snapshot transactions. It uses encrypted owner/catalog-bound
continuation and an exclusive private-volume lock, stops/retries a deferred photo,
and never runs in gallery requests. Publication state writes take the same short
album-row lock as archive/sync. ADR-036 records its single-volume, crash-lock
and soft-deadline limitations. There is still no background scheduler, automated
derivative purge or approved multi-instance store.
RAW and HEIC remain
per-photo unsupported outcomes until their processing paths are implemented.
ADRs 023–025 record the initial limits and trade-offs.

## 8. API conventions

- Prefix routes with `/api/v1`.
- Validate params, query, body, and external response mapping with Zod.
- Use opaque cursor tokens that encode the stable sort tuple, not raw offsets.
- Return a consistent error envelope with a request/correlation ID.
- Separate public gallery DTOs from private album DTOs.
- Use idempotency semantics for submit and other retry-prone mutations.
- Keep list responses narrow; fetch detail only when needed.

The initial cursor sort tuple is `(sortOrder, id)`, with the album catalog
version included in an encrypted, authenticated opaque cursor. ADR-019 records
the natural-order choice and ADR-022 records the 100-item keyset read. The
current read service can include application-generated image descriptors for
READY revisions; protected galleries require ADR-028's password session.
Reindex and query-plan performance remain to be proven before launch.

The authenticated workspace in ADR-033 exposes indexed owner albums, paged
selection review, stored selected thumbnails, submitted/locked text exports,
lock/reopen, and non-destructive archive. Owner sessions are resolved on every
API request. Dashboard continuation is an owner-indexed `(createdAt, id)`
keyset; review continuation binds a natural-order metadata snapshot and
monotonic selection revision. Only 25 albums/50 comments are returned per page;
review sorts narrow metadata server-side, including inactive selected photos.
The UI disables speculative page prefetch. Private thumbnails/exports use
no-store and never disclose provider file IDs/URLs or credentials. Archive
serializes on the album row, retains history, and refuses a running sync.

## 9. Selection consistency

For select:

1. Authorize the gallery session and verify selection is draft.
2. Start a transaction and lock the album row so first-selection creation and
   all later mutations serialize per album.
3. If item already exists, return success idempotently.
4. Count active items and enforce the album limit.
5. Insert the unique selection item.
6. Commit and return the authoritative count.

Deselect is allowed at the limit while draft. Submit transitions only from draft,
requires at least one item, and is idempotent while submitted. Submitted and
locked selections reject edits. ADR-021 records this policy; it still needs a
live PostgreSQL concurrency test.

The guest API exposes a narrow, at-most-50-photo current-page selection state
and slug-authorized select/deselect/comment/submit mutations. ADR-029 records
the facade, exact web-origin check, and single-process pilot limiter. No
public response includes the internal album ID; owner review/export use separate
photographer-session-authorized routes in ADR-033.

The Next.js gallery fetches selection state only for the displayed page and
uses server actions to forward the matching HttpOnly gallery cookie and exact
web origin to mutation routes. The client viewer updates from authoritative
API counts, keeps current-page selected/comment state, requires an explicit
second confirmation before submit, and disables edits after SUBMITTED/LOCKED.
Live concurrent-browser and mobile-device validation remain outstanding.

## 10. Frontend performance

- Server-render the gallery shell and only the first bounded page when appropriate.
- Use an infinite-query data layer with opaque cursors.
- Reserve aspect-ratio boxes from stored dimensions.
- Use `srcset`/sizes or equivalent descriptor selection.
- Lazy-load outside the initial viewport.
- Use a measured masonry strategy that does not reflow the entire collection repeatedly.
- Apply windowing once item count/DOM measurements require it; preserve keyboard navigation and lightbox index mapping.
- Avoid prefetching large previews indiscriminately.
- Treat image failures as recoverable, visible per-item states.

Performance must be tested on representative mobile hardware and constrained networks. Desktop localhost measurements alone are insufficient.

## 11. Caching

Start without Redis.

- PostgreSQL is the durable metadata cache/query model.
- Browser and CDN cache headers should be used where privacy and URL lifetime allow.
- Next.js data caching may be used only with explicit invalidation after sync and selection mutations.
- Small in-process caches may hold non-sensitive, short-lived provider metadata if correctness does not depend on them.
- Do not cache password authorization or private image URLs in shared/public caches.

Add Redis or a queue only after measurements show a concrete need such as cross-instance leases, background work pressure, or hot shared data.

## 12. Security boundaries

- Private API: authenticated photographer plus owner policy.
- Public gallery: slug lookup plus optional password-derived short-lived session.
- Mutations: CSRF-safe authenticated/session-bound request and rate limit.
- Drive provider: server only; credentials never exposed to web code.
- Export: photographer owner only and submitted selection only.
- Logs/telemetry: structured and redacted.

Use the versioned scrypt password hashes recorded in ADR-027 (or explicitly
migrate to a stronger deployment-supported algorithm). Public slugs must use
cryptographically secure randomness. ADR-037 now enforces a request-nonce CSP
for the existing application-owned derivative strategy: only self and validated
same-host public API image origins, no Drive/Google image or script sources.
Only Google OAuth form navigation is allowed. API responses use same-site
resource isolation without granting cross-origin JavaScript reads. Headers do
not replace owner/gallery checks; HTTPS/HSTS, edge rate limits and a production
browser/account pilot remain release gates.
Web documents use ADR-040's origin-only, downgrade-safe referrer policy so
native sign-in/Drive/logout POSTs preserve Origin across local ports. API
no-referrer and exact-origin CSRF checks are unchanged; opaque origins are denied.

## 13. Observability

Record:

- Request ID, route, status, and duration.
- Drive operation name, latency, response class, quota/rate-limit category, and retry count.
- Sync run counts and duration.
- Gallery list latency and page size.
- Image descriptor/thumbnail failure rate.
- Selection-limit conflicts and submit results.

Never record raw tokens, passwords, cookies, authorization headers, or sensitive image URLs.

## 14. Deployment direction

The initial deployment needs:

- One Next.js service.
- One Express API service.
- Managed PostgreSQL.
- Secret management and an encryption key strategy.
- TLS, application hostname, and allowed-origin configuration.
- Database migrations as a controlled release step.
- Health/readiness checks and centralized logs.

The provider must be selected only after checking long-running/streaming constraints, egress cost, region, database connectivity, and the chosen thumbnail path.

## 15. Requirement coverage

| Architecture area | Requirement groups |
| --- | --- |
| Modular monolith and packages | PROD-003, DRIVE-003 |
| Identity and authorization | AUTH-*, PROD-002, SEC-* |
| Metadata index and sync | DRIVE-005–018, DB-* , OPS-001 |
| Album/gallery APIs | ALB-*, GAL-*, PERF-001, PERF-005 |
| Image provider | IMG-*, PERF-002–004 |
| Transactional selection | SEL-*, EXP-* |
| Operations | OPS-*, PERF-006–007 |

## 16. Unresolved gates

- Exact Google OAuth scopes and consent/verification path.
- Production image delivery mechanism for private Drive files.
- Production/shared derivative storage provider, retention limits, and
  asynchronous processing execution model (the private filesystem store in
  ADR-025 is limited to an explicitly persistent single-instance pilot).
- HEIC decoder distribution/licensing and the pinned RAW decoder compatibility policy.
- Materialized natural-order reindexing cost and catalog-version cursor behavior (ADR-019; live performance proof pending).
- Production-like query/lock/load coverage beyond ADR-042's executed local SQL
  selection-limit, sync-claim and archive-fence tests.
- Where sync executes if request duration exceeds the chosen hosting limit.
- Production gallery-session revocation, cross-instance abuse controls, and
  trusted-proxy address policy (ADR-028 covers only the single-instance pilot).
- Quantitative performance budgets and target device/network matrix.
- Data retention and account/album deletion policy.

These gates must be recorded or resolved in `docs/DECISIONS.md` before their implementation phases.

The complete current implementation/verification/setup register for all
requirements is [IMPLEMENTATION_STATUS.md](IMPLEMENTATION_STATUS.md).
