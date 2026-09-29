# `packages/google-drive`

Planned Google Drive integration package.

## Responsibilities

- Provider-neutral storage and image URL interfaces.
- Google OAuth client and secure token-refresh integration points.
- Complete paginated folder/file listing with narrow fields.
- Metadata mapping, error classification, and safe retry policy.
- Folder mutation/upload support in later workspace phases.

## Rules

- Keep `googleapis` details inside this package.
- Never log tokens or sensitive provider URLs.
- Do not assume undocumented thumbnail URL formats are stable.
- Distinguish idempotent reads from unsafe-to-retry mutations.

Status: directory placeholder; provider prototypes begin in Phase 1.

