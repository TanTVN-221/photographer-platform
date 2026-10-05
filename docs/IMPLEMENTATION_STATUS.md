# Implementation status and remaining work

Audit date: 2026-10-05. Product scope: the proofing MVP in PRODUCT_SPEC.md and
MVP_SCOPE.md, not the entire future DAM/SaaS roadmap. Requirement source:
REQUIREMENTS.md. This register covers every requirement ID individually.

The full MVP is **not complete**. Much of the gallery/review workflow exists
and is offline tested, but there is no enabled folder-to-published-album flow.
Internal services are not presented as working dashboard features. Phases 3G/3H
have executed isolated PostgreSQL concurrency/migration proof, including
owner-bound retry-safe draft creation. Synthetic provider
responses and local browser fixtures are still not real Google, handset or
production acceptance evidence.

## Current usable boundaries

- Web/API/shared/UI/database/Drive packages form a strict TypeScript modular
  monolith. English/Vietnamese switching persists through a locale cookie.
- Google identity sign-in, owner sessions, logout and separate encrypted Drive
  authorization are implemented. A local browser check in phase 3F reached an
  authenticated workspace; no Drive connection was shown at that check.
- Existing indexed albums have dashboard/review/export/lock/reopen/archive
  routes and localized UI. Archive retains history and never deletes originals.
- Published indexed galleries have password gating, bounded photo pages,
  application-owned stored derivatives, lightbox, selection/comments and submit.
- Internal paginated Drive sync reconciles additions/changes/removals and
  invalidates previews. It is not connected to an import or manual-sync UI.
- Raster processing covers JPEG, PNG, WebP, AVIF, GIF and TIFF. Recognition of
  HEIC/RAW is implemented; rendering those formats is not. A serial preview
  operator command handles existing indexed albums, not automatic imports.
- Phase 3F adds accessible-folder metadata validation and atomic internal draft
  album/selection creation with real owner-bound OAuth composition. No route,
  publication or live application record is introduced by this phase.
- Phase 3G adds a repeatable private temporary PostgreSQL launcher and actual SQL
  verification of creation, constraints, concurrent selections, sync and bounded
  500/5,000-photo pagination. Application/remote databases and Drive were untouched.
- Phase 3H adds mandatory request UUIDs and durable creation receipts. Matching
  retries recover the original result without another album or Drive call;
  changed settings/passwords conflict. Same-key SQL races and rollback pass.
  This is an internal boundary, not an enabled dashboard create/import feature.

## Remaining MVP implementation, in dependency order

### 1. Resolve and implement the existing-folder authorization workflow

Requirements: DRIVE-004/005/015, ALB-001, SEC-005, OPS-004.

- Complete human Drive consent and perform the supplied folder's read-only pilot.
  Compare the app's fully paginated direct-child results with a known inventory;
  verify existing child metadata and download capability/content access, not
  merely a successful folder GET or an empty list response.
- Decide whether folder ID input can work with the accepted drive.file grant,
  whether explicit Picker file authorization is necessary, or whether the
  product accepts restricted-scope verification/security-assessment cost.
  Update ADR-011/032 with evidence before exposing folder/import routes.
- Implement the chosen folder URL/ID or Picker UX and server authorization.
  Picker requires separately configured Cloud API/project/key restrictions and
  a reviewed narrow CSP/script/frame policy; no broad allowlist is implied.
- Verify My Drive/shared-folder/shared-drive behavior for the chosen supported
  access scope, plus denied, removed, expired and revoked access states.

### 2. Expose the complete album creation and publication flow

Requirements: ALB-001/002/003/005, GAL-003, AUTH-001/004, SEC-001/003/005.

- Connect authenticated HTTP/server-action/UI contracts to the internal draft
  creator. Add localized folder/title/password/selection-limit input, validation,
  disabled/busy/error states and clear import outcome/navigation.
- Integrate the internal retry-safe UUID/receipt contract (ADR-043). The future
  HTTP/UI must keep the same UUID across an uncertain outcome/retry and handle
  request-conflict explicitly. Add owner/origin/abuse/KDF capacity controls;
  slug-collision retry alone is not request idempotency.
- Compose authorized initial sync, preview preparation and explicit publication
  policy. Do not publish a draft on partial listing or assume every preview is
  READY. Decide/show how pending/unsupported/failed photos affect publication.
- Return the share URL and import summary; support recovery after a failed
  first import without inventing or duplicating catalog entries.
- Album settings/editing/password rotation are not separately specified as MVP
  requirements. If desired, define their state, cursor, session and limit-change
  policies before adding them; creation configuration remains required.

### 3. Wire manual sync, progress and recoverable processing

Requirements: ALB-005, DRIVE-007/008/009/014/015/017/018, OPS-001/002/004.

- Add owner/origin/rate-limited manual-sync routes and EN/VI controls using the
  existing claim/reconcile service and real owner-bound Drive provider.
- Expose the last run's state, timestamps, created/updated/unchanged/removed/
  skipped/failed counts, actionable errors and safe retry instructions. Sync
  failure counts must be meaningful at the exposed orchestration boundary.
- Choose execution compatible with actual hosting duration limits; measure the
  current 25-minute listing deadline, 30-minute lease and reconciliation time.
  Implement a bounded execution/resumption policy and verify stale-run recovery.
- Integrate bounded preview batches with imports and changed source revisions.
  Provide progress/retry controls and durable execution/capacity semantics;
  the privileged 25-photo operator command alone is not this dashboard workflow.
- Test cancellation, disconnect, concurrent sync/archive/selection, process
  crashes and changed cursors. Add a queue only if measured constraints justify
  changing the accepted monolith decision.

### 4. Finish guaranteed photographic format rendering

Requirements: DRIVE-011/016/017, IMG-006/007, OPS-004.

- Approve and package a HEIC/HEIF/HIF decoder after codec/licensing and target
  runtime review. Verify actual image variants, dimensions, orientation/color
  and invalid/truncated inputs with redistributable source fixtures.
- Pin a RAW implementation for DNG, CR2, CR3, NEF, NRW, ARW, RAF, ORF, RW2 and
  PEF. Prefer adequate embedded previews; implement a measured bounded full
  demosaic fallback or explicitly actionable unsupported-variant outcomes.
- Record decoder/camera compatibility and rendering version. Verify provenance,
  byte signatures, GPS stripping, sRGB/orientation and camera/container variants.
- Verify APNG first-frame behavior and animated/multi-page representatives.
  Validate professional sources rejected by the current 64 MiB/80 MP limits;
  do not silently declare every camera file supported or lift safety limits.
- Bound hostile/expensive native decoding with deployment-appropriate process
  isolation and hard resource/time limits. Current cooperative deadlines are
  not an OS sandbox or a guaranteed wall-clock cutoff.

### 5. Finalize image storage, delivery and retention

Requirements: IMG-003/005/006, DRIVE-018, PERF-002/004/007, OPS-003.

- Measure the private persistent-volume/API derivative strategy against real
  Drive and gallery use: quota, download/refresh calls, image failures, storage,
  cache revalidation, revocation behavior, bandwidth and cost.
- Select production single-instance persistent storage or an approved shared
  derivative store/CDN; implement that provider if required. Multi-instance or
  ephemeral-volume hosting is not covered by the filesystem pilot decision.
- Agree and implement bounded old-revision/orphan derivative cleanup, retention,
  safe deletion/audit/recovery and rendering-version invalidation. Originals
  stay in Drive; application purge must not delete them.
- Tune responsive thumbnail variants/srcset and prefetch only with measurement.
  Current grid images are bounded 512px thumbnails, not adaptive variant sets.
- Confirm delivery/privacy on protected galleries and source removal/archive/
  password rotation, including bytes already held in a visitor's browser cache.

### 6. Production security and operational integration

Requirements: AUTH-004, SEC-002/003/004/005, OPS-002/003/004.

- Configure an HTTPS same-host web/API deployment, fixed origins and exact Google
  callbacks. Verify Secure/__Host- cookies, deployed CSP/native form redirects,
  CORS/CORP, TLS/CA and deliberate edge HSTS policy.
- Implement/configure edge or shared abuse limits and a trusted-proxy address
  policy. Current per-process/socket-address throttles do not secure a scaled
  deployment. Add creation/sync/KDF capacity controls before exposing them.
- Provision private secret management and versioned Drive decryption-key backup,
  recovery and rotation procedures; do not replace keys blindly.
- Connect structured events to redacted metrics/log aggregation and alerts for
  readiness, errors, latency, selection conflicts, image failures, sync/Drive
  quota, database pressure and derivative capacity/cost.
- Configure database backups/PITR and derivative recovery. Agree RPO/RTO,
  frequency/retention and operational ownership; execute and record an isolated
  restore drill and migration/application rollback rehearsal.
- Archive currently retains history indefinitely. Approve production retention
  and account/album purge policy before implementing permanent deletion. A
  hard-delete/restore UI is not required merely to satisfy the MVP's archive
  alternative, and destructive Drive actions remain out of scope.

## Acceptance work on already implemented code

These are verification gaps, not a request to rewrite working boundaries:

1. Keep the executed isolated SQL checks green with `pnpm test:postgres` (explicit
   PostgreSQL 17 binaries): migrations, constraints, selection caps/submission,
   ownership/archive/publication, draft rollback/collision/connection races,
   sync reconciliation/leases and 500/5,000-page traversal passed in phases 3G/3H.
   Phase 3H also proves 20 matching creation requests commit one album/selection/
   receipt, conflicting connection races roll back, and retries survive archive/
   disconnect without changing lifecycle state.
   Extend query-plan/load coverage to dashboard, review, selection, sync/reindex
   and production-sized concurrency; representative gallery EXPLAINs alone do
   not close every indexing or lock-time acceptance criterion.
2. Run the actual pinned GitHub CI workflow with ephemeral PostgreSQL and fresh
   migration deployment. A workflow file is not evidence of a green CI run.
3. Verify Google consent/callback/token refresh/expiry/revocation/disconnect,
   session logout/expiry, account isolation and the folder-child access pilot
   with two owners/accounts. The observed one-owner workspace is narrower proof.
4. Run the entire real browser workflow: create/import/publish/share; wrong and
   correct password; pages/lightbox; select/deselect-at-limit/comments/submit;
   photographer review/lock/reopen/export/archive; check ordered filenames and
   retained removed photos. Exercise stale cursors, image/provider errors and
   reconnect/quota states in both English and Vietnamese.
5. Verify real iOS/Android touch/pinch/keyboard/focus/screen-reader behavior and
   responsive layout, not just synthetic gestures or a desktop-sized fixture.
6. Define numeric target devices/networks and measure 500/5,000 records: initial
   and next-page response, useful render, layout stability, interaction latency,
   failure rate, mounted item count, memory, transferred bytes and Drive calls.
   Record test conditions, not only the word "fast" or localhost timings.
7. Verify source/render fixtures, privacy/color/orientation, resource limits,
   crash recovery, storage cleanup and deployed HTTPS/security/restore behavior.

## Setup and choices needed from the product/deployment owner

- **Now:** connect Google Drive from the authenticated local workspace. The
  supplied disposable folder URL is sufficient to identify the pilot target;
  it does not itself grant the application's OAuth client access. Human consent
  is still needed. No folder contents, tokens or private folder IDs belong here.
- **Test runtime:** the local SQL blocker was resolved using a temporary official
  PostgreSQL 17.11 source build. For repeat runs, supply installed PostgreSQL 17
  binaries via POSTGRES_BIN_DIR to `pnpm test:postgres`, or manage a separate
  eligible loopback `_test` target. The temporary build/cluster are not a system
  installation. Remote/query-parameter targets remain rejected; the supplied
  remote test target and application database were not used or modified.
- **Google Cloud:** confirm Drive API enablement, consent/test-user settings and
  exact identity/Drive callback URLs. If Picker is selected, supply an approved
  project/API-key setup; if broader access is selected, approve verification and
  compliance work rather than silently changing scope.
- **Deployment:** choose hostname/HTTPS, region, process/request-duration limits,
  one-instance versus shared-store architecture, managed database/direct migration
  access and a private persistent derivative volume. Local CA and development
  derivative directories have already been set up; they are not production infra.
- **Secrets:** provision GOOGLE_CLIENT_ID/SECRET, independent AUTH_FLOW_KEY,
  GALLERY_CURSOR_KEY, GALLERY_SESSION_KEY, DRIVE_TOKEN_KEY/key version, database
  URLs/CA and fixed API_BASE_URL/PUBLIC origins through private secret management.
  Existing local values need not be sent in chat; .env.example describes names.
- **Media:** choose target OS/container and approve codec/RAW licenses, versions
  and redistributable test images/camera coverage.
- **Acceptance/operations:** approve device/network budgets, retention/deletion,
  backup/recovery targets, monitoring ownership and deployment/cost constraints.

## Requirement-by-requirement coverage

Legend: **Boundary** = implemented and checked within the documented local/offline
boundary; not blanket production acceptance. **Partial** = implementation or
required integration evidence is missing. **Future** = no MVP surface is needed.
Evidence points to source/test modules; phase verification is in CURRENT_PLAN.md.

| ID | State | Evidence / remaining work |
| --- | --- | --- |
| PROD-001 | Partial | Workspace/gallery routes exist; complete folder-to-gallery workflow pending §§1–3. |
| PROD-002 | Partial | Owner checks and composite-owner creation receipts, with SQL cross-owner rejection; real two-owner browser workflow pending. |
| PROD-003 | Boundary | Six workspace packages/apps; no microservices/Redis/queue introduced. |
| PROD-004 | Boundary | Owner relations and provider/module boundaries; future SaaS features deliberately deferred. |
| UX-001 | Partial | Locale cookie/actions/document language and EN/VI copy tested; new import/sync copy and full browser/accessibility checks pending. |
| AUTH-001 | Partial | owner-auth and private route tests; one authenticated local workspace observed, two-owner/full lifecycle pending. |
| AUTH-002 | Partial | Google identity implementation; local signed-in workspace observed; full callback/account matrix still pending. |
| AUTH-003 | Boundary | Guest gallery/password sessions require no client account. |
| AUTH-004 | Partial | Hashed revocable owner sessions, cookie/exact-origin policies tested; deployed HTTPS/expiry/logout/two-owner checks pending. |
| DRIVE-001 | Boundary | Provider reads and derivative-only store preserve Drive as original source. |
| DRIVE-002 | Boundary | Bounded temporary source buffers; no permanent original persistence path. Verify deployed cleanup/resource behavior. |
| DRIVE-003 | Boundary | Provider interfaces/package isolate Google calls; new DriveFolderReader and owner composition tested. |
| DRIVE-004 | Partial | Encrypted owner-bound drive.file grant exists; live existing-child access, scope choice and key recovery pending. |
| DRIVE-005 | Partial | Paginated narrow list/provider tests include 10,000 records; real folder inventory/pagination pilot pending. |
| DRIVE-006 | Partial | Indexed album/gallery reads exist; chosen folder selection/browsing UX and end-to-end evidence pending. |
| DRIVE-007 | Partial | Unit and real SQL repeat-sync/no-duplicate/catalog-version checks pass; authorized exposure and real Drive repeat-import proof pending. |
| DRIVE-008 | Partial | Real SQL add/change/removal/reactivation, incomplete/provider failure and lease/claim tests pass; real Drive/manual-sync workflow pending. |
| DRIVE-009 | Partial | Real SQL soft removal preserves selected IDs/comments/export and reactivation identity; real Drive/browser acceptance pending. |
| DRIVE-010 | Boundary | Direct-parent query only; no recursion, provider tests enforce scope. Real pilot still needed. |
| DRIVE-011 | Partial | Shared registry/provider classify all guaranteed families and skipped files; real mixed-format import pending. |
| DRIVE-012 | Future | Provider-neutral boundary supports later expansion; general Drive mutations/upload are a later product phase. |
| DRIVE-013 | Partial | Natural comparator/materialized order/export tests; real reindex/query-plan and export workflow pending. |
| DRIVE-014 | Boundary | Bounded safe-read retries/jitter and durable local creation replay; replay does not call Drive or retry a Drive mutation. |
| DRIVE-015 | Partial | Safe provider/connection/creation errors exist; expose and verify import/sync quota/reconnect states. |
| DRIVE-016 | Partial | Source-prefix and raster decoder checks exist; HEIC/RAW-specific probes and source fixtures pending. |
| DRIVE-017 | Partial | Per-photo pending/unsupported/failed outcomes exist; actionable integrated dashboard/gallery error and real variant proof pending. |
| DRIVE-018 | Partial | Revision-keyed publication/conditional READY/stale-URL and real SQL sync invalidation pass; render-version cleanup and deployed storage/Drive proof pending. |
| DB-001 | Boundary | Prisma stores metadata/application state only; no original bytes in schema. |
| DB-002 | Boundary | Photo model contains required metadata/order/state/timestamps with schema validation. |
| DB-003 | Boundary | Real SQL album/file uniqueness, selection/composite FKs, owner-bound receipt uniqueness/digest/slug checks, credential state and dimension/limit constraints pass. |
| DB-004 | Partial | Representative 500/5,000 gallery EXPLAINs/timings recorded; 5,000 first/late pages use catalog index. Dashboard/review/sync/lock/load plans remain. |
| DB-005 | Partial | All six reviewed migrations deploy to fresh PostgreSQL 17.11; schema/order/invariant checks pass. Actual CI/staging/rollback/restore proof pending. |
| ALB-001 | Partial | Internal owner-validated, retry-safe draft service; folder-access gate and create/import/publication HTTP/UI pending. |
| ALB-002 | Partial | Real SQL atomic DRAFT album/selection/receipt, rollback and matching/conflicting race checks pass; create/import/publication HTTP/UI pending. |
| ALB-003 | Boundary | 144-bit slug, actual pg-adapter collision/rollback and durable request replay pass. HTTP/UI must integrate the stable UUID contract before exposure (§2). |
| ALB-004 | Partial | Dashboard keyset summaries/UI and tests exist; populated real browser/SQL evidence pending. |
| ALB-005 | Partial | Copy/open/review/export/lock/reopen/archive implemented; manual sync/result controls missing; full workflow pending. |
| ALB-006 | Partial | Confirmed non-destructive archive exists; live transaction/browser proof and production retention policy pending. |
| GAL-001 | Partial | /g/[slug] and metadata routes exist; real created/published gallery browser acceptance pending. |
| GAL-002 | Partial | Hash-bound encrypted password session gates metadata/images; deployed end-to-end/cookie/revocation checks pending. |
| GAL-003 | Partial | Versioned salted scrypt creation/replay tested in SQL; no plaintext or fast password fingerprint. HTTP/log/deployed KDF capacity acceptance pending. |
| GAL-004 | Partial | Responsive bounded grid/lightbox and phone-sized fixture checked; real handset/full workflow pending. |
| GAL-005 | Partial | Grid/filenames/selection counts/lightbox implemented; real stored-image/selection browser checks pending. |
| GAL-006 | Partial | Keyboard/native dialog/pointer-swipe boundaries tested; real touch/pinch and assistive-tech acceptance pending. |
| GAL-007 | Partial | Narrow public DTO/owner/provider redaction tests exist; deployed authorization/privacy review pending. |
| SEL-001 | Boundary | Photo has no isSelected field; selections are separate aggregates. |
| SEL-002 | Boundary | Real SQL unique membership/composite album FKs reject duplicates and cross-album items. |
| SEL-003 | Partial | DRAFT/SUBMITTED/LOCKED service/UI policy implemented; real lifecycle proof pending. |
| SEL-004 | Boundary | Limit checked inside album-row-locked transaction; 30 concurrent SQL selects at cap 5 produce exactly five items. |
| SEL-005 | Boundary | Executed PostgreSQL concurrent-cap and 20 duplicate-select/20-submit checks pass without excess items/transitions; not production load proof. |
| SEL-006 | Partial | Deselect-at-limit allowed while draft; real browser/SQL boundary validation pending. |
| SEL-007 | Partial | Per-selected-photo comments/API/actions/UI tested; live save/reload and state/race checks pending. |
| SEL-008 | Partial | Transactional idempotent submit and 20 concurrent real SQL submissions pass; full real browser workflow pending. |
| SEL-009 | Partial | Two-step localized confirmation and submitted-state UI; live workflow/accessibility checks pending. |
| SEL-010 | Partial | Owner review paginates selected comments/thumbnails, including removed history; real populated workflow pending. |
| EXP-001 | Partial | Owner-only text/plain attachment API/UI exists; live auth/download checks pending. |
| EXP-002 | Partial | Natural filename order/line escaping tested; real submitted export contents pending. |
| EXP-003 | Partial | Real SQL submitted/locked export and reopen denial pass; full real browser lifecycle acceptance pending. |
| IMG-001 | Boundary | Grid requests only application thumbnails; image routes never fetch an original. Verify real network traces. |
| IMG-002 | Boundary | Shared application descriptors/ImageUrlProvider consumed by web, no Drive URL construction. |
| IMG-003 | Partial | ADR-012/024–028 document strategy/privacy/cost implications; credentialed production comparison pending. |
| IMG-004 | Boundary | No public original-resolution proxy or download surface. |
| IMG-005 | Boundary | ImageUrlProvider/DerivativeStore abstractions preserve migration path; production provider choice pending. |
| IMG-006 | Partial | Raster derivatives/private publication/batch/delivery implemented; HEIC/RAW and automated import processing missing. |
| IMG-007 | Partial | Raster auto-orientation/sRGB/metadata stripping tested; HEIC/RAW/privacy/color fixtures and deployed proof pending. |
| PERF-001 | Partial | Encrypted catalog-bound keyset cursors and bounded pages tested; live SQL/cursor-change/performance acceptance pending. |
| PERF-002 | Partial | Lazy bounded 512px thumbnails; adaptive variants/srcset tuning and actual bandwidth/device evidence pending. |
| PERF-003 | Partial | Web renders one 50-row page, not an accumulated collection; real 5,000-item DOM/memory proof pending. |
| PERF-004 | Partial | Stored dimensions reserve aspect ratio; unknown-size/orientation/layout-shift measurements pending. |
| PERF-005 | Partial | Narrow DTO/page-scoped selection/review limits tested; actual response-size/latency acceptance pending. |
| PERF-006 | Partial | Actual local SQL traversal and equivalent query plans recorded for 500/5,000 photos; representative Drive albums/device/network/load results remain required. |
| PERF-007 | Partial | Numeric device/network budgets and production-like measurements not yet agreed or executed. |
| SEC-001 | Partial | Strict Zod boundary/provider/creation UUID validation and safe replay conflicts; audit newly exposed import/sync inputs later. |
| SEC-002 | Partial | Ignored .env/CA, encrypted tokens, independent keys and hashed receipt keys/salted password verifiers; production secret/key recovery pending. |
| SEC-003 | Partial | Pilot per-process password/mutation throttles exist; edge/shared/proxy and import/KDF capacity controls pending. |
| SEC-004 | Partial | Fixed route/stable errors and creation/replay private-diagnostic redaction tests; production aggregation audit/workflow telemetry pending. |
| SEC-005 | Partial | Nonce CSP, exact origins, cookie/CORP/no-CORS policy tested; deployed HTTPS/edge/Picker review pending. |
| SEC-006 | Future | No destructive Drive operation exposed in MVP; later mutation phase needs owner confirmation/audit. |
| OPS-001 | Partial | SyncRun transaction records states/counts; real execution, dashboard visibility and failure counts pending. |
| OPS-002 | Partial | Structured redacted request/provider events exist; workflow metrics aggregation, alerts and measurements pending. |
| OPS-003 | Partial | OPERATIONS documents release/restore/incidents and pilot retention; production policy, schedules and restore drills pending. |
| OPS-004 | Partial | Safe provider errors/fallbacks/readiness/local startup exist; import/sync/reconnect end-to-end states pending. |

## Future product phase, not remaining MVP implementation

- Drive folder/file create, rename, move, trash/delete and upload UI.
- Recursive folder sections, multiple source folders, video previews/source editing.
- Client accounts, multiple clients/selections and guest download controls.
- Studio teams/roles/admin, subscriptions/billing and other storage providers.
- Custom branding/logo/watermark/domains and email/SMS/WhatsApp notifications.
- Tags, advanced search/filtering, analytics and face recognition/search.
- Native mobile apps; Next web is the current mobile experience.
- Optional PSD/PSB, JPEG XL, JPEG 2000, BMP and best-effort extra RAW families.
  SVG remains excluded as a photographic source and must not be directly served.

## Phase 3H verification record

- Final full suite against fresh PostgreSQL 17.11: **657 passed**, **zero
  skipped** (75 files), including **22 real SQL checks**. All six migrations
  applied, including `202610050001_album_creation_receipts`. This migration was
  not applied to the application or a remote database; deploy it before using
  the upgraded internal creator. No existing album backfill is required.
- Adds 17 offline checks and four real SQL checks. Creation tests now cover
  normalized UUID/settings, exact passwords, conflict/redaction, committed-result
  recovery, owner isolation and cancellation. The actual SQL suite proves 20
  simultaneous matching attempts commit one album/selection/receipt; competing
  same-key requests on different owner-owned connection locks commit one winner
  and roll back the loser. Post-insert transaction rollback releases the key
  for a retry; composite owner FKs and digest/slug checks reject invalid receipts.
- Retained receipts recover the original ID/slug/DRAFT response after later
  metadata edits, archive and disconnect, without another provider read or
  reverting the album's current lifecycle. Response-loss recovery is tested
  synthetically; no real browser/network failure or Google import is claimed.
- Password work and provider calls stay outside locked transactions. Receipts
  retain the original salted scrypt verifier, not plaintext or a fast password
  digest; one receipt remains with album history under ADR-033/043.
- Final 500-photo traversal: 5 pages, first/max page 6 ms. 5,000 photos: 50
  pages, first page 1 ms / max page 2 ms. Equivalent 5,000 first/late SQL plans
  used the catalog index with zero filtered rows (0.025/0.036 ms execution).
  The small 500-row tail chose a sequential scan. These synthetic local metadata
  timings do not establish production browser/device/network performance.
- Schema validation caught a missing composite uniqueness declaration during
  development; corrected schema and migration agree. A later SQL run caught
  an overlong synthetic slug masking the intended owner-FK check. Fixtures now
  use the real slug generator, invalid-slug rejection is explicit, and reruns pass.
- Final workspace types/source lint, script lint, database/API builds and Prisma
  validation passed. Web production code was unchanged; no web production build
  was rerun. Final focused creation/safety/guard/config/traceability: 5 files /
  93 tests passed. Final source/whitespace and all-82-ID checks passed.
- Every SQL launcher run stopped/removed its exact owned cluster, including the
  failed test run. The checksum-verified temporary source/runtime was removed
  afterward. No global service, application/remote row write, private .env/CA
  edit, OAuth grant, real Drive request, original download or Drive mutation.
- Fresh local workspace check still showed no connected Drive account or albums.
  The temporary browser tab was closed; user tabs/session remained unchanged.

## Previous phase 3G verification record

- Full suite against fresh PostgreSQL 17.11: **636 passed**, **zero skipped**
  (75 files), including **18 real SQL checks**. All five migrations applied.
  The isolated launcher has 16 unit checks plus the shared guard/config tests.
- Real SQL proof covers concurrent cap/duplicates/submissions, constraints,
  ownership, retained removed selections/export, archive/publication fences,
  draft atomicity/rollback/collision/connection change, sync repeat/change/removal/
  reactivation, failure rollback, competing claims and expired leases.
- Gallery metadata traversal checked all 500/5,000 records in 5/50 pages at a
  100-photo cap with no duplicates or Drive IDs/image originals in responses.
  Representative first/late query plans use the catalog index for 5,000 rows;
  the optimizer may choose a sequential scan for the smaller 500-row tail.
  Per-run timing events are emitted; no production budget is declared met.
- All workspace types/lint, database/API/Drive builds, Prisma validation and
  final phase source/whitespace/82-ID coverage checks passed. Web production
  source was unchanged; its production build was not rerun this phase.
- The first SQL run found three invalid synthetic CONNECTED credential fixtures,
  not a reason to weaken the migrated constraint. Fixtures now use fresh
  synthetic encrypted tokens and complete metadata. A later full run exposed a
  random-state tamper test that sometimes did not change its input; that test
  now guarantees a mutation. Both issues were corrected and reruns passed.
- Every actual launcher run stopped/removed its exact newly owned cluster. The
  checksum-verified temporary source/runtime was removed afterward; no global
  PostgreSQL install/service, application/remote DB change, root `.env` edit,
  Drive token lookup, folder request, original download or Drive mutation.

## Previous phase 3F verification record

- Full suite: **601 passed**, **12 real SQL tests skipped** (72 files passed,
  one suite skipped). Includes 69 new offline checks and three new opt-in SQL
  creation/rollback/connection-race checks compared with phase 3E.
- All workspace type/lint checks, API/Drive production builds, final API/script
  checks and Prisma validation passed. Web production code was unchanged; no
  new web build was necessary in this internal phase.
- Requirement coverage test: all **82 IDs** appear exactly once, no omissions,
  duplicates or invented IDs. Final phase source/whitespace inspection passed.
- Live browser checks observed sign-in success, no connected Drive account and
  no albums. Temporary tabs were closed and the user's session was preserved.
  No folder request, real SQL fixture, provider credential read, migration,
  original download, application record creation or Drive mutation ran.

Detailed evidence/limits are in .agent/CURRENT_PLAN.md. No live folder access,
production/device performance result or full-MVP completion is implied.
