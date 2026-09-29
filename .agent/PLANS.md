# Execution Plan Standard

Use this format for work that spans multiple files, changes architecture, or requires more than one verification step. Plans are living documents: update them as facts change.

## Rules

- Read `AGENTS.md` and the relevant documents before planning.
- Scope one coherent phase; do not plan the entire product as one implementation task.
- Reference requirement IDs from `docs/REQUIREMENTS.md`.
- State assumptions and unresolved product decisions.
- Separate user-visible acceptance criteria from internal tasks.
- Include verification before implementation is considered complete.
- Record deviations and update `docs/DECISIONS.md` when an accepted decision changes.
- Never mark an item complete without evidence.

## Template

```markdown
# Current Execution Plan

## Phase
<number and name>

## Goal
<one concrete outcome>

## In scope
- <item>

## Out of scope
- <item>

## Requirement IDs
- <ID>

## Assumptions and decisions
- <assumption or ADR>

## Risks
- <risk and mitigation>

## Tasks
- [ ] Inspect existing code and relevant documents.
- [ ] Define or update contracts.
- [ ] Implement one coherent slice.
- [ ] Add or update tests.
- [ ] Run verification.
- [ ] Review the final diff and docs.

## Acceptance criteria
- [ ] <observable outcome>

## Verification log
- Not run yet.

## Requirement status at completion
- Implemented: none
- Partial: none
- Deferred: none
```

## Suggested phase sequence

1. Architecture validation and risk prototypes.
2. Database/domain schema and migrations.
3. Photographer authentication and authorization.
4. Google Drive connection and metadata service.
5. Album creation and idempotent synchronization.
6. Photographer dashboard and gallery publication.
7. Client gallery and image-delivery integration.
8. Selection, comments, submit, and export.
9. Performance, security, observability, and private pilot hardening.
10. Drive workspace folder operations after proofing MVP validation.

Each phase should end with a gap review against the scoped requirement IDs before the next phase begins.

