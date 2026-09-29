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

### Drive workspace

- Provider-neutral `StorageProvider` contract.
- Google OAuth client and token refresh.
- Folder/file listing and narrow metadata mapping.
- Future folder mutations and upload.

### Albums and catalog

- Album creation, publication, archive, and listing.
- Album-scoped `Photo` metadata and cursor queries.
- Natural sort keys.
- Dashboard summaries.

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

### Selections

- Draft selection creation or retrieval.
- Transactional add/remove/comment.
- Selection-limit enforcement.
- Submit, lock, and reopen policy.
- Photographer review and filename export.

## 4. Proposed domain data

The exact Prisma schema is a Phase 2 deliverable. The expected relationships are:

```text
Photographer 1---n DriveConnection
Photographer 1---n Album
Album        1---n Photo
Album        1---n Selection
Selection    1---n SelectionItem n---1 Photo
Album        1---n SyncRun
```

Important constraints:

- Unique photographer email or provider account identity.
- Unique album `publicSlug`.
- Unique `(albumId, driveFileId)`.
- Unique `(selectionId, photoId)`.
- A selection item photo must belong to the same album as its selection; enforce in service logic and, where practical, database constraints.
- Soft-deactivated photos remain addressable for history but are excluded from active gallery listing.
- Selection mutations use a transaction and row/advisory locking strategy selected in Phase 2.

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
7. Upsert in bounded batches under the unique album/file constraint.
8. Mark unseen previously-active photos inactive only after a complete successful listing.
9. Store sync counts and publish the album when policy allows.

### Incremental strategy

For the first MVP, a complete manual folder reconciliation is simpler and safer than a distributed webhook system. Future optimization may use the Drive Changes API and periodic reconciliation. Do not mark items removed when a partial listing fails.

### Idempotency and concurrency

- Reject or coalesce concurrent syncs for the same album.
- Use a sync-run lease/status with timeout recovery.
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

Do not proxy originals by default. If a thumbnail proxy is chosen, constrain sizes, authenticate private access, stream safely, set cache policy deliberately, and prevent it from becoming an open proxy.

## 8. API conventions

- Prefix routes with `/api/v1`.
- Validate params, query, body, and external response mapping with Zod.
- Use opaque cursor tokens that encode the stable sort tuple, not raw offsets.
- Return a consistent error envelope with a request/correlation ID.
- Separate public gallery DTOs from private album DTOs.
- Use idempotency semantics for submit and other retry-prone mutations.
- Keep list responses narrow; fetch detail only when needed.

Candidate cursor sort tuple: `(sortOrder, id)` or `(naturalSortKey, id)`. The database representation of natural ordering must be proven before final schema selection.

## 9. Selection consistency

For select:

1. Authorize the gallery session and verify selection is draft.
2. Start a transaction and lock the selection row or use an equivalent serializable strategy.
3. If item already exists, return success idempotently.
4. Count active items and enforce the album limit.
5. Insert the unique selection item.
6. Commit and return the authoritative count.

Deselect is allowed at the limit but not when locked. Submit transitions only from draft and is idempotent. The final isolation/locking approach belongs to Phase 2 and needs a concurrency test.

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

Use Argon2id or a currently suitable equivalent for gallery passwords after verifying deployment support. Public slugs must use cryptographically secure randomness. Define CSP image sources only after the delivery mechanism is chosen.

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
| Metadata index and sync | DRIVE-005–015, DB-* , OPS-001 |
| Album/gallery APIs | ALB-*, GAL-*, PERF-001, PERF-005 |
| Image provider | IMG-*, PERF-002–004 |
| Transactional selection | SEL-*, EXP-* |
| Operations | OPS-*, PERF-006–007 |

## 16. Unresolved gates

- Exact Google OAuth scopes and consent/verification path.
- Production image delivery mechanism for private Drive files.
- Natural-sort key representation and pagination stability.
- Database transaction/locking implementation for selection limits.
- Where sync executes if request duration exceeds the chosen hosting limit.
- Gallery password session format and revocation behavior.
- Quantitative performance budgets and target device/network matrix.
- Data retention and account/album deletion policy.

These gates must be recorded or resolved in `docs/DECISIONS.md` before their implementation phases.

