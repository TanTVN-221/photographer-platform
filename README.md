# Photographer Drive + Client Proofing Platform

A starter repository for a photographer-oriented Digital Asset Management (DAM) and client proofing platform. The product keeps original photographs in Google Drive, indexes metadata in PostgreSQL, and provides a faster browsing and selection experience for large galleries.

This repository currently contains planning documents and an implementation-ready monorepo skeleton. It intentionally does not claim that the application has been built yet.

## Product goals

1. Browse folders and galleries containing hundreds or thousands of photographs quickly.
2. Keep infrastructure and bandwidth costs low.
3. Keep Google Drive as the source of truth for original files during the MVP.
4. Provide a clean photographer workspace and a simple client proofing flow.
5. Preserve a migration path to a SaaS product and a future CDN/object-storage image layer.

## Repository map

```text
.
├── AGENTS.md
├── README.md
├── docs/
│   ├── PRODUCT_SPEC.md
│   ├── REQUIREMENTS.md
│   ├── MVP_SCOPE.md
│   ├── ARCHITECTURE.md
│   └── DECISIONS.md
├── .agent/
│   ├── PLANS.md
│   └── CURRENT_PLAN.md
├── apps/
│   ├── web/
│   └── api/
└── packages/
    ├── database/
    ├── shared/
    ├── google-drive/
    └── ui/
```

## Proposed stack

- pnpm workspaces
- Next.js, React, TypeScript, Tailwind CSS
- Node.js, Express, TypeScript, Zod
- PostgreSQL and Prisma
- Google Drive API v3 through `googleapis`
- Auth.js or an equivalent Google sign-in solution for photographer accounts

## Start here

1. Read `AGENTS.md`.
2. Read `docs/PRODUCT_SPEC.md` and `docs/MVP_SCOPE.md`.
3. Review the open questions in `docs/DECISIONS.md`.
4. Use `.agent/PLANS.md` to write an execution plan.
5. Complete Phase 1 in `.agent/CURRENT_PLAN.md` before writing production application code.

## Current status

- Product requirements: drafted
- MVP boundaries: drafted
- Reference architecture: drafted and awaiting validation
- Application code: not started
- Tests and deployment: not configured

## Suggested first Codex task

```text
Read AGENTS.md and all files in docs/. Do not implement application code yet.
Review docs/ARCHITECTURE.md against docs/REQUIREMENTS.md, resolve or explicitly
record architectural gaps, and update .agent/CURRENT_PLAN.md. Stop after Phase 1.
```

