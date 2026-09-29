# Current Execution Plan

## Phase

Phase 1 — Architecture validation and risk reduction

## Goal

Turn the draft reference architecture into an implementation-ready architecture by resolving the highest-risk unknowns without writing production application features.

## In scope

- Validate repository boundaries and dependency direction.
- Verify current Google OAuth scope options and consent implications.
- Prototype and compare private thumbnail/preview delivery choices.
- Define stable natural ordering and gallery cursor semantics.
- Choose the database consistency strategy for selection limits.
- Test whether realistic 5,000-file sync fits the likely hosting request window.
- Define quantitative performance budgets and target environments.
- Update accepted/proposed ADRs and map the architecture to requirements.

## Out of scope

- Production Next.js or Express feature implementation.
- Final Prisma schema and migrations.
- UI design implementation.
- Deployment or production Google OAuth submission.
- Features listed as out of scope in `docs/MVP_SCOPE.md`.

## Requirement IDs

- PROD-003
- DRIVE-003–015
- DB-003–004
- SEL-004–005
- IMG-001–005
- PERF-001–007
- SEC-002, SEC-004–005
- OPS-001–004

## Decisions to resolve

- ADR-011: Google OAuth scope set.
- ADR-012: Private thumbnail/preview delivery.
- ADR-013: Sync execution model.
- ADR-014: Selection concurrency mechanism.
- ADR-015: Gallery password session.
- ADR-016: Performance budgets.

## Risks

- Drive thumbnail URLs may expire or be unsuitable for private client delivery.
- Google verification requirements may change the feasible OAuth scope set.
- A full 5,000-file reconciliation may exceed serverless request limits.
- Natural ordering may be expensive or unstable if calculated only at query time.
- A naive count-then-insert selection flow will race under concurrency.

## Tasks

- [ ] Review every open decision against current official provider documentation.
- [ ] Define the `StorageProvider` and `ImageUrlProvider` contracts at design level.
- [ ] Build a disposable image-delivery experiment; do not treat it as production code.
- [ ] Measure listing/sync behavior for representative Drive folders or a faithful test harness.
- [ ] Propose the natural-sort key and opaque cursor format.
- [ ] Propose and test the selection transaction strategy.
- [ ] Define target devices, networks, gallery sizes, and numeric performance budgets.
- [ ] Update `docs/ARCHITECTURE.md` and `docs/DECISIONS.md`.
- [ ] Produce a requirement gap report with PASS, PARTIAL, MISSING, or CONFLICT.

## Acceptance criteria

- [ ] Each open ADR is accepted, rejected, or explicitly deferred with an owner and consequence.
- [ ] The image delivery decision has evidence for authentication, expiry, privacy, CORS, caching, quota, and cost.
- [ ] Cursor and natural-order semantics are unambiguous.
- [ ] Selection-limit concurrency has a testable database strategy.
- [ ] The sync execution model works within the selected hosting constraints or names the required background mechanism.
- [ ] Numeric performance budgets are recorded with a repeatable test setup.
- [ ] No production application feature is represented as implemented.

## Verification log

- Not run. This repository is an initial planning skeleton.

## Requirement status

- Implemented: none
- Partially covered by architecture: IDs listed above
- Deferred: all production implementation requirements

