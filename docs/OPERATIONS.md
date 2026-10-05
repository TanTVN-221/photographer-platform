# Release, backup and incident runbook

Scope: the persistent single-instance private pilot (ADRs 025/028/033–035).
Requirement traceability: OPS-002/003, DB-005, SEC-002/004. These procedures are
documented, not an executed production restore drill. Hosting, backup scheduling,
recovery targets and edge controls must be configured and verified before launch.

## Readiness and monitoring

`GET /health/live` proves only the API process responds. `GET /health/ready`
returns 200/ready or 503/not-ready with no dependency detail. Readiness requires
configured photographer/Drive authorization and guest-proofing boundaries,
the current PostgreSQL schema, and an existing private derivative directory
with read/write/traverse permissions. It does not call Google, read any original,
test a user's consent, prove spare disk space or claim the product is complete.
Schema probes return no rows, use a two-second SQL statement timeout and a
three-second transaction timeout; calls coalesce and cache for five seconds.
An unconfigured foundation remains live but deliberately not ready for proofing.

Monitor readiness, 5xx/409/429 rates, request latency by fixed route label,
process memory, database connection pressure and volume capacity. Structured
http_request events contain requestId, fixed route, method, status, durationMs
and an optional stable errorCode. Never add raw exceptions, request URLs,
cookies, authorization headers, passwords, filenames, email or tokens to logs.
Use correlation IDs to investigate; a 409 selection conflict is not itself a
server failure. The deployment must supply log aggregation/alerts and the
trusted-proxy/edge rate-limit policy; they are not implemented by a local logger.

## Release and migration procedure

1. Review the exact release diff and migrations. Require green CI, including
   real PostgreSQL tests; a locally skipped SQL suite is insufficient.
2. Verify a recent recoverable backup, available versioned encryption keys,
   persistent private preview storage and a known previous application artifact.
3. Apply migrations in an isolated staging database first. Verify actual SQL
   checks/partial indexes and test two-owner isolation and concurrent selection.
4. During the approved release window, apply reviewed additive migrations with
   `pnpm --filter @photographer-platform/database db:deploy` using a separately
   privileged direct connection. Do not point integration tests at this target.
5. Deploy built API/web artifacts, with secrets loaded by the process manager
   and HTTPS/same-host origins. Verify readiness, sign-in, protected gallery,
   selection, filename download and a non-destructive archive of a test album.
6. Observe error/latency changes and record the release artifact, schema versions,
   smoke-check result and recovery contact. Do not record credential values.

Rollback is normally an application rollback while retaining compatible additive
schema changes. Prisma deploy does not supply automatic down migrations. Do not
use migrate reset, drop tables, truncate, blindly mark migrations applied or
rewrite applied migration directories. A destructive schema rollback needs a
reviewed explicit recovery/migration plan, backup and authorization. Restore to
a new isolated database first, validate it, then approve a cutover. Never restore
over a live database merely to reverse a UI release.

The active-sync migration name was corrected in the undeployed repository
baseline (ADR-034). If an environment applied the old name independently,
reconcile its history before deployment rather than renaming applied history.

## Database backups and restore drill

Use the chosen database provider's scheduled encrypted snapshots/PITR where
available. Before a pilot, the deployment owner must record backup frequency,
retention, access policy, RPO/RTO targets, restore contact and a tested recovery
time. No recovery guarantee or configured scheduler exists in this repository.

A logical custom-format pg_dump is an additional portable database snapshot;
it does not back up cluster roles/tablespaces. It must be made with appropriate
read privileges and compatible PostgreSQL client tools. Follow the
[PostgreSQL SQL dump guidance](https://www.postgresql.org/docs/17/backup-dump.html)
and [pg_dump reference](https://www.postgresql.org/docs/17/app-pgdump.html).

Configure private libpq service entries `pp_backup` and `pp_restore_drill` and a
0600 password file through operator secret management. The backup service must
resolve to the explicitly approved source. The restore service must resolve to
a newly created empty isolated database, never the source/production database.
Do not paste a credential-bearing connection string into shell arguments/logs.
Set PP_BACKUP_FILE to a new validated absolute path in a private backup volume;
do not reuse an existing file. Only after checking these exact targets:

```sh
set -eu
test -n "$PP_BACKUP_FILE"
test ! -e "$PP_BACKUP_FILE"
umask 077
pg_dump --dbname='service=pp_backup' --format=custom --file="$PP_BACKUP_FILE"
pg_restore --list "$PP_BACKUP_FILE"
```

Encrypt completed archives with the deployment's approved key management and
retain them off-host under the agreed policy. A listable archive is not a restore
test. Archives contain sensitive client/owner metadata, password hashes,
encrypted credentials and session hashes; never commit or upload them to public
CI artifacts. Store versioned Drive decryption keys separately with restricted
recovery access; a database backup alone cannot recover encrypted refresh tokens.

Restore only a trusted backup after validating the isolated target and original
schema/application version. This command intentionally omits --clean/--create
and stops on an error within one transaction:

```sh
pg_restore --dbname='service=pp_restore_drill' --single-transaction --exit-on-error --no-owner --no-privileges "$PP_BACKUP_FILE"
psql 'service=pp_restore_drill' -X --set=ON_ERROR_STOP=on -c 'ANALYZE;'
```

See the [pg_restore reference](https://www.postgresql.org/docs/17/app-pgrestore.html).
Verify migration history, constraints/indexes, row counts, two-owner isolation,
selection statuses/comments/limits, naturally ordered exports and gallery
pagination. Test against a clone that cannot contact real Google accounts; do
not run disconnect/revocation on restored production credentials. Record actual
restore time and data loss window. Approve privileges, session invalidation and
Google reconnection behavior separately before any cutover. A restore may revive
older application state; it must not silently re-enable old sessions or pretend
a revoked Google grant is still usable.

## Preview storage and retention

Drive remains authoritative for originals. PostgreSQL backups contain no original
image bytes. The configured private derivative volume is a separate resource;
provider snapshots or controlled regeneration need their own recovery procedure.
Never copy a running PostgreSQL data directory as a substitute for an approved
database backup. [PostgreSQL file backup guidance](https://www.postgresql.org/docs/17/backup-file.html)
describes the consistency constraints.

Archived application metadata, selections/comments and available derivatives are
retained indefinitely in this pilot. There is no purge/delete/restore API or
automatic old-preview cleanup. Archive never deletes Drive originals. Monitor
volume growth; before it becomes a cost/capacity problem, agree and implement a
retention/purge policy with explicit owner confirmation, audit and recovery
rules. Do not manually delete derivative paths or database rows as routine
maintenance. Missing previews must remain an explicit fallback, not an original
download. There is no unverified promise of recovering a source deleted in Drive.

### Explicit processing and crash recovery

Use only the confirmed, owner-bound `preview:batch` command documented in
LOCAL_SETUP for existing indexed albums. Read its counts/codes: `complete` is
not proof every photo rendered. Deferred outcomes stop at a retry cursor;
catalog changes require restarting the traversal. Preserve continuation
privately and do not increase concurrency or broaden scopes to fix failures.

The exclusive empty `.preview-batch-lock` directory under the validated private
volume prevents cooperating command invocations from overlapping. Normal exit
or handled cancellation removes it; a hard kill/power loss can leave it behind.
First confirm all preview processors using the volume are stopped, then remove
only that exact empty directory with `rmdir`. Never recursively delete preview
storage, steal a live lock, or implement automatic age-based takeover. The
two-minute cooperative deadline is not a hard native decoder/process sandbox;
monitor memory/CPU/quota and stop the pilot if resource behavior is unsafe.
Multi-instance processing remains unapproved until a durable execution/capacity
policy and shared-store semantics are measured.

## Incident handling

- Readiness failure: check configuration, migrated schema, database access and
  volume existence/permissions/capacity in private operator tools. Never expose
  the failing path, DSN or token to public responses. Restart only when the
  cause warrants it; liveness alone is not recovery evidence.
- Selection/export failure: use requestId + stable operation/errorCode. Check
  album ownership/publication and DRAFT/SUBMITTED/LOCKED state before any retry.
  Never force a submitted selection back to draft through SQL. Use the authorized
  confirmed reopen flow when the photographer requests client edits.
  Archive refuses an active sync lease; an expired 30-minute lease is marked
  failed under the album lock so a crashed run does not block archive forever.
- Google invalid/revoked grant: the connection becomes reauth-required and
  ciphertext is cleared. Ask the owner to reconnect. A transient provider/quota
  failure is not a reason to delete credentials or broaden OAuth scope.
- Suspected credential/session exposure: preserve redacted evidence, restrict
  access, obtain the incident owner's approval for revocation and rotation, and
  follow an explicit affected-account recovery plan. Drive token key changes
  require a decrypt/re-encrypt migration or deliberate reconnect; replacing a
  key blindly strands existing encrypted credentials. Flow/session/cursor key
  rotation invalidates corresponding cookies/pages and must be communicated.
- Suspected data loss: stop unsafe writes according to the incident plan,
  snapshot evidence, restore into isolation, validate, then approve cutover and
  user notification. Do not overwrite the only remaining copy.

Record incident timeline, impacted requirement IDs, recovery evidence and follow-up
tests without sensitive payloads. Hosting alerts, successful restore drills,
production rate limits, deployed CSP/HTTPS browser verification, Google folder
access, HEIC/RAW decoder policy and
device/network-specific performance targets remain explicit release gates.

## Browser-policy release checks

Web documents/RSC carry a fresh enforced nonce CSP and no-store; do not apply a
shared HTML cache or strip request/response policies at the edge. Static assets
keep cache headers. Configure same-host/scheme PUBLIC origins in both runtime
processes; private API_BASE_URL is not a browser source grant. Review headers
from the real HTTPS hostname, including fallback errors and native OAuth POST
redirects. Keep form destinations narrow; do not fix a violation with wildcard
scripts/images or production unsafe-eval/inline script grants.

API resources use CORP same-site, no CORS read/credential grant and no-referrer;
this preserves same-host images across loopback ports, not cross-site embedding.
Configure HSTS at the selected TLS edge after validating domain/subdomain scope,
without blindly enabling preload. No CSP-report sink currently logs private
URLs; use browser diagnostics for pilot triage and design redacted/bounded
reporting before introducing an external collector. ADR-037 records the policy
and the remaining live OAuth/gallery/mobile/HTTPS acceptance checks.
