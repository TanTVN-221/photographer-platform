# Project Instructions

## Product context

This repository contains a photographer-oriented Digital Asset Management and Client Proofing platform.

Before making product or architectural decisions, read:

- `docs/PRODUCT_SPEC.md`
- `docs/REQUIREMENTS.md`
- `docs/MVP_SCOPE.md`
- `docs/ARCHITECTURE.md`
- `docs/DECISIONS.md`

`docs/PRODUCT_SPEC.md` is the product source of truth. Requirement IDs in `docs/REQUIREMENTS.md` provide traceability.

## Priority order

Optimize for these priorities, in order:

1. Fast browsing of large photography folders and galleries.
2. Low infrastructure, storage, and bandwidth cost.
3. Google Drive remains the source of truth for original files during the MVP.
4. A clean photographer-oriented and mobile-friendly client experience.
5. Maintainable, strict TypeScript architecture.
6. A practical path to a multi-tenant SaaS product.

Do not sacrifice the first three priorities without documenting the trade-off.

## Architecture rules

- Build the MVP as a modular monolith in a pnpm workspace.
- Use Next.js/React/Tailwind for `apps/web`.
- Use Node.js/Express/Zod for `apps/api`.
- Use PostgreSQL/Prisma in `packages/database`.
- Isolate Google Drive API code in `packages/google-drive`.
- Keep shared schemas and DTOs in `packages/shared`.
- Keep reusable presentational components in `packages/ui`.
- Do not introduce microservices, Redis, queues, Elasticsearch, or Kubernetes without a measured need and a recorded decision.

## Google Drive rules

- Original photographs remain in Google Drive during the MVP.
- Do not permanently duplicate original files into application storage.
- PostgreSQL stores Drive metadata and application state, not original image bytes.
- Folder navigation and gallery listing should normally be served from indexed local metadata, not a fresh Drive API list call on every page load.
- Sync operations must be paginated, idempotent, retry-safe, and able to detect additions, metadata changes, and removals.
- Do not recursively traverse subfolders in the MVP unless the scope is explicitly changed.
- Preserve natural filename ordering.
- Keep Google-specific code behind interfaces such as `StorageProvider`, `GoogleDriveService`, and `ImageUrlProvider`.
- Do not spread `googleapis` calls through route handlers, database code, or frontend components.

## Image performance rules

- Never load original-resolution images in a normal gallery grid.
- Assume galleries may contain 500–10,000 photos even though the initial target is 500–5,000.
- Use cursor-based pagination or a similarly stable continuation mechanism.
- Use lazy loading, responsive thumbnails, stored width/height, cache headers, and controlled prefetching.
- Use virtualization or windowing where measurement shows it is needed.
- Avoid mounting thousands of photo components simultaneously.
- The frontend must depend on an application image contract, not hard-coded Google Drive thumbnail URL details.

## Selection rules

- Never put `isSelected` on the `Photo` model.
- Selection state belongs to `Selection` and `SelectionItem`.
- The existence of a `SelectionItem` represents a selected photo.
- Enforce selection limits on the backend inside a transaction or equivalent concurrency-safe operation.
- Concurrent requests must not exceed the configured limit.
- Submitted and locked states must be explicit and enforced by the backend.

## Security rules

- Never store plaintext gallery passwords, OAuth refresh tokens, access tokens, API keys, or application secrets in source code.
- Hash gallery passwords with a suitable password-hashing algorithm.
- Encrypt refresh tokens at rest when OAuth Drive access is implemented.
- Request the minimum Google OAuth scopes needed for the feature set.
- Validate untrusted input with Zod at the boundary.
- Authorization-check every photographer-owned resource.
- Do not expose sequential database IDs in public gallery URLs.
- Avoid leaking Drive credentials or private file URLs to unauthorized clients.

## Engineering rules

- Use strict TypeScript. Avoid `any` unless the reason is documented.
- Prefer simple, testable modules over speculative abstraction.
- Use Prisma transactions where consistency or concurrency matters.
- Write production-quality code; do not present placeholders or mocked paths as completed functionality.
- Do not silently change an accepted decision. Explain the reason, consequences, and migration path, then update `docs/DECISIONS.md`.
- Preserve requirement IDs in implementation plans, tests, and completion reports.

## Implementation process

For significant work:

1. Read the relevant product documents and inspect the repository.
2. Update `.agent/CURRENT_PLAN.md` before implementation.
3. Identify the exact requirement IDs in scope.
4. Implement one coherent phase only.
5. Run relevant type checks, tests, linting, and Prisma validation.
6. Inspect the final diff and verify acceptance criteria.
7. Update documentation when architecture or scope changed.
8. Report implemented, partially implemented, and deferred requirement IDs.

Do not proceed into a different product phase unless the task explicitly requests it.

## Completion standard

Never claim a feature is complete merely because code exists. Before reporting completion, record the checks performed and any checks that could not be run.

