# `packages/shared`

Planned browser-safe shared contracts package.

## Responsibilities

- Zod request/response schemas and inferred TypeScript types.
- Domain enums and provider-neutral value objects.
- Cursor and error-envelope contracts.
- Small utilities that are safe in both browser and server runtimes.

## Rules

- Avoid framework-specific dependencies.
- Do not expose Prisma models directly as public API DTOs.
- Do not include secrets, server-only provider clients, or database access.

Status: directory placeholder; contracts have not been implemented.

