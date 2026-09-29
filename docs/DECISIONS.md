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

Status: Accepted

### Decision

MVP album sync scans only direct children of one Drive folder and imports JPEG, PNG, and WebP metadata.

### Consequences

- Import rules are understandable and testable.
- Recursive sections, HEIC/TIFF/RAW, video, and preview conversion are deferred.

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

### ADR-012 — Private thumbnail/preview delivery

Status: Proposed

Decision needed: Prototype official Drive thumbnail links and a constrained thumbnail proxy/cache. Compare privacy, expiry, CORS, quota, cacheability, egress, and hosting limits. Do not standardize an undocumented URL pattern without evidence.

### ADR-013 — Sync execution model

Status: Proposed

Decision needed: Run bounded manual sync inline for the first slice or introduce a minimal background execution mechanism if realistic 5,000-file sync exceeds hosting time limits.

### ADR-014 — Selection concurrency mechanism

Status: Proposed

Decision needed: Choose row locking, serializable transactions, or a counter-based constraint and prove it with a concurrency test.

### ADR-015 — Gallery password session

Status: Proposed

Decision needed: Define the signed/encrypted session format, TTL, cookie settings, rate-limit key, and revocation behavior.

### ADR-016 — Performance budgets

Status: Proposed

Decision needed: Establish target devices, networks, data sizes, and numeric budgets for first response, first useful gallery render, page fetch, layout shift, interaction latency, and image failure rate.

