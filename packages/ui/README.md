# `packages/ui`

Planned reusable React presentation package.

## Responsibilities

- Accessible buttons, dialogs, forms, feedback, and navigation primitives.
- Gallery presentation primitives that receive provider-neutral image descriptors.
- Shared tokens and Tailwind-compatible styling conventions.

## Rules

- Components do not call Prisma, Drive, or application APIs directly.
- Preserve keyboard, screen-reader, focus, reduced-motion, and touch usability.
- Avoid embedding product-specific business rules in generic components.

Status: the package now provides a reusable, accessible `StatusPill` presentation component used by `apps/web`. Broader UI primitives remain future work.
