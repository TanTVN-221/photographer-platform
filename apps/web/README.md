# `apps/web`

Next.js application for the authenticated private workspace and public client gallery.

The enforced browser policy uses fresh request nonces for scripts, validated
public API origins for images/forms, no framing, and dynamic/no-store documents.
Production excludes development eval/HMR allowances; static assets retain caching.
Configure both PUBLIC origins in the web runtime too. See LOCAL_SETUP and ADR-037
for OAuth redirect compatibility, inline aspect-ratio styles and HTTPS/edge checks.

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

## Implemented foundation

- Bilingual `/signin` and `/workspace` entry screens. The web forwards only a
  valid host-only owner session cookie to the API and never exposes its token
  to client components. The workspace shows owner-scoped Drive connection
  summaries and direct consent/disconnect forms with localized outcomes; it
  never receives provider credentials. Folder/import controls remain closed
  pending the live `drive.file` scope pilot.
- The owner dashboard lists 25 indexed albums at a time with counts/status/dates.
  `/workspace/albums/[albumId]` reviews 50 selections with private lazy thumbnails,
  comments, inactive-photo markers, safe gallery-link copy/open, text export,
  lock/reopen and confirmed archive. It handles expired sessions, unavailable
  services and stale continuation explicitly in English/Vietnamese. Server
  Actions/API routes enforce ownership and mutation confirmation; no provider
  credentials or original-image URLs enter the page.

- Next.js App Router, React, strict TypeScript, and Tailwind.
- A server-rendered home page that validates the API's `/api/v1/system` response against the shared Zod contract.
- Honest API-connected and API-unavailable states.
- A live source-format catalog drawn from the shared API policy.
- English/Vietnamese home-page copy with a persistent, accessible language switch.
- `/g/[slug]` server-rendered gallery shell, with English/Vietnamese states,
  one 50-photo page at a time, opaque-cursor continuation, and no-index metadata.
  It validates the API response and hides protected galleries until password
  proof. A localized server-action form forwards the password to the API,
  stores only an HttpOnly per-gallery session cookie, and forwards that cookie
  during later server-rendered metadata fetches. A small client
  viewer lazy-loads current-page generated thumbnails and mounts one larger
  preview in an accessible dialog, with keyboard, touch-sized controls and
  single-finger horizontal swipes on the preview stage. Native pinch zoom and
  vertical pan remain available; multi-touch/zoomed-viewport gestures do not
  navigate. English/Vietnamese guidance and page-position announcements are
  included. Escape/close restores opener focus and page scrolling; only a
  deliberate outside tap dismisses the backdrop.
  It fetches a narrow current-page selection state, then lets the guest
  select/deselect, comment, and confirm submission through server actions
  using backend-authoritative counts. It never loads original-resolution
  images and still requires live proofing validation.

Run with `pnpm --filter @photographer-platform/web dev`. The default address is `127.0.0.1:3000`. Set `API_BASE_URL` in the web process environment when the API is not at `http://127.0.0.1:4000`.

Status: application foundation and authorized gallery grid/lightbox with
optional generated derivatives running. Configure `PUBLIC_API_BASE_URL` as the
browser-reachable API origin when it differs from `API_BASE_URL`; this is an
application endpoint, never a Drive URL. Protected galleries additionally
require the API's session key and same-host `PUBLIC_WEB_BASE_URL` configuration.
Album import/sync UI and live client-selection validation remain future phases.
Without configured API
PostgreSQL access, the gallery shows an unavailable state rather than fake data.
