# `apps/api`

Planned Express API and composition root for the modular monolith.

## Responsibilities

- Authentication/session integration and authorization middleware.
- Versioned REST routes and Zod boundary validation.
- Album, gallery, sync, selection, comment, submit, and export services.
- Drive provider coordination and image descriptor endpoints.
- Rate limiting, structured logging, health checks, and error mapping.

## Boundaries

- Use repositories from `packages/database`.
- Use Drive interfaces/implementation from `packages/google-drive`.
- Share API contracts through `packages/shared`.
- Route handlers should remain thin; business rules belong in application services.

Status: directory placeholder; application code has not started.

