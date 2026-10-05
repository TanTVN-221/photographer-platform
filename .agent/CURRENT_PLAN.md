# Current Execution Plan

## Active phase — 3H: retry-safe internal album creation

Scope: ALB-001/002/003, DRIVE-014, DB-003/005, PROD-002, SEC-001/002/004,
GAL-003 support. One creation-idempotency phase only; folder/import/publication/
sync HTTP/UI remain gated by ADR-011/032 and human Drive consent.

- Fresh temporary browser check: authenticated Vietnamese workspace, no connected
  Drive account and no albums. Tab closed; user's tabs/session unchanged.
- Require a validated request UUID for draft creation. Persist an owner-bound
  receipt atomically with its album/selection; replay committed results, reject
  reuse with changed settings/password, and preserve existing lifecycle state.
- Use hashed request keys and canonical non-secret request fingerprints. Reuse
  the creation's salted password hash for replay verification, outside row locks;
  never store a fast digest/plaintext of a gallery password. Keep receipts with
  album history without speculative expiry or purge.
- Add reviewed composite-owner/unique constraints and indexed lookups. Account
  for concurrent same-key requests, including different connection locks, slug
  collisions, rollback and ambiguous successful-response loss. No placeholder
  HTTP exposure, OAuth scope expansion or application/remote DB migration.
- Run offline regressions and fresh isolated real PostgreSQL migration/race
  checks. Obtain checksum-verified official PostgreSQL 17.11 under a private
  temporary prefix again if necessary; no system service or existing cluster.
- Validate/build/types/lint, inspect source/phase diffs, record evidence and
  update ADR-041/043/status/setup. Clean only exact owned temporary SQL assets.

### Verification and requirement status

- Added strict request UUID validation/normalization and an owner-scoped hashed
  key. Canonical settings digests exclude password content; exact password replay
  uses the original salted scrypt verifier outside locks. Only album ID, original
  public slug and original DRAFT response leave the service; replay never restores
  a current archived/published album to DRAFT or calls Drive again.
- Added AlbumCreationRequest with one receipt per album, a composite owner FK,
  indexed owner/key uniqueness and SQL digest/slug checks. Receipt/album/selection
  commit together. The connection-row lock and receipt recheck serialize matching
  requests; known receipt-key conflicts across different connection locks roll
  back the losing nested create and validate the committed winner outside locks.
  Unknown persistence errors fail safely. Existing slug retries remain bounded.
- New metadata-only migration: 202610050001_album_creation_receipts. Existing
  albums remain valid without invented request IDs/backfill. This migration is
  not deployed to the application or a remote database; it is required before
  using the upgraded internal service. No new HTTP/UI surface was exposed.
- Rebuilt official checksum-verified PostgreSQL 17.11 under an exact owned temp
  prefix using ADR-042's non-production macOS arm64 profile. All six migrations
  applied to freshly initialized isolated loopback databases. Initial schema
  validation caught a missing composite unique declaration; corrected schema and
  migration passed. One SQL run caught an overlong synthetic gallery slug masking
  an intended owner-FK test. Fixtures now use the real generator, malformed-slug
  rejection is explicit, and the final rerun passed.
- Final full suite: 75 files / 657 tests passed, zero skips, including 22 real SQL
  checks. This adds 17 offline and four SQL checks versus phase 3G. The real suite
  proves 20 concurrent matching creation attempts commit one album/selection/
  receipt, conflicting different-connection races commit one winner/roll back one
  loser, post-insert rollback frees the request key, and composite owner/digest/
  slug constraints reject invalid receipts. Original identity/settings/password
  replay survives later metadata edits, archive and disconnect. Offline response-
  loss simulation is not a real network-fault or Google workflow acceptance test.
- Final 500-photo traversal: 5 pages, first/max page 6 ms; 5,000 photos: 50 pages,
  first page 1 ms / max page 2 ms. 5,000 first/late equivalent SQL plans used the
  catalog index with zero filtered rows (0.025/0.036 ms execution). The 500-row
  tail chose a sequential scan. Synthetic local metadata timings do not meet or
  replace production browser/device/network/load budgets.
- All six workspace type/source lint checks, script lint, database/API production
  builds and Prisma validation passed. Final creation/receipt safety/guard/config/
  all-82-ID coverage checks: 5 files / 93 tests passed after documentation updates.
  Web production code was unchanged; no web production build was rerun (latest
  successful isolated one: phase 3E). Final phase source inspection and tracked/
  phase-new-file whitespace checks pass; unrelated dirty changes are preserved.
- Every launcher run stopped/removed its own exact cluster, including the failed
  run. After the final successful SQL run, validated and removed only the owned
  generated source/archive/runtime root. Assets are reproducible; no global
  PostgreSQL install/service, app/remote row write, private .env/CA edit, OAuth
  grant/token lookup, real Drive request, original download or Drive mutation.
- Updated ADR-041/043, architecture, database/API/root READMEs, setup and the
  complete remaining-work register. Verified boundary support: DB-003, ALB-003,
  DRIVE-014. Partial implementation/acceptance: ALB-001/002, DB-005, PROD-002,
  GAL-003 and SEC-001/002/004. Deferred: DRIVE-004/005/015 access pilot and
  ALB-001/005 import/publication/manual-sync HTTP/UI, IMG-006/007 HEIC/RAW,
  PERF-007 device/network acceptance, production SEC-003/005 and OPS-003.

Status: this retry-safe internal creation phase is complete within the recorded
boundary. Full MVP is not complete. The signed-in workspace still has no Drive
connection; human consent is required for the supplied read-only folder pilot.
Exposed creation/import/publication/manual-sync UX, HEIC/RAW, hosting/storage/
retention, production security/restore and device/network acceptance remain open.

---

## Active phase — 3G: isolated real PostgreSQL correctness verification

Scope: DB-003/004/005, SEL-002/004/005/008, ALB-001/002/003/006,
DRIVE-007/008/009/018 and PERF-006 acceptance support. One database-verification
phase only; Drive import exposure and human consent remain separate gates.

- Current local browser check: owner signed in, no Drive connection; temporary
  tab closed. Do not grant Google permissions or widen scopes for the owner.
- No local PostgreSQL/container runtime was found. Obtain the official pinned
  PostgreSQL 17 release source, verify SHA-256, and build under a private mktemp
  directory only. Do not install a system service, modify Homebrew installation,
  reuse an existing cluster or contact application/remote test databases.
- Add a repeatable fail-closed local verification launcher: explicitly supplied
  PostgreSQL binaries, newly initialized private temporary cluster, loopback
  port, fresh _test database, isolated child environment, strict test-only Prisma
  configuration, reviewed migrations, SQL tests and owned-process cleanup.
  Never load root .env or relax the remote/query-parameter fixture guard.
- Run the real SQL suite, investigate/fix any in-scope correctness failures,
  add missing sync/slug/lock/query-plan checks where justified, and record actual
  500/5,000 record results and target/runtime limitations.
- Run relevant build/types/lint/full regression/Prisma validation and inspect
  phase diff. Update requirement status with executed proof, not fixture existence.
  Stop the temporary database and remove only exact owned temporary assets.

### Verification and requirement status

- Built official PostgreSQL 17.11 from checksum-verified source in a private
  temporary prefix on macOS arm64. No Homebrew/system service installation,
  application cluster or remote test target was used. ADR-042 records the exact
  digest, loopback/non-production profile and repeat-run prerequisite.
- Added test:postgres and 16 launcher safety unit checks: explicit major/toolchain,
  private new cluster, generated loopback SCRAM target, isolated environment,
  failed start/migration/test cleanup, cancellation, redaction and preservation
  after uncertain shutdown. Test-only Prisma config reuses the unchanged strict
  target guard moved into the database package with an API compatibility export.
  The launcher/migration config never reads private root .env or falls back to
  application URLs. Application CLI configuration remains unchanged.
- All five reviewed migrations applied successfully on each newly initialized
  real cluster. The initial run passed selection/pagination but rejected three
  invalid synthetic CONNECTED credential fixtures. Corrected them using fresh
  synthetic AES-GCM tokens and the required account/scope/timestamp metadata;
  disconnect clears ciphertext/key together. The database check stays intact.
- Added six actual SQL checks (12 -> 18): real pg-adapter public-slug collision,
  sync repeat/add/change/removal/reactivation and retained selection/comment/
  export history, incomplete/provider failure rollback, concurrent claim/archive
  fencing, expired lease/partial unique index and migrated metadata/credential
  constraints. Provider responses are synthetic; no Google access is implied.
- One full run exposed an existing random-state tamper test that could replace
  a character with itself. Changed the test to guarantee a different first
  character; OAuth production behavior was not modified. Subsequent full runs
  passed. Final: 75 files / 636 tests passed, zero skips, including 18 real SQL
  tests. Final focused safety/guard/config/flow/82-ID traceability: 5 files /
  34 tests passed after documentation updates.
- Final metadata traversal: all 500 photos across 5 pages, first/max page 11 ms;
  all 5,000 across 50 pages, first page 9 ms / max page 13 ms. Responses capped at
  100, no duplicate IDs, no original images/private Drive file IDs. Equivalent
  projection/keyset EXPLAIN ANALYZE/BUFFERS: 5,000 first/late plans use the catalog
  index, zero filtered rows, 0.027/0.049 ms execution. The 500-row tail chose a
  sequential scan (454 filtered rows, 0.157 ms). This is an optimizer choice on
  a small local synthetic table, not proof of deployed device/network budgets.
  Representative dashboard/review/sync/reindex/production-lock plans remain.
- All six workspace TypeScript and source lint checks passed, as did script
  lint, database/API/Drive production builds and Prisma validation. A root lint
  wrapper stalled and was interrupted; the explicit
  pinned workspace lint plus script lint reruns passed. No web production source
  changed; no web production build was rerun (latest successful one: phase 3E).
- Every actual run, including failed runs, confirmed its owned cluster stopped
  and removed its exact temporary directory. After final SQL verification the
  separately validated source/archive/runtime temp root was removed. These are
  reproducible generated assets, not application data. No private .env/CA change,
  migration/schema edit, application/remote row write, Drive token lookup,
  original download, folder/Drive mutation or OAuth grant was performed.
- Updated status/setup/README/architecture evidence and ADR-041/042. All 82 IDs
  remain covered exactly once. Final phase source inspection and tracked/new-file
  whitespace checks pass; existing unrelated dirty changes are preserved.
- Verified boundaries: DB-003, SEL-002/004/005 and ALB-003. Partial acceptance
  support: DB-004/005, ALB-001/002/006, SEL-008, DRIVE-007/008/009/018, PERF-006.
  HTTP/browser-to-database, live Drive scope/content, CI/staging/restore and
  production/device load remain separate from these service-level SQL checks.

Status: this isolated database-verification phase is complete within the recorded
boundary. Folder-child access and human Google consent, HEIC/RAW rendering,
import/publication/manual-sync HTTP/UI, deployed/device performance, hosting/
retention and restore/security decisions remain open. Full MVP is not complete;
the next folder pilot needs the owner to connect Drive from the signed-in workspace.

---

## Active phase — 3F: internal validated draft-album creation and gap audit

Scope: partial ALB-001, ALB-002/003, GAL-003, PROD-002, DRIVE-003/014/015,
SEC-001/004 and DB-005 regression checks. One internal album-creation phase;
no import/sync HTTP routes, publication, OAuth scope changes or live row writes.

- Add a provider-neutral accessible-folder metadata reader, implemented through
  Google's narrow files.get projection with bounded safe-read retries. Reject
  files, shortcuts, trashed/mismatched folders and unavailable list capability.
  Folder access alone must not be mistaken for access to existing children.
- Validate title/folder/connection/password/limit input, check connection ownership
  before provider access, hash outside transactions, and create one DRAFT album
  with one DRAFT selection atomically. Recheck/lock the owner connection briefly
  after provider access; bound retries to known public-slug uniqueness conflicts.
- Provide real owner-bound OAuth composition, without wiring it into a route or
  command before ADR-011/032's access gate. Test safe errors, cancellation,
  races, ownership, hashing and transaction composition offline.
- Audit every requirement in docs/REQUIREMENTS.md into a complete remaining-work
  register separating implementation, acceptance verification and external setup.
  The supplied disposable folder is authorized for read-only pilot checks only;
  its ID is not persisted in source. Local browser inspection confirmed a signed-
  in owner but no Drive connection. Human consent is requested separately.
- Run focused/full tests, relevant production builds/types/lint and Prisma
  validation; inspect phase diffs. No remote fixtures or migrations are inferred.

### Verification and requirement status

- Added DriveFolderReader and reused the provider's narrow validated metadata
  machinery for files.get and files.list. Folder GETs reject invalid/mismatched/
  trashed/non-folder/shortcut IDs and missing list capability, use bounded retries
  and credential-free telemetry, and never follow redirects or read originals.
- AlbumCreationService validates strict inputs, checks owner connection before
  provider access, hashes passwords outside transactions, locks/rechecks the
  connection snapshot, and atomically creates a DRAFT album/nested DRAFT selection.
  Real composition refreshes through owner-bound encrypted OAuth. Only known
  slug collisions receive at most three retries; installed Prisma 7 adapter
  error shape was inspected and covered. Unknown diagnostics are never echoed.
- No create/import/sync HTTP route, web change, publication, schema migration,
  OAuth scope expansion, credential read or live application record write ran.
  The initial focused test/type run found a miswrapped empty-array test fixture;
  the test table was corrected and all reruns passed. This was not live SQL proof.
- Final full suite: 72 files passed, 601 tests passed; one real SQL suite / 12
  tests explicitly skipped without exported TEST_DATABASE_URL. This adds 69
  offline tests and three opt-in SQL tests versus phase 3E. Focused final creation/
  folder/traceability checks: 3 files / 69 tests passed. Earlier provider regression
  checks included all existing listing tests. Actual SQL creation/rollback/races
  remain unverified, and the remote fixture guard was not weakened.
- All six workspace type/lint checks and API/Drive production builds passed;
  final API type/lint and script lint checks passed again after the coverage test.
  Prisma validation passed. No web production source changed, so its production
  build was not rerun; phase 3E has the latest isolated successful web build.
  Tracked and phase-untracked whitespace checks and final source diff inspection
  passed. Existing unrelated dirty changes were preserved.
- docs/IMPLEMENTATION_STATUS.md covers all 82 requirements exactly once, with
  missing implementation, acceptance checks, external setup and future scope.
  A regression test prevents missing/duplicate/invented IDs. ADR-041 records
  internal creation limits/idempotency/lock policy; README/provider/API/architecture
  status now links or reflects the new boundary and corrects stale exposure notes.
- Two read-only temporary local browser checks reached an authenticated Vietnamese
  workspace, empty album dashboard and no Drive connection. Both temporary tabs
  were closed; the user's tabs/session/locale were preserved. Human Drive consent
  was requested asynchronously. The supplied folder was not contacted, persisted
  in source or modified; no folder/child access result is fabricated.
- Implemented boundary: partial ALB-001, ALB-002/003, GAL-003, PROD-002 and
  DRIVE-003/014/015, SEC-001/004 support. ALB-001/005 import/publication/manual-sync
  UX, DRIVE-004 live scope pilot, complete IMG-006 HEIC/RAW, DB-004/SEL-005/PERF-006
  live SQL, PERF-007 devices and production SEC-003/005/OPS-003 remain deferred.

Status: this internal phase and complete requirement audit are finished within
the verified offline boundary. Full MVP remains incomplete. Connect Drive from
the signed-in workspace for the supplied folder's read-only pilot; provide a
safe disposable test database and resolve remaining deployment/media/retention/
performance choices before the affected acceptance or production phases.

---

## Active phase — 3E: native sign-in origin rejection

Scope: AUTH-002/004 and SEC-005, with Drive consent/logout regression coverage.
Investigate and correct the reported ORIGIN_REJECTED sign-in failure only.

- Reconcile the real loopback public origins with the browser's native POST
  behavior. The current web same-origin referrer policy nulls Origin across
  ports under Fetch's navigation algorithm; never allow null origins in the API.
- Use web strict-origin referrer policy: origin-only referrers, no private paths
  or query strings, no HTTPS-to-HTTP downgrade. Keep API no-referrer, exact
  CSRF origins, cookies, CSP and OAuth permissions unchanged. Record the
  accepted ADR-037 policy correction and its limited privacy trade-off.
- Add opaque/missing/mismatched-origin API regression tests and header tests.
  Verify native browser POSTs using an isolated loopback mock-auth fixture,
  without Google access, real sessions, credential reads or database writes.
- Run focused/full tests, web/API types/lint, production web build and Prisma
  validation; inspect phase diff and record the actual runtime header. Preserve
  the user's browser tabs and pending login state.

### Verification and requirement status

- Corrected the shared web header to strict-origin, used by both Next config
  and Proxy. API origin/cookie/redirect/CORS policy and Google scopes were not
  changed. ADR-040 records why ADR-037's same-origin web policy was incompatible
  with native cross-port POSTs and the origin-only disclosure trade-off.
- A temporary two-port browser fixture used the actual API auth router and web
  header/CSP code, synthetic auth only, and suppressed all Set-Cookie headers
  to preserve the user's real host-shared cookies. Old same-origin policy:
  browser sent Origin null / no Referer; auth begin stayed at zero and the API
  returned 403 ORIGIN_REJECTED. Corrected strict-origin: browser sent the exact
  fixture web origin and origin-only Referer despite a private query parameter;
  API returned 303 and browser reached the local completion page. No Google,
  real session, database row or provider credential was used by the fixture.
  The temporary browser tab/server were closed; user tabs/login state preserved.
- Focused auth/header/Proxy tests: 3 files / 46 tests passed. Final full suite:
  69 files / 532 tests passed; nine real SQL tests in one suite skipped without
  exported TEST_DATABASE_URL. Eight new tests guard the header, missing/opaque/
  mismatched origins, cookies/side effects and explicit-null precedence over
  Referer. API production source did not change; no schema migration was added.
- Web/API TypeScript checks, all six workspace source lint checks and Prisma
  validation passed. An initial web typecheck command referenced a nonexistent
  package-local TypeScript binary; the root installed compiler rerun passed.
  Production web build/type compilation passed in an isolated temporary source
  checkout sharing only installed workspace dependencies, not private .env/CA.
  Its .next directory did not collide with the user's live development server.
- Fresh HTTP checks: active dev /signin and isolated production /signin both
  returned 200, strict-origin and nonce CSP. The temporary production server
  was stopped; the user's existing API/web development servers remain running.
  Browser fixture warnings/errors were absent. Tracked/phase-file whitespace
  checks and final source/documentation diff inspection passed.
- Implemented: reported browser-initiation defect supporting AUTH-002/004 and
  SEC-005. Full real Google callback, consent/two-owner and deployed HTTPS/browser
  matrix validation remain partial/deferred, as do prior full-MVP external gates.

Status: native form origin-policy correction is implemented and checked. Reopen
the web /signin page before retrying; reloading the old API error POST is not a
new sign-in attempt from the corrected web document. No credentials, application
records, grants, user cookies or private environment settings were changed.

---

## Active phase — 3D: reliable local development startup

Scope: OPS-004, SEC-002/004 and AUTH-004 configuration support; DB-001 and
IMG-002 readiness regression protection. One local-runtime phase only.

- Make both app development commands explicitly load optional repository-root
  .env using Node's loadEnvFile before launching child CLIs, preserving
  exported-value precedence. Keep production start/build, preview operators and
  SQL test loading unchanged.
- Replace only the private derivative-path placeholder with an ignored,
  workspace-local persistent directory. Validate exact targets before creating
  private 0700 directories; retain only derivatives, never Drive originals.
- Test launcher configuration with isolated synthetic environment files,
  without reading live secrets or starting database fixtures. Document restart,
  public origin and production-secret behavior.
- Gracefully restart only the verified repository development processes. Verify
  health/readiness and sign-in availability without Google consent, row reads,
  schema changes or fixture writes. Run workspace checks and inspect phase diffs.

Remaining gates: absent disposable test database and loopback-only fixture policy;
live Google/folder-access consent and ADR-011/032; HEIC/RAW decoder decision;
production infrastructure, retention/restore and real performance acceptance.

### Verification and requirement status

- Both development commands now use scripts/dev.mjs and Node loadEnvFile,
  resolving root .env relative to the launcher. Exported/empty settings win;
  production start/build, preview operators and SQL fixture loading are unchanged.
  A direct environment-file-flag approach failed in Next worker NODE_OPTIONS
  during integration; it was replaced and the actual two-app restart passed.
- Created only checkout-local .local and .local/derivatives, verified regular
  owner-controlled 0700 directories, and changed only DERIVATIVE_STORE_ROOT in
  private .env using apply_patch. All other environment values were asserted
  preserved. The volume is empty; no originals/previews or database rows were
  read or changed. .env, ca.pem and the volume are confirmed git-ignored. All
  three existing database URLs still verify the supplied CA.
- Gracefully stopped only the previously verified repo development launchers
  and restarted pnpm dev with Node 24. Both app servers remain running on the
  configured 127.0.0.1 ports. /health/live=200, /auth/status=200/configured,
  anonymous /auth/session=401 AUTH_REQUIRED (previously 503). Initial readiness
  was 503 while the connection warmed up; subsequent and final read-only
  /health/ready checks returned 200/ready. This is not a performance benchmark.
- A hidden temporary browser tab verified the Vietnamese sign-in page, enabled
  Google button, POST action to the correct public API origin, and no console
  warnings/errors. It was closed; the user's tab and language were preserved.
  No Google action/consent, token lookup, schema change or fixture write ran.
- Final full regression: 69 files passed, 524 tests passed; one real PostgreSQL
  suite / nine tests skipped without an exported TEST_DATABASE_URL. Seventeen
  new launcher tests cover actual synthetic child execution, cwd independence,
  literal values, exported/empty precedence, missing files, exit codes, safe
  argument/environment failures, worker flags and production isolation.
- All six production builds and workspace TypeScript checks passed during this
  phase; final API type checking and Prisma validation were repeated after the
  launcher correction. Final full lint, including the new launcher, passed.
  A normal root-lint attempt was blocked by sandboxed pnpm registry-signature
  verification; the approved rerun passed without disabling verification.
  Tracked and phase-specific untracked-file whitespace checks passed; final
  source/package/documentation diffs were inspected. Real OAuth/two-owner,
  SQL fixtures, authenticated gallery and production/device checks were not run.
- Implemented: OPS-004 local-startup portion and SEC-002/004 configuration
  support. AUTH-004, DB-001 and IMG-002 have running-infrastructure evidence,
  not complete end-to-end acceptance. ADR-039 documents the development-only
  behavior change and production/storage boundaries.
- Deferred: ALB-001/005 import/sync and DRIVE-004 folder-access pilot under
  ADR-011/032; complete HEIC/RAW IMG-006; real SQL PERF-006 and device/network
  PERF-007; production SEC-003/005 and OPS-003 retention/restore/hosting.

Status: local development startup and private preview provisioning are complete
and checked as above. Full MVP remains incomplete. The separately named test
database remains absent; creating it or allowing remote fixture writes is not
inferred. Google consent/folder access and production decisions need user action.

---

## Active phase — 3C: configure the supplied PostgreSQL CA locally

Scope: DB-001, SEC-002/004 and OPS-004 configuration support. The user supplied
ca.pem and explicitly requested setup; this is not authorization to relax TLS,
enable remote test writes, apply schema migrations or change application data.

- Validate the supplied file as a current CA certificate without private keys.
- Mechanically update only DATABASE_URL, DIRECT_DATABASE_URL and
  TEST_DATABASE_URL in private root .env: sslmode=verify-full and an absolute,
  URL-encoded sslrootcert path. Preserve credentials, targets and unrelated
  environment values; do not print secrets or commit environment-specific CA.
- Verify the actual pg/Prisma adapter connection using bounded read-only SQL,
  without migrations, fixtures, credentials/row reads or TLS bypass.
- Document restart/export behavior and retain the loopback-only test guard.
  Record exact checks and any remaining connection/schema/runtime blockers.

### Verification and requirement status

- Supplied ca.pem: one regular, non-symlink, currently valid CA certificate;
  no private key. The certificate was neither modified nor copied to global
  system/Node trust. Root ca.pem and .env are confirmed git-ignored.
- Updated exactly the three private URL settings using apply_patch through
  private stdin (no credentials in tool arguments/output). Post-edit assertions
  confirmed targets/credentials and all unrelated environment values preserved.
  Each URL now has sslmode=verify-full and the absolute encoded sslrootcert.
- Actual pg read-only probes verified DATABASE_URL and DIRECT_DATABASE_URL.
  TEST_DATABASE_URL passed TLS but returned PostgreSQL 3D000 (database does not
  exist). No database was created; no fixtures, migrations or row reads ran.
- Actual application Prisma adapter verified with SELECT 1 WHERE FALSE after
  connection warm-up. An initial short-transaction probe failed; the successful
  follow-up separates connection setup from the query and is not a lock/performance
  result. Prisma CLI migrate status exited 0 against the direct connection;
  this only checked existing migration history and applied no migrations.
- Focused database/environment/test-target suite: 3 files / 22 tests passed.
  Database TypeScript check/lint and Prisma schema validation passed. Tracked
  diff whitespace passed. Full workspace build/browser/SQL fixture suite was
  not rerun for this private-configuration/documentation-only phase.
- Implemented: user-requested local CA configuration supporting DB-001 and
  SEC-002/004, with actionable OPS-004 setup guidance. No application architecture,
  accepted test-target policy, OAuth permission or credential rotation changed.
- Deferred: restart the existing API with updated exported values/.env process
  loading; create a disposable test database and explicitly approve any remote
  test-write policy before SQL tests. Full MVP/Drive/decoder/performance gates
  are unchanged. The user supplied CA trust is scoped only to configured URLs.

Status: CA setup complete and verified for application/direct PostgreSQL and
Prisma. The separately named test database is absent; live application restart
and remote fixtures were not performed or represented as complete.

---

## Active phase — 3B: mobile lightbox gestures and modal interaction safety

Scope: GAL-004/005/006, UX-001, IMG-001/002 and PERF-003 regression coverage.
One client-interaction phase only; no new provider, database, import route or
change to selection authorization.

- Add single-finger horizontal swipe navigation on the preview stage only.
  Cancel taps, vertical/diagonal drags, long holds, multi-touch, cancelled/lost
  pointers and zoomed-viewport gestures. Keep native vertical pan/pinch zoom.
- Preserve bounded page navigation, one generated preview and explicit selection
  controls. Do not navigate, select, submit or dismiss on accidental gestures.
- Make backdrop dismissal require a press and release outside the dialog;
  preserve Escape, close button, opener focus and restore body overflow on exit.
- Localize gesture guidance/navigation announcements in English/Vietnamese.
- Verify gesture state-machine and modal boundaries, render regressions, builds,
  types, lint and Prisma validation. Record real handset/authenticated gallery
  checks that cannot be run; unit evidence is not mobile performance acceptance.

Remaining full-MVP gates: live PostgreSQL/Drive folder access, ALB-001/005 import/
sync exposure, HEIC/RAW decoders, production infrastructure and PERF-007 evidence.

### Verification and requirement status

- Full repository: 68 files / 507 tests passed; nine real PostgreSQL tests in
  one suite skipped without TEST_DATABASE_URL. Thirty new tests cover gesture
  direction/threshold/timing/axis/multi-touch/zoom/cancellation, deliberate
  backdrop taps, localized lightbox markup and explicit selection controls.
- All six builds, TypeScript checks and lint passed; Prisma validation passed.
  After browser fixes, optimized web build/type compilation, full suite and
  lint were repeated. Tracked diff and phase-file whitespace checks passed.
- An isolated temporary loopback component fixture (not a public app route)
  verified English/Vietnamese controls, keyboard page edges, exactly one preview,
  Escape and backdrop dismissal, opener focus and body-overflow restoration.
  Browser testing exposed disabled-navigation focus loss and intrinsic image/
  grid overflow; both were fixed and rechecked. Mouse drag within/outside the
  stage did not navigate or dismiss; a deliberate outside tap did dismiss.
- Responsive fixture checks: 390×844 Vietnamese, 320×568 English and 844×390
  English had no horizontal/vertical content overflow and a nonzero preview
  stage. Browser warnings/errors were absent. QA screenshots were inspected.
  Temporary viewport overrides were reset and the tab/server were closed.
  The user's original browser tab/server and preferences were not changed.
- Real iOS/Android touches/pinch zoom, screen-reader output, protected-gallery
  provider reads and performance budgets were not exercised by this fixture.
  Unit tests prove gesture rules, not real handset or complete MVP acceptance.
- Fresh read-only running-API check: /health/live returned 200 and /health/ready
  returned 503. No existing database records, migrations, grants or credentials
  were changed; no live Google account was accessed.
- Implemented: mobile-gesture/modal-safety portions of GAL-004/005/006 with
  UX-001 localization and IMG-001/002, PERF-003 regression protection. These
  gallery requirements remain acceptance-partial until the real pilot checks.
- Deferred: ALB-001/005 import/sync (ADR-011/032 access gate), complete HEIC/RAW
  IMG-006, real SQL PERF-006 and device/network PERF-007, deployed infrastructure
  and OPS-003 restore/retention evidence. ADR-038 records the interaction policy.

Status: this coherent client-interaction phase is implemented and checked;
full MVP is not complete. Integration-gated work needs configured test/pilot
infrastructure and the approved folder-access/decoder decisions before proceeding.

---

## Active phase — 3A: enforced web/API browser security policy

Scope: SEC-005, AUTH-004, GAL-007, IMG-002/004 and UX-001 regression coverage.
Implement one coherent security phase; no OAuth scope, schema or live-data change.

- Read the installed Next.js CSP/Proxy documentation before implementation.
- Generate fresh cryptographic script nonces in Next Proxy and overwrite
  caller-supplied CSP/nonce headers before rendering. Apply policy to documents,
  RSC navigation/prefetch and Server Action requests without authentication in
  Proxy. Keep dynamic pages/no-store nonce responses; static assets retain caching.
- Restrict images/forms to validated public origins, never internal API/Drive
  origins. Permit the Google OAuth navigation origin for form redirects only.
  Keep development eval/WebSocket exceptions out of production script policy.
- Preserve required inline aspect-ratio styles explicitly without allowing
  inline scripts. Add framing/MIME/referrer/feature controls, and API same-site
  resource isolation without enabling credentialed cross-origin JavaScript reads.
- Verify policy/origin injection and nonce rotation, API success/error coverage,
  all repository checks and production HTTP/browser hydration/language switching.
  Record unavailable authenticated/real-gallery/HTTPS checks honestly.

Remaining full-MVP gates: live PostgreSQL/Drive folder access, ALB-001/005 import/
sync exposure, HEIC/RAW, production infrastructure/retention and PERF-007 evidence.

### Verification and requirement status

- Full repository: 66 files / 477 tests passed; one real PostgreSQL suite's
  nine tests skipped without TEST_DATABASE_URL. This phase introduced no schema
  migration or database fixtures beyond existing isolated SQL test coverage.
- New security tests cover production/development distinctions, random/canonical
  nonce generation, origin/header injection, missing production config, actual
  Next matcher behavior, prefetch/Server Action coverage, API success/parse/
  availability/not-found errors and image/304 resource-policy regressions.
- All six builds, TypeScript checks and source lint passed; Prisma validation
  and tracked/phase-file whitespace checks passed. After the last fail-closed
  config change, web production build/type compilation and lint passed again.
  Installed Next exported the old experimental matcher-test name despite its
  guide naming the newer function; tests use the verified installed export.
- Temporary production HTTP check on loopback 3120: 200 sign-in, seven scripts
  all nonced, matching CSP, nonce rotation, caller nonce rejected, no eval/
  powered-by, no-store documents, and 200 immutable cached static JavaScript.
- Production browser: English and Vietnamese Server Actions, client navigation
  to home, document lang=vi and original Vietnamese preference restored. No
  browser warnings/errors were recorded. A QA screenshot was captured. The
  temporary tab/server were closed; the user's original tab/server remained.
- Authenticated galleries, Google OAuth redirect, protected-image browser reads,
  mobile/HTTPS/edge proxy acceptance were not run. The visible sign-in remains
  unavailable without the API's database/auth runtime configuration; a policy
  check does not claim that live sign-in/import has been completed.
- Implemented: enforced web/API browser-policy portion of SEC-005 and regression
  protection supporting AUTH-004, GAL-007, IMG-002/004 and UX-001. Full SEC-005
  remains production-partial for deployed HTTPS/HSTS/edge/account verification.
- Deferred: ALB-001/005 import/sync gate, complete HEIC/RAW IMG-006, real SQL
  PERF-006 and device/network PERF-007, production infrastructure/retention.
  ADR-037 records the nonce caching/cost, style-attribute and OAuth redirect
  trade-offs without altering the accepted grant or original storage policy.

Status: one security phase implemented and verified as above; full MVP remains
incomplete. No live records, grants, credentials, deployment or git commits were
changed; existing dirty worktree changes were preserved.

---

## Active phase — 2Z: explicit OAuth-backed preview batches

Scope: DRIVE-015/016/017/018, IMG-004/006/007, DB-001, PROD-002,
SEC-001/002/004 and OPS-002. Complete one bounded processing phase without
exposing folder import/sync or changing the accepted Google grant.

- Add owner/catalog-bound, encrypted continuation over the existing photo
  sort index; read at most 26 narrow candidates in a short snapshot transaction.
- Process at most 25 photos serially outside transactions, using the real
  owner-scoped OAuth refresh boundary and existing original reader/publication.
  Stop on operational failures, cancellation or catalog changes; never skip a
  deferred item in continuation. Unsupported/failed files remain indexed.
- Provide an explicit operator command, not a public endpoint/background queue.
  Require configured private storage and an exclusive volume lock across
  invocations. Crash locks fail closed and need deliberate operator recovery.
- Recheck archive/ownership on publication writes and honor cancellation before
  publication. Keep originals ephemeral and logs free of credentials/filenames.
- Verify cursors, bounded/serial work, deferred retry, cancellation, isolation,
  lock cleanup and real raster/private-store composition. Run relevant builds,
  checks, tests and Prisma validation; record live checks that cannot run.

Full MVP remains gated on live PostgreSQL/Google folder access, approved
HEIC/RAW decoders, production storage/retention and device-network acceptance.
No existing database, Google grant or original file will be changed in this phase.

### Verification and requirement status

- Full repository suite: 63 files / 436 tests passed. Nine real PostgreSQL
  tests are explicitly skipped without TEST_DATABASE_URL, including the new
  owner batch continuation and archive/publication state regressions. Real
  SQL lock behavior/query plans are not claimed from mocked transaction tests.
- Focused media suite: 9 files / 105 tests passed. The real Google original
  reader/raster/private-store composition was exercised with simulated provider
  responses; no live Google account or grant was accessed. Cursor encryption/
  expiry/domain/binding, serial bounds, deferred retry, cancellation, archive
  state, crash locks and exact-argument confirmation are covered.
- All six builds, TypeScript checks and source lint passed, including the
  optimized Next build (type generation ran afterward, not concurrently).
  Prisma validation, tracked diff and all phase-file whitespace checks passed.
  Final source/test/documentation changes were inspected before handoff.
- Built CLI without arguments returned exit 1 and only the stable
  invalid-request error, before configuration/database/volume work. No actual
  album-processing command or migration was run against existing private data.
- Implemented offline: bounded OAuth-backed processing orchestration supporting
  DRIVE-015/016/017/018, IMG-004/006/007, DB-001, PROD-002 and SEC-001/002/004.
  These requirements remain full-product partial pending live verification and
  missing decoders. OPS-002 has stable command outcome logs but remains partial
  for production aggregation/capacity monitoring.
- Deferred: ADR-011/ALB-001/ALB-005 folder import/sync exposure, HEIC/RAW conversion,
  scheduler/multi-instance storage/retention, production edge/deployment/restore,
  PERF-006 SQL execution and PERF-007 device/network budgets.
- PostgreSQL guidance shaped narrow existing-index keyset reads and short
  publication locks, with no provider/decoder/storage I/O inside transactions.
  ADR-036 records quota, soft-deadline, crash-lock and migration limitations.

Status: processing phase implemented/offline verified; full MVP not complete.
Live setup remains documented in LOCAL_SETUP/OPERATIONS; unrelated dirty changes
were preserved. No commit/push, live original retention or Google scope expansion.

---

## Scoped maintenance — Prisma deployment environment

Fix `db:deploy` failing with a missing `datasource.url` when connection settings
are in the repository-root `.env`. Scope: DB-005, SEC-002/004; no schema or
product-phase changes. Preserve the operational-readiness work below.

- Resolve the root `.env` relative to the Prisma config, independent of cwd.
- Preserve exported values and DIRECT_DATABASE_URL over DATABASE_URL priority.
- Allow offline validation/generation without a database URL; never invent one.
- Verify environment resolution, database tests/types/lint and Prisma validation.
- Do not apply migrations to an existing database as part of verification.

### Verification and requirement status

- Database package: 4 test files / 13 tests passed, including 6 environment
  regression tests. Package typecheck, build TypeScript compilation, explicit
  config typecheck, and lint of both source and config passed.
- Prisma validation and client generation passed. Isolated validation/generation
  also passed with no `.env` or connection variables.
- Isolated `migrate status` confirmed datasource resolution from the root `.env`
  when run from the package directory. The intentionally unavailable dummy
  endpoint then returned an engine error; this is not live database proof.
- The existing root `.env` has both connection variables; neither was exported.
  Checked presence only, without logging credentials. The config now reads them.
- Package `db:validate` passed using `pnpm with current` (installed pnpm 12.6.0).
  Pinned pnpm 11.19.0 could not be verified/downloaded due registry access, so
  remaining checks used the installed dependency executables directly.
- Implemented/verified: environment-resolution fix supporting DB-005 and
  SEC-002/004. Full requirement completion is not claimed. Live deployment and
  PostgreSQL migration execution remain deferred; no existing database changed.
- Final config/source/test/documentation changes inspected; `git diff --check`
  passed. Existing unrelated work was preserved.

Status: configuration fix verified; live migration deployment not run.

---

## Active phase

Phase 2Y — operational readiness and release/incident procedures

## Goal and requirements

Close the remaining setup-independent operational work: safe infrastructure
readiness checks and documented backup/restore, release rollback, incident and
retention procedures. Scope: OPS-002/003, SEC-002/004, DB-005. A runbook is not a
completed restore drill, production deployment or live performance proof.

## Implementation and acceptance

- Separate process liveness from readiness. Readiness must check configured
  private workflow boundaries, current PostgreSQL schema and an existing private
  derivative volume without calling Google or reading originals/credentials.
- Bound database probes, coalesce/cache them briefly, redact failure details,
  and expose only a stable 200/503 status DTO.
- Include stable operation/error codes in existing structured request logs,
  particularly private export/selection/archive failures, without raw errors,
  URLs or secrets.
- Document managed backups versus logical restore drills, exact-target safety,
  additive migration rollback policy, key recovery/rotation risks, incident
  triage, indefinite archive retention, release gates and unmeasured targets.
- Add focused service/HTTP/storage tests and repeat checks. Do not perform
  backups/restores, deploy infrastructure, rotate keys or delete live data.

## Verification and requirement status

- Full repository suite: 59 files / 398 tests passed; the separate real SQL
  suite's seven tests are explicitly skipped without TEST_DATABASE_URL.
  Focused tests cover bounded/coalesced schema probes, storage privacy/no writes,
  narrow readiness HTTP, redacted operation/error logs and expired-sync archive.
- All six package/application builds and TypeScript checks, complete source
  and Prisma-config lint, Prisma validation, tracked/untracked phase-file
  whitespace checks passed. A parallel Next build/typegen check raced generated
  files; the web typecheck was rerun sequentially and passed after the build.
- Browser smoke: anonymous /workspace redirected to the unavailable sign-in
  screen; updated English home status copy appeared. Authenticated owner review,
  mobile clipboard/download and real Google consent were not browser-verified.
- Current private root configuration has database/auth/key settings (checked
  presence only, never values). Both configured direct and application database
  URLs failed permitted read-only SELECT probes. DERIVATIVE_STORE_ROOT and
  TEST_DATABASE_URL are unset. No database records/migrations or Google grants
  were modified; API startup still needs its private values exported.
- Implemented offline for this phase: readiness and stable redacted request
  operation/error logging (OPS-002/SEC-004), expired-sync archive recovery, and
  OPS-003 procedures. OPS-002/003 remain production-partial until aggregation,
  backups/scheduling, restore drills and recovery targets are configured/tested.
  SEC-002 and DB-005 support is verified without changing schema in this phase.
- Full MVP remains incomplete: ADR-011 folder-child access, ALB-001 import and
  ALB-005 sync exposure, OAuth-backed preview orchestration/HEIC/RAW decoding,
  production retention/deletion, PERF-006 live execution/PERF-007 device-network
  proof, edge security, deployment and real account/browser acceptance remain.
- Concurrent Prisma environment-loader/source/test changes were inspected and
  preserved; documentation matches their root-.env CLI fallback. Prior dirty
  changes were preserved. No commit/push, infrastructure install, key rotation,
  backup/restore or live-data deletion was performed.

Status: offline verified; live completion requires the documented setup and
unresolved scope/decoder decisions. See docs/LOCAL_SETUP.md and docs/OPERATIONS.md.

---

## Active phase

Phase 2X — repeatable CI and opt-in PostgreSQL correctness checks

## Goal and requirements

Provide the MVP foundation's missing automated release checks and a real
PostgreSQL integration harness for DB-001/004/005, SEL-002/004/005/008,
AUTH-004/PROD-002, ALB-006, EXP-001/002/003 and PERF-006 (dataset coverage,
not production device/network targets). OPS-003 remains a production runbook
gate, not claimed by CI.

## Implementation and acceptance

- Add a read-only-permission, pull_request/push GitHub Actions workflow using
  pinned official actions, Node 24, the repository pnpm version, frozen lockfile,
  ephemeral PostgreSQL and explicit migration/build/typecheck/lint/tests.
- Add an opt-in real database suite. Never use DATABASE_URL implicitly for test
  writes; require a separate TEST_DATABASE_URL for a loopback `_test` database.
  Isolate generated fixture rows and clean only those exact records.
- Verify concurrent selection caps/idempotent submits, composite album FKs,
  owner isolation and archive/running-sync behavior against PostgreSQL.
- Exercise gallery pages with 500/5,000 indexed records, record elapsed metadata
  timings without presenting them as production budgets or Drive performance.
- Add safety-guard tests and document local/CI invocation and skipped evidence.
  Do not install database services, push code, run cloud CI, or use live Google
  accounts without the required setup/authority.

## Verification and requirement status

- Full suite: 56 files passed / 383 tests passed; one real PostgreSQL suite /
  seven tests explicitly skipped because TEST_DATABASE_URL and a local server
  are unavailable. No SQL concurrency/migration/timing proof is claimed.
- Guard and migration-order regressions passed. CI YAML parsed successfully,
  official action tags were resolved to immutable commits, API build, database/
  API typechecks, complete lint and Prisma validation passed. All six builds/
  typechecks passed in the preceding owner-workspace verification.
- Implemented: CI foundation and explicit test targeting; harness coverage for
  DB-001/004/005, SEL-002/004/005/008, AUTH-004/PROD-002, ALB-006, EXP-001/002/003
  and PERF-006 datasets. These IDs remain live-verification partial until the
  PostgreSQL suite is actually executed. PERF-007 and OPS-003 remain deferred.
- Fixed undeployed migration ordering without changing SQL constraints. Exact
  cleanup removes only generated test fixtures; no live data was changed.
- Remote GitHub CI was not triggered, no code was pushed, no database service
  was installed, and no migration was applied. ADR-034 and LOCAL_SETUP document
  the commands, restrictions and independently-deployed history warning.

Status: offline verified; SQL/remote CI checks pending external setup.

---

## Active phase

Phase 2W — authenticated album dashboard and photographer selection delivery

## Goal and requirements

Expose existing indexed albums and selection domain operations through an
owner-authorized bilingual workspace. Scope: PROD-001/002, AUTH-001/004,
ALB-004/005/006 (archive only), SEL-003/010, EXP-001/002/003,
UX-001, PERF-003/005, DB-004/005 and SEC-001/004/005.

## Implementation and acceptance

- Add strict narrow shared owner album/review DTOs and opaque owner-bound,
  expiring cursors. Album pages use indexed createdAt/id keyset pagination.
- Review preserves inactive selected photographs in natural filename order;
  fetch only narrow ordering metadata for snapshot validation and at most 50
  comments per page. Reject changed snapshots instead of skipping selections.
- Authenticate every private route, enforce ownership in the database, check
  mutation origins and limits, and expose safe no-store errors.
- Add owner selection export, lock/reopen, and idempotent archive controls.
  Archive serializes on the same album row as guest mutations and sync, keeps
  metadata/selection history, and never deletes Drive files.
- Add English/Vietnamese album list and review screens with bounded rendering,
  unavailable/empty/stale states and explicit lifecycle controls.
- Test cursor tampering/expiry/binding, ownership, pagination, lifecycle HTTP,
  web boundary validation, and archive serialization. Run repository checks,
  inspect the diff and document measured/unverified limitations.

Album creation, folder Picker and sync exposure remain gated on ADR-011's live
folder-child access pilot. Deletion/retention, original downloads and HEIC/RAW
conversion are not silently included or presented as finished in this phase.

## Verification and requirement status

- Full repository suite: 54 files / 368 tests passed, including private HTTP
  ownership/origin/throttle/confirmation, natural-order inactive review,
  10,000-selection bounded payload, snapshot changes, thumbnail authorization,
  lifecycle/exports, bilingual rendering and Server Action checks. Supertest
  used a permitted temporary localhost listener.
- All six TypeScript checks, complete source lint, all six package/application
  builds, Prisma generation/validation and tracked diff checks passed. The
  production Next build includes the dynamic owner review route. No migration
  was deployed and no real Google/PostgreSQL/browser workflow was claimed.
- Implemented offline: ALB-004, SEL-010, EXP-001/002/003, owner lock/reopen
  SEL-003, archive-confirmation ALB-006 and AUTH-004/PROD-002 enforcement for
  these paths. ALB-005 partial: copy/open/review/export/archive implemented;
  sync and deletion/retention remain deferred. PROD-001/UX-001 remain partial
  for the complete workflow because album import is still gated.
- The PostgreSQL best-practices skill influenced the owner-first keyset index,
  narrow projections and short locked archive transaction. Review's O(n log n)
  metadata sort is explicitly documented, not presented as database keyset or
  measured production performance.
- OAuth/Google folder access, real row locking/query plans, mobile clipboard/
  download behavior, production derivative storage/retention and HEIC/RAW
  remain unverified/deferred. See docs/LOCAL_SETUP.md and ADR-033.

Status: offline verified; full MVP still awaiting the documented live gates.
No commit was created; pre-existing worktree changes were preserved.

---

## Active phase

Phase 2V — owner-bound Google Drive authorization and encrypted credentials

## Goal and requirements

Let an authenticated photographer explicitly connect and disconnect a Google
Drive account without combining Drive consent with sign-in. Scope:
PROD-001/002, AUTH-001/004, DRIVE-003/004/015, DB-005,
SEC-001/002/004/005, OPS-004, and UX-001.

## Implementation and acceptance

- Request only `drive.file` plus the identity claims needed to bind the granted
  Drive account, using offline access, S256 PKCE, state, nonce, and an encrypted
  owner-bound callback flow. Existing-folder child access remains a live scope
  pilot gate; this phase must not claim it is proven.
- Verify the Google account and granted scope, discard access/ID tokens, and
  encrypt the refresh token with a dedicated versioned AES-256-GCM key before
  persisting it. No plaintext token may enter logs, DTOs, browser storage, or
  database fields.
- Add owner-authorized connection status, connect, disconnect/revoke, and
  refresh-token-to-access-token boundaries. Invalid/revoked credentials become
  an explicit reauthorization state without exposing provider details.
- Add bilingual workspace connection controls and safe unavailable/error states.
  Do not add folder selection, albums, or sync routes in this phase.
- Add a reviewed Prisma migration, focused crypto/provider/service/HTTP/web
  tests, and run all typechecks, lint, builds, Prisma validation, and diff checks.
- Record the scope, token lifecycle, disconnect behavior, setup values, and
  remaining live Google/PostgreSQL gates in architecture and decisions.

## Verification

- The Drive grant is a separate owner-session-bound OAuth flow using S256 PKCE,
  state, nonce, offline consent, verified Google identity, and the exact
  `drive.file` grant. It rejects missing grants and any broader Drive scope.
- Refresh tokens are encrypted nondeterministically with a dedicated
  versioned AES-256-GCM key and owner/account authenticated data before the
  database write. Access and ID tokens are discarded. Tests cover tampering,
  owner swapping, key/version mismatch, plaintext absence, revoked versus
  transient refresh failures, and undecryptable-token disconnect cleanup.
- Owner-authenticated no-store routes list narrow connection DTOs, start and
  complete consent, and disconnect with exact Origin/Referer enforcement.
  Callback redirects are fixed, HTTPS uses `__Host-` Secure cookies, expired
  owner sessions fail closed, and provider failures never enter responses.
- The bilingual workspace shows connection/reconnect/disconnect and honest
  scope-pilot/error states. Its server bridge forwards only the owner session
  cookie and rejects malformed credential-bearing responses.
- Full repository suite: 47 test files / 321 tests passed. All six TypeScript
  checks, source lint, shared/UI/database/Google Drive/API builds, the optimized
  Next.js production build, Prisma generation/validation, secret-fixture scan,
  trailing-whitespace scan, and `git diff --check` passed. API HTTP tests used
  a permitted temporary loopback listener after the sandbox blocked Supertest.

## Requirement status at completion

- Implemented offline for this phase: owner-bound AUTH-001/004 and PROD-002
  enforcement, provider isolation in DRIVE-003, encrypted credential lifecycle
  and narrow-scope request for DRIVE-004, safe Drive failure states for
  DRIVE-015/OPS-004, the DB-005 migration, and relevant SEC-001/002/004/005
  controls.
- Partial PROD-001 and UX-001: the bilingual private workspace can manage Drive
  connection state, but folder selection, album creation and dashboard tools
  intentionally remain closed.
- ADR-011 remains unresolved by design: official documentation recommends
  `drive.file` but does not prove access to every pre-existing child of a
  selected folder. No broader restricted scope was introduced silently.
- Live validation remains blocked by external setup: no PostgreSQL instance,
  Google OAuth client, Drive API project, or real account is available here.
  The migration was validated but not deployed; consent, refresh, revocation,
  two-account isolation, and Picker/folder access are not claimed as live-
  verified. Exact setup is recorded in `docs/LOCAL_SETUP.md`.

Status: offline verified; live Google Drive/PostgreSQL scope pilot pending.
No commit was created, and all pre-existing worktree changes were preserved.

---

## Active phase

Phase 2U — Google photographer sign-in and database sessions

## Goal and requirements

Implement Google identity sign-in independently of Drive authorization, so
the private workspace has a real authenticated owner. Scope: AUTH-001/002/004,
PROD-001/002, SEC-001/002/004/005, DB-005, and UX-001.

## Implementation and acceptance

- Use Google's maintained authentication library for code exchange and ID
  token verification; request only OpenID identity scopes in this phase.
- Protect callback correlation with short-lived encrypted state/nonce/PKCE
  cookies; never accept identity or owner IDs supplied by the browser.
- Persist random owner sessions as hashes in PostgreSQL, support expiry and
  logout, and require configured same-host origins and secure cookies.
- Provide bilingual sign-in and authenticated workspace entry screens with
  explicit unavailable/error states. No fabricated albums or Drive connection.
- Test invalid callback/session, account isolation, configuration and HTTP
  behavior; run typechecks, lint, builds and Prisma validation.
- Document exact setup values and callback URL. Live Google/account validation
  requires configured external credentials and remains separately reported.

Drive consent/refresh tokens, album management and HEIC/RAW remain later
implementation phases within the requested MVP completion work.

## Verification

- Google sign-in uses `google-auth-library` for authorization-code exchange
  and cryptographic ID-token verification. Focused tests cover PKCE/scopes,
  signature, issuer, audience, expiry, nonce, `azp`, and verified-email
  failures without exposing provider details.
- Login correlation is a ten-minute AES-GCM state/nonce/verifier cookie.
  Photographer identity is keyed only by Google's stable `sub`. Owner sessions
  use random 256-bit tokens, persist only SHA-256 hashes, expire after twelve
  hours, rotate on login, and are deleted on logout.
- The API exposes same-origin guarded login/logout, a no-store session status
  endpoint, and a fixed callback redirect. The web app adds localized EN/VI
  sign-in and authenticated workspace entry pages and forwards only the
  narrowly scoped owner cookie from its server boundary.
- The Prisma migration and schema validate. Full repository suite: 40 test
  files / 285 tests passed. All six TypeScript checks, source lint, shared/API/
  database/Google Drive builds, the optimized Next.js production build, and
  `git diff --check` passed.
- The production sign-in page was rendered locally. An HTTP Server Action
  check confirmed the Vietnamese switch returns `lang=vi` and an HttpOnly,
  SameSite=Lax locale cookie without an invalid Secure flag on loopback HTTP.

## Requirement status at completion

- Implemented offline: the AUTH-001/002/004 session foundation, DB-005
  photographer-session model/migration, and the SEC-001/002/004/005 controls
  in this phase.
- Partial PROD-001/002 and UX-001: bilingual sign-in/workspace entry exists,
  but the private album workspace is intentionally not fabricated before
  Drive authorization and album management are implemented.
- Live validation remains blocked by external setup: a PostgreSQL instance and
  Google OAuth web client credentials are not present. Therefore no migration
  was deployed and no real Google account callback/session was claimed as
  verified. Exact local setup and callback values are in `docs/LOCAL_SETUP.md`.

Status: offline verified; live Google/PostgreSQL pilot pending external
credentials. No commit was created, and all pre-existing worktree changes were
preserved.

---

## Active phase

Phase 2T — photographer selection review lifecycle (offline verified; private HTTP/live pilot pending)

## Goal

Complete the owner-side selection status policy before exposing private routes:
only the album owner may lock a submitted selection or reopen a submitted/locked
selection, with the same album row serialization used by guest mutations.
Exports must remain available after locking and stop being available after
reopening; review must preserve selected inactive photos and comments.

## Requirement IDs

- PROD-002, AUTH-001 — ownership checks are mandatory; HTTP exposure waits for
  real photographer authentication.
- SEL-003/008/010 — explicit status lifecycle and owner review.
- EXP-001/002/003 — submitted-or-locked snapshot export, natural order, no
  inference from photo state.
- ALB-005 — owner review/export and lock/reopen policy.

## In scope

- Transaction-safe owner lock/reopen methods and corrected locked export policy.
- Focused state/ownership/concurrency-order tests, decision/docs update, and
  repository verification.

## Out of scope

- Google sign-in, Drive OAuth scope choice, owner HTTP/UI, live PostgreSQL
  concurrency proof, and production deployment.

## Acceptance criteria

- [x] Unauthorized or missing albums never mutate selection state.
- [x] Lock is idempotent after submission; reopen clears submission time and
  makes export unavailable until a new submission.
- [x] Owner operations serialize with guest selection mutations on the album
  row; locked export keeps one filename per line in natural order.
- [x] Tests, typechecks, lint, builds, Prisma validation, and diff checks pass
  or limitations are recorded.

## Verification log

`SelectionService.lockForOwner` and `reopenForOwner` check ownership and
publication inside a transaction with `SELECT ... FOR UPDATE` on the album
row, the same serialization point guest mutations use. Lock requires a
submitted selection, is idempotent, preserves `submittedAt`, and sets
`lockedAt`. Reopen clears both timestamps and returns to draft. Export accepts
only an explicitly submitted or locked selection with a submission timestamp;
archived albums remain reviewable/exportable but cannot change status. Added
owner, state, lock-query, archive, export, and reopen tests. ADR-030 records
the policy; ADR-011 now records the current Drive scope evidence and unresolved
Picker-folder child-access gate.

Full repository suite: 34 files / 254 tests passed. All six TypeScript
checks, API and Next.js builds, source lint, Prisma validation, and
`git diff --check` passed. No live PostgreSQL transaction test, Google Drive
scope pilot, authenticated private route, or browser workflow test was
possible in this environment. Existing pre-phase untracked files were
preserved; no commit was created.

## Requirement status at completion

- Partial PROD-002/AUTH-001: service verifies owner IDs under the DB lock,
  but Google sign-in/secure owner session and private HTTP route do not exist.
- Partial SEL-003/008/010 and ALB-005: domain lifecycle and review exist,
  but owner UI/API and live concurrency validation remain.
- Partial EXP-001/002/003: domain export enforces completed state and natural
  order, including locked selections; authenticated `text/plain` download and
  pilot verification remain.

---

## Active phase

Phase 2S — bilingual client selection controls (offline verified; live pilot pending)

## Goal

Make the guest selection API usable from the bounded gallery page: show the
authoritative total/current-page selected state, select/deselect and comment
on a photo, confirm submission, and show the submitted/locked state.

## Requirement IDs

- GAL-004/005/006 — mobile-friendly selected states, count, and lightbox flow.
- SEL-004/006/007/008/009 — backend-authoritative limit/count, comments,
  deselection, two-step confirmation, and submitted status.
- UX-001 — all new controls, status, and error copy in English/Vietnamese.
- SEC-001/004/005 — server actions validate input and forward only the scoped
  HttpOnly gallery session with exact configured origin; no password/token in
  client props.
- PERF-003/005 — one 50-photo page and a narrow selected-item state response.

## In scope

- Server-only selection state fetch/action bridge and client controls in the
  existing gallery viewer.
- Localized copy, responsive styles, focused tests, and full verification.

## Out of scope

- Photographer dashboard/review/export, multiple selection lists, client
  accounts, live PostgreSQL/mobile performance proof, and production shared
  abuse control.

## Acceptance criteria

- [x] The page shows authoritative total count and only current-page selected
  items; mutations use the API and reconcile responses without client-only
  claims of success.
- [x] Submitted/locked selections reject edits in the UI, confirmation is
  explicit, and failures are localized without leaking credentials.
- [x] Tests, typechecks, lint, builds, Prisma validation, and diff checks pass
  or limitations are recorded.

## Verification log

- The gallery page fetches a narrow selection response for only its displayed
  photo IDs. Server actions validate a discriminated mutation DTO and forward
  only the matching HttpOnly gallery cookie plus configured web Origin to the
  API. The client grid/lightbox shows selected states and authoritative total
  count/limit, lets draft visitors select/deselect and save comments, disables
  new selects at the limit while preserving deselection, asks for a separate
  confirmation before submit, and displays submitted/locked states. Failed
  mutations do not update local selection state. All new copy is EN/VI.
- Six new tests cover bounded state fetch, scoped cookie/origin mutation
  forwarding, safe error handling, draft/submitted/locked markup, and
  at-limit deselection behavior. Full repository suite: 34 files / 252 tests
  passed. All six TypeScript checks, API and Next.js builds, source lint,
  Prisma validation, and diff checks passed.
- The React interaction path is not browser-automated in the current Node-only
  harness. No live PostgreSQL/gallery exists for a mobile-device or
  concurrent-visitor run. Selection state on a long-lived page can become
  stale when another visitor edits the one shared MVP selection; a conflict
  prompts refresh and all mutations remain backend-authoritative.

## Requirement status at completion

- Partial GAL-004/005/006: selected state/count and controls work in a bounded
  responsive page; swipe gestures and live device QA remain.
- Partial SEL-004/006/007/008/009: UI calls backend for limits/comments/submit
  and confirms before submit; live concurrency and browser workflow proof
  remain.
- Partial UX-001: all selection copy is bilingual; photographer workspace UI
  still needs localization.
- Partial SEC-001/004/005: server actions validate inputs and only forward the
  scoped cookie; deployment CSRF/CSP proof remains.
- Partial PERF-003/005: at most 50 gallery cards and selected page items are
  mounted/returned, but representative device/network measurements remain.

---

## Active phase

Phase 2R — authorized guest selection API (offline verified; web/live integration pending)

## Goal

Expose the existing transaction-safe single-selection service through
gallery-slug routes, with publication/password-session checks, a bounded
current-page state response, strict origin checks, and pilot mutation limits.
Keep owner IDs and internal album IDs out of public DTOs.

## Requirement IDs

- SEL-001/002/003/004/005/006/007/008 — preserve the existing transaction
  semantics while making select/deselect/comment/submit reachable safely.
- GAL-002/007 — published/password-authorized gallery only; no private IDs.
- SEC-001/003/004/005 — validate all inputs, limit public mutations, never
  log comments or cookies, and reject cross-origin mutation requests.
- PERF-005 — only current-page selected items and count in guest state.

## In scope

- Guest selection facade and narrow shared state DTO.
- Read/mutation routes with origin and per-process pilot mutation limiter.
- Service/HTTP tests and full verification; decision/documentation updates.

## Out of scope

- Web selection controls/confirmation, owner review/export HTTP, distributed
  abuse protection, photographer auth/OAuth, and live PostgreSQL concurrency
  proof.

## Acceptance criteria

- [x] Protected and unpublished galleries cannot read or mutate selection
  without authorization; public responses include no album/owner IDs.
- [x] Valid select/deselect/comment/submit calls delegate to the existing
  concurrency-safe service, with Zod and same-origin/rate gates.
- [x] Tests, typechecks, lint, builds, Prisma validation, and diff checks pass
  or limitations are recorded.

## Verification log

- Added shared narrow selection DTOs and `SelectionService.stateForGuest`,
  which returns total count/status plus selected comments only for at most 50
  requested current-page photo IDs. A gallery-slug facade checks published
  state and the current password-bound session before translating to a private
  album ID. It delegates select/deselect/comment/submit to the existing
  album-row-locking transaction methods; no `Photo.isSelected` or owner ID is
  exposed. Routes validate params/query/body and exact web Origin/Referer for
  mutations, with a single-process 60/minute address/gallery pilot limiter.
  ADR-029 records the single-selection and production trade-offs.
- Eleven new tests cover narrow state, authorization/rotation, malformed and
  duplicate page IDs, route dispatch, conflict envelopes, and mutation
  throttling. Full repository suite: 33 files / 246 tests passed. All six
  TypeScript checks, API build, lint, Prisma validation, and diff checks
  passed. Next.js build passed at the end of Phase 2Q; web source did not
  change in this phase.
- No web selection controls, submitted confirmation, owner review/export
  route, live PostgreSQL concurrency measurement, or shared production abuse
  limiter exists yet. A password change racing an already-authorized mutation
  remains a documented narrow window.

## Requirement status at completion

- Partial SEL-001/002/003/004/005/006/007/008: model/service and guest API
  paths exist; UI, live concurrency proof, and final workflow remain.
- Partial GAL-002/007: facade enforces published/password session and public
  DTO excludes private IDs; no live session/database run yet.
- Partial SEC-001/003/004/005: Zod, origin checks, safe logs, and pilot limiter
  are in place; distributed controls and deployment CSRF validation remain.
- Partial PERF-005: selected items are scoped to at most 50 requested photo
  IDs, but query-plan and real-size payload measurements are pending.

---

## Active phase

Phase 2Q — bilingual protected-gallery unlock on the web (offline verified; live pilot pending)

## Goal

Show a localized password form for a protected gallery, prove the password via
the API from a server action, keep the session in an HttpOnly cookie, and
forward only that gallery cookie during server-rendered metadata fetches.

## Requirement IDs

- GAL-002/003/004 — protected gallery remains hidden until proof, then uses
  the existing mobile-friendly grid/lightbox.
- UX-001 — English/Vietnamese form, errors, and accessible controls.
- SEC-001/004/005 — validate form values and cookie tokens, keep password out
  of URLs/logs/client state, use same-host cookie policy.
- IMG-001/002/004 — unlocked gallery still requests only generated derivatives.

## In scope

- Server action and protected gallery form/statuses.
- Server-only cookie forwarding to the API metadata route and focused tests.
- Web/API docs and full verification.

## Out of scope

- Photographer auth/album creation, selection mutations, cross-site deployment,
  live browser/PostgreSQL/Drive validation, and distributed rate limiting.

## Acceptance criteria

- [x] The protected page reveals no photo list until a valid password session
  is present; success redirects to the same gallery without password in URL.
- [x] Incorrect/limited/unavailable states are localized and session tokens
  stay HttpOnly and scoped to the exact gallery.
- [x] Tests, typechecks, lint, builds, Prisma validation, and diff checks pass
  or limitations are recorded.

## Verification log

- The protected page now renders a bilingual accessible password form, not a
  photo list. A Next server action validates the form, sends the password only
  in a no-store API POST body, maps safe error statuses, copies only the opaque
  session token into a host-only HttpOnly/SameSite cookie, and redirects to the
  same gallery without a password in the URL. Later server-rendered metadata
  requests forward only that gallery's validated cookie; same-host browser
  image requests carry it to the API. The form uses generated derivatives just
  like passwordless galleries after authorization.
- Shared cookie naming, expiry, and Zod password validation avoid web/API
  drift. Five new tests cover password-body-only POST, safe error mapping,
  origin/cookie rejection, HTTPS secure behavior, and scoped metadata cookie
  forwarding. Full repository tests passed: 30 files / 235 tests. All six
  TypeScript checks, API and Next.js builds, source lint, Prisma validation,
  and diff checks passed.
- No live protected album or configured PostgreSQL/Google account is available
  for browser-on-device interaction. The current per-process limiter and
  same-host cookie model are pilot-only; production gateway abuse controls,
  trusted-proxy behavior, and live CSRF/cookie policy validation remain open.

## Requirement status at completion

- Partial GAL-002/003/004: protected unlock and responsive browsing are wired,
  but album creation/password update and live protected-gallery proof remain.
- Partial UX-001: form, guidance, and errors are bilingual; future workspace
  and selection screens still require localization.
- Partial SEC-001/004/005: Zod boundary and scoped HttpOnly cookie forwarding
  are present; production CSP, proxy, CSRF for future mutations, and live
  deployment validation remain.
- Partial IMG-001/002/004: authorized gallery still uses only stored generated
  derivatives; no original route exists or live visual QA was possible.

---

## Active phase

Phase 2P — protected-gallery API session gate (offline verified; web/live integration pending)

## Goal

Let a client prove a published gallery password once, receive a short-lived
HttpOnly same-site cookie, and use it for metadata and generated derivatives.
Keep owner/private data hidden and preserve the passwordless path.

## Requirement IDs

- GAL-002/003/007 — password proof gates both list and image bytes without
  exposing owner IDs or Drive details.
- SEC-001/003/004/005 — validate input, throttle public password attempts,
  avoid logging secrets, and define cookie/origin policy for this pilot path.
- IMG-001/002/004 — protected reads still serve only revision-checked stored
  derivatives, never Drive originals.

## In scope

- An AEAD gallery-session codec bound to album ID/password hash and expiry.
- A bounded in-memory pilot attempt limiter and strict origin check on the
  password POST; HttpOnly/SameSite cookie issuance.
- Session checks in gallery listing and image services and HTTP routes.
- Focused tests, ADR and API documentation, full verification.

## Out of scope

- Web password form and SSR cookie forwarding, photographer auth/album creation,
  distributed rate limiting, cross-site deployment, CSRF on future mutations,
  live database/Drive validation.

## Acceptance criteria

- [x] Without a valid current session, protected metadata and derivatives are
  denied; passwordless galleries behave as before.
- [x] Password POST is input/origin checked, throttled before expensive scrypt,
  and returns only a cookie or generic safe error.
- [x] Tests, typechecks, lint, builds, Prisma validation, and diff checks pass
  or limitations are recorded.

## Verification log

- Added a dedicated-key AES-GCM gallery-session codec (12-hour expiry) bound to
  album ID, slug, and current password-hash fingerprint. Per-gallery host-only
  HttpOnly, SameSite=Lax cookies use `Secure` on HTTPS and allow HTTP only for
  loopback pilot origins. Duplicate/malformed cookies fail closed.
- The optional password POST validates Zod input and web Origin/Referer, then
  applies a bounded single-process five-attempt/15-minute per-IP+gallery
  limiter and four-concurrent-scrypt cap before verification. Protected list
  and stored-derivative reads recheck the current album password hash; missing,
  rotated, tampered, and expired sessions are denied. Passwordless access is
  unchanged. ADR-028 documents same-host deployment and production gaps.
- Eighteen new tests passed across codec, limiter, proof service, route,
  protected listing/image checks, and runtime config. Full repository suite:
  29 files / 230 tests passed. All six TypeScript checks, API build, source
  lint, Prisma schema validation, and `git diff --check` passed. The earlier
  Next.js build remains valid because no web source changed in this phase.
- No browser password form/cookie forwarding, live PostgreSQL/Drive test, or
  distributed limiter exists. The route must not be exposed beyond a local or
  single-instance pilot without a gateway/shared abuse policy and measured
  proxy address behavior. No album-create flow writes a password hash yet.

## Requirement status at completion

- Partial GAL-002/003/007: API password proof gates protected reads and emits
  no owner/Drive data, but the web unlock and album creation flows are absent.
- Partial SEC-001/003/004/005: input, origin, cookie, and in-process throttles
  are present; distributed abuse control, full future-mutation CSRF policy,
  and deployment validation remain pending.
- Partial IMG-001/002/004: protected image reads still use only current stored
  derivative pairs; real browser/live-storage behavior is unverified.

---

## Active phase

Phase 2O — gallery password hashing boundary (offline verified; access integration pending)

## Goal

Provide a slow, salted, versioned password hash/verify module for future
protected-gallery creation and access. Do not expose a password route or mark
protected galleries browsable before rate limiting, session cookies, and
authorization checks are implemented together.

## Requirement IDs

- GAL-002/003 — protected content stays closed; gallery passwords must be
  hashed, never stored in plaintext.
- SEC-001/002/003 — validate password inputs, exclude secrets from outcomes,
  and keep online guessing closed until rate limiting is present.

## In scope

- A bounded async scrypt module with unique random salt, fixed work factors,
  versioned storage format, and timing-safe hash comparison.
- Tests for correct/incorrect, empty/oversized, malformed stored hashes, and
  salt uniqueness; documented decision and full verification.

## Out of scope

- Password submission endpoint, session cookie, gallery access, album create
  flow, password reset, distributed rate limiting, live database/OAuth.

## Acceptance criteria

- [x] No plaintext password is emitted or stored by this module; supported
  hashes verify correctly and malformed values fail closed.
- [x] No protected gallery is opened by this phase.
- [x] Tests, typechecks, lint, builds, Prisma validation, and diff checks pass
  or limitations are recorded.

## Verification log

- Added a server-only versioned scrypt hash/verify module with 16-byte random
  salt, fixed N=2^15/r=8/p=3 work factors, a 32-byte derived key, 1024-byte
  input cap, canonical encoding, and timing-safe comparison. The database
  already has `Album.passwordHash`; no schema change or route was added.
  ADR-027 records the choice and the online-attempt/concurrency risk.
- Three focused tests cover salt uniqueness, exact and wrong guesses, input
  limits, malformed/noncanonical hashes, and rejection of arbitrary high-cost
  parameters. Full repository tests passed: 25 files / 212 tests. API build
  and typecheck, source lint, Prisma validation, and diff checks passed. The
  other five package/app typechecks and Next.js build passed immediately in
  Phase 2N; no code in those units changed afterward.
- No protected-gallery request route, rate limiter, signed session, CSRF/cookie
  policy, or live database test exists yet. The hash module is not wired into
  album creation, so GAL-003 is only a tested storage primitive, not a complete
  password workflow. The public passwordless/image routes still reject
  protected galleries.

## Requirement status at completion

- Partial GAL-002/003: password storage and verification logic exists, but no
  protected-gallery access or create/update integration exists.
- Partial SEC-001/002/003: bounded validation and no secret logging are present
  in this module; a public password endpoint must be rate-limited and hardened
  before protected access can open.

---

## Active phase

Phase 2N — paginated gallery grid and lightbox (offline verified; live gallery QA pending)

## Goal

Turn the existing bounded passwordless gallery page into a responsive photo grid
with an accessible preview lightbox. Keep the page server-rendered except for a
small client viewer, and load only application-generated thumbnails/previews.

## Requirement IDs

- GAL-004/005/006 — mobile-friendly grid, filename, lightbox, keyboard and
  touch-friendly navigation (selection state remains a later phase).
- IMG-001/002/004/005 — use the application image descriptors and never load a
  Drive original or add a full-resolution route.
- PERF-002/003/004 — lazy thumbnail loading, at most one open preview, current
  page only, and reserved image space.
- UX-001 — localize all new English and Vietnamese controls and status copy.

## In scope

- A bounded client-side grid/viewer with native dialog semantics, keyboard
  navigation, explicit previous/next/close buttons, and safe image fallback.
- Responsive styles and focused tests; full repository verification.

## Out of scope

- Selection, protected gallery session, pagination-wide lightbox, swipe
  gestures, photographer authentication, automatic preview processing, and
  live device/network performance measurement.

## Acceptance criteria

- [x] Only current-page generated thumbnails are rendered; one preview mounts
  while the dialog is open; unpreviewable photos remain readable.
- [x] Keyboard and visible controls navigate within the page and close/restore
  focus; all added copy is bilingual.
- [x] Tests, typechecks, lint, builds, Prisma validation, and diff checks pass
  or limitations are recorded.

## Verification log

- The server still fetches one 50-photo page; a small client viewer receives
  only that page's DTOs. Cards use application-generated thumbnail descriptors
  with lazy loading and reserved aspect ratios. Missing/failed thumbnails show
  a readable localized fallback. A native modal dialog mounts only the active
  preview and has Escape, arrow-key, visible previous/next/close controls,
  bounded navigation, and opener focus restoration.
- Three new viewer tests cover server-rendered bounded markup, localized
  controls/fallbacks, and navigation boundaries. Full repository tests passed:
  24 files / 209 tests. All six TypeScript typechecks, source lint, Next.js
  webpack build, Prisma validation, and `git diff --check` passed.
- No published album with generated derivatives was available for live browser
  interaction, image failure, or mobile-device QA. Swipe gestures, full
  selection UI, password sessions, and 500/5,000-photo measurements remain
  deferred. The native dialog's keyboard/focus behavior is implemented but not
  browser-automated by the current Node-only test harness.

## Requirement status at completion

- Partial GAL-004/005/006: responsive grid and lightbox/keyboard controls are
  implemented; selection state/count and swipe gesture are not.
- Partial IMG-001/002/004/005: the viewer consumes only derivative descriptors,
  mounts one preview, and has no original route; live delivery is unverified.
- Partial PERF-002/003/004: lazy current-page thumbnails, a single preview,
  and reserved ratios are present; realistic device/network proof is pending.
- Partial UX-001: all new viewer text and controls have English/Vietnamese
  copy; future workspace/selection screens still need localization.

---

## Active phase

Phase 2M — passwordless gallery derivative delivery (offline verified; pilot integration pending)

## Goal

Expose only revision-matched, stored WebP thumbnail/preview derivatives for
published passwordless galleries through an application image contract. Render
lazy thumbnails in the bounded web gallery page. Protected galleries remain
closed until a password-session phase.

## Requirement IDs

- GAL-001/002/004/007 — published passwordless gallery access only; no owner,
  Drive ID, or protected-gallery image leakage.
- IMG-001/002/004/005/006/007 — browser gets application descriptors and
  stored derivatives, never original-resolution Drive bytes.
- PERF-001/002/003/004/005 — preserve 50/100-item pagination, lazy thumbnails,
  reserved aspect ratio, and narrow payloads.
- DRIVE-018, SEC-001/004 — reject stale revision URLs, validate route inputs,
  and return safe failure envelopes without revealing store paths.

## In scope

- An optional server-side `ImageUrlProvider` descriptor implementation.
- A passwordless-only derivative read service and HTTP route with conservative
  cache/revalidation headers.
- Shared DTO and web-gallery thumbnail rendering that uses descriptors.
- Focused service, route, contract, and web tests; full verification.

## Out of scope

- Password gallery session, photographer auth/OAuth composition, automatic
  processing trigger, CDN/shared-object-store deployment, lightbox, selections,
  and live performance/Drive/database integration.

## Acceptance criteria

- [x] Only an active READY photo in a published passwordless album whose
  source/preview revisions match can return stored derivative bytes.
- [x] Descriptor URLs are application-owned; stale tokens, protected galleries,
  missing/corrupt files, and invalid requests fail safely.
- [x] The web gallery lazy-loads only current-page thumbnails and keeps all
  other states readable without requesting originals.
- [x] Tests, typechecks, lint, builds, Prisma validation, and diff checks pass
  or limitations are recorded.

## Verification log

- Added `ApiDerivativeImageUrlProvider` with versioned application paths and
  nullable image descriptors in the shared gallery DTO. The list emits them
  only when READY and source/preview revisions match, and only when the
  derivative store is configured. No Drive URL or source revision appears.
- Added passwordless `GalleryImageService` and a read-only HTTP route. The
  indexed query requires published, passwordless, active, revision-matched
  photos before reading a stored derivative. Stale URLs return 404; missing or
  corrupt storage returns a sanitized 503. `private, no-cache`, ETag, and
  `nosniff` allow private revalidation without a shared immutable cache.
- The localized web index resolves application descriptors against a
  configured browser-reachable API origin and lazy-loads only the current
  50-item page's generated thumbnails. Invalid public origin suppresses images
  while preserving metadata. It never constructs a Drive URL.
- Twenty-three new tests passed across descriptor gating, image service,
  route, real filesystem delivery, runtime configuration, and web URL safety.
  Full repository tests: 23 files and 206 tests passed. Typechecks, lint,
  Prisma validation, API build, Next.js webpack build, and diff checks passed.
- No live database, Drive/OAuth account, configured persistent volume,
  browser-on-device performance run, production egress measurement, or
  protected-gallery session was available. The UI still lacks a lightbox,
  selection, and per-image retry/fallback behavior.

## Requirement status at completion

- Partial GAL-001/002/004/007: a passwordless published gallery has bounded
  derivative access and lazy thumbnails; protected access and complete mobile
  proofing remain deferred.
- Partial IMG-001/002/004/005/006/007: only stored browser-safe derivatives
  reach the browser through an app descriptor, not Drive originals. Production
  delivery/storage and HEIC/RAW coverage remain unresolved.
- Partial PERF-001/002/003/004/005: pages remain bounded and images lazy with
  fixed thumbnail boxes; realistic device/network and 5,000-photo measurements
  are still required.
- Partial DRIVE-018 and SEC-001/004: source revision and route inputs are
  checked, and storage errors are sanitized; live invalidation and full HTTP
  security policies remain pending.

---

## Active phase

Phase 2L — revision-safe derivative publication (offline verified; runtime integration pending)

## Goal

Persist only generated WebP thumbnail/preview pairs in an explicit private
filesystem derivative root for a single-instance pilot, then set `Photo`
preview state to READY only when the indexed Drive source revision still
matches. Keep browser delivery and OAuth composition out of this phase.

## Requirement IDs

- DRIVE-001/002/018 — originals remain in Drive; derivative pairs are keyed
  to source revision and stale processing cannot become READY.
- DB-001, DRIVE-017 — PostgreSQL holds processing state, not image bytes; one
  unsupported/failed photo records a safe per-photo state.
- IMG-001/004/005/006/007 — store only bounded browser-safe derivatives behind
  a swappable store, never originals or a public full-resolution route.
- PROD-002, SEC-001/002/004 — owner-check the internal request, validate
  storage keys, and keep provider details and secrets out of state/logs.

## In scope

- A private filesystem `DerivativeStore` implementation with atomic pair
  publication, bounded reads, content checks, and no original-byte storage.
- An owner-scoped one-photo service that reads/prepares, publishes the pair,
  and conditionally commits READY against the current source revision.
- Safe outcomes for stale, unsupported, failed, and deferred processing.
- Focused unit tests and filesystem tests, plus repository-wide verification.

## Out of scope

- OAuth/token acquisition, HTTP triggering, scheduler/concurrency queue,
  public descriptors/serving, production shared object storage, retention/GC,
  HEIC/RAW decoders, and live PostgreSQL/Drive validation.

## Acceptance criteria

- [x] READY is never committed before both derivatives are durable and the
  photo still has the same active source revision.
- [x] An initially unauthorized or missing photo does not fetch Drive bytes;
  a photo superseded during processing cannot commit READY, and expected
  per-photo failures are sanitized.
- [x] All relevant tests, typechecks, lint, builds, Prisma validation, and
  diff checks pass or limitations are recorded.

## Verification log

- Added `FileSystemDerivativeStore` behind `DerivativeStore`: explicit private
  absolute root, revision-hashed keys, bounded WebP-only bytes, content hashes,
  private staging files, file/directory sync, and atomic pair-directory rename.
  Reads check the manifest and requested file. Originals are never written.
- Added owner-scoped `PreviewPublicationService`. It obtains an indexed active
  photo under the owner predicate, prepares one photo, publishes both outputs,
  then uses `updateMany` compare-and-set on active source revision before READY.
  Stale/unsupported/failed/deferred outcomes set safe per-photo state without
  overwriting a concurrent READY. A missing or stale stored READY pair is
  invalidated when encountered. No route or scheduler invokes the service yet.
- Eighteen new tests passed for private-store publication/read/corruption,
  owner gating, revision races, safe error states, READY reuse/invalidation,
  and a real store + renderer path before database commit. Full repository
  tests: 21 files and 183 tests passed.
- Typechecks passed for all six packages/apps. API TypeScript build, source
  lint, Prisma schema validation, Next.js webpack production build, and
  `git diff --check` passed. No schema migration was needed.
- No live PostgreSQL, OAuth, Drive, persistent deployment volume, multi-
  instance/shared-store test, throughput benchmark, crash-recovery test, or
  retention/garbage-collection policy was available. Filesystem publication
  and database READY update are not one transaction; the revision key and
  serving-time check required by ADR-025 contain but do not remove that gap.

## Requirement status at completion

- Partial DRIVE-001/002/018: only generated derivatives are stored and READY
  uses an active source-revision compare-and-set; old revisions are not yet
  garbage-collected and live invalidation has not been exercised.
- Partial DB-001 and DRIVE-017: PostgreSQL receives state/error codes, not
  image bytes, and unsupported/failed outcomes are per-photo; live DB and
  HEIC/RAW processing remain outstanding.
- Partial IMG-001/005/006/007: bounded WebP pairs can be stored behind a
  replaceable interface for a single-instance pilot. IMG-004 remains satisfied
  in this slice because no public original route exists. Public descriptors,
  authorization, and production delivery are deferred.
- Partial PROD-002 and SEC-001/002/004: the internal lookup includes owner
  and active status, storage keys are validated, and stored errors are safe;
  caller authentication, OAuth secrets, and HTTP security are still deferred.

---

## Active phase

Phase 2K — trusted preview preparation boundary (offline verified; publication pending)

## Goal

Connect the revision-checked Drive original reader to the verified raster
renderer for one photo at a time. Return bounded derivative buffers only to a
trusted server caller; never mark a photo READY until a later phase has
persisted both derivatives and committed their source revision.

## Requirement IDs

- DRIVE-001/002/003 — Drive retains originals and provider code stays isolated.
- DRIVE-016/017 — verify bytes at the decoder boundary; per-photo unsupported
  or failed outcomes must not interrupt other photos.
- DRIVE-018 — bind prepared outputs to the indexed source revision and signal
  stale reads distinctly, without falsely marking a photo READY.
- IMG-001/004/006/007 — create browser-safe derivatives, never a public
  full-resolution proxy.
- SEC-001/002 — validate the internal request and keep credentials out of
  returned outcomes/logs.

## In scope

- A server-only composition service with an injected `OriginalImageReader`.
- Strict input validation, stale metadata checks, and safe Drive-error mapping.
- One-photo processing with safe per-photo outcomes so an external bounded
  worker can continue after one unsupported or corrupt photo.
- Tests with a real raster fixture and fake reader for success, unsupported,
  stale, transient, and failure paths.

## Out of scope

- OAuth/album authorization, processor scheduling, derivative storage, DB
  preview-state commit, public image route, RAW/HEIC decoding, and live Drive.

## Acceptance criteria

- [x] Successful supported photo returns two bounded derivatives and the
  verified source revision; no original bytes appear in the result.
- [x] Unsupported, stale, transient, and corrupt sources are distinct safe
  outcomes; a later photo can still be prepared after a failed one.
- [x] Tests, typechecks, lint, builds, Prisma validation, and diff checks pass
  or limitations are recorded.

## Verification log

- `preparePreview` validates an indexed candidate, skips known unsupported or
  unrecognized formats before any Drive download, passes a revision-checked
  original into the existing raster renderer, and returns only derivative
  buffers or a sanitized per-photo outcome. It never persists or marks READY.
- Nineteen new tests passed for ready WebP outputs, no-download cases, stale
  metadata, mapped provider failures, cancellation, corrupt-photo isolation,
  and input validation. Full repository tests: 19 files and 165 tests passed.
- Typechecks passed for all six packages/apps; API TypeScript build, source
  lint, Prisma schema validation, and Next.js webpack production build passed.
  `git diff --check` passed. No schema migration was needed.
- Live Google Drive, OAuth, PostgreSQL, representative album throughput, and
  durable derivative publication remain unverified. A future authorized
  worker must persist both derivatives, then atomically compare the current
  photo source revision before setting READY.

## Requirement status at completion

- Partial DRIVE-001/002/003: this path uses a provider interface and retains
  no original; authorized production composition remains deferred.
- Partial DRIVE-016/017: supported raster bytes reach the decoder, while
  unsupported/corrupt sources produce per-photo outcomes. HEIC/RAW remain
  unsupported and no worker records those outcomes in the database yet.
- Partial DRIVE-018: prepared buffers carry the verified source revision, but
  persistence, revision-safe READY commit, and invalidation are pending.
- Partial IMG-001/006/007: two bounded, oriented, sRGB, metadata-stripped
  WebP derivatives can be prepared; no gallery image delivery exists. IMG-004
  remains satisfied in this slice because there is no public original route.
- Partial SEC-001/002: inputs are validated and safe outcomes do not include
  credentials, but OAuth secret management and caller authorization remain.

---

## Active phase

Phase 2J — bounded revision-checked Drive original reader (offline verified; integration pending)

## Goal

Provide a server-only, provider-isolated way for a future preview processor to
temporarily read one original from Google Drive without storing it, exposing
credentials, or accidentally processing a moved/changed file. Gallery routes
must remain metadata-only.

## Requirement IDs

- DRIVE-001/002/003 — Drive is the original source; no permanent copy and
  Google calls remain in the provider package.
- DRIVE-014/015 — bounded safe-read retry and actionable redacted errors.
- DRIVE-018 — compare expected source revision before/after transfer and
  content checksum when available.
- IMG-004 — no public full-resolution proxy or gallery-grid original request.
- SEC-001/002 — validate IDs/metadata/stream bounds; keep access token private.

## In scope

- Separate `OriginalImageReader` interface and Google implementation.
- Narrow metadata preflight and postflight checks for parent, trash,
  `canDownload`, source revision, size, and optional MD5.
- 64 MiB bounded streamed `alt=media` read, safe redirect handling, and
  bounded retry before body consumption.
- Unit tests with fake Drive responses for safety, failures, retry, redirects,
  and no token leakage.

## Out of scope

- Google OAuth credential acquisition, album authorization, processing job,
  derivative storage, public image URL, live Drive integration, and folder
  listing changes.

## Acceptance criteria

- [x] Reader never returns bytes for disallowed/moved/stale/oversized files.
- [x] Redirects do not forward access tokens to a different host.
- [x] Tests, builds, typechecks, lint, Prisma validation, and diff checks pass
  or limitations are recorded.

## Verification log

- A separate `OriginalImageReader` and `GoogleDriveOriginalReader` perform
  narrow metadata pre/postflight checks around a 64 MiB streamed `alt=media`
  read, matching the renderer's input bound. The shared source-revision helper
  is used by both sync reconciliation and this reader.
- Nineteen new reader tests cover success, permission, move/trash, revision,
  checksum, size, redirects, retry, cancellation, and error redaction. Full
  repository tests: 18 files and 146 tests passed.
- Typechecks passed for shared, Drive, database, UI, API, and web. The Drive
  and API TypeScript builds, source lint, Prisma schema validation, and Next.js
  webpack production build passed. `git diff --check` passed. No database
  migration was added in this phase.
- No live Google Drive account, OAuth token, or database was available for
  integration validation. Redirect behavior and quota/latency are tested with
  fake responses only. A trusted album-authorized processing caller is still
  required; the reader is not exposed over HTTP.

## Requirement status at completion

- Partial DRIVE-001/002/003: original bytes stay temporary and provider-only,
  but production authorization and processing integration are outstanding.
- Partial DRIVE-014/015: bounded read retries and redacted provider errors are
  covered by unit tests; live quota/error behavior is unverified.
- Partial DRIVE-018: sync and reader share revision identity, with pre/post
  checks and MD5 verification where supplied. Derivative persistence and
  invalidation remain deferred.
- IMG-004 remains satisfied in this slice: no full-resolution public proxy or
  gallery-grid original request was added.
- Partial SEC-001/002: inputs, metadata, and byte bounds are checked and the
  token is not returned or logged; credential management and caller-level
  authorization are future integrations.

---

## Active phase

Phase 2I — bounded raster thumbnail/preview renderer (offline verified; delivery pending)

## Goal

Turn verified, supported raster source bytes into bounded static WebP
derivatives with orientation, sRGB conversion, and metadata removal. Keep the
renderer server-only and independent of Drive fetching/storage so the future
sync processor can supply ephemeral original bytes and persist only
derivatives. Do not claim RAW or HEIC support from the bundled decoder.

## Requirement IDs

- DRIVE-016/017 — validate bytes and return per-photo unsupported/failure
  outcomes without failing an album.
- IMG-001, IMG-006/007 — bounded browser-safe derivatives; no original bytes
  in gallery output, auto-orientation, sRGB, and sensitive metadata stripping.
- DRIVE-001/002/018 — originals remain in Drive; derivative revision identity
  will be supplied by later persistence integration.
- SEC-001 — size, pixel, format, and timeout limits at the decoder boundary.

## In scope

- Server-only Sharp-based renderer for JPEG, PNG, WebP, AVIF, GIF, TIFF.
- Preflight plus decoder metadata validation; one still frame/page only.
- Fixed thumbnail and preview width ceilings, no upscaling, WebP output,
  limits on input bytes/pixels/output bytes and processing time.
- Tests using generated raster fixtures for dimensions, output format,
  metadata stripping, first-frame policy, invalid/spoofed/oversized input,
  and unsupported RAW/HEIC handling.
- APNG first-frame compatibility remains an explicit unverified variant.

## Out of scope

- Drive download/OAuth, RAW embedded-preview extraction, HEIC codec deployment,
  persistent derivative storage, image URL provider, API image route, gallery
  image rendering, and measured production throughput.

## Acceptance criteria

- [x] Supported raster input produces bounded static browser-safe outputs.
- [x] Invalid/unsupported inputs produce explicit per-photo outcomes.
- [x] Tests, builds, typechecks, lint, Prisma validation, and diff checks pass
  or limitations are recorded.

## Verification log

- Added Sharp 0.35.5 as a direct API dependency. Twelve new renderer tests
  passed: JPEG, PNG, WebP, AVIF, GIF, TIFF conversion, bounded sizing,
  EXIF orientation and metadata stripping, first still from animated GIF,
  corrupt/mismatched source handling, explicit RAW/HEIC unsupported outcome,
  and source-byte limit. APNG variants were not exercised.
- Full suites passed: shared 12, Drive 10, database 6, API 84, web 15 (127
  total); UI package has no test files.
- Typechecks passed for all six code packages. API TypeScript build, source
  lint, Prisma schema validation, and Next.js webpack production build passed.
  No schema migration was added.
- `git diff --check` and new-source trailing-whitespace checks passed.
- This renderer is not wired to Drive fetching, a job, persistent revision-keyed
  storage, or public image delivery. No live source corpus, production hardware,
  throughput, memory-concurrency, HEIC codec, or RAW camera validation was
  available. The output-byte and timeout guards are implemented but not
  exercised with limit-triggering fixtures.

## Requirement status at completion

- Partial DRIVE-016/017: source preflight is now invoked by a real decoder
  boundary for the raster subset, and unsupported/failure outcomes are
  per-photo. RAW/HEIC and APNG compatibility remain unverified or unsupported.
- Partial IMG-001/006/007: static, bounded WebP derivatives apply orientation,
  sRGB, and metadata stripping, but no gallery grid consumes them yet.
- Partial DRIVE-001/002/018: renderer keeps no persistent original and accepts
  transient bytes, but Drive ingestion, derivative storage, and revision-based
  invalidation are not implemented.
- SEC-001 has byte/pixel/format/output/time guards in this server-only slice;
  hostile-input isolation and live resource measurements remain deferred.

---

## Active phase

Phase 2H — source-byte preflight for preview processing (offline verified; pipeline pending)

## Goal

Add a conservative server-side preflight step between Drive metadata discovery
and future decoders. Reject obvious extension/MIME spoofing, recognize common
raster container signatures, and require an explicit decoder probe for RAW or
ambiguous variants. Do not call this preview generation.

## Requirement IDs

- DRIVE-011, DRIVE-016 — recognized source families and byte verification gate.
- DRIVE-017 — unsupported/ambiguous variants must remain per-photo states, not
  fail a whole album.
- IMG-003 — document why direct Drive thumbnail links are not the browser
  delivery mechanism.
- SEC-001 — bound and validate untrusted byte-prefix inspection.

## In scope

- Pure server-only prefix inspection for common photographic containers.
- Distinct match, mismatch, insufficient-data, and decoder-probe outcomes.
- Tests for matched/mismatched prefixes, HTML/SVG disguises, ISO BMFF brands,
  TIFF-backed RAW ambiguity, and short buffers.
- Record official Drive thumbnail behavior as evidence without committing to
  an untested proxy/cache implementation.

## Out of scope

- Downloading Drive originals, full-file validation, decoder invocation,
  thumbnail generation, storage, gallery image URLs, OAuth, and live image
  performance tests.

## Acceptance criteria

- [x] Common raster signatures are checked against metadata classification.
- [x] Ambiguous RAW families cannot be marked decoded or browser-ready.
- [x] Tests, builds, typechecks, lint, and diff checks pass or limits recorded.

## Verification log

- 17 new preflight tests passed for common containers, metadata conflicts,
  non-image disguises, RAW/ISO BMFF ambiguity, and short prefixes. Full suites
  passed: shared 12, Drive 10, database 6, API 72, web 15 (115 total); UI has
  no test files.
- Typechecks passed for all six code packages. API TypeScript build, full
  source lint, Prisma schema validation, and Next.js webpack production build
  passed. No schema migration was added.
- `git diff --check` and new-source trailing-whitespace scan passed.
- The helper is not yet called by a download/decoder pipeline. No source files
  or Drive credentials were available for decoder compatibility or live
  thumbnail/proxy measurements. Header matching remains a hint, not proof a
  complete file is safe or decodable.

## Requirement status at completion

- Partial DRIVE-011/016: discovery is complemented by a conservative byte
  preflight, but no decoder boundary uses it yet. DRIVE-017 remains partial:
  ambiguous RAW formats are distinguished as needing a probe, but no per-photo
  processing job writes unsupported-variant state.
- Partial IMG-003: official Drive thumbnail behavior is documented and direct
  browser embedding is ruled out; a proxy/cache versus derivative-provider
  prototype and measured costs remain open under ADR-012.
- SEC-001: prefix inspection is bounded and rejects obvious mislabeled
  content, but full-file validation is deferred to a decoder pipeline.

---

## Active phase

Phase 2G — public gallery metadata web route (offline verified; live integration pending)

## Goal

Connect the Next.js client route to the bounded gallery metadata API without
misrepresenting metadata as a finished proofing gallery. Keep each rendered
page small, localized, and truthful about preview/selection unavailability.

## Requirement IDs

- GAL-001 — public `/g/{publicSlug}` route, metadata-only portion.
- GAL-002, GAL-007 — do not reveal a protected gallery's metadata or Drive data.
- UX-001 — English/Vietnamese gallery states and accessible language switch.
- PERF-001, PERF-003 — cursor continuation and bounded rendered photo count.
- SEC-001 — validate route/search inputs and API responses.

## In scope

- Server-only API fetch through the shared gallery DTO with safe unavailable,
  missing, protected, invalid, and stale states.
- One bounded page at a time with a continuation link and no speculative image
  fetching or all-page accumulation.
- Localized, responsive metadata index with explicit preview-unavailable copy.
- Tests for URL validation, response mapping, pagination, and localized copy.

## Out of scope

- Thumbnails, image descriptors, lightbox, selections, comments, password
  entry/session, and photographer dashboard. Those require separate gates.

## Acceptance criteria

- [x] The web reader requests 50 rows, validates the returned DTO and bound,
  and continues through the opaque cursor without requesting image bytes.
- [x] Protected/missing/unavailable/stale states are safe and bilingual.
- [x] Builds, typechecks, lint, tests, and diff checks pass or limitations are
  recorded.

## Verification log

- Next.js production build with webpack passed and lists `/g/[slug]` as a
  dynamic route. Web metadata-client tests cover bounded page requests,
  continuation, status mapping, invalid input, malformed/private responses,
  and unavailable transport. English/Vietnamese copy completeness is tested.
- Full suites passed: shared 12, Drive 10, database 6, API 55, web 15 tests
  (98 total); UI package has no test files.
- Typechecks passed for all six code packages; API and shared builds, source
  lint, and Prisma schema validation passed. No schema migration was added.
- `git diff --check` and new-source trailing-whitespace checks passed.
- No live PostgreSQL gallery, image delivery, or OAuth connection was
  available, so rendering a real populated album, password access, and
  end-to-end browsing latency remain unverified. The previous phase's
  Turbopack port-binding limitation remains; the configured webpack build
  passes.

## Requirement status at completion

- Partial: GAL-001 now has a public route and metadata paging, but not a
  usable visual proofing gallery. GAL-002/007 remain closed for protected
  albums and response data excludes private Drive fields. UX-001 covers this
  new route's localized copy and shared language cookie. PERF-001/003 use one
  bounded page at a time, but 5,000-photo browser performance is unmeasured.
  SEC-001 validates the web request and API response boundaries.
- Deferred: thumbnails, preview/lightbox, password entry/session, selection
  mutations and state, photographer workspace, and live integration proof.

---

## Active phase

Phase 2F — configurable gallery metadata API route (offline verified; live database pending)

## Goal

Expose the already-tested passwordless gallery metadata reader through a
versioned Express route, with strict input/output contracts, safe errors, and
runtime PostgreSQL/cursor-key composition. Preserve the no-credential local
foundation by returning an explicit unavailable response when not configured.

## Requirement IDs

- GAL-001 — public gallery metadata endpoint by opaque slug (web route deferred).
- GAL-002, GAL-007 — protected galleries denied and private fields omitted.
- PERF-001, PERF-005 — bounded cursor page and narrow response contract.
- SEC-001, SEC-002 — Zod boundary validation and private runtime configuration.
- OPS-004 — safe actionable error responses for unavailable/stale reads.

## In scope

- Shared Zod gallery page DTO and route query/param validation.
- `GET /api/v1/galleries/:slug/photos` wired to `GalleryListingService` only
  when `DATABASE_URL` and a dedicated cursor key are privately configured.
- Safe 400/403/404/409/503 response mapping, no-store metadata policy, and
  startup/shutdown database lifecycle.
- HTTP tests with an injected service; no mocked response is presented as live
  database functionality.

## Out of scope

- Password session, image descriptors, gallery web page, photographer auth,
  album creation, and live PostgreSQL integration/performance verification.

## Acceptance criteria

- [x] Unconfigured API responds truthfully; configured composition requires a
  valid database URL and 32-byte cursor key without logging secrets.
- [x] Route validates inputs and emits only shared client-safe DTO fields.
- [x] Protected, invalid, stale, and missing gallery cases map to safe statuses.
- [x] Tests, builds, typechecks, lint, Prisma validation, and diff check pass or
  limitations are recorded.

## Verification log

- API route and runtime-config tests: 21 new-case assertions passed; full API
  suite: 55 tests passed. Shared, Drive, database, and web suites passed (12,
  10, 6, and 6 tests respectively). UI package has no test files.
- TypeScript typechecks passed for all six code packages. Shared, API, Drive,
  and database TypeScript builds passed. ESLint passed over all source trees.
- Prisma schema validation passed. Next.js production build passed with
  `--webpack`. The default Turbopack build could not run here because its CSS
  worker was denied local port binding, including with elevated execution.
- `git diff --check` and trailing-whitespace scan of changed source passed.
- No PostgreSQL instance or credentials were available; database connection,
  migration application, live HTTP listing, and query-plan latency remain
  unverified. HTTP tests injected the real service boundary with deterministic
  test responses, not a claimed live database.

## Requirement status at completion

- Implemented at API boundary: GAL-001 passwordless metadata route; GAL-002/007
  protected and unpublished gate inherited from the listing service and safe
  DTO projection; PERF-001/005 bounded cursor query contract; SEC-001 strict
  boundary validation; SEC-002 private cursor/database runtime configuration;
  OPS-004 explicit safe 400/403/404/409/503 responses.
- Partial at product level: no gallery web page, password session, image
  delivery, live database verification, or measured large-gallery latency.
- Deferred: remaining MVP features, including OAuth, preview processing,
  photographer CRUD, selection HTTP routes, and deployment.

---

## Active phase

Phase 2E — safe public-gallery metadata pagination (offline verified; live query plans pending)

## Goal

Make large published, passwordless galleries list from indexed PostgreSQL
metadata using a bounded keyset page and an authenticated opaque cursor tied
to the album catalog version. Do not disclose password-protected data or
invent image URLs while the delivery strategy is unresolved.

## Requirement IDs

- DRIVE-006, DRIVE-013 — local metadata reads in materialized natural order.
- PERF-001, PERF-005 — stable bounded cursor pagination and narrow list fields.
- GAL-002, GAL-007 — protected galleries denied and private owner/Drive fields omitted.
- ALB-003 — cryptographically random public-slug generator (creation retry deferred).
- SEC-001 — validate listing input and cursor payloads.
- DB-004 — exercise candidate gallery index shape (live query-plan proof deferred).

## In scope

- A server-side passwordless gallery listing service and encrypted/versioned
  cursor codec with strict input bounds.
- Public-slug generator using cryptographic randomness.
- Tests for 5,000-record continuation, tampering, stale/cross-gallery cursors,
  protection gates, and field minimization.

## Out of scope

- HTTP route, gallery password session, image descriptor/provider, web grid,
  album creation, live PostgreSQL query plan and performance measurement.

## Acceptance criteria

- [x] The service queries active rows in `(sortOrder, id)` order, with a 100-photo maximum, no Drive call, and no offset.
- [x] AES-GCM cursors are opaque, authenticated, album-bound, time-limited, and rejected after a catalog-version change.
- [x] Protected and unpublished albums yield no photo metadata in service tests.
- [x] Build, typecheck, lint, tests, Prisma validation, and final diff checks pass or limits are recorded.

## Verification log

- Prisma schema validation — passed; this phase added no migration.
- Direct TypeScript builds and typechecks — passed for all six code packages; Next.js production build passed.
- Direct ESLint checks — passed for all six code packages.
- Direct Vitest runs — 68 tests passed (12 shared, 10 Drive, 6 database, 34 API, 6 web). The API HTTP tests required permitted loopback binding.
- The compiled gallery-listing service imported successfully under Node 24.
- Gallery tests traverse 5,000 active records in 50 pages, exclude soft-removed rows, verify query limits/field projection and tie-breaking, and reject tampered, expired, cross-gallery, and stale cursors.
- No live PostgreSQL instance or `DATABASE_URL` is available. Query-plan/index performance, snapshot behavior, and 5,000-photo latency are not verified against a real database or mobile browser.
- `git diff --check` and new-file trailing-whitespace scan — passed after final edits.

## Requirement status at completion

- Implemented in server-only code: local metadata keyset paging for DRIVE-006/013 and PERF-001/005, encrypted catalog-versioned cursors, passwordless-only gate for GAL-002/007, strict listing input validation under SEC-001, and random slug generation under ALB-003.
- Partial at product level: no HTTP gallery route or web grid, protected-gallery authorization, image descriptors, slug collision retry in album creation, or live DB query-plan proof (DB-004).
- Deferred: the remaining MVP requirements, including OAuth, preview processing/delivery, password sessions, UI flows, and production performance validation.

---

## Active phase

Phase 2D — transactional client selection and filename export service (offline verified; live concurrency pending)

## Goal

Implement the one-selection-per-album proofing workflow behind a server-only
service. Keep selected state in `SelectionItem`, enforce limits and state changes
under a database lock, and make submitted filename export deterministic.

## Requirement IDs

- SEL-004–008 — backend limit, concurrency strategy, deselection, comments, and idempotent submit.
- SEL-010 — photographer review data (service portion).
- EXP-001–003 — owner-authorized text export from an explicit submitted selection.
- DRIVE-013 — natural album order for export.
- PROD-002 — owner check for private review/export (gallery authorization deferred).

## In scope

- Record the selection locking and state policy in `docs/DECISIONS.md`.
- Implement select, deselect, comment, submit, owner review, and export methods
  in the API application service layer.
- Ensure the service is not publicly routed until gallery password/session
  authorization and mutation rate limiting are in place.
- Unit tests for limits, idempotence, state changes, owner isolation, and
  filename ordering/line safety.

## Out of scope

- Guest gallery session/password authorization, routes, UI, live PostgreSQL
  concurrency proof, lock/reopen owner policy, and database migration application.

## Acceptance criteria

- [x] Select, deselect, comment, and submit each use a transaction and lock the album row before reading or changing selection state.
- [x] Selection-limit checking follows the intended PostgreSQL lock ordering in code; a live concurrent-request proof remains required before this requirement is complete.
- [x] The service exports only an explicit submitted selection for its album owner, in natural filename order.
- [x] Unit tests and workspace build/typecheck/lint/Prisma checks pass or limits are recorded.

## Verification log

- Prisma schema validation — passed; this phase added no migration.
- Direct TypeScript builds and typechecks — passed for all six code packages; Next.js production build passed.
- Direct ESLint checks — passed for all six code packages.
- Direct Vitest runs — 59 tests passed (12 shared, 10 Drive, 6 database, 25 API, 6 web). The API HTTP tests required permitted loopback binding.
- The compiled selection service imported successfully under Node 24.
- Service tests cover idempotent select/submit, optional limit, deselect-at-limit, inactive/cross-album rejection, unpublished gallery rejection, comments, locked/submitted states, owner isolation, natural export order, line-break escaping, and soft-removed selection history.
- No `DATABASE_URL`, PostgreSQL server, or Docker executable is available in this workspace. No live row-lock/concurrent-selection or HTTP authorization test could be run.
- `git diff --check` and trailing-whitespace scan — passed after final edits.

## Requirement status at completion

- Implemented in server-only code: select/deselect/comment/submit, owner review, and filename export portions of SEL-004–008, SEL-010, EXP-001–003, DRIVE-013, and PROD-002.
- Partial at product level: SEL-005 needs live concurrent-request proof; EXP-001 needs an authorized `text/plain` route; PROD-002 and guest mutations need real authentication/gallery access; SEL-010 needs photographer UI.
- Deferred: guest password/session authorization, rate-limited routes, client UI and submission confirmation (SEL-009), owner lock/reopen policy, and the remaining MVP requirements.

---

## Active phase

Phase 2C — album catalog reconciliation service (offline verified; live integration pending)

## Goal

Connect the complete direct-child Drive catalog to the durable photo index with
owner-scoped, retry-safe sync runs. Keep network reads outside database
transactions; reconcile only after the provider has returned a complete catalog.

## Requirement IDs

- DRIVE-007–009 — idempotent add/update/soft-remove without losing selection history.
- DRIVE-013 — persist natural filename order.
- DRIVE-018 — invalidate preview state when source revision changes (derivative deletion deferred).
- DB-002–003 — populate photo metadata through the unique album/file identity.
- OPS-001 — sync run status and count recording.
- PROD-002 — verify album ownership before a sync is claimed.

## In scope

- A server-only sync service using the existing `StorageProvider` and Prisma model.
- A bounded run claim/expiry policy and per-album transaction serialization.
- Pure reconciliation planning tests for additions, changes, reactivation,
  removals, ordering, and revision invalidation.
- Failure recording and no removal on incomplete/failed Drive listing.

## Out of scope

- Public API route, Google OAuth/token handling, photographer session, album
  creation, image decoding/derivative cleanup, and live database verification.
- Background scheduling, multi-instance heartbeat, and performance proof.

## Acceptance criteria

- [x] Owner checks, album-row locking, a partial unique active-run index, and lease recovery are implemented and unit tested; live PostgreSQL behavior remains unverified.
- [x] Repeated complete catalogs produce a no-op reconciliation plan and cannot create duplicate album/file identities at the schema boundary.
- [x] Provider failure leaves photo rows untouched; stale runs fail before reconciliation, covered by service tests.
- [x] Complete runs record counts and assign natural ordinals in one transaction, covered by unit tests; live throughput remains unverified.
- [x] Typecheck, tests, lint, build, and Prisma checks pass or limitations are recorded.

## Verification log

- `pnpm install --offline --no-frozen-lockfile` — passed; lockfile refreshed for API workspace dependencies.
- Prisma schema validation — passed with supported Node 24.19.0; the second migration's partial unique index is hand-reviewed SQL and cannot be applied without PostgreSQL.
- Direct TypeScript builds and typechecks — passed for all six code packages; Next.js production build passed.
- The compiled API sync module imported successfully under Node 24.
- Direct ESLint checks — passed for all six code packages.
- Direct Vitest runs — 52 tests passed (12 shared, 10 Drive, 6 database, 18 API, 6 web). The API suite required permitted local loopback binding for its existing HTTP tests.
- Sync tests cover natural ordering, idempotence planning, reactivation, soft removal, source-revision invalidation, invalid catalogs, owner isolation, active-run conflict, lease recovery, stale-run rejection, and no photo changes on provider failure.
- No live PostgreSQL instance, OAuth credentials, or authenticated album route is available. Migration application, database concurrency/integration behavior, and representative sync throughput remain unverified.
- `git diff --check` and new-file trailing-whitespace scan — passed after final edits.

## Requirement status at completion

- Implemented in code for this slice: `AlbumSyncService`, reconciliation planner, active-run migration, and unit tests for DRIVE-007–009, DRIVE-013, DRIVE-018, DB-002–003, OPS-001, and owner checks under PROD-002.
- Partial at product level: all listed IDs require live database/provider integration; DRIVE-018 also needs derivative invalidation/deletion, and PROD-002 needs authenticated caller/session enforcement.
- Deferred: API route and UI trigger, Google OAuth/token encryption, media processing/delivery, gallery, selection, export, production operations, and remaining requirements.

---

## Active phase

Phase 2B — PostgreSQL/Prisma metadata schema foundation (offline verified; live DB verification pending)

## Goal

Define the first durable metadata model and reviewed migration for photographer-owned albums, indexed photos, Drive connections, sync runs, and selections. Preserve Drive originals outside PostgreSQL and make the model ready for later authorized sync and gallery services.

## Requirement IDs

- DB-001 — metadata/application state only, no original bytes.
- DB-002 — photo fields for Drive identity, dimensions, sort, activity, and timestamps.
- DB-003 — unique `(albumId, driveFileId)`.
- DB-004 — candidate ownership, gallery, sync, and selection indexes (query-plan proof deferred).
- DB-005 — reviewed migration and Prisma validation (live migration application deferred).
- ALB-002–003 — album fields and unique opaque public slug (generation deferred).
- SEL-001–003 — selection aggregate, unique items, explicit states (mutation logic deferred).
- DRIVE-009, DRIVE-018, OPS-001 — schema support for soft removal, source revisions, and sync counts (behavior deferred).

## In scope

- Pin a supported Prisma ORM release and add `packages/database` schema, generated client configuration, and initial SQL migration.
- Model owner and album relationships, indexed photos, preview state, selection items, and sync runs with uniqueness and foreign-key constraints.
- Choose and record a natural-sort/cursor representation before schema implementation.
- Validate schema and generated migration offline; add focused tests for deterministic natural ordering where possible.

## Out of scope

- Live PostgreSQL migration application or representative query-plan measurements without a database.
- OAuth/token encryption implementation, Drive reconciliation, album APIs, gallery passwords, selection concurrency enforcement, or UI flows.
- Retention/purge policy and full workspace `DriveItem` indexing.

## Acceptance criteria

- [x] Prisma validates and generates a type-safe client without embedding credentials.
- [x] Initial migration contains required uniqueness, foreign keys, and candidate indexes.
- [x] No original image bytes or `Photo.isSelected` field appears in the schema.
- [x] Natural filename ordering has a deterministic implementation and tested edge cases.
- [x] Workspace build, typecheck, tests, lint, and final diff checks pass or limitations are recorded.

## Verification log

- Prisma 7.10.0 `validate` and `generate` — passed under supported Node 24.19.0. Generated client is ignored; no credentials were used.
- Offline `migrate diff --from-empty --to-schema ... --script` — generated the initial SQL migration; manually reviewed uniqueness, composite same-album foreign keys, listing indexes, and positive/nonnegative check constraints.
- Direct TypeScript builds and `--noEmit` checks — passed for shared, UI, Google Drive, database, API, and web; Next.js production build passed.
- The compiled `packages/database/dist` entry point loaded and constructed/disconnected a Prisma client without opening a PostgreSQL connection.
- Direct ESLint checks — passed for all six code packages.
- Direct Vitest runs — 39 tests passed (12 shared, 10 Drive, 6 database, 5 API, 6 web). The API HTTP tests needed permitted local loopback binding; the first sandboxed run failed because Supertest could not bind, then passed with loopback access.
- `CI=true pnpm build` stalled before script output in this environment; equivalent installed toolchain commands above passed instead.
- No PostgreSQL server or connection URL is available. Migration application, runtime FK/check behavior, representative query plans, and 5,000–10,000-row reindex cost remain unverified.
- `git diff --check` — passed after source and documentation edits.

## Requirement status at completion

- Implemented structurally: DB-001–003, database portion of ALB-002, SEL-001–003, and initial migration portion of DB-005.
- Partial: DB-004 (candidate indexes but no query plans), DB-005 (SQL reviewed and Prisma validated but not applied live), ALB-003 (unique slug field but no opaque slug generator), DRIVE-009/018 and OPS-001 (state fields only).
- Deferred: authorized persistence/sync services, gallery cursor enforcement, transactional selection mutations and limit tests, OAuth encryption, and all other product requirements not listed above.

---

## Active phase

Phase 2A — Google Drive direct-child catalog provider (verified)

## Goal

Implement and test the server-only Drive metadata listing boundary that a later album sync can consume. This is the first coherent slice toward the user's request for the full MVP; no product requirement is claimed end-to-end without OAuth, persistence, processing, and UI.

## Requirement IDs

- DRIVE-003 — isolate Drive calls behind a provider interface.
- DRIVE-005 — complete pagination with a narrow field mask.
- DRIVE-010 — direct-child listing only.
- DRIVE-011 — classify supported source images and count skipped files (partial until album import exists).
- DRIVE-014 — bounded, jittered retries for safe reads.
- DRIVE-015 — actionable, credential-safe provider error categories (partial until API/UI mapping).
- DRIVE-016 — metadata classification remains discovery only (partial).
- OPS-002 — safe provider operation telemetry (partial).

## In scope

- A `packages/google-drive` package with an injected OAuth token source and provider-neutral catalog interface.
- Google Drive v3 `files.list` direct-child query, narrow metadata projection, complete pagination, response validation, supported-image classification, and skip counts.
- Retry-safe reads with bounded exponential backoff and non-secret error categories.
- Focused tests for pagination, filtering, malformed data, duplicate page tokens, retry policy, and auth/quota failures.

## Out of scope

- OAuth consent, refresh-token encryption, DB persistence/reconciliation, byte validation, image processing, galleries, and selections.
- Public-folder API-key access and folder mutations.

## Acceptance criteria

- [x] One call follows every Drive page and never returns a partial catalog as complete.
- [x] Only direct, non-trashed children are requested; no originals or sensitive metadata are fetched.
- [x] Supported sources are classified through the shared registry; unsupported files are counted.
- [x] Retry and error behavior is bounded, testable, and does not leak tokens or provider payloads.
- [x] Package build, typecheck, lint, tests, and final diff checks pass or limitations are recorded.

## Verification log

- `pnpm install --offline --no-frozen-lockfile` — passed after pnpm identity verification required an elevated run; lockfile updated for the new workspace package.
- `CI=true pnpm build` — passed for shared, UI, API, web, and Google Drive packages.
- `CI=true pnpm typecheck` — passed for all five code packages.
- `CI=true pnpm lint` — passed for all five code packages.
- `CI=true pnpm test` — passed: 33 tests total (12 shared, 6 web, 5 API, 10 Drive).
- Drive tests cover 10,000 files across 10 pages, malformed/incomplete results, repeated and rejected page tokens, bounded retries, invalid folder IDs, and non-leaking auth/quota errors.
- No live Google account was available, so behavior against the real Drive service is unverified.
- Prisma validation is not applicable to this phase; `packages/database` remains a placeholder.
- `git diff --check` — passed after the final plan update.

## Requirement status at completion

- Implemented in this phase: Drive package portion of DRIVE-003, DRIVE-005, DRIVE-010, and DRIVE-014.
- Partial: DRIVE-011, DRIVE-015, DRIVE-016, OPS-002. The package is not yet wired into an authorized API or persisted sync.
- Deferred: the remaining product requirements, including OAuth (DRIVE-004), PostgreSQL (DB-001–005), album/gallery APIs (ALB-001–006, GAL-001–007), selections (SEL-001–010), image processing/delivery (IMG-001–007), and performance validation (PERF-001–007).

---

## Active phase

Phase 1C — English/Vietnamese language switch for the current web surface (code implemented; browser interaction unverified)

## Goal

Let visitors switch the existing web page between English and Vietnamese, retain that preference, and present the correct document language without adding a client-side translation bundle.

## Requirement IDs

- UX-001 — current web UI can switch between English and Vietnamese and retain the chosen language (new requirement for this request).
- SEC-001 — validate the language submitted to the web boundary (partial).

## In scope

- Add a small server-side dictionary and accessible language-switch buttons.
- Persist the selected locale in a cookie and set the HTML language and metadata accordingly.
- Translate all human-facing copy on the current home page, including unavailable-API text.
- Update the product/MVP requirements and verify English, Vietnamese, invalid input, and persistence.

## Out of scope

- Translating API contracts or photographic format names.
- Localizing future authenticated workspace and gallery screens that do not yet exist.
- Locale-specific URL routes or automatic browser-language detection.

## Acceptance criteria

- [x] English remains the default when no valid preference is stored (unit tested).
- [x] The page exposes English and Vietnamese submit buttons with language-specific accessible names; server action accepts both (unit tested).
- [x] The selected language is stored in a one-year cookie and selects page copy, metadata, and HTML `lang` on server render (unit tested and build checked, but not browser-interaction verified).
- [x] Invalid locale submissions cannot set a preference (unit tested).
- [ ] Browser interaction check passes; the in-app browser's security policy blocked access to localhost and forbade a workaround.

## Verification log

- `apps/web/node_modules/.bin/next typegen` — passed.
- Direct TypeScript checks for web, API, shared, and UI — passed.
- Direct ESLint check for all four code packages — passed.
- Direct Vitest run for web — 2 files, 6 tests passed, including valid/invalid action submissions.
- `apps/web/node_modules/.bin/next build --webpack` — passed with dynamic home route.
- `git diff --check` — passed after the final plan update.
- `pnpm` stalled before script output in this environment, so verification used the installed package binaries directly.
- The in-app browser refused the localhost URL under its security policy; no browser interaction or visual check was performed.

## Requirement status at completion

- Implemented in code: UX-001 for the currently existing home page.
- Partial: UX-001 for the full future web product; SEC-001 for broader untrusted input validation.
- Deferred verification: real browser switching, persistence across reloads, and mobile visual review.

---

## Active phase

Phase 1B — Runnable web and API foundation (verified)

## Goal

Make both planned applications start, communicate through a versioned contract, and expose a truthful system and media-capability view. This creates a runnable base for authentication, Drive sync, albums, and galleries.

## Requirement IDs

- PROD-003 — modular monolith in the pnpm workspace.
- DRIVE-011 — expose the supported source-format policy from the shared registry (partial).
- SEC-001 — validate API input at the boundary (partial; endpoints in this phase have no untrusted body).
- OPS-002 — structured request logging and health visibility (partial).

## In scope

- Bootstrap `apps/web` with Next.js App Router, React, Tailwind, strict TypeScript, and a page that consumes the API contract.
- Bootstrap `apps/api` with Express, Zod contracts, request IDs, structured request logs, an error envelope, and live health/media-format endpoints.
- Add a small presentational component package in `packages/ui`.
- Add focused API tests, build/lint/type checks, and local development instructions.

## Out of scope

- Photographer sign-in, Drive OAuth, PostgreSQL schema, album sync, image conversion, gallery publication, selections, and export.
- Database readiness claims when no database connection exists.

## Acceptance criteria

- [x] `pnpm dev` starts both applications without private credentials.
- [x] The web page reads and validates the API response; unavailable API is clearly shown.
- [x] API routes return versioned, typed responses and errors with request IDs.
- [x] API tests cover healthy and invalid routes.
- [x] Build, typecheck, test, lint, and a running HTTP smoke test pass, or limitations are recorded.
- [x] Existing Phase 1A changes remain intact.

## Tasks

- [x] Inspect workspace state and relevant product/architecture documents.
- [x] Add shared API contracts and reusable UI primitives.
- [x] Implement the Express application and focused tests.
- [x] Implement the Next.js application and API integration.
- [x] Install dependencies and verify both applications.
- [x] Inspect the final diff and update this verification log.

## Verification log

- `CI=true pnpm build` — passed for shared, UI, API, and web; Next.js production route `/` built successfully.
- `CI=true pnpm typecheck` — passed for all four code packages.
- `CI=true pnpm lint` — passed for all four code packages.
- `CI=true pnpm test` — passed: 12 shared format tests and 5 API integration tests.
- `pnpm dev` — both applications started locally; HTTP smoke checks returned 200 for live health, versioned system info, and web `/` with the API-connected state.
- Web-only local HTTP check with API stopped — returned 200 and rendered the API-unavailable state.
- `git diff --check` — passed after the final plan update.
- API integration tests and local HTTP checks required a local loopback-listener permission escalation in this sandbox.

## Requirement status at completion

- Implemented: the Phase 1B runnable web/API foundation and shared system contract; no MVP product requirement is claimed complete solely from this foundation.
- Partial: PROD-003, DRIVE-011, SEC-001, OPS-002.
- Deferred: the remaining MVP requirements.

---

## Completed phase: Phase 1A — Expanded image-format foundation

## Phase

Phase 1A — Expanded image-format foundation

## Goal

Define the supported source-image contract for the proofing product and implement a tested, browser-safe shared classifier that later Drive sync and preview-processing phases can use.

## In scope

- Replace the JPEG/PNG/WebP-only product decision with an explicit popular-format support matrix.
- Preserve Google Drive as the source of truth for original bytes.
- Record that non-browser-native sources require generated thumbnail/preview derivatives.
- Scaffold the strict TypeScript shared package.
- Implement source-format definitions and Drive-metadata classification without treating metadata classification as content validation.
- Add unit tests for MIME aliases, extensions, case handling, ambiguous metadata, and unsupported inputs.

## Out of scope

- Downloading original bytes from Drive.
- Byte-signature validation and malicious-file detection.
- HEIC, TIFF, PSD, or RAW decoder integration.
- Derivative generation, storage, serving, or cleanup.
- Sync orchestration and database schema changes.
- Next.js or Express feature implementation.

## Requirement IDs

- DRIVE-003
- DRIVE-011
- DRIVE-016–018
- IMG-002
- IMG-005–007
- SEC-001

## Assumptions and decisions

- “Support” means the application can index a recognized source and produce a safe browser preview; it does not mean editing the source format.
- MIME type and filename classification is discovery only. A later processing boundary must verify bytes before decoding.
- Animated and multi-page sources use a representative still frame/page in the proofing MVP.
- Generated derivatives are not original-file duplication and must be invalidated when the Drive source revision changes.

## Risks

- Google Drive may report generic or incorrect MIME types, so filename and MIME evidence can conflict.
- RAW compatibility varies by camera model and decoder version.
- HEIC decoding has deployment and patent/licensing implications.
- Broad decoding expands the untrusted-input and resource-exhaustion attack surface.

## Tasks

- [x] Inspect existing product, requirements, architecture, and decision documents.
- [x] Update the product scope and ADRs for expanded source formats and derivatives.
- [x] Scaffold `packages/shared` with strict TypeScript and package-local verification.
- [x] Implement the immutable format registry and metadata classifier.
- [x] Add classification tests.
- [x] Run package type checking and tests.
- [x] Inspect the final diff and record verification evidence.

## Acceptance criteria

- [x] The guaranteed and best-effort source formats are named explicitly.
- [x] Existing accepted decisions are superseded rather than silently rewritten.
- [x] The classifier is deterministic for filename/MIME conflicts and generic MIME types.
- [x] Callers can distinguish browser-native, converted-raster, RAW, and best-effort formats.
- [x] Unrecognized input remains unsupported rather than being accepted as an arbitrary image.
- [x] Tests and strict TypeScript checks pass.
- [x] No decoder or end-to-end gallery support is represented as complete.

## Verification log

- 2026-09-29: `pnpm typecheck` passed for `packages/shared`.
- 2026-09-29: `pnpm test` passed: 1 file, 12 tests.
- 2026-09-29: `pnpm build` passed and emitted the shared package declarations/ES modules.
- 2026-09-29: Built-module smoke check classified a generic-MIME `.CR3` source as guaranteed camera RAW with `extract-raw-preview` strategy.
- 2026-09-29: `pnpm lint` exited successfully, but no package currently defines a lint task; lint rules remain deferred to the foundation phase.
- 2026-09-29: Final diff inspected. No decoder, derivative store, Drive sync, API, or UI implementation is claimed.

## Requirement status at completion

- Implemented: the shared discovery/classification portion of DRIVE-011 and DRIVE-016.
- Partial: DRIVE-003, DRIVE-011, DRIVE-016–018, IMG-002, IMG-005–007, SEC-001.
- Deferred: byte validation, decoding, derivatives, persistence, sync, and gallery delivery.
