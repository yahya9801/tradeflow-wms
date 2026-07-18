# Phase 10a — Interaction Feedback & States — Design Spec

**Date:** 2026-07-17
**Branch:** `phase-10a-interaction-feedback`
**Status:** Approved (design), pending implementation plan

## Goal

Make every interaction acknowledge itself immediately, and make error / not-found
paths look intentional. Fixes the reported problem: clicking a link/row/tab gives
no feedback, so the screen "suddenly loads" and the click feels dead.

## Scope (Phase 10 sub-project 10a)

Phase 10 in PLAN.md bundles five independent workstreams (UX polish, CSV export,
QA/Playwright, security pass, deploy). This sub-project is the UX-feedback slice:

- Navigation progress bar (in-app navigation feedback).
- `loading.tsx` skeletons.
- `error.tsx` and `not-found.tsx` boundaries.
- Success/error toasts on mutations (sonner).

**Explicitly out of this sub-project** (later Phase-10 pieces): CSV export,
mobile pass, Playwright E2E, security pass, production deploy.

## What already exists (build on, do not rebuild)

- `src/app/(app)/layout.tsx` — server layout rendering `<AppShell>`; the mount
  point for the progress bar and the toaster (both client components render
  fine inside a server layout).
- `next-themes` `ThemeProvider` (`attribute="class"`, root layout) — so a
  theme-aware sonner `<Toaster>` can read `useTheme()`.
- Mutation client components already using `useActionState` (each exposes a
  `state` with `ok?`/`error`): invoice/payment/client/user dialogs, company &
  preferences forms, delete buttons, lot form, status stepper, exception
  resolve + flag. These get a one-line toast hook — no structural change.
- Empty states already exist in tables ("No invoices", "No clients match",
  etc.) — not re-done here.
- No `loading.tsx`, `error.tsx`, `not-found.tsx`, or toast library exist yet.

## Architecture

1. **Nav progress bar** — a client island in the `(app)` layout; a pure
   predicate decides which clicks count as navigations (unit-tested).
2. **Skeletons** — a `Skeleton` primitive + `loading.tsx` files (Suspense
   fallbacks Next renders instantly on navigation).
3. **Boundaries** — `error.tsx` (client) and `not-found.tsx`.
4. **Toasts** — `sonner` `<Toaster>` in the layout + a `useActionToast` hook
   wired into the existing mutation clients.

## 1. Navigation progress bar

`src/lib/nav-progress.ts` (pure, testable):

```ts
/** Should a click on this anchor start the navigation indicator? */
export function isTrackableNavigation(
  a: { href: string; target: string | null; hasDownload: boolean },
  current: { origin: string; url: string },
  modifier: boolean,
): boolean {
  if (modifier || a.hasDownload) return false;
  if (a.target && a.target !== "" && a.target !== "_self") return false;
  let u: URL;
  try { u = new URL(a.href, current.url); } catch { return false; }
  if (u.origin !== current.origin) return false;         // external
  if (u.href === current.url) return false;               // same page
  if (u.pathname === new URL(current.url).pathname && u.hash) return false; // hash-only
  return true;
}
```

`src/components/nav-progress.tsx` (client, mounted once in the layout):
- A fixed `top-0` 2px bar (`bg-primary`), `z-50`, width driven by state.
- On mount, a **capture-phase** `document` click listener: resolve
  `event.target.closest("a")`, build the anchor descriptor, and if
  `isTrackableNavigation(...)` → start (animate width 0 → ~90% via a trickle
  timer).
- `useEffect(() => complete(), [pathname, searchParams])` — when the route
  commits, jump to 100% then fade to 0 and reset. (`usePathname`,
  `useSearchParams` from `next/navigation`.)
- Programmatic `router.push` navigations (e.g. delete → `/clients`) still
  *complete* via the effect; they simply don't trigger the start animation —
  acceptable, since the reported problem is link/row/tab/sidebar clicks.
- Respects reduced motion (no trickle animation, just show/hide) — minor.
- `NavProgress` uses `useSearchParams()`, so it is mounted inside a
  `<Suspense>` boundary in the layout (Next requirement; avoids a build-time
  de-opt warning).

## 2. `loading.tsx` skeletons

`src/components/ui/skeleton.tsx`:

```tsx
export function Skeleton({ className = "" }: { className?: string }) {
  return <div className={`animate-pulse rounded-md bg-muted ${className}`} />;
}
```

- **`src/app/(app)/loading.tsx`** — generic fallback for every route: a title
  bar, a 4-up stat-card grid, and a table shell of Skeletons. Covers all routes
  by default (nearest Suspense boundary).
- **Route-tailored** loading files for the heaviest / most-distinct screens so
  the skeleton matches the real layout: `dashboard/loading.tsx`,
  `reports/loading.tsx`, `live-ops/loading.tsx`, `lots/[id]/loading.tsx`.

These are pure presentational shells (no data, no client JS).

## 3. Error boundary — `src/app/(app)/error.tsx`

```tsx
"use client";
// receives { error: Error & { digest?: string }, reset: () => void }
```

A centered card: heading "Something went wrong", a one-line message, a **Try
again** button calling `reset()`, and the `digest` in small muted mono when
present. Client component (error boundaries must be client). Does not leak stack
traces — shows a friendly message only.

## 4. Not-found — `src/app/(app)/not-found.tsx`

A branded 404 inside the app shell: "Not found", a short explanation, and a
`<Link href="/dashboard">` back. Catches `notFound()` from the lot and client
detail pages and unknown in-app URLs.

## 5. Toasts (sonner)

- Add dependency **`sonner`**.
- `src/components/ui/toaster.tsx` (client): wraps sonner's `<Toaster>`, reads
  `useTheme()` (next-themes) and passes `theme={resolvedTheme}` so toasts match
  light/dark; `richColors`, `position="bottom-right"`, `closeButton`.
- Mount `<Toaster />` in `(app)/layout.tsx`.
- `src/lib/use-action-toast.ts` (client hook):

```ts
export function useActionToast(
  state: { ok?: boolean; error?: string | null },
  messages: { success: string; error?: (e: string) => string },
): void {
  // useEffect: when state.ok becomes true → toast.success(messages.success)
  //            when state.error is a non-null string → toast.error(...)
  // Guards against firing twice for the same state object.
}
```

- Wire `useActionToast(state, { success: "…" })` into each mutation client:
  - Accounts: invoice dialog ("Invoice saved"), payment dialog ("Payment
    recorded"), delete-invoice button ("Invoice deleted").
  - Clients: client dialog ("Client saved"), delete-client button ("Client
    removed").
  - Lots: lot form ("Lot saved"), status stepper ("Status updated"), exception
    resolve ("Exception resolved"), flag-issue dialog ("Issue flagged").
  - Settings: user dialog ("User updated"), company form ("Company info saved"),
    preferences form ("Preferences saved").

Inline field errors and the existing `state.error` banners stay; the toast is an
additional, transient confirmation of the server round-trip.

## 6. Testing & verification

- **Vitest unit:** `nav-progress.test.ts` — `isTrackableNavigation` truth table:
  internal link (true), external origin (false), same-URL (false), hash-only
  (false), `target="_blank"` (false), download (false), modifier-click (false).
- **Static gates:** `tsc --noEmit`, `eslint`, `next build`, `vitest run` — and
  the presence of the `loading`/`error`/`not-found` files means Next compiles
  them into the route tree.
- **Manual visual note:** progress bar animates on nav, skeletons flash on slow
  routes, a thrown error shows the boundary, a bad `/lots/<garbage>` shows
  not-found, a save shows a toast. Not gated on a live screenshot (browser
  automation has been flaky this project); correctness of the pure predicate is
  unit-tested and the rest is presentational.

## Defaults (explicit, changeable)

- Progress bar is hand-rolled (no dependency); only `sonner` is added.
- Toasts confirm success and surface top-level errors; field-level validation
  stays inline (not toasted).
- Route-tailored skeletons only for the four heaviest screens; all others use
  the generic root `loading.tsx`.
- Programmatic navigations complete the bar but don't start its animation.

## Out of scope (other Phase-10 sub-projects)

- CSV export for lots/invoices/reports.
- Mobile pass on warehouse-floor screens.
- Playwright smoke E2E (login → lot → store → invoice → pay → audit).
- Security pass (RLS audit, auth rate-limiting, security headers, secret scan).
- Production Supabase + Vercel deploy and real reference seed.
