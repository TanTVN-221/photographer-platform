# Photographer Drive + Client Proofing Platform

Status: Draft product source of truth  
Audience: Product owner, designers, architects, and implementation agents

## 1. Product vision

Professional photographers often store client albums in Google Drive, but the standard Drive interface becomes inconvenient when browsing hundreds or thousands of high-resolution images. This product will use Google Drive as the original storage backend while providing a faster, cleaner photographer workspace and a client photo-proofing workflow inspired by products such as Shotpik.

The long-term product is a lightweight Photographer Digital Asset Management (DAM) and Client Proofing platform that can evolve into a multi-tenant SaaS product.

The product must have its own interface and implementation. “Similar to Shotpik” describes the workflow category, not permission to copy a proprietary design, brand, or code.

## 2. Product principles

1. Performance is a feature. Large galleries must remain responsive.
2. Google Drive remains the source of truth for originals during the MVP.
3. Avoid unnecessary storage and server bandwidth costs.
4. Cache and index metadata locally; do not rebuild the Drive UI by calling Drive for every view.
5. Make the common photographer workflow obvious and efficient.
6. Let clients view and select photos without creating an account.
7. Prefer a simple modular monolith until real usage justifies more infrastructure.
8. Separate provider-specific concerns so storage and image delivery can change later.

## 3. Users

### Photographer

An authenticated workspace user who connects a Google account, manages Drive-backed folders and albums, publishes client galleries, reviews selections, and exports filenames.

### Client or guest

A visitor who opens a public or password-protected gallery, browses photographs, selects favorites, leaves per-photo feedback, and submits a final selection. A client account is not required in the MVP.

### Future studio administrator

A future SaaS role that can manage studio members, branding, domains, quotas, subscriptions, and permissions. This role is not part of the MVP.

## 4. Product areas

The web experience should support English and Vietnamese. Visitors can switch languages explicitly, and their choice persists across visits. Product-facing copy is localized; technical file-format names and filenames retain their original spelling. The home page, gallery password form, and authorized gallery grid, lightbox, and selection controls are localized; future photographer workspace screens must follow this policy when built.

### 4.1 Photographer workspace

The private workspace should eventually let photographers:

- Sign in with Google.
- Connect and disconnect Google Drive safely.
- Browse indexed Drive folders and supported image files.
- Create, rename, move, and delete Drive folders when authorized.
- Upload files to Drive.
- Search albums and photos by useful metadata.
- Create a client gallery from a Drive folder.
- Configure a title, optional password, and optional selection limit.
- Copy a non-sequential public gallery URL.
- Synchronize Drive metadata into the application.
- Review selection status, selected photos, and client comments.
- Reopen or lock a selection.
- Export selected filenames as text.

Folder operations and upload are part of the broader product vision. The first proofing MVP focuses on Drive connection, indexed browsing, gallery creation, sync, selection review, and export.

### 4.2 Client proofing gallery

The guest experience should let clients:

- Open a public URL such as `/g/{publicSlug}`.
- Enter a gallery password when one is configured.
- Browse an optimized, mobile-first gallery.
- Load thumbnails rather than originals in the grid.
- Open an appropriate larger preview in a lightbox.
- Navigate with keyboard on desktop and gestures on mobile.
- Select and deselect photographs.
- See selected count and configured maximum.
- Add or edit a comment on a selected photograph.
- Submit the selection after confirmation.
- See a clear success state after submission.

### 4.3 Photographer review

The photographer should be able to:

- See album photo count, selected count, and selection status.
- Filter or inspect selected photos.
- Read comments next to the relevant filenames.
- Export one selected filename per line from the submitted selection.
- Lock a completed selection or reopen it when the workflow permits.

## 5. Large-gallery performance

Assume a common album contains 300–5,000 photos, with future galleries reaching 10,000. Original files may be high-resolution and unsuitable for direct grid display.

The system must:

- Index Drive metadata in PostgreSQL.
- Serve routine folder and gallery listings from PostgreSQL.
- Use stable cursor pagination or an equivalent continuation model.
- Avoid returning unnecessary fields.
- Store image width and height when available so layout is known before loading.
- Preserve natural filename order (`IMG_2` before `IMG_10`).
- Use viewport-appropriate thumbnails and previews.
- Lazy-load images and control prefetching.
- Avoid mounting every item in a large gallery at once.
- Define measurable budgets before performance is declared complete.

Initial working budgets are documented as targets in `docs/REQUIREMENTS.md`; they must be validated under realistic network and device conditions.

## 6. Google Drive integration

### 6.1 Source of truth

Google Drive stores the original photographs. The application stores metadata and application state only. It must not permanently copy original files into application storage during the MVP.

### 6.2 Authentication and access

The intended full product uses Google OAuth with the smallest practical Drive scopes and encrypted refresh tokens. The architecture should also permit a limited public-folder proof-of-concept with an API key, but this is not the final private-folder strategy.

OAuth consent, sensitive/restricted scope verification, and platform policies must be reviewed before production launch.

### 6.3 Supported operations

The storage integration should be designed around:

- List folders and files with complete pagination.
- Create folders.
- Rename files or folders.
- Move files or folders.
- Trash/delete when explicitly authorized.
- Upload files.
- Read metadata, including MIME type, dimensions, size, timestamps, parents, and checksum when available.
- Obtain supported thumbnails or preview URLs.
- Synchronize changes into local metadata.

The MVP implements only the subset defined in `docs/MVP_SCOPE.md`.

### 6.4 Synchronization

Sync must be idempotent. Re-running it must not duplicate photos. It must page through the complete Drive result, add new supported files, update changed metadata, and mark missing/trashed files without destroying client selection history.

The MVP scans direct children of the selected folder only. Recursive folders are deferred.

## 7. Supported media

The proofing workflow separates source-format support from browser delivery. A supported source can be indexed and represented by a safe browser preview; the product does not edit or replace the original.

Guaranteed source formats are:

- Web and interchange images: JPEG/JFIF, PNG/APNG, WebP, AVIF, GIF, HEIC/HEIF/HIF, and TIFF.
- Open RAW: DNG.
- Major camera RAW families: Canon CR2/CR3, Nikon NEF/NRW, Sony ARW, Fujifilm RAF, Olympus/OM System ORF, Panasonic RW2, and Pentax PEF.

Extended camera RAW formats recognized by the selected decoder may be imported on a best-effort basis. PSD/PSB, JPEG XL, JPEG 2000, and BMP are optional extended formats rather than guaranteed proofing inputs. SVG is not a photographic source format and must not be served directly when supplied by an untrusted user.

Browser-native formats may still be normalized for privacy, caching, orientation, color, or delivery consistency. HEIC, TIFF, RAW, multi-page, and other non-universal sources require a generated thumbnail or preview. Animated and multi-page sources use a representative still frame/page in the proofing MVP. Video remains deferred.

Format recognition during Drive listing is discovery only. The processing boundary must verify the source bytes before decoding and report unsupported camera variants or processing failures without failing the complete album sync.

## 8. Image delivery

Image delivery is a major architectural risk. The implementation must not treat an undocumented Drive thumbnail URL as a permanent API contract.

The frontend should request an application-level image descriptor through an `ImageUrlProvider` abstraction. The selected strategy must document the behavior of Drive `thumbnailLink`, authentication, URL expiry, CORS/hotlinking constraints, cacheability, privacy, quota use, and bandwidth cost.

The default should not proxy full-resolution images through the Node server. The system must preserve a future migration path to Cloudflare R2 or another object store/CDN without rewriting the gallery UI.

## 9. Domain model

The core concepts are:

- `Photographer`: authenticated owner of albums and Drive connection(s).
- `DriveConnection`: encrypted provider credentials and account metadata.
- `DriveItem`: indexed folder/file metadata when workspace browsing is enabled.
- `Album`: published proofing container backed by a Drive folder.
- `Photo`: album-scoped metadata for a supported Drive image.
- `Selection`: one client selection workflow with `DRAFT`, `SUBMITTED`, or `LOCKED` state.
- `SelectionItem`: selected photo plus optional comment.
- `GallerySession`: optional short-lived proof that a visitor passed gallery password protection.
- `SyncRun`: operational record of an album/folder synchronization.

Selection state must never be a boolean field on `Photo`. The presence of a unique `(selectionId, photoId)` `SelectionItem` means the photo is selected.

## 10. Key workflows

### Create an album

1. Photographer signs in and has an authorized Drive connection.
2. Photographer selects or provides a Drive folder.
3. Photographer enters a title, optional password, and optional selection limit.
4. Backend validates ownership/access and creates the album.
5. Backend synchronizes all supported direct-child images with full Drive pagination.
6. Metadata is stored in PostgreSQL and a unique public slug is generated.
7. Photographer receives a shareable gallery URL and an import summary.

### Synchronize an album

1. Photographer requests sync.
2. Backend verifies ownership and prevents conflicting sync work.
3. Drive pages are fetched with limited fields and retries for safe transient failures.
4. Database is reconciled idempotently.
5. Removed items are soft-deactivated so selection history remains meaningful.
6. A result reports created, updated, unchanged, removed, skipped, and failed counts.

### Select and comment

1. Guest opens an authorized gallery session.
2. Guest toggles a photo.
3. Backend verifies gallery state and enforces the selection limit atomically.
4. Guest may attach a comment to the selected item.
5. UI updates optimistically only when it can safely reconcile an API rejection.

### Submit and export

1. Guest reviews the count and confirms submission.
2. Backend changes the selection from `DRAFT` to `SUBMITTED` atomically.
3. Further edits are allowed or denied according to album policy.
4. Photographer reviews the submitted selection.
5. Export returns one selected filename per line, in natural album order.

## 11. Security and privacy

- Hash gallery passwords; never store them in plaintext.
- Encrypt Google OAuth refresh tokens at rest.
- Store secrets in environment-specific secret management, not source control.
- Enforce tenant/owner authorization on every private resource.
- Use non-sequential, sufficiently random public slugs.
- Rate-limit public password attempts and mutation endpoints.
- Validate all request bodies, params, query strings, and external provider responses.
- Define CSRF, cookie, session, and CORS policies explicitly.
- Avoid disclosing private Drive identifiers or credentials unnecessarily.
- Record destructive Drive operations and require explicit confirmation in the UI.
- Define retention and deletion behavior before production use.

## 12. API direction

Use a versioned REST API with Zod contracts. Candidate resources include:

```text
/api/v1/auth/*
/api/v1/drive/folders
/api/v1/drive/items/:itemId
/api/v1/albums
/api/v1/albums/:albumId
/api/v1/albums/:albumId/sync
/api/v1/albums/:albumId/photos
/api/v1/albums/:albumId/selections
/api/v1/albums/:albumId/export
/api/v1/galleries/:slug
/api/v1/galleries/:slug/photos
/api/v1/galleries/:slug/selection/items
/api/v1/galleries/:slug/submit
```

Exact routes and DTOs are architecture decisions, not immutable product requirements.

## 13. Observability and operations

The product should capture structured logs and metrics for Drive API calls, sync duration, Drive quota/rate-limit errors, gallery response time, image failures, selection conflicts, and export errors. Never log tokens, passwords, or sensitive signed URLs.

Backups, migrations, incident response, and data deletion must be planned before production launch.

## 14. Future capabilities

Do not implement these in the first MVP, but avoid designs that make them prohibitively difficult:

- Studio teams and granular roles
- Custom logo, branding, watermark, and custom domain
- Tags, advanced filtering, analytics, and download controls
- Email and WhatsApp notifications
- Multiple selection lists or clients per album
- Multiple Drive folders per album
- Recursive folder sections
- Video previews and editing of source image formats
- Face recognition or face search
- Cloudflare R2/object-storage/CDN delivery
- Subscription plans and billing
- Storage providers other than Google Drive

## 15. Product success indicators

- Photographers can create and sync a large Drive-backed album without missing files.
- Clients can begin browsing quickly without downloading originals.
- The gallery remains responsive on common mobile hardware.
- Selection limits remain correct under concurrent requests.
- A photographer can move from gallery creation to a trustworthy filename export without manual reconciliation.
- Drive API calls and application bandwidth remain bounded and observable.
