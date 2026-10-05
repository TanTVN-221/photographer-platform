# Local setup and live integration checklist

## Runtime

Use Node.js 22.13+ or 24 LTS and the pinned pnpm 11.19.0. Run `pnpm install`.
`pnpm dev` and each app's `dev` command explicitly load the optional root `.env`
before launching Node/Next.js. Exported values take precedence, including empty
values; restart both development processes after editing `.env`. No shell
`source`, secret copying or new environment dependency is needed. The shared
launcher uses Node's built-in `loadEnvFile` before spawning the installed CLIs,
so Next workers never receive incompatible environment-file Node flags. Next's
app-local `.env*` files cannot override values already loaded from root `.env`.
Root values are literal: use complete URLs/paths rather than `$VARIABLE`
expansion in that file.
Production `start`/`build` and the preview CLI do not load root `.env` this way:
configure their process environments privately. Tests likewise do not autoload
live credentials. Do not commit secrets or paste them into chat.

## PostgreSQL and previews

1. Create an empty PostgreSQL database for local testing.
2. Set `DATABASE_URL`; set `DIRECT_DATABASE_URL` only if migrations require a
   separate direct connection. Prisma commands also read these values from the
   repository-root `.env`, with exported values overriding each file value.
   A nonblank direct URL takes precedence over the application URL. Development
   commands load root `.env`; production still requires process configuration.
   Use a disposable/test database for initial QA.
3. Generate four independent 32-byte base64url keys with this command, once
   per key, and retain them in your local secret configuration:

   ```sh
   node -e 'console.log(require("node:crypto").randomBytes(32).toString("base64url"))'
   ```

4. Set `GALLERY_CURSOR_KEY`, `GALLERY_SESSION_KEY`, `AUTH_FLOW_KEY`, and
   `DRIVE_TOKEN_KEY` to four different values. Set `DRIVE_TOKEN_KEY_VERSION=v1`.
   Changing the flow key invalidates pending sign-ins; changing gallery keys
   invalidates their cursors/sessions. Do not replace the Drive token key until
   stored credentials have been migrated or users will need to reconnect.
5. Provision an existing absolute private directory (permissions
   0700) on persistent local storage. Only generated previews belong there.
   Set `DERIVATIVE_STORE_ROOT` to that validated directory.
   For development, an ignored `.local/derivatives` directory inside this checkout
   is suitable; use its absolute path and private permissions on both directories.
   The server/readiness probe never creates it automatically. Do not use this
   checkout-local directory as an unplanned production volume or store originals.
6. Run `pnpm --filter @photographer-platform/database db:deploy` and
   `pnpm --filter @photographer-platform/database db:generate`.

Use these consistent origins for local testing:

```dotenv
API_HOST=127.0.0.1
API_PORT=4000
API_BASE_URL=http://127.0.0.1:4000
PUBLIC_API_BASE_URL=http://127.0.0.1:4000
PUBLIC_WEB_BASE_URL=http://127.0.0.1:3000
```

Do not mix localhost and 127.0.0.1: they are different cookie hosts. In a hosted
pilot use HTTPS with web and API behind one hostname. API_BASE_URL may address
the internal API; the two PUBLIC values describe browser-reachable origins.

### Hosted PostgreSQL CA certificates

When the provider supplies a trusted CA certificate, mount it as a local file
and set `sslmode=verify-full` plus `sslrootcert` in each hosted PostgreSQL URL.
Use an absolute path and URL-encode it, for example this **query suffix only**:

```text
?sslmode=verify-full&sslrootcert=%2Fabsolute%2Fprivate%2Fpath%2Fca.pem
```

Preserve the URL's existing host, database, credentials and other parameters;
use `&` when extending an existing query. This works with the pg-backed Prisma
adapter and the Prisma CLI connection URL. Do not combine URL SSL options with
a separate pg ssl object: URL parsing can replace that object. Do not use
`rejectUnauthorized=false`, `sslmode=no-verify`, or global TLS-verification
disable switches to work around trust errors. Use the provider's authentic
CA, not a certificate collected from an unverified failed connection.

The repository-root `ca.pem` is git-ignored; it is not bundled in the application
artifact. Hosted processes must mount the correct file and configure their own
paths. Restart `pnpm dev` after editing the URLs; for production, export the
updated URLs or set them in the process manager before restarting the API.
An already-running process does not pick up root .env changes. Prisma commands
and app development launchers read root .env; exported values override it.
CA setup does not apply migrations or enable remote test fixtures;
the SQL test guard below remains loopback-only even if a remote TLS probe works.

References: [node-postgres TLS configuration](https://node-postgres.com/features/ssl)
and [PostgreSQL certificate verification](https://www.postgresql.org/docs/current/libpq-ssl.html).

## Browser security policy

Set PUBLIC_WEB_BASE_URL and PUBLIC_API_BASE_URL in the **web runtime** as well
as the API. They must be bare origins with the same hostname and scheme (ports
may differ locally). The web CSP never uses private API_BASE_URL as an image/
form allowlist. Invalid public settings fail closed to self-only destinations.
Use the loopback defaults for local development; hosted HTTP is not supported.
Production requires both PUBLIC values explicitly, including when testing a
production build locally; missing values do not grant development destinations.

The policy is enforced automatically; no key or CSP environment toggle is needed.
Web documents use `Referrer-Policy: strict-origin`, retaining the originating
web origin for native POSTs to a different API port without sharing private
paths/query strings or sending referrers on HTTPS-to-HTTP downgrade. Do not
replace it with `same-origin`/`no-referrer`: native cross-port POSTs then carry
`Origin: null` and correctly fail API CSRF checks. The API retains `no-referrer`,
including OAuth redirects/callbacks. `null` and mismatched origins remain denied.
Production scripts receive a fresh request nonce, HTML/RSC responses are no-store,
and static assets retain caching. Only application image origins are allowed.
Google is allowed only for the top-level OAuth form redirect. Development eval,
HMR style and exact-origin WebSocket allowances do not carry into production.
Inline style attributes remain allowed for photo aspect ratios, not scripts.

Before a hosted pilot, verify sign-in/Drive redirect, password unlock, images,
selection/comment/submit, owner export/clipboard and both languages in supported
browsers. Test the **production build**, not only next dev. Keep baseline/CSP
headers at the reverse proxy and do not cache nonce documents/RSC. Configure
HSTS only at the selected HTTPS edge after confirming hostname/subdomain scope;
do not enable preload or trust arbitrary forwarded headers. See ADR-037.

## Google photographer sign-in

1. Create/select a Google Cloud project and configure Google Auth Platform
   branding, audience, support contact and test users as appropriate.
2. Create an OAuth client of type **Web application**.
3. Register this exact authorized redirect URI:
   `http://127.0.0.1:4000/api/v1/auth/google/callback`.
4. Set `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, and the separate
   `AUTH_FLOW_KEY` privately in the API environment.
5. Start `pnpm dev`, open `http://127.0.0.1:3000/signin`, and use Continue with
   Google. Success opens `/workspace`; Sign out revokes the database session.

The current sign-in requests only `openid email profile`. It does not connect
Drive, create albums, or fetch photos. No additional browser API key is needed
for this server-side sign-in flow. Missing auth configuration displays an
unavailable state; partial or unsafe configuration fails API startup.

Official setup guidance:
https://developers.google.com/identity/protocols/oauth2/web-server

## Google Drive authorization

1. Enable the Google Drive API in the same Google Cloud project.
2. Add `openid`, email, and
   `https://www.googleapis.com/auth/drive.file` to the consent configuration.
   The application does not request broad `drive` or `drive.readonly` access.
3. Register this second exact authorized redirect URI:
   `http://127.0.0.1:4000/api/v1/drive/google/callback`.
4. Set `DRIVE_TOKEN_KEY` and `DRIVE_TOKEN_KEY_VERSION=v1` privately in the API
   environment. The encryption key must differ from every other application key.
5. Sign in, open `/workspace`, and choose **Connect Google Drive**. Consent is
   owner-bound and separate from sign-in. Disconnect deletes the locally
   encrypted refresh token and then attempts Google revocation.

Only the refresh token is retained, encrypted with AES-256-GCM and bound to
the application owner and Google account. Access and ID tokens are discarded.
The `drive.file` grant is intentionally narrow. A real-account Picker/folder
pilot must still prove whether it exposes the intended pre-existing direct
children; folder selection and album import remain disabled until that gate is
passed. Testing-mode external apps can issue refresh tokens with limited
lifetimes, so reauthorization behavior must be exercised.

## Explicit preview processing for existing indexed albums

After applying migrations, exporting the API environment, connecting Drive and
provisioning the existing private derivative volume, build dependencies/API:

```sh
pnpm --filter @photographer-platform/shared build
pnpm --filter @photographer-platform/database build
pnpm --filter @photographer-platform/google-drive build
pnpm --filter @photographer-platform/api build
pnpm --filter @photographer-platform/api preview:batch --owner=OWNER_ID --album=ALBUM_ID --limit=10 --confirm=processing
```

Replace OWNER_ID/ALBUM_ID with the exact verified private records. This is a
privileged operator command, never a browser action accepting arbitrary owners.
It changes preview state and writes generated WebP derivatives; it does not
create/import albums, change scopes or persist originals. It requires the same
exported runtime/auth/Drive keys as the API; it does not autoload `.env`.

The JSON summary contains status, per-status counts, safe codes and an encrypted
`nextCursor`; it excludes provider credentials, filenames and original bytes.
For `page-full`, repeat the same command with `--cursor=RETURNED_CURSOR` (keep
private). `blocked` returns a cursor before the deferred photo: fix the reported
authorization/quota/storage problem and retry it. `catalog-changed` means restart
without a cursor. Exit 0 means `complete`/`page-full`, 2 means blocked/cancelled/
catalog-changed, and 1 means configuration/lock/infrastructure failure. `complete`
does not mean every photo is READY: inspect failed/unsupported/needs-sync counts.
HEIC/RAW remain `decoder-not-enabled`; no fake conversion is supplied.

Each invocation processes at most 25 photos serially, has a cooperative
two-minute deadline, and never runs from a gallery request. Stop with SIGINT or
SIGTERM. A private-volume `.preview-batch-lock` prevents cooperating invocations
from overlapping. After a hard kill or crash, confirm **all** preview processors
on that volume have stopped, then remove only that exact empty lock directory
with `rmdir` using the validated absolute volume path. Never use recursive
deletion, automatic stale-lock takeover or remove a live processor's lock.
Follow ADR-036/OPERATIONS before using this pilot path with real private images.

## Owner workspace acceptance checks

Apply all migrations (including owner dashboard indexing/selection revision)
before starting the API. Once authenticated, `/workspace` lists real indexed
albums in pages of 25. `/workspace/albums/{albumId}` reviews 50 selections at a
time, including comments and retained removed photos, and provides copy/open
gallery, submitted/locked filename download, lock/reopen and archive controls.
No extra Google scope or browser API key is needed for these local operations.
Thumbnails require the persistent derivative store and a current READY preview.
There is no synthetic album seed or public endpoint that accepts an owner ID.

The internal draft creator also requires the creation-receipt migration
`202610050001_album_creation_receipts` and a validated stable UUID per intended
creation. Retry an uncertain outcome with the same UUID and unchanged settings/
password; do not generate a new UUID on each retry. Receipts keep the original
response and do not change a later archive/publication state. This is not a
dashboard create/import endpoint; consent/child-access and HTTP capacity gates
still apply. No application/remote migration was run in phase 3H.

With a live database and real albums, verify:

- Two photographers cannot list/read/export/change each other's albums or
  selected thumbnails. An expired session returns to sign-in.
- Album/selection continuation remains bounded; a client edit between review
  pages causes an explicit restart instead of missing entries.
- Submitted and locked filename downloads contain naturally ordered, escaped
  one-per-line filenames and include soft-removed selections. Reopening
  disables download until resubmission.
- Password-protected owner review needs only the owner session, not the gallery
  password. Missing derivatives show a fallback without requesting originals.
- Confirmed archive closes guest pages/images/mutations, preserves history and
  exports, leaves Drive originals unchanged, and rejects concurrent active sync.
- Test English/Vietnamese controls on mobile and clipboard/download behavior in
  real supported browsers. Automated render tests do not replace this check.

## Automated PostgreSQL and CI checks

The checked-in GitHub Actions workflow runs builds, all TypeScript checks,
lint, unit/HTTP/render tests, migrations and PostgreSQL integration tests in
an ephemeral PostgreSQL 17 service. It needs no Google credentials or production
secrets. Actions are pinned to reviewed official commit hashes; the workflow
uses read-only repository permissions and does not deploy or publish anything.
It has not been run on GitHub from this environment.

### Recommended: a newly isolated cluster per run

Provide an installed PostgreSQL **17** toolchain (`postgres`, `initdb`, `pg_ctl`,
`createdb`) in an absolute binary directory. Use a normal non-root macOS/Linux
account, installed workspace dependencies and built shared/database/Drive packages:

```sh
pnpm --filter @photographer-platform/shared --filter @photographer-platform/database --filter @photographer-platform/google-drive build
POSTGRES_BIN_DIR=/absolute/path/to/postgresql-17/bin pnpm test:postgres
```

The launcher creates a private temporary directory, random SCRAM password,
loopback-only port and fresh randomly named `_test` database. It applies all
reviewed migrations through `prisma-test.config.ts`, runs the complete suite and
stops/removes only its newly created cluster. It installs no service, accepts no
database URL/cluster path and does not read root `.env`, inherit private URLs,
OAuth/loader/proxy settings or modify an existing database. Interruption still
attempts owned-cluster shutdown. If shutdown cannot be confirmed, the private
directory is preserved and a cleanup-required event identifies it; verify that
cluster's process state before removal. Do not delete a running cluster.

This command needs local socket/process permission. It supports neither root
execution nor Windows; the checked-in PostgreSQL service CI is the alternative.
PostgreSQL binaries are a prerequisite, not silently downloaded or globally
installed by the launcher. Phases 3G/3H used official checksum-verified 17.11
source builds under temporary prefixes; those one-use runtimes were removed afterward.
See [PostgreSQL source installation](https://www.postgresql.org/docs/17/install-make.html).

### Alternative: an explicitly managed disposable database

For local integration tests, create a separate disposable loopback PostgreSQL
database named `photographer_platform_test`. Set TEST_DATABASE_URL explicitly
to that database; it must end in `_test`, use 127.0.0.1/localhost/::1, and have no
query parameters. The test suite never falls back to DATABASE_URL. Apply the
migrations to that exact disposable target:

```sh
pnpm --filter @photographer-platform/shared --filter @photographer-platform/database --filter @photographer-platform/google-drive build
pnpm --filter @photographer-platform/database exec prisma migrate deploy --config prisma-test.config.ts
pnpm test
```

If TEST_DATABASE_URL is absent, the real PostgreSQL suite is clearly skipped;
a green unit test run is not evidence that row locks or migrations ran. Unsafe
explicit targets fail test collection. Fixtures use unique per-run owner/album
IDs and cleanup deletes only those exact generated records, never truncating
the database. The suite covers concurrent selection caps/submission, composite
foreign keys, duplicate constraints, ownership, archive, preview batch
continuation/publication state, draft creation/rollback/slug collisions,
durable creation replay and matching/conflicting same-key races,
idempotent reconciliation/removal/reactivation/lease recovery and 500/5,000-photo
gallery pagination with representative query plans. Timing output describes
metadata queries on the test database, not production browser/network budgets.
Phase 3H passed all 657 tests (22 real SQL checks) after six migrations against
fresh PostgreSQL 17.11;
actual GitHub CI, staging, Google/device acceptance and restore drills remain open.

The undeployed active-sync migration was reordered after initial metadata
creation. If you have independently applied the old
`20260929_active_sync_run` name anywhere, stop and reconcile that environment's
Prisma migration history before deploying; never rewrite applied history.

Workflow references: [official pnpm action](https://github.com/pnpm/action-setup)
and [GitHub PostgreSQL services](https://docs.github.com/en/actions/tutorials/use-containerized-services/create-postgresql-service-containers).

## Next integration gates

Use `/health/ready` for configured proofing infrastructure, not `/health/live`.
The derivative root must already exist with 0700 permissions. Readiness checks
schema/storage without reading rows or calling Google and does not replace the
end-to-end checks. Release, backups, restore drills, retention and incidents are
documented in [OPERATIONS.md](./OPERATIONS.md); no backup/restore was executed.

- Prepare a private test folder with existing
  JPEG/PNG images and representative HEIC/RAW samples. Picker testing will
  additionally need Google Picker API configuration when that flow is added.
- Verify whether the least-privilege file-specific grant covers the intended
  existing-folder workflow before settling ADR-011. Broader read-only access
  has restricted-scope verification obligations.
- Verify the actual Google callback, logout, expired session, and two different
  photographer accounts against PostgreSQL. Unit tests cannot prove the live
  cookie/consent/database path.
- Album creation's internal validated/retry-safe boundary is implemented, but
  creation/import/publication HTTP/UI, processing orchestration and HEIC/RAW
  decoders remain implementation work. Owner review UI/API and exports exist but
  require the real-account/database checks above.
- Before a public pilot: measure 500/5,000-photo performance, validate concurrent
  selections and query plans, deploy edge abuse controls, establish database
  backups/restore and preview retention, and run mobile/browser acceptance QA.
