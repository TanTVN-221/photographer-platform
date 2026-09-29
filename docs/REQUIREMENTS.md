# Requirements

Status: Draft  
Notation: `MUST` is required for the stated scope; `SHOULD` is strongly preferred; `MAY` is optional.

## Product and tenancy

### PROD-001
The system MUST provide a private photographer workspace and a public/client proofing gallery.

### PROD-002
Every photographer-owned resource MUST be associated with an authenticated owner and authorization-checked.

### PROD-003
The MVP MUST use a modular monolith and MUST NOT require microservices.

### PROD-004
The design SHOULD preserve a path to multi-tenant SaaS operation without implementing billing or teams in the MVP.

## Authentication and accounts

### AUTH-001
Photographers MUST authenticate before using private workspace APIs.

### AUTH-002
The preferred photographer sign-in method SHOULD be Google through Auth.js or an equivalently secure integration.

### AUTH-003
Client gallery visitors MUST NOT require an account in the MVP.

### AUTH-004
Private sessions MUST use secure cookie/session settings and an explicit CSRF strategy.

## Google Drive integration

### DRIVE-001
Google Drive MUST remain the source of truth for original photographs during the MVP.

### DRIVE-002
The application MUST NOT permanently duplicate original photograph bytes into its own storage during the MVP.

### DRIVE-003
Drive integration MUST be isolated behind provider abstractions rather than used directly throughout routes or UI code.

### DRIVE-004
The production private-folder workflow MUST use least-privilege Google OAuth scopes and MUST encrypt refresh tokens at rest.

### DRIVE-005
Every Drive listing operation MUST handle all result pages and MUST request only required fields.

### DRIVE-006
Routine folder/gallery browsing SHOULD use locally indexed metadata instead of calling Drive on every view.

### DRIVE-007
Album synchronization MUST be idempotent and MUST not create duplicate photos.

### DRIVE-008
Synchronization MUST add new supported files, update changed metadata, and soft-deactivate missing or trashed files.

### DRIVE-009
Synchronization MUST preserve selection history whenever the referenced photo record still exists.

### DRIVE-010
MVP album import MUST include direct children only and MUST NOT recursively scan subfolders.

### DRIVE-011
MVP gallery import MUST accept JPEG, PNG, and WebP images and MUST report skipped unsupported files.

### DRIVE-012
The workspace architecture SHOULD support create, rename, move, trash/delete, and upload operations; the MVP implements only operations named in `MVP_SCOPE.md`.

### DRIVE-013
Natural filename ordering MUST be preserved for browsing and export.

### DRIVE-014
Safe transient Drive errors SHOULD use bounded exponential backoff with jitter; unsafe mutations MUST NOT be blindly retried.

### DRIVE-015
The system MUST expose Drive quota and authorization failures as actionable errors without leaking credentials.

## Metadata and database

### DB-001
PostgreSQL MUST store application state and Drive metadata, not original image bytes.

### DB-002
`Photo` MUST store album ID, Drive file ID, filename, MIME type, width, height, sort information, active/deleted state, and timestamps when available.

### DB-003
The database MUST prevent duplicate `(albumId, driveFileId)` photo records.

### DB-004
Frequently used ownership, gallery listing, sync, and selection queries MUST have suitable indexes verified against representative query plans before launch.

### DB-005
Schema changes MUST use reviewed migrations and Prisma validation.

## Albums and photographer workspace

### ALB-001
An authenticated photographer MUST be able to create an album backed by one accessible Drive folder.

### ALB-002
An album MUST have a title, unique public slug, owner, Drive folder reference, status, optional password hash, optional selection limit, and timestamps.

### ALB-003
Public gallery slugs MUST be non-sequential, unguessable in practice, and unique.

### ALB-004
The dashboard MUST show title, photo count, selected count, selection status, and created/updated date for each album.

### ALB-005
The photographer MUST be able to copy the gallery URL, open the gallery, request sync, review selections, export filenames, and archive/delete an album according to defined retention rules.

### ALB-006
A destructive album action MUST require explicit confirmation and MUST NOT delete Drive originals by default.

## Public gallery

### GAL-001
The public gallery MUST be available through `/g/{publicSlug}` or an equivalent non-sequential public route.

### GAL-002
If a password is configured, the gallery MUST remain unavailable until the visitor proves knowledge of it.

### GAL-003
Gallery passwords MUST be hashed using a suitable password-hashing algorithm and MUST never be stored or logged in plaintext.

### GAL-004
The gallery MUST be responsive and mobile-first.

### GAL-005
The gallery MUST provide an optimized grid, filename display, selected state, selected count, and a lightbox/preview experience.

### GAL-006
Desktop SHOULD support keyboard navigation, and mobile SHOULD support touch-friendly navigation.

### GAL-007
Gallery APIs MUST avoid revealing private owner data, credentials, or internal sequential identifiers.

## Selection and comments

### SEL-001
Selection state MUST NOT be stored as an `isSelected` field on `Photo`.

### SEL-002
A `Selection` MUST contain unique `SelectionItem` records that reference photos.

### SEL-003
Selection status MUST support `DRAFT`, `SUBMITTED`, and `LOCKED` or equivalent explicit states.

### SEL-004
The backend MUST enforce an optional album selection limit.

### SEL-005
Concurrent select requests MUST NOT cause the configured limit to be exceeded.

### SEL-006
Clients MUST be able to deselect while at the selection limit unless the selection is locked.

### SEL-007
Clients MUST be able to add and edit a comment associated with a selected photo.

### SEL-008
Submit MUST atomically transition an eligible selection from draft to submitted and MUST be idempotent.

### SEL-009
The UI MUST confirm submission and show a clear submitted state.

### SEL-010
The photographer MUST be able to review selected photos and their comments.

## Export

### EXP-001
An authorized photographer MUST be able to export the submitted selection as `text/plain`.

### EXP-002
The export MUST contain one filename per line in natural album order.

### EXP-003
The export MUST use an explicit submitted selection and MUST NOT infer selection from photo state.

## Image delivery and performance

### IMG-001
Normal gallery grids MUST NOT request original-resolution files.

### IMG-002
The frontend MUST consume an application image descriptor/provider contract instead of hard-coding Google-specific URL construction.

### IMG-003
The chosen Drive image strategy MUST document URL expiry, authentication, privacy, CORS, cache, quota, and bandwidth implications.

### IMG-004
Full-resolution images MUST NOT be proxied through the API by default.

### IMG-005
The image abstraction MUST allow a future CDN/object-storage provider without rewriting gallery components.

### PERF-001
Gallery photo APIs MUST use cursor-based pagination or an equivalently stable continuation mechanism.

### PERF-002
The UI MUST lazy-load off-screen images and SHOULD use responsive thumbnail sizes.

### PERF-003
The UI MUST NOT mount all items in a 5,000-photo gallery simultaneously.

### PERF-004
Stored width and height SHOULD reserve image aspect ratio before thumbnail load to minimize layout shift.

### PERF-005
API list responses MUST include only fields needed by the view.

### PERF-006
Performance validation MUST use representative albums of at least 500 and 5,000 records.

### PERF-007
Before production launch, the team MUST define and measure device/network-specific targets for initial gallery response, next-page response, visual stability, interaction responsiveness, and error rate.

## Security and abuse prevention

### SEC-001
All untrusted API inputs MUST be validated at the boundary with Zod or an equivalent schema system.

### SEC-002
Secrets and OAuth credentials MUST be provided through environment-specific secret management and MUST NOT be committed.

### SEC-003
Public password attempts and mutation endpoints MUST be rate-limited before production launch.

### SEC-004
Application logs MUST redact tokens, passwords, cookies, signed URLs, and sensitive headers.

### SEC-005
The system MUST define CORS, CSP, cookie, and CSRF policies before production launch.

### SEC-006
Destructive Drive operations MUST be owner-authorized, explicitly confirmed, and auditable.

## Reliability and observability

### OPS-001
Sync runs MUST record start/end state and counts for created, updated, unchanged, removed, skipped, and failed items.

### OPS-002
The system SHOULD emit structured logs and metrics for Drive errors, sync duration, API latency, gallery image failures, selection conflicts, and export failures.

### OPS-003
Database backup/restore, migration rollback, retention, and incident procedures MUST be documented before production launch.

### OPS-004
External API failures MUST produce actionable user-facing states and safe retry behavior.

