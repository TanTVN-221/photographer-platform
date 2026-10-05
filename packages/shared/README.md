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

## Implemented

- Immutable source-image format registry covering guaranteed and best-effort formats.
- Deterministic Drive filename/MIME discovery classifier.
- Explicit browser-native, converted-raster, camera-RAW, and extended-raster categories.
- Unit coverage for aliases, generic MIME types, metadata conflicts, unsupported inputs, and registry uniqueness.
- Strict photographer session and narrow Drive connection DTOs/cookie names;
  no OAuth credential is part of a browser-safe contract.

Classification is not content validation. The future media-processing boundary must inspect source bytes before invoking a decoder.

Status: media-format and current API contract foundation implemented; contracts
remain intentionally narrow as private workspace features expand.
