# MVP Scope

Status: Proposed scope boundary

## MVP outcome

A photographer can sign in, connect Google Drive, create a proofing album from one Drive folder, share a fast public or password-protected gallery, receive one client selection with comments, and export the selected filenames.

The MVP proves the product's two highest-risk claims:

1. A locally indexed Drive-backed gallery feels materially faster than browsing the same large folder in the standard Drive UI.
2. The complete selection workflow is reliable without hosting original photographs.

## In scope

### Foundation

- pnpm monorepo with strict TypeScript.
- Next.js web app and Express API.
- PostgreSQL and Prisma migrations.
- Shared Zod DTOs and common UI package.
- Local development environment and documented environment variables.
- Basic automated tests, linting, type checking, and CI.

### Photographer authentication

- Google sign-in for photographer accounts.
- Secure application session.
- One photographer owns each album.
- Google Drive OAuth connection using approved least-privilege scopes.
- Encrypted refresh token storage.

### Drive-backed album creation and sync

- Select or provide one accessible Drive folder.
- Direct-child images only.
- JPEG, PNG, and WebP only.
- Complete Drive pagination.
- Local metadata indexing in PostgreSQL.
- Natural filename order.
- Idempotent manual sync.
- Add/update/soft-remove reconciliation and sync summary.
- Stored filename, MIME type, Drive file ID, width, height, size/timestamps when available.

### Photographer dashboard

- Album list and create flow.
- Title, photo count, selected count, status, and timestamp summary.
- Copy/open public gallery URL.
- Trigger sync and see the last result.
- Review selected photos and comments.
- Export the submitted selection as a text file.
- Archive/delete the application album without deleting Drive originals.

### Client gallery

- Non-sequential public slug.
- Optional password protection.
- Paginated, responsive image grid.
- Lazy loading and reserved aspect ratio.
- Appropriate thumbnail/preview delivery through an image-provider contract.
- Lightbox with desktop keyboard and mobile-friendly controls.
- Select/deselect and visible count/limit.
- Comment on a selected photo.
- Submit a selection and show confirmation.
- Backend-enforced selection limits and state transitions.

### Operational minimum

- Structured, redacted error logging.
- Basic rate limiting on public password and mutation endpoints.
- Health checks.
- Drive error mapping and bounded retry for safe reads.
- Representative performance test dataset of 500 and 5,000 records.

## Explicitly out of scope

- Hosting or permanently copying original photos.
- Recursive subfolder traversal and photo sections.
- General-purpose Drive replacement for every file type.
- Full folder create/rename/move/delete/upload UI; these belong to the next workspace phase after proofing MVP validation.
- HEIC, TIFF, RAW, video, or server-side preview conversion.
- Client accounts, multiple clients, or multiple selection lists per album.
- Email, SMS, or WhatsApp notifications.
- Guest download management.
- Custom branding, logo, watermark, or custom domain.
- Tags, advanced search, analytics, face recognition, or face search.
- R2/CDN migration.
- Teams, roles, billing, subscription plans, or admin console.
- Native mobile apps.
- Microservices, Redis, queues, Elasticsearch, or Kubernetes unless a measured blocker forces a decision change.

## Acceptance criteria

The MVP is ready for a private pilot only when:

- All `MVP` requirements selected in the implementation plan are traceable to tests or manual verification evidence.
- A 5,000-record gallery can be navigated without mounting the entire collection or fetching originals into the grid.
- Drive import proves it handles every page and re-running sync creates no duplicate photos.
- Added, modified, trashed, and removed Drive items reconcile predictably.
- Concurrent selection attempts cannot exceed the configured limit.
- Passwords and tokens are never stored or logged in plaintext.
- A submitted selection exports the correct ordered filenames.
- Failure cases for expired/revoked Drive access, quota errors, and unavailable thumbnails are understandable to the user.
- Performance results and test conditions are recorded rather than described only as “fast.”

## Deferred product decision

The exact production image-delivery mechanism is a Phase 1 architecture gate. A prototype must compare Drive-provided thumbnail links, a controlled thumbnail proxy/cache, and the future CDN path before the MVP implementation locks the contract.

