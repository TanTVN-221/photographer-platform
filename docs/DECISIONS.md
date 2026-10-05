# Architectural Decision Log

This file records decisions that future implementation work must not silently reverse. Each change should include the reason, consequences, and migration path.

## ADR-001 — Google Drive stores original files

Status: Accepted

### Decision

Google Drive remains the source of truth for original photographs during the MVP. The application does not permanently duplicate originals into its own storage.

### Consequences

- Storage cost stays low.
- Availability, quota, and some image-delivery behavior depend on Google Drive.
- A future CDN/object-storage migration must be possible through provider abstractions.

## ADR-002 — PostgreSQL is the metadata query model

Status: Accepted

### Decision

Drive metadata is synchronized into PostgreSQL. Routine workspace and gallery listings read from PostgreSQL instead of issuing a fresh Drive listing on every view.

### Consequences

- Browsing is faster and more predictable.
- The product needs explicit sync and stale-data behavior.
- Sync must be complete, idempotent, observable, and safe under partial failure.

## ADR-003 — Modular monolith in a pnpm monorepo

Status: Accepted

### Decision

Use `apps/web`, `apps/api`, and focused packages in one repository. Do not begin with microservices.

### Consequences

- Local development and deployments remain understandable.
- Module boundaries must be enforced through imports and ownership, not network services.
- Services can be extracted later only with measured justification.

## ADR-004 — No Redis or queue initially

Status: Accepted

### Decision

Start with PostgreSQL and application processes. Add Redis or a job queue only after a concrete need is measured or a hosting constraint requires background execution.

### Consequences

- Fewer operational dependencies.
- Initial sync execution must have explicit concurrency and timeout handling.
- A later background-work migration should preserve the same sync service contract.

## ADR-005 — Selection is a separate aggregate

Status: Accepted

### Decision

Selection state is modeled with `Selection` and `SelectionItem`; `Photo` has no `isSelected` boolean.

### Consequences

- Draft/submitted/locked workflow and future multiple lists are possible.
- Selection limits require transactional enforcement.
- Export must identify the submitted selection explicitly.

## ADR-006 — Direct-child supported images only in MVP

Status: Superseded by ADR-017 for media formats; direct-child traversal remains accepted

### Decision

MVP album sync scans only direct children of one Drive folder and imports JPEG, PNG, and WebP metadata.

### Consequences

- Import rules are understandable and testable.
- Recursive sections, HEIC/TIFF/RAW, video, and preview conversion are deferred.

### Supersession note

The direct-child traversal decision remains in force. The JPEG/PNG/WebP-only media boundary was expanded by ADR-017 after product review; video and recursive folder traversal remain deferred.

## ADR-007 — Provider-neutral image contract

Status: Accepted

### Decision

Gallery components consume application image descriptors from `ImageUrlProvider`; they do not construct Google Drive URLs.

### Consequences

- Drive URL expiry and refresh can be handled centrally.
- The gallery can migrate to a CDN/object store without component-level rewrites.
- The initial provider mechanism remains an open gate.

## ADR-008 — Full-resolution API proxy is not the default

Status: Accepted

### Decision

Do not send full-resolution image bytes through the Node API during routine gallery browsing.

### Consequences

- Server bandwidth remains bounded.
- A safe, privacy-aware thumbnail and preview strategy still needs validation.
- Original downloads are outside the MVP.

## ADR-009 — Cursor pagination for gallery lists

Status: Accepted

### Decision

Use an opaque cursor over a stable sort tuple instead of offset pagination for large galleries.

### Consequences

- Performance and continuation behavior are more stable under changes.
- Natural ordering and cursor encoding must be resolved together.

## ADR-010 — Soft removal preserves history

Status: Accepted

### Decision

When a previously indexed Drive file is missing or trashed, mark the photo inactive instead of immediately deleting the database row.

### Consequences

- Submitted selections and audit history remain understandable.
- Retention and permanent purge policy must be added before production.

## Open decisions

### ADR-011 — Google OAuth scope set

Status: Proposed

Decision needed: Choose the smallest scope set that supports the final MVP folder selection and metadata sync. Verify current Google verification requirements before implementation.

Current evidence (2026-09-30): Google's Drive scope guide defines the
non-sensitive `drive.file` grant around files the app creates or the user opens
or shares with the app through Picker, while `drive.readonly` (needed for broad
read/download access) is restricted. Google does not explicitly document that
selecting a folder with Picker grants an app `drive.file` access to all of that
folder's pre-existing children. This must be tested with an authorized Google
Cloud pilot before choosing the production scope; do not infer child-file
access from normal Google Drive folder permission inheritance. The fallback
may require restricted-scope verification and a security assessment for
server-side storage of restricted data.

References: https://developers.google.com/workspace/drive/api/guides/api-specific-auth
and https://developers.google.com/workspace/drive/api/guides/handle-errors .

### ADR-012 — Private thumbnail/preview delivery

Status: Proposed

Decision needed: Prototype official Drive thumbnail links and a constrained thumbnail proxy/cache. Compare privacy, expiry, CORS, quota, cacheability, egress, and hosting limits. Do not standardize an undocumented URL pattern without evidence.

Current evidence: Google's [Drive files resource](https://developers.google.com/workspace/drive/api/reference/rest/v3/files)
describes `thumbnailLink` as short-lived, not intended for direct web-app use
because of CORS, and credentialed for non-public files. Its
[thumbnail guide](https://developers.google.com/workspace/drive/api/guides/file-metadata)
also notes that the field may be absent and normally lasts only hours. Thus
the web gallery must not embed it as a durable image contract. A controlled
proxy/cache or generated derivative provider still needs a credentialed
prototype and cost/privacy measurements; this ADR remains open.

### ADR-013 — Sync execution model

Status: Proposed

Decision needed: Run bounded manual sync inline for the first slice or introduce a minimal background execution mechanism if realistic 5,000-file sync exceeds hosting time limits.

### ADR-014 — Selection concurrency mechanism

Status: Resolved by ADR-021; live PostgreSQL concurrency proof pending

The initial mechanism is an album-row `FOR UPDATE` lock for all selection
mutations. ADR-021 records the details; a live concurrent-request test is
required before launch.

### ADR-015 — Gallery password session

Status: Proposed

Decision needed: Define the signed/encrypted session format, TTL, cookie settings, rate-limit key, and revocation behavior.

### ADR-016 — Performance budgets

Status: Proposed

Decision needed: Establish target devices, networks, data sizes, and numeric budgets for first response, first useful gallery render, page fetch, layout shift, interaction latency, and image failure rate.

## ADR-017 — Expanded photographic source formats

Status: Accepted

### Decision

The proofing MVP recognizes popular web/interchange formats plus DNG and major camera RAW families. Guaranteed sources are JPEG/JFIF, PNG/APNG, WebP, AVIF, GIF, HEIC/HEIF/HIF, TIFF, DNG, CR2/CR3, NEF/NRW, ARW, RAF, ORF, RW2, and PEF. Other decoder-recognized RAW formats are best-effort. Support means indexing plus a proofing preview, not source editing or identical rendering to Lightroom or camera-vendor software.

### Consequences

- Source discovery needs a shared format registry, while the processing boundary still validates bytes.
- Decoder versions and camera compatibility become observable operational metadata.
- Some indexed photos can have pending, unsupported-variant, or failed preview states.
- HEIC deployment requires an explicit codec and licensing review.
- Video remains outside the MVP.

### Migration path

Existing JPEG, PNG, and WebP records remain valid. New source-format and preview-status fields can be added without rewriting existing Drive identifiers or selection records.

## ADR-018 — Generated browser-safe derivatives

Status: Accepted

### Decision

The application may temporarily read an original from Drive and retain bounded thumbnail/preview derivatives for proofing. It must not retain a duplicate original. Derivatives are keyed to the source content revision and delivered through `ImageUrlProvider`.

### Consequences

- Original ownership and source-of-truth remain with Google Drive.
- Derivative storage, invalidation, retention, privacy, and cost require explicit implementation and measurement.
- RAW processing should prefer an adequate embedded preview before full demosaic.
- Public derivatives remove sensitive metadata, normalize orientation, and use an explicit browser-safe color profile.
- Large imports require resumable, bounded-concurrency processing rather than synchronous decoding in gallery requests.

### Migration path

`ImageUrlProvider` remains the frontend contract. Drive thumbnails, a controlled cache, or a future CDN-backed derivative provider can be swapped without changing gallery components.

## ADR-019 — Materialized natural photo order and catalog version

Status: Accepted for the initial PostgreSQL schema; performance proof pending

### Decision

After a complete album sync, sort active photos by filename using a numeric-aware `Intl.Collator`, then break equivalent-name ties by exact filename and Drive file ID. Store the resulting zero-based `sortOrder` on each `Photo`. Gallery pagination will use `(sortOrder, id)` with an `Album.catalogVersion` embedded in opaque cursors; a completed reconciliation that changes photo rows increments the version so stale cursors are rejected rather than silently skipping or repeating photos. A no-op sync keeps cursors valid.

### Consequences

- Indexed gallery reads avoid sorting thousands of names on every request.
- A sync may update many ordinals when files are inserted or renamed, so sort/reindex cost must be measured with 5,000–10,000 photos before launch.
- Natural comparison depends on the runtime's ICU data; stored ordinals remain stable until a deliberate reindex. A runtime upgrade may require a full album reindex.
- The schema and pure ordering helper are part of Phase 2B; transactional reindexing and cursor-version enforcement belong to the sync/gallery phases.

### Migration path

`sortOrder` and `catalogVersion` are introduced before photo persistence. If reindexing proves too expensive, a future migration can add a materialized sortable key while preserving the public cursor contract and photo identities.

## ADR-020 — Claimed manual album sync with short reconciliation transaction

Status: Accepted for the first server-side sync slice; live throughput proof pending

### Decision

Claim one `RUNNING` `SyncRun` per album under an album row lock. A partial unique
PostgreSQL index backs the claim. Fetch the complete direct-child catalog outside
the transaction with a 25-minute abort deadline. A run older than 30 minutes
may be marked failed and replaced under the same row lock, but a replaced or
expired run must never commit. Reconciliation, soft removal, ordinal updates,
run counts, and catalog-version increment occur in one transaction after the
complete listing is available.

### Consequences

- A failed or incomplete Drive listing cannot mark photos removed.
- A crashed process leaves a run that can be superseded after its lease expires.
- A long-running catalog read does not hold database locks, but two reads from
  different process generations can overlap near lease expiry; only the active
  claim may commit.
- The first implementation is a manually invoked service, not a background job
  or public route. It requires a caller that has already established an
  authorized Drive provider and authenticated owner.
- The 25/30-minute limits and transaction duration need measurement with
  5,000–10,000-photo albums before deployment.

### Migration path

The partial unique index is in a separate migration because Prisma does not
express it in the model. A future scheduler can retain the claim/reconcile
contract while adding heartbeat or shorter leases after measured evidence.

## ADR-021 — Serialize one client selection per album

Status: Accepted for the server-side selection slice; live concurrency proof pending

### Decision

The MVP has one `Selection` per album. Every select, deselect, comment, and
submit operation starts a PostgreSQL transaction, locks the album row with
`FOR UPDATE`, then reads or creates the selection and performs its mutation.
The lock also serializes creation of the first selection. A selection limit is
checked after the lock and before an item insert; a repeated select is a no-op.
Only `DRAFT` selections may be edited. Submit requires at least one selected
photo, changes `DRAFT` to `SUBMITTED` once, and treats a repeat submit of an
already submitted selection as success. `LOCKED` rejects edits and submit.

Owner review and export check album ownership. Export requires an explicit
`SUBMITTED` selection and orders selected filenames with the same natural
comparator used by album indexing. This also correctly orders soft-removed
photos whose old `sortOrder` may overlap with current active photos. Because
Drive filenames can contain line breaks, text export
escapes backslashes and line-break characters so each selected photo remains
one unambiguous line.

### Consequences

- One album's selection mutations are serialized, which is simple and
  concurrency-safe if PostgreSQL row locking behaves as expected; throughput
  and conflicting requests must be tested against a real database.
- Sync reconciliation also locks the album row, so a long sync commit can
  briefly delay selection mutations. The transaction duration must be measured.
- The internal service is not a public endpoint. A later gallery authorization
  layer must prove access to password-protected albums and rate-limit mutations
  before calling it.
- Submitted selections are immutable by default until a separately specified
  owner reopen policy is implemented.

### Migration path

The existing one-to-one album/selection schema already supports this policy.
Multiple client selections in a later product phase require a new client
identity and schema migration; the locking point can then move to a specific
selection row if measured contention warrants it.

## ADR-022 — Encrypted keyset cursors for public gallery metadata

Status: Accepted for the passwordless metadata-read slice; live query-plan proof pending

### Decision

Read published gallery photos from the indexed PostgreSQL `Photo` table in
`(sortOrder, id)` order, using keyset continuation and a maximum page size of
100. Each cursor is an AES-256-GCM encrypted, authenticated token containing
the album ID, `catalogVersion`, last sort tuple, and issue time. Tokens expire
after 24 hours and require a dedicated 32-byte server secret; rotation
invalidates outstanding cursors. A page reads album and photo rows in one
repeatable-read transaction to avoid a mixed-version response during sync.

The initial service lists only passwordless published albums. A protected
album produces no photo metadata until a separate password/session layer is
implemented. The list response excludes owner, Drive IDs, credentials,
checksums, and source URLs. It contains photo metadata only; image descriptor
delivery remains a separate unresolved strategy gate. New public slugs are
generated from 18 cryptographically random bytes (24 base64url characters),
with the database unique constraint remaining the final collision guard.

### Consequences

- Routine gallery reads avoid Drive listings and offset scans.
- A sync that changes the catalog invalidates old cursors rather than silently
  skipping or repeating photos. No-op syncs keep cursors valid.
- The cursor secret must come from private configuration; missing/invalid
  configuration must prevent constructing the service.
- Live PostgreSQL query plans and mobile browsing performance remain to be
  measured before claiming the gallery requirement complete.

### Migration path

The token has a version field. A future cursor codec can accept old and new
keys briefly during rotation, or issue a new version while preserving the
frontend's opaque-token contract. A future image provider can add descriptors
without exposing Drive-specific fields in the list response.

## ADR-023 — Bounded static WebP derivatives for the first raster renderer

Status: Accepted for the server-only renderer slice; authorized scheduling,
derivative storage, and image delivery remain unresolved

### Decision

The first preview renderer accepts full bytes for JPEG, PNG, WebP, AVIF,
GIF, and TIFF only after source-prefix and decoder-format checks. It extracts
one still frame/page, applies EXIF orientation, converts to sRGB, strips source
metadata, and emits two static WebP derivatives bounded to 512px and 1600px
edges. Input is capped at 64 MiB and 80 million pixels; each output is capped
at 6 MiB with a 10-second libvips processing timeout. It returns explicit
per-photo unsupported or failure outcomes rather than aborting an album.

The deployed Sharp 0.35.5 decoder is used for this subset. HEIC/HEIF and RAW
remain unsupported by this renderer until codec/licensing review and a
dedicated decoder or embedded-preview path are implemented. APNG first-frame
behavior is not yet verified and must not be marked guaranteed. Sharp's
[output documentation](https://sharp.pixelplumbing.com/api-output/) confirms
metadata is removed and sRGB used by default without preservation options;
the implementation makes the color conversion explicit.

### Consequences

- Generated derivatives, not originals, are suitable for future gallery
  delivery. No original file is retained by this renderer.
- The 64 MiB/80 MP limits may reject large professional sources; they are
  bounded safety defaults, not a claim that all guaranteed source variants
  are now supported. The rejected photo must remain indexed and actionable.
- This function accepts an in-memory source buffer. A separate bounded Drive
  reader and trusted preparation boundary now feed it one source at a time;
  authorized scheduling, bounded worker concurrency, revision-aware
  storage/invalidation, and cleanup still need implementation. It is not an
  image route or background job.
- Native decoder packaging and HEIC/RAW coverage require deployment-specific
  verification. A pixel/byte limit does not replace process isolation for
  hostile or expensive inputs.

### Migration path

Keep the future `ImageUrlProvider` contract independent of WebP and Sharp.
Replace or supplement the renderer for HEIC/RAW and add alternate output
formats without changing album/photo identities. Persist derivatives under
the source revision so updates invalidate stale outputs.

## ADR-024 — Revision-checked, bounded Drive original reads

Status: Accepted for the server-only reader slice; authorized processing and
image delivery remain deferred

### Decision

Keep original-byte access behind a separate `OriginalImageReader` provider
interface. A trusted caller supplies a Drive file ID, expected direct-parent
folder ID, and indexed source revision. The Google implementation reads narrow
file metadata before and after `files.get?alt=media`, rejecting trashed, moved,
non-downloadable, oversized, or revision-changed sources. It caps streamed
bytes at 64 MiB, checks the Drive MD5 when supplied, uses bounded read retries,
and strips OAuth authorization on allowed Google-hosted download redirects.
Only temporary in-memory bytes are returned; neither this package nor a
gallery route stores or serves the original.

### Consequences

- Two metadata GETs plus one media GET per processed file add Drive quota and
  latency. They guard against stale or moved sources but cannot make the three
  calls atomic; an MD5 checksum narrows that race when Drive supplies one.
- The 64 MiB default matches the first raster renderer and rejects some large
  professional files. Such a file remains indexed and needs an actionable
  per-photo failure or a future measured streaming/decoder strategy.
- Authorization, OAuth token lifecycle, processor concurrency, derivative
  persistence, and deletion/invalidation are separate required integrations.
  The interface is not a public full-resolution download feature.

### Migration path

Preserve the reader interface if a different authorized storage provider or
bounded processing strategy is introduced. Measure quota, latency, memory,
and rejection rates on real galleries before changing these limits.

## ADR-025 — Private revision-keyed derivative files for a single-instance pilot

Status: Accepted for the internal publication slice only; production image
delivery and shared-storage deployment remain open gates

### Decision

Store bounded WebP derivative pairs, never original bytes, under an explicitly
configured private absolute filesystem root. A pair is published by writing
both files and a small manifest in a private staging directory, then renaming
that directory into a deterministic photo/source-revision key. PostgreSQL keeps
only preview status/revision/error state. A processing service may set READY
only after publication and a conditional update confirming the photo is still
active and its indexed Drive source revision has not changed. A later image
provider must authorize access and verify the stored pair before delivery.

### Consequences

- This avoids adding an object-store service for local development and a
  single-instance pilot. The root must be a private persistent volume with
  backups; ephemeral containers or multiple API instances without shared
  storage cannot safely serve these files. Such deployment is not approved by
  this decision.
- A crash after file publication but before the database update can leave an
  unreferenced pair. Old revisions also remain until retention/garbage
  collection is defined. Storage cost and cleanup must be measured before
  production; the database must not infer availability from READY alone.
- A source change during processing cannot commit a stale READY state, but
  filesystem publication and the database update are not one transaction.
  The revision key and serving-time check contain that gap.
- No public URL or full-resolution proxy is introduced by this decision.

### Migration path

Keep the `DerivativeStore` interface so a future object-storage/CDN provider
can replace local files without changing the renderer or gallery components.
Backfill only derived images from Google Drive when migrating; originals stay
there. Define retention and render-version invalidation before production.

## ADR-026 — Application-owned derivative URLs for passwordless galleries

Status: Accepted for the local/single-instance proofing slice; ADR-012 remains
open for production delivery and protected-gallery sessions

### Decision

Only a published, passwordless gallery may receive an application-owned
thumbnail/preview descriptor. Its URL includes a non-secret digest of the
photo's current source revision. A read-only API route rechecks album
publication, passwordlessness, photo activity, READY state, and matching
source/preview revision before reading a stored WebP derivative. A stale URL
does not fall forward to a newer revision. Protected galleries receive no
descriptor or image bytes until a separate gallery-session design exists.

Use `Cache-Control: private, no-cache` and an ETag for browser revalidation:
repeated views can avoid transferring unchanged bytes, while every request
still rechecks access and revision. The route never proxies a Drive original.

### Consequences

- Node serves bounded derivatives in this pilot, adding API egress and local
  filesystem reads. This is not yet a CDN cost/performance decision; measure
  bandwidth and 500/5,000-photo browsing before production.
- Passwordless gallery slugs are bearer-like share links. Previously cached
  derivative bytes may remain in a visitor's private browser cache after an
  album is unpublished, even though revalidation stops future responses.
- The browser needs a public API base URL distinct from the server-to-server
  API address when deployed behind separate hosts. Host headers must not be
  used to construct descriptor URLs.

### Migration path

Keep the descriptor DTO and `ImageUrlProvider` boundary while replacing the
API-backed source with authorized object-store/CDN URLs if measurements
justify it. Add a separate protected-gallery authorization policy before
serving those images; do not relax this passwordless gate implicitly.

## ADR-027 — Versioned scrypt hashes for gallery passwords

Status: Accepted for password storage only; protected-gallery access remains closed

### Decision

Use Node's asynchronous scrypt with a fresh 16-byte random salt per gallery
password. Store only a versioned algorithm/parameter/salt/derived-key string in
`Album.passwordHash`. The fixed work factors are N=2^15, r=8, p=3 with a
32-byte derived key, following an [OWASP recommended scrypt configuration](https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html).
Verification accepts only this exact version and bounded canonical encoding,
then compares equal-length derived keys with `timingSafeEqual`. Password input
is limited to 1024 UTF-8 bytes. No password route is enabled by this decision.

### Consequences

- Each attempt is intentionally CPU/memory expensive (about 32 MiB for the
  scrypt work factor). A future public verification route must implement a
  measured attempt limiter and concurrency cap before accepting traffic;
  otherwise online guessing or resource exhaustion is possible.
- Existing/plaintext hashes are not accepted. The future album create/update
  flow must hash before persistence and must never log plaintext or a hash.
- A future password-session design must handle secure cookies, CSRF,
  cross-origin deployment, expiry, and password changes; this decision grants
  no access to protected gallery metadata or derivatives.

### Migration path

The versioned string permits an explicit verify-and-rehash transition to a
stronger configuration or Argon2id later. Do not silently accept arbitrary
stored cost parameters or turn password verification into an unbounded KDF.

## ADR-028 — Same-host encrypted gallery sessions for the pilot API

Status: Accepted for the same-host pilot boundary; production abuse controls
and live browser/database validation remain outstanding

### Decision

An optional password proof endpoint accepts a published gallery slug and
password only from the configured web origin. It is guarded by an in-process
five-attempt/15-minute per-address/gallery limiter and a global cap of four
concurrent scrypt verifications. Success issues an AEAD-encrypted 12-hour
session token in a per-gallery, host-only, HttpOnly, SameSite=Lax cookie with
`Path=/`; HTTPS deployments add `Secure`. The session binds album ID, slug,
current password-hash fingerprint, and issue time. Metadata and derivative
reads recheck publication and the current hash before allowing a protected
gallery. The cookie's origin and key must be explicitly configured; its key
is separate from the cursor key. HTTP is accepted only on loopback.

The web uses a server action to prove the password, sets the same cookie as
HttpOnly without exposing the token to client JavaScript, then forwards only
the matching gallery cookie on server-rendered metadata fetches. Browser image
requests carry the host-only cookie to the API on the same host.

This follows [OWASP session-cookie guidance](https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html)
and uses strict origin/referer checks on the password POST as recommended by
[OWASP CSRF guidance](https://cheatsheetseries.owasp.org/cheatsheets/Cross-Site_Request_Forgery_Prevention_Cheat_Sheet.html).

### Consequences

- Web and API must share a hostname and scheme (ports may differ locally), or
  be placed behind a same-host reverse proxy. A cross-site API deployment is
  not supported by this cookie model. No `Domain` attribute or JavaScript
  token storage is used.
- The in-process limiter and socket-address identity are local pilot measures.
  Multi-instance production needs an edge/shared limiter and a deliberate
  trusted-proxy policy; otherwise attempts can bypass per-instance counters or
  a reverse proxy can collapse visitors onto one address.
- Password rotation invalidates later requests by changing the hash
  fingerprint. A request racing an album update can finish under its earlier
  database read; a stronger transaction/locking policy needs live validation.
- Cookie-authenticated guest selection mutations use exact Origin/Referer
  checks in ADR-029. Any additional mutation surface must receive an explicit
  CSRF policy before exposure.

### Migration path

Replace the stateless cookie with a database session or BFF gateway if
revocation, independent client sessions, or cross-site deployment becomes
necessary. Keep the gallery-service authorization check, rather than moving
access decisions into image URL construction alone.

## ADR-029 — Gallery-slug guest selection boundary for the pilot

Status: Accepted for the single-instance proofing pilot; live transaction and
distributed-abuse proof remain open

### Decision

Expose the existing `SelectionService` only through a facade that looks up a
published public gallery slug and validates its current password-bound session
when needed. The facade translates the slug to an internal album ID without
returning it. A guest state request may list at most 50 specified current-page
photo IDs and returns only their selected/comment state plus total count,
limit, and selection status. Mutations delegate to the existing PostgreSQL
row-locking selection service; no `Photo.isSelected` field is introduced.

Every public mutation requires the configured web Origin (or exact Referer
fallback) and a pilot in-process 60-per-minute address/gallery limiter. This
is an origin defense for the current same-host server-action flow, not a
general cross-site cookie policy. Request logs retain only route templates,
method, status, duration, and request ID; comments and cookies are excluded.
The web uses server actions to forward only the matching HttpOnly gallery
cookie, show authoritative API counts, and require an explicit second submit
confirmation. It keeps only current-page selected/comment state in memory.

### Consequences

- A bearer gallery link (and password session if configured) authorizes the
  one shared MVP selection for that album. There are no separate guest
  identities or multiple selection lists.
- The existing select transaction locks the album row before counting and
  inserting, so concurrent requests serialize for the configured limit.
  Live PostgreSQL concurrency and query-plan tests are still required.
- The limiter is per process and uses the socket address, not untrusted
  forwarded headers. A multi-instance deployment needs edge/shared controls
  and a deliberate proxy address policy before production use.
- A password change racing an already-authorized mutation is a small window;
  a stronger in-transaction session check would be needed for strict instant
  revocation. Later requests reject the old session.

### Migration path

Retain the public DTO and facade when adding a BFF or shared limiter. If
multiple clients per album become a product requirement, introduce explicit
guest selection identities rather than overloading `Photo` state.

## ADR-030 — Owner lock/reopen and export snapshot policy

Status: Accepted in the selection service; private HTTP/UI exposure pending

### Decision

Only the album owner may lock or reopen a selection, and these mutations
serialize on the same album row as guest selection changes. Lock requires an
explicit submitted selection and is idempotent. A locked selection retains
its original submission timestamp and remains eligible for filename export.
Reopening a submitted or locked selection returns it to draft, clears both
submission and lock timestamps, and makes export unavailable until it is
submitted again. An archived album cannot be locked or reopened, but its
previously submitted/locked selection remains reviewable and exportable.

### Consequences

- Export is based on an explicit completed selection, not a photo flag, and
  includes soft-removed selected photos in natural filename order.
- A photographer reopening the one shared MVP selection enables guests to
  edit that same list again. The UI must explain this before exposing reopen.
- Private routes must not be wired until Google sign-in and a validated owner
  session authorize the owner ID; a caller-supplied owner ID is not sufficient.

### Migration path

If multi-client proofing is added later, make lock/reopen operate on an
explicit selection identity and retain the same completed-snapshot export
rule. Existing album-level status timestamps remain auditable.

## ADR-031 — Google identity sign-in and revocable photographer sessions

Status: Implemented and offline tested; real Google/PostgreSQL verification pending

### Decision

The API owns Google authorization-code sign-in through Google's maintained
`google-auth-library`, requesting `openid email profile` only. Drive consent
is a separate grant; ADR-011 stays open. Sign-in begins with an exact-origin
POST, then uses S256 PKCE, state and nonce in a ten-minute AES-GCM encrypted,
HttpOnly, SameSite=Lax cookie. A distinct AUTH_FLOW_KEY and authenticated data
bind that cookie to the configured OAuth client and callback. Google tokens
are verified for signature, issuer, audience, nonce, verified email and
authorized presenter when supplied. Provider errors are never echoed/logged.

Photographers are upserted by stable Google subject, never linked by matching
email. Email uniqueness conflicts fail sign-in without taking over an existing
account. A successful sign-in rotates the browser's existing session and
creates a random 256-bit token. Only its SHA-256 hash is persisted in
`PhotographerSession`, with a fixed twelve-hour expiry. Every private API read
must resolve this session to the owner; logout removes its database record.
Expired records for that owner are cleaned during sign-in.

Cookies are host-only with Path=/ and use the __Host- prefix and Secure on
HTTPS. HTTP is allowed only on loopback. Web/API share one hostname and scheme,
as for gallery sessions. Private mutations require the configured web Origin
or matching Referer. Login/callback endpoints have a bounded per-process
60/minute address throttle. Callback redirects are fixed configured URLs;
browser returnTo parameters cannot alter them. Auth responses use no-store and
no-referrer headers. Google codes/access/ID tokens are never persisted.

Reference: https://developers.google.com/identity/openid-connect/openid-connect

### Consequences and migration

- A new migration adds PhotographerSession without modifying existing photos,
  owners, albums or selections. Deployment must apply it before enabling auth.
- Google app configuration and real consent/cookie/database tests remain a
  pilot gate. In-process rate limits still require deployment edge controls.
- Signing in does not connect Drive. A separate grant and encrypted refresh
  token lifecycle will attach to the authenticated owner later.
- Session expiry is absolute; returning photographers sign in again after
  twelve hours. Future sliding sessions or account-wide revocation can build
  on this database model without changing public gallery sessions.

## ADR-032 — Separate owner-bound Drive grant with encrypted refresh tokens

Status: Implemented and offline tested; live scope/account/database pilot pending

### Decision

Drive consent remains separate from photographer sign-in. An authenticated
owner explicitly starts a second server-side authorization-code flow that
requests `openid`, email, and the non-sensitive file-specific
`https://www.googleapis.com/auth/drive.file` scope with offline access. It uses
S256 PKCE, state, nonce, forced consent/account selection, and a ten-minute
AES-GCM flow cookie containing the initiating owner ID. The callback requires
the same active owner session and verifies the Google ID token, nonce,
audience/presenter, verified email, refresh-token presence, and actual granted
Drive scope through the maintained `google-auth-library`.

Only the refresh token is persisted. It is encrypted using AES-256-GCM with a
dedicated 32-byte key, an explicit key-version column, and authenticated data
binding the ciphertext to the application owner and Google account. Access and
ID tokens are discarded. Private connection DTOs contain only connection ID,
account email, state, scope mode, and connection time. A server-only refresh
boundary decrypts just in time and returns a short-lived access token to a
trusted caller. An invalid/revoked refresh token clears ciphertext and marks
the connection `REAUTH_REQUIRED`.

Disconnect first removes the local encrypted credential, then attempts Google
revocation. Failure to confirm remote revocation does not restore the local
secret; the owner receives a warning to review Google-connected applications.
Connections are owner-scoped and retained as disconnected records so existing
album foreign keys and audit context are not destroyed.

This decision does not close ADR-011. `drive.file` is the smallest recommended
grant, but official documentation does not establish that selecting a folder
grants access to every pre-existing child. Folder selection, album creation,
and sync routes remain closed until a credentialed Picker/Drive pilot proves
the workflow or the product accepts the verification/security cost of a
broader restricted scope.

References:
https://developers.google.com/workspace/drive/api/guides/api-specific-auth,
https://developers.google.com/identity/protocols/oauth2/web-server, and
https://developers.google.com/identity/protocols/oauth2/resources/best-practices .

### Consequences and migration

- A migration adds explicit Drive connection states, account email, granted
  scopes, and connect/disconnect timestamps while preserving existing rows.
- Key rotation needs a deliberate decrypt/re-encrypt migration while old key
  material remains available. The initial configuration accepts one active
  version and fails closed on a version mismatch.
- Google Cloud configuration, consent behavior, token expiry/revocation, two
  accounts, and PostgreSQL constraints still require a live pilot. Testing-mode
  refresh-token lifetime must not be mistaken for a production session policy.

## ADR-033 — Indexed owner dashboard, bounded review and non-destructive archive

Status: Implemented and offline tested; live PostgreSQL/browser pilot pending

### Decision

The owner workspace reads existing albums from local PostgreSQL metadata. Each
private API request resolves a database-backed photographer session; browser
owner IDs are never accepted. Dashboard pages contain at most 25 albums,
ordered by immutable `(createdAt, id)` descending with an owner-first compound
index. An AES-GCM cursor binds the continuation to the owner, expires after
24 hours, and uses authenticated data distinct from guest gallery cursors.

Selection review and exports retain inactive selected photos. Their historical
sort ordinals may overlap current ordinals, so review uses the same natural
filename/Drive-ID comparator as export. Each review request loads only narrow
ordering metadata, sorts it, validates a snapshot fingerprint, and retrieves
at most 50 comments/image descriptors. This is O(n log n) server work per page;
it is deliberately not described as a database-keyset review query. The
10,000-selection fixture verifies bounded response/rendering, not live database
latency. Materializing immutable review snapshots is deferred until measurement
justifies the additional storage/workflow complexity.

A monotonic Selection.revision increments transactionally with item/comment
and lifecycle writes. This invalidates review cursors even when rapid edits
share the same millisecond timestamp. Catalog/status/order changes also alter
the fingerprint; changed snapshots require returning to the first page.

Only stored WebP thumbnails are served to owner review. The image route checks
owner and selection membership, current READY/source revision, and uses
no-store; it never reads a Drive original or requires a gallery password. It
works for archived albums/retained items when a derivative still exists. Export
uses a fixed safe attachment filename and text/plain, reads no comments, and is
allowed only for submitted/locked selections (including archived history).

Archive requires explicit confirmation, locks the same album row as selections
and sync, rejects a running sync, and is idempotent. Archived galleries cannot
be browsed or edited by guests, and new sync claims are rejected. No application
rows, derivatives or Drive originals are deleted. Archived application history
is retained indefinitely in this pilot; purge/retention remains a separate
decision. No delete/restore route is introduced.

### Consequences and migration

- Apply the dashboard index/selection-revision migration before deploying this
  API. Existing selection history starts at revision zero without deletion.
- Database scripts explicitly load the repository's `prisma7.config.ts`, so
  deployment honors DIRECT_DATABASE_URL/DATABASE_URL as documented.
  The CLI config explicitly reads the repository-root `.env`, resolved relative
  to the config file because pnpm runs scripts from the package directory.
  Exported settings override file values per variable, and a nonblank direct
  URL takes precedence. This fixes Prisma 7's lack of automatic `.env` loading
  without adding a dependency or changing API process-environment behavior.
  Existing exported configurations continue to work; no schema migration is
  required by this configuration fix.
- Private mutation routes enforce exact web origin and a pilot in-process
  limiter. Server Actions forward only the owner cookie, fixed origin and a
  strict action body. Two-account and real row-lock tests still require a live
  database; the existing external setup gates are unchanged.
- This enables reviewing existing indexed albums, not importing them. ADR-011
  still gates Picker, album creation and authorized sync exposure. Production
  retention, edge limiting and derivative storage remain open gates.

## ADR-034 — Ephemeral PostgreSQL CI with fail-closed test targeting

Status: Workflow/harness implemented; remote CI and live integration execution pending

### Decision

CI checks the frozen dependency graph, production builds, all package types,
lint, reviewed migrations and the test suite. Official checkout/setup-node/pnpm
actions are pinned to resolved commit hashes, repository permissions are
contents-read only, persisted checkout credentials are disabled, and triggers
do not use privileged pull_request_target. The disposable PostgreSQL 17 service
has only known ephemeral test credentials; no OAuth or production secret is
passed to untrusted pull-request code. CI does not deploy.

Real SQL integration tests opt in only through TEST_DATABASE_URL for a loopback
database ending in `_test`. Query parameters and remote hosts are rejected;
DATABASE_URL is never used as a test fallback. Unique per-run fixtures are
cleaned by exact generated IDs, not truncate/reset. Missing configuration is
reported as a skip rather than a successful concurrency test. The root test
command runs the full monorepo once, avoiding parallel duplicate integration
fixtures across workspace test invocations.

### Consequences and migration

- A migration-order regression test exposed the undeployed active-sync index
  sorting before initial table creation. Its directory is now dated 20260930,
  after 20260929_initial_metadata. The SQL constraint is unchanged. No applied
  migration history was changed here; independently deployed environments must
  reconcile old names before using the corrected baseline.
- CI must actually run before claiming migration/concurrency proof. Local
  PostgreSQL was unavailable during implementation, so seven integration tests
  are skipped and no database timing result is invented.
- 500/5,000-record SQL pagination tests emit explicit test-environment timings;
  device/network budgets and real Drive import remain separate acceptance gates.
- Action pins require reviewed maintenance updates. Production backup/restore,
  incident and retention policies are not supplied by an ephemeral CI database.

## ADR-035 — Dependency readiness without provider calls or sensitive diagnostics

Status: Implemented/offline tested; production monitoring/restore drills pending

### Decision

Process liveness and proofing infrastructure readiness are distinct. A readiness
probe requires the configured private auth/Drive/guest boundaries, current local
schema and existing private preview volume. It never calls Google or reads rows,
tokens or originals. SQL probes use WHERE FALSE, a two-second statement timeout
and a three-second transaction timeout. Concurrent checks coalesce and results
cache for five seconds. Public results contain only ready/not-ready and service.

Fixed route labels and stable error codes extend structured request logs for
export, selection lifecycle, archive and auth failures; raw URLs/errors/headers
remain excluded. The operator supplies aggregation, thresholds and edge controls.

docs/OPERATIONS.md documents release/rollback, isolated logical restore drills,
key recovery, incident triage and the existing indefinite pilot archive policy.
Infrastructure readiness is not end-to-end consent verification, capacity proof,
an implemented backup scheduler, a completed restore drill or MVP acceptance.

### Consequences

- A no-database foundation is live but not ready to serve the private pilot.
- Configure/create the persistent 0700 derivative root before checking readiness;
  the probe never creates directories. Monitor capacity separately.
- Readiness changes can lag by five seconds. No extra tables, queues, secret
  rotation or provider permissions are introduced.
- Archive recovers a crashed RUNNING sync only after ADR-020's existing
  30-minute lease expires, under the same album lock, marking it FAILED/
  STALE_RUN. A still-active lease blocks archive; late reconciliation after
  archive is rejected. Operators need not force-edit stale sync rows in SQL.
- Backup frequency/retention and recovery/device-network targets must be agreed,
  configured and measured before launch; no targets or execution results are
  fabricated here. Applied migration history is never rewritten by rollback.

## ADR-036 — Explicit serial OAuth-backed preview batches for the private pilot

Status: Implemented/offline tested; live Google/PostgreSQL capacity proof pending

### Decision

Provide a privileged operator command for existing indexed albums, not an HTTP
endpoint, scheduler, queue or folder import workaround. It requires explicit
owner/album IDs and processing confirmation in a trusted operator environment.
The owner is verified against PostgreSQL, and every Drive request refreshes
through the owner-scoped encrypted connection boundary. The accepted `drive.file`
grant is unchanged; inaccessible existing children fail rather than widening it.

Read at most 26 ID/order candidates in a short repeatable-read transaction using
the existing `(albumId, active, sortOrder, id)` index. Process at most 25 photos
serially outside that transaction, retaining only one bounded original at a time.
Encrypted one-day continuation uses separate authenticated data from guest/owner
read cursors and binds owner, album, catalog version and the last completed tuple.
READY files are checked against actual storage. Unsupported/failed/missing-revision
outcomes remain per-photo; operational deferral stops before advancing the cursor
past that photo. Catalog changes invalidate continuation and require a restart.

The command holds an exclusive `.preview-batch-lock` directory on the existing
private persistent volume across its work. This globally serializes cooperating
operator invocations on the pilot volume. It never steals an existing lock. A
crash/power loss can leave it behind; recovery requires confirming that every
processor has stopped before removing only the empty lock directory. No lease
expiry can allow an old decoder process to overlap its replacement unnoticed.

Publication state writes now briefly lock the owned album row in the same order
as sync/archive/selection, check archive status, and conditionally update the
current source revision. No Drive/filesystem/decoder work holds this lock.
Cancellation is checked before reads/render publication and READY writes. A
cancellation or archive after file publication can leave an unreferenced pair,
as already documented in ADR-025; it is not publicly addressable as READY.

### Consequences and migration

- The two-minute command deadline is a cooperative scheduling deadline, not a
  hard wall-clock guarantee or native decoder sandbox. Provider/Sharp limits
  still apply; a blocked database/native operation may delay exit. Hard-killing
  requires crash-lock recovery. No background automatic retry is introduced.
- Each processed raster uses two metadata GETs plus one bounded media GET and
  currently refreshes/rechecks credentials for each. This favors disconnect
  correctness but incurs quota/latency overhead. Measure before adding a
  short-lived credential cache or increasing concurrency.
- This lock assumes one trusted private persistent volume and cooperating
  operator invocations. It does not approve multi-instance/NFS semantics,
  bypass callers, hostile-user native processing or serverless scheduling.
- `complete` means this catalog page/traversal was visited, not that all photos
  rendered successfully. Inspect outcome counts/codes; re-run from the start
  after correcting failed inputs, syncing revisions or installing decoders.
- No schema migration, plaintext credential persistence, original-file retention,
  new public resource or broader scope is introduced. A future measured scheduler
  can preserve batch/publication contracts and replace the operator lock with a
  durable claim/capacity policy before exposing work through the dashboard.
- HEIC/RAW decoder decisions, folder-child access, live SQL locks/query plans,
  retention, backup/restore and device/network budgets remain separate gates.

## ADR-037 — Enforced nonce-based browser policy for application-owned images

Status: Implemented/offline and local production-browser tested; live pilot pending

### Decision

Next Proxy generates 32 cryptographically random bytes per request and forwards
the nonce in a trusted request CSP header for framework script rendering. It
overwrites caller-supplied nonce/CSP headers, including spoofed prefetch/RSC
requests; it does not perform authentication. Documents, navigation responses
and Server Action requests have enforced CSP and private/no-store caching.
All page shells are explicitly dynamic. Static Next assets bypass nonce work,
keep their existing cache policy and receive baseline security headers.

Production scripts use a nonce and strict-dynamic, with no unsafe-inline/eval
or event-handler grant. Stylesheets/style elements use self/nonce; only style
attributes allow unsafe-inline for existing aspect-ratio rendering. Development
alone permits eval, HMR styles and the configured exact web WebSocket origin.
No blanket http/https, wildcard, data/blob, Drive or Google image/script grant
is introduced. Image/form destinations include only the configured, validated
same-host/same-scheme public API (never internal API_BASE_URL or Host/forwarded
headers). Invalid public configuration fails closed to self-only destinations.
Missing production PUBLIC origins also fail closed instead of granting loopback
development destinations.
HTTPS public configuration upgrades insecure subresources; loopback HTTP does
not. Framing, objects, base tags, workers and media are disallowed.

The only extra form destination is https://accounts.google.com because native
POST sign-in/Drive consent redirects there. Browsers differ in form-action
redirect enforcement; it is a navigation grant, not permission to load Google
scripts, images, frames or contact Google through browser fetch. Current consent
is top-level navigation, not a popup, so same-origin opener isolation is retained.

Web/API responses add MIME-sniffing/framing, referrer, opener/resource and feature
policies, and suppress framework identity headers. Web referrers remain same-origin;
the API preserves its stricter no-referrer policy. API CORP uses same-site, not
same-origin, to preserve same-host cookie-authenticated derivative reads across
different local ports. It grants no CORS origins/credentials: browser data reads
and mutations use the web's server boundaries or existing native forms. These
headers are defense-in-depth, not a resource authorization/CSRF substitute.

Primary references: [Next CSP](https://nextjs.org/docs/app/guides/content-security-policy),
[MDN form-action](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Content-Security-Policy/form-action),
[MDN CORP](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Cross-Origin-Resource-Policy).
The installed Next 16.3.6 runtime/source was checked where its guide used a newer
experimental matcher-test function name; production behavior uses stable Proxy.

### Consequences and migration

- Nonce shells cannot use static/ISR/shared HTML caching. The product pages
  were already dynamic for locale/session access; only the generic error shell
  is additionally dynamic. This does not change local metadata pagination,
  lazy derivative sizes or immutable static asset caching. Measure SSR latency
  and cost before changing this policy, rather than adopting experimental SRI.
- Client navigation and language Server Actions were checked in a temporary
  local production server. All initial scripts matched their response nonce,
  nonces rotated, client navigation worked and browser warnings were absent.
  Authenticated galleries, OAuth redirects, HTTPS/mobile browser matrices and
  production reverse-proxy behavior still require a real pilot.
- Configure the public origins in the web runtime as well as the API. A CDN
  must not cache nonce HTML/RSC or strip/replace the CSP. A future Picker, CDN,
  worker, analytics or popup feature needs a reviewed narrow policy change and
  tests; adding broad unsafe-inline or scheme allowlists is not a migration.
- HSTS remains an explicit TLS-edge deployment setting; the applications do not
  trust arbitrary forwarded-proto headers or enable preload/includeSubDomains
  for an unknown hostname. No TLS infrastructure or trust-proxy policy changed.
- No CSP-report endpoint/third-party collector is introduced because raw
  violation URLs can reveal private gallery/owner routes. A future collector
  must redact/bound reports and define retention before logging them.
- No database migration, session/token rotation, OAuth scope change, original
  download or new external service is required. SEC-005 policy is implemented;
  full production verification remains partial until the listed release gates.

## ADR-038 — Bounded touch navigation without implicit proofing mutations

Status: Implemented/unit and isolated browser tested; real handset pilot pending

### Decision

Use Pointer Events on the generated-preview stage only, without a gesture
library, animation dependency or extra prefetch. One completed primary touch
can move one photo within the current bounded page: at least 48 CSS pixels
horizontal displacement, at least 1.5 times vertical displacement, within
1.5 seconds. A vertical motion of at least 12 pixels that dominates horizontal
motion invalidates that gesture permanently. Taps, holds, secondary touches,
pointer cancellation/capture loss, blur, navigation and zoomed viewport input
are ignored/cancelled. Mouse/pen dragging is not photo navigation.

Stage touch-action is pan-y pinch-zoom; browser scroll/zoom are not prevented
by event handlers. A second touch anywhere in the dialog cancels the active
stage gesture. No gesture changes selection, saves comments, submits, closes
the viewer or automatically fetches another gallery page. Existing generated
image descriptors, page bounds and explicit selection buttons remain unchanged.

Keep the native modal/Escape behavior. Backdrop dismissal needs a primary
press outside the actual dialog bounds and a nearby outside click within
1.5 seconds; inside-to-outside drags and synthetic/keyboard clicks cannot
dismiss it. Body overflow is restored on close/unmount, and focus returns to
the opener. If a focused navigation button becomes disabled at the page edge,
focus moves to the enabled close control, preserving subsequent arrow/Escape
input. Localized instructions and polite position/filename announcements
complement buttons; swiping is never the sole navigation mechanism.

Primary API reference: [MDN Pointer Events](https://developer.mozilla.org/en-US/docs/Web/API/Pointer_events),
[touch-action](https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/Properties/touch-action)
and [native dialog](https://developer.mozilla.org/en-US/docs/Web/API/HTMLDialogElement).

### Consequences and acceptance boundaries

- Grid/image counts and bandwidth policy are unchanged: one bounded page,
  lazy thumbnails, one generated preview and no original/neighbor requests.
  Pointer movement updates only an in-memory gesture tracker, not React state.
- Deterministic unit tests cover thresholds, direction, axis, timing, pointer
  cancellation/multi-touch, viewport zoom, intentional backdrop taps, localized
  markup and explicit selection controls. An isolated temporary component
  fixture uses test-only images/selection state, not an authenticated gallery,
  SQL/Google integration or production CSP acceptance result.
- Local browser verification includes keyboard page edges, Escape/opener focus,
  body-overflow restoration and phone-sized layout. It caught and corrected
  disabled-button focus loss and intrinsic image/grid overflow. Real touch,
  pinch behavior on iOS/Android, screen readers and device/network performance
  are still private-pilot checks; no benchmark or handset result is fabricated.
- There is no schema/authorization/provider change, new public route or
  persistent original storage. Thresholds are usability defaults, not measured
  performance budgets, and may be tuned with pilot evidence.

## ADR-039 — Explicit optional root environment loading for development

Status: Accepted for local development only

### Decision

The API and web `dev` scripts use `scripts/dev.mjs` to call Node's built-in
`loadEnvFile` against the optional repository-root `.env`, resolved relative to
the launcher. It spawns their existing installed CLIs with the loaded environment,
no extra Node flags and each app's working directory. Supported Node 22.13+
already provides the loader. Exported values, including empty values, retain
precedence. No shell sourcing, new dependency or secret logging is introduced.
Restart the development processes after changing the file.

Direct `--env-file-if-exists` flags were rejected during integration verification:
Next 16 forwards Node execArgv into worker NODE_OPTIONS, where the environment-file
flag is disallowed. Loading before spawn avoids this incompatibility; the launcher
forwards shutdown signals and preserves the child exit code.

This supersedes ADR-033's process-environment-only **development launcher**
behavior: merely saving root `.env` previously configured Prisma but not the API.
The server itself remains process-environment-only. Production `start`/`build`,
the explicit preview operator and SQL tests retain their existing environment
policy; production secret management and loopback fixture safety are unchanged.

### Consequences and migration

- Existing exported development configurations continue to work. Next app-local
  environment files cannot override already loaded root settings; put overrides
  in the shell, or omit the corresponding root setting. Node's root loader does
  not perform Next's `$VARIABLE` expansion: use literal complete values.
- Development may provision an ignored checkout-local `.local/derivatives`
  volume with private 0700 permissions and an absolute configured path. Only
  generated derivatives belong there; readiness remains read-only and does not
  create storage. Production volume/retention remains an independent gate.
- No schema migration, row/credential access, Google scope change, fixture-policy
  change or permanent original storage is required by this startup fix.
- Synthetic launcher tests verify file loading, export/empty-value precedence,
  missing-file behavior and production isolation. Live readiness is infrastructure
  evidence only, not OAuth consent or full photographer workflow acceptance.

## ADR-040 — Origin-only web referrers for native authentication POSTs

Status: Accepted; corrects ADR-037's web referrer-policy choice

### Decision and cause

Use `Referrer-Policy: strict-origin` in the shared web header set used by
Next config and Proxy. The previous `same-origin` policy makes a native
POST navigation from the web origin to a different API port carry `Origin: null`
under Fetch's origin-header algorithm. The API's exact web-origin CSRF check
then correctly rejects the legitimate sign-in before initiating OAuth. The
same problem affects native Drive consent and logout forms across ports.

Do not solve this by trusting null/missing origins, the request Host, arbitrary
Referer fallbacks, or broadening CORS. The configured same-host/same-scheme public
origins, API exact-origin validation, cookies, PKCE/state/nonce, CSP and approved
Google scopes are unchanged. API responses/redirects retain `no-referrer`.

### Trade-off and migration

- Web-origin disclosure is now allowed to navigation/resource destinations,
  including different origins at an equal-security scheme. Only the origin is
  disclosed: never private gallery/owner paths, query strings or fragments, even
  for same-origin requests. HTTPS-to-HTTP downgrade referrers are suppressed.
  API OAuth redirects continue to remove the referrer before visiting Google.
- Existing deployment needs only the updated web build and a document reload;
  no database migration, credential rotation, new permission or API grant is
  required. Both next.config and Proxy consume the same constant header set.
- Regression coverage must preserve rejection of `Origin: null`, missing or
  mismatched origins and prevent a Referer from overriding explicit null Origin.
  A local browser fixture can prove the native POST/303 boundary without real
  Google consent, application sessions or database changes; it is not full
  callback or multi-browser/device acceptance.

Primary reference: [Fetch origin-header algorithm](https://fetch.spec.whatwg.org/#append-a-request-origin-header).

## ADR-041 — Validated internal draft creation without opening the import gate

Status: Implemented/offline and isolated real SQL tested; folder-child access pending

### Decision

Introduce DriveFolderReader and an internal AlbumCreationService, not an HTTP
endpoint or pilot-import bypass. Google's files.get reads only id/name/MIME/
trashed/canListChildren through the existing bounded metadata-read machinery.
It refuses files, shortcuts, mismatched/trashed folders and missing/false list
capability. Metadata requests refuse redirects so credentials cannot be sent
to a different destination. Folder capability is not proof of OAuth access to
all pre-existing children; ADR-011/032 still gate folder/create/sync exposure.

A trusted authenticated owner ID and strict creation input identify one connected
owner connection. The real composition refreshes through that connection; no
caller token is accepted. Folder access and optional scrypt hashing occur before
any transaction. The transaction locks only that connection row, rechecks its
owner/status/updatedAt snapshot, then creates one DRAFT album with a nested DRAFT
selection. It never lists/downloads originals, syncs, publishes or serves a draft.
Only the ID, random slug and DRAFT status leave the service.

Titles trim to 1–200 characters. Optional passwords preserve their exact bytes,
must be nonempty when supplied and remain within the existing 1024-byte limit;
null/omission means no password. Limits are null/omitted or positive PostgreSQL
Int values. Eighteen random slug bytes and the existing unique index remain the
collision policy. Retry at most three fresh transactions for only a recognized
publicSlug uniqueness conflict, including the installed Prisma 7 pg-adapter
constraint shape. Other persistence failures are redacted and not blindly retried.

### Consequences and migration

- The original phase 3F boundary required no migration, live record write, OAuth
  scope change or public API/UI surface. ADR-043 now adds the creation-receipt
  migration before using the upgraded service. Existing selections remain
  compatible with explicit draft selection creation. No original or derivative
  storage is added.
- The short row lock serializes creation with local disconnect/reconnect writes;
  it does not make Google permission changes atomic with PostgreSQL. A later
  initial sync must prove current child access and handle provider revocation.
- ADR-043 supersedes the original internal request-idempotency gap with durable
  owner-bound receipts. HTTP/UI must integrate its stable UUID/replay/conflict
  contract and capacity/origin/abuse controls before exposure; a random-slug
  collision retry alone is not permission to repeat a failed client POST.
- Offline tests verify composition, hashing and safe failures. Phase 3G executed
  real PostgreSQL nested creation, rollback, slug collision and connection-change
  checks through ADR-042's isolated launcher. This is not full Drive/import or
  production-load proof; the remote-fixture guard remains unchanged.
- The read-only pilot folder supplied by the owner stays outside source/docs.
  A locally authenticated workspace was observed, with no Drive connection;
  human Drive consent is still a prerequisite to the real access pilot.

Primary references: [Drive files.get](https://developers.google.com/workspace/drive/api/reference/rest/v3/files/get),
[File capabilities](https://developers.google.com/workspace/drive/api/reference/rest/v3/files),
[Drive scopes](https://developers.google.com/workspace/drive/api/guides/api-specific-auth).

## ADR-042 — Isolated local PostgreSQL acceptance without application credentials

Status: Implemented and executed locally; hosted CI/production acceptance pending

### Decision

Add `pnpm test:postgres`, requiring an explicit absolute PostgreSQL 17 binary
directory (matching the CI major). It always initializes a new private temporary
cluster, random SCRAM password, loopback TCP port and random `_test` database.
No caller URL, existing cluster or private root `.env` is accepted. The child
environment excludes application URLs, OAuth keys, loader/PG-service/proxy
settings. Unix sockets are disabled and PostgreSQL listens only on 127.0.0.1.

Move the existing strict `testDatabaseUrl` guard into the database package, retain
the API re-export, and reuse it in `prisma-test.config.ts`. Unlike the application
CLI config, the test config never loads private environment files or falls back
to application URLs. Deploy reviewed migrations, run the full regression/SQL
suite, then stop only the newly owned cluster and remove its exact directory.
Cancellation still performs cleanup. Uncertain shutdown preserves the directory
and reports recovery required rather than deleting possibly live database files.
Synthetic one-run passwords are redacted from subprocess diagnostics.

### Evidence and limits

- Phase 3G checksum-verified the official PostgreSQL 17.11 source release and
  built/installed it under a temporary prefix because no local runtime was
  present. SHA-256: `dd27f2b3c59e73ed14aa3324901242bf69a032a6347805f274e6260322d42979`.
  macOS arm64/Apple clang; locale C/UTF-8, 32 MiB shared buffers, no ICU/readline/
  zlib/NLS/SSL build extensions. This synthetic loopback profile is not an
  approved production TLS, locale, sizing or deployment configuration.
- Fresh migration application and real SQL constraint/transaction/concurrency/
  sync/creation checks passed. Gallery traversal and equivalent SQL EXPLAIN
  ANALYZE/BUFFERS cover 500/5,000 metadata records. These are local warm synthetic
  fixtures, not Google access, browser render, network/device or load benchmarks.
- PostgreSQL natural filename collation is not relied on: the application keeps
  its existing assigned natural sort ordinals. No schema/index/OAuth/product
  scope decision changed and no production service/storage was introduced.
- All temporary runtime/source/cluster assets are removed after this acceptance
  phase. Users supply installed approved binaries for repeat runs; the launcher
  does not download software, modify Homebrew or create a system service.
- Actual hosted CI, production-like query/lock coverage, staging migration/
  rollback and backup/restore drills still require separate evidence.

Primary references: [PostgreSQL 17 source installation](https://www.postgresql.org/docs/17/install-make.html),
[PostgreSQL 17 initdb](https://www.postgresql.org/docs/17/app-initdb.html),
[PostgreSQL 17 pg_ctl](https://www.postgresql.org/docs/17/app-pg-ctl.html).

## ADR-043 — Owner-bound durable draft-creation receipts

Status: Implemented/offline and isolated real SQL tested; HTTP/import exposure gated

### Decision

Require a UUID requestId at the internal draft-creation boundary. The trusted
owner ID scopes a SHA-256 request-key digest; a composite primary key enforces
one receipt per owner/request. Create the receipt, DRAFT album and DRAFT selection
in one transaction. A composite album/owner foreign key prevents a receipt from
referencing another photographer's album. One receipt belongs to one album.

Retain the original public slug in the receipt and replay the original creation
identity after a successful commit, without Drive calls, new albums/selections or
lifecycle changes. Returned DRAFT status describes the original creation response,
not the album's current publication/archive state.
A disconnected Drive account does not prevent recovering an already-created
identity. New requests still require the connected owner account and accessible
folder checks; receipts never grant gallery or Drive access.

Bind reuse to canonical trimmed title, connection/folder, normalized optional
limit and password presence. Store only a digest of these non-secret settings.
Verify an exact supplied password against a separate retained copy of the original
salted scrypt creation hash; never put password bytes into a fast fingerprint.
This keeps replay independent of future album edits/password changes. A changed
setting/password fails with a safe request-conflict, requiring a new request ID.
Network calls, hashing and replay password checks remain outside locked transactions.

The connection lock and in-transaction receipt recheck handle same-connection
concurrency. The receipt's unique key also handles different-connection races:
recognize only that exact uniqueness conflict, roll back the losing nested create,
then read/validate the winner. Unknown persistence failures are not blindly retried.
Existing bounded public-slug collision retries remain separate from request replay.

### Consequences and migration

- A new reviewed metadata-only migration is required before using the upgraded
  internal creator. Existing albums remain valid without receipts; no backfill
  invents request IDs. Internal callers/tests must now supply a stable UUID per
  intended creation, and a future HTTP/UI must reuse it after uncertain outcomes.
- Keep one small immutable receipt with each created album/history under ADR-033.
  Do not expire receipts and accidentally turn a late retry into a second album.
  Future approved hard purge must remove the receipt in the same cleanup policy;
  no automated permanent deletion/Drive mutation is introduced here.
- Concurrent first attempts may duplicate safe folder reads/password work before
  a receipt commits, but cannot commit duplicate albums. HTTP capacity/abuse limits,
  initial sync/publication and consent/child access still need their own integration.
- Phase 3H executed 22 real PostgreSQL checks after all six migrations, including
  20 matching creation requests, conflicting different-connection races, rollback/
  stable-key retry, owner/digest/slug constraints and replay after metadata edits/
  disconnect/archive. The final full suite passed 657 tests with zero skips.
  This is internal service proof, not HTTP/network-fault or live Google acceptance.
  No live app/remote database migration is inferred.
