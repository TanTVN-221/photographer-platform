# `apps/web`

Planned Next.js application for both the authenticated photographer workspace and the public client gallery.

## Responsibilities

- Photographer sign-in and dashboard UI.
- Album creation, sync status, selection review, and export actions.
- Public/password-protected gallery shell.
- Paginated photo grid, lightbox, selection, comments, and submission UI.
- Accessible, mobile-first interaction and performance instrumentation.

## Boundaries

- Consume versioned API/shared DTOs from `packages/shared`.
- Consume presentation components from `packages/ui`.
- Do not call Google Drive or Prisma directly.
- Do not construct Google Drive image URLs in components.

Status: directory placeholder; application code has not started.

