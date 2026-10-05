# `packages/google-drive`

Server-only Google Drive provider package for metadata discovery and bounded original reads.

## Implemented

- Google authorization-code identity provider using the maintained
  `google-auth-library`, identity-only scopes, S256 PKCE inputs, signed ID-token
  verification, nonce/audience/issuer/email checks, and sanitized failures.
  Drive consent remains a separate grant.
- A separate Drive authorization provider requests `drive.file` with offline
  access, consent, state/nonce/PKCE inputs, validates the account and actual
  granted scope, refreshes short-lived access tokens, and revokes grants. It
  never persists credentials; the API owns encrypted storage.

- `StorageProvider` and `GoogleDriveService` interfaces with an injected access-token source.
- `DriveFolderReader` validates narrow accessible-folder metadata with files.get;
  it refuses trashed/non-folder/shortcut IDs and unavailable list capability.
  This does not prove drive.file access to existing children. Metadata GETs do
  not follow redirects; existing safe-read retry/error rules apply.
- Drive v3 `files.list` for direct, non-trashed children, using a narrow field mask and 1,000-item pages. All pages are collected before a catalog is returned; incomplete results fail closed.
- Shared source-format classification with explicit skipped-file count. This is metadata discovery, not byte validation or successful preview generation.
- Bounded retry with exponential backoff and jitter for safe reads. Expired credentials, missing folders, permissions, and quota failures are classified without echoing Drive's raw error payload.
- One full restart if Drive rejects a continuation token; a second rejection fails rather than looping.
- A safe optional telemetry callback containing only operation, result category, page, attempt, and duration.
- `OriginalImageReader` / `GoogleDriveOriginalReader` for a trusted processor: metadata preflight checks folder membership, trash state, `canDownload`, revision, and size; `files.get?alt=media` streams at most 64 MiB in memory; optional MD5 and metadata postflight reject changed files. Redirects are host-restricted and never receive the OAuth token.

The caller must provide a valid OAuth access token and authorize the album/photo before invoking the reader. This package obtains and refreshes grants but does not persist refresh tokens. The reader returns temporary bytes to its trusted caller; it does not persist originals or expose a public download route.

## Deferred

- Picker/existing-child access pilot, final scope decision and live-account
  verification. Folder metadata validation is implemented; album authorization
  and refresh-token encryption live in the API.
- Automatic import processing/scheduling. The API already connects bounded reads,
  raster rendering, revision-keyed storage and delivery, with an explicit serial
  owner-bound OAuth operator command for existing indexed albums.
- Folder mutations and upload.

## Rules

- Keep `googleapis` details inside this package.
- Never log tokens or sensitive provider URLs.
- Do not assume undocumented thumbnail URL formats are stable.
- Distinguish idempotent reads from unsafe-to-retry mutations.

Run `pnpm --filter @photographer-platform/google-drive test`, `typecheck`, `lint`, and `build` from the repository root.

The list query and continuation behavior follow the [Drive files.list reference](https://developers.google.com/workspace/drive/api/reference/rest/v3/files/list); retry categories follow Google's [error guidance](https://developers.google.com/workspace/drive/api/guides/handle-errors).
