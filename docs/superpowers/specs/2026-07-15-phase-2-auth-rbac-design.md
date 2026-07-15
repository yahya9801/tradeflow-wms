# Phase 2 — Auth + RBAC Plumbing (Design)

**Date:** 2026-07-15
**Project:** TradeFlow WMS
**Phase:** 2 of 10 (see `PLAN.md`)
**Status:** Awaiting approval

## Goal

Wire the application to the Phase 1 database: real Supabase Auth sessions held
server-side, middleware-protected routes, and a single capability helper that is
the *only* way the app asks "can this user see money?". Ship the first
production-grade UI surfaces (login, blocked screen, real user menu).

This phase fixes, by construction, the demo bug where session/role lived in
memory and reset to Owner on reload or a typed URL.

## Context

- Phase 1 (merged, PR #1) already provides in the database:
  - `profiles.role` of type `app_role` (`owner` | `management` | `warehouse` | `finance`)
  - `SECURITY DEFINER` helpers `can_view_financials()`, `is_owner()`, `current_app_role()`
  - RLS on all 11 tables enforcing the capability matrix
  - Seeded users: `owner@tradeflow.example`, `management@tradeflow.example` (password `TradeFlow!2026`)
- Phase 0 provides the app shell; `src/components/layout/top-bar.tsx` currently
  renders a **hardcoded placeholder "Owner"** user — this phase replaces it.
- `src/lib/supabase/client.ts` and `server.ts` exist; no middleware yet.

## Decisions (approved)

1. **Login-only, no public signup.** Users are created by the Owner (Phase 9) or
   the seed. A DB trigger creates the `profiles` row for any new auth user with a
   safe default role of `management`. Nobody self-registers into trade data.
2. **Server-fetched profile + context provider** for client role access (not
   custom JWT claims). One source of truth; role changes take effect without a
   token refresh.
3. **Dev-only "switch user" dropdown** — real sessions, rendered only when
   `NODE_ENV !== "production"`.
4. **Login layout: centered card**, identical across breakpoints.

## Architecture

### Capability model — one source of truth

`src/lib/permissions.ts` — a pure, dependency-free module mirroring the
`CLAUDE.md` §3 matrix and the Phase 1 SQL helpers:

```ts
export type AppRole = "owner" | "management" | "warehouse" | "finance";

export type Capability =
  | "view_operations"   // lots, warehouses, clients, import/export
  | "manage_lots"       // create/edit lots, change status
  | "view_financials"   // amounts, invoices, prices, net position
  | "manage_invoices"
  | "view_audit"
  | "manage_users";     // users & settings

const ROLE_CAPABILITIES: Record<AppRole, Capability[]> = {
  owner:      ["view_operations","manage_lots","view_financials","manage_invoices","view_audit","manage_users"],
  management: ["view_operations","manage_lots"],
  finance:    ["view_operations","view_financials","manage_invoices"], // reserved (v2)
  warehouse:  ["view_operations"],                                      // reserved (v2)
};

export function can(role: AppRole | null | undefined, cap: Capability): boolean;
```

Pure function, no I/O → unit-tested with Vitest per `PLAN.md` §5.6 ("the
permission helper gets unit tests").

**Correspondence to the DB is deliberate:** `can(role,'view_financials')` must
match SQL `can_view_financials()` (`role in ('owner','finance')`), and
`can(role,'manage_users')`/`can(role,'view_audit')` must match `is_owner()`.
The unit test asserts this mapping explicitly so drift is caught.

### Server session

`src/lib/auth.ts` (server-only):

- `getSession(): Promise<{ user, profile } | null>` — wrapped in React `cache()`
  so one profile read per request.
- `requireUser(): Promise<Session>` — redirects to `/login` when absent.
- `requireCapability(cap): Promise<{ allowed: true; session } | { allowed: false; role }>`
  — never throws and never redirects, so the caller decides what to render.

Protected pages use exactly this pattern:

```tsx
export default async function AccountsPage() {
  const gate = await requireCapability("view_financials");
  if (!gate.allowed) return <BlockedScreen required="view_financials" role={gate.role} />;
  // ...page content, safe to query financial data
}
```

Session lives in cookies via the existing `@supabase/ssr` server client, so it
survives hard reloads and typed URLs.

### Middleware

`src/middleware.ts` refreshes the Supabase auth cookie on every request and
performs the **coarse auth gate only**:

- unauthenticated → redirect `/login?next=<path>`
- authenticated hitting `/login` → redirect `/dashboard`
- matcher skips `_next/static`, `_next/image`, `favicon.ico`, public assets

Middleware is explicitly **not** the capability gate. Role checks happen in
server components, where the profile is read from the database. Middleware alone
must never be the security boundary for roles.

### Route protection (from `CLAUDE.md` §3 matrix)

| Route | Required capability | Management |
|---|---|---|
| `/dashboard`, `/live-ops`, `/warehouses`, `/lots`, `/imports`, `/exports`, `/clients` | `view_operations` | allowed |
| `/accounts`, `/reports` | `view_financials` | blocked |
| `/audit` | `view_audit` | blocked |
| `/settings/*` | `manage_users` | blocked |

Unauthorized navigation renders **`BlockedScreen`** ("Owner access required")
rather than redirecting — a typed URL gets a real explanation, not a silent
bounce. `/dashboard` stays visible to Management; its financial widgets are
gated inside the page in Phase 7.

### Client side

`src/app/(app)/layout.tsx` (server) fetches the session once and passes it to a
client `SessionProvider`. `usePermissions()` returns `{ role, can(cap) }`.

Sidebar nav items gain an optional `capability` field and are filtered by
`usePermissions()`. **This is cosmetic only** — the server already enforced
access and RLS already filtered the data. UI hiding is never the mechanism.
This is the rule that eliminates the demo's redaction-inconsistency bug class.

### Database change

`supabase/migrations/0009_profile_trigger.sql` — additive; Phase 1 schema
untouched (per `PLAN.md` §5.3 "schema is sacred"):

```sql
create or replace function public.handle_new_user()
returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  insert into public.profiles (id, full_name, role)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'full_name', split_part(new.email,'@',1)),
    'management'
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();
```

`on conflict do nothing` keeps the seed script (which upserts profiles)
idempotent and safe.

## Components / files

| File | Responsibility |
|---|---|
| `src/lib/permissions.ts` | Pure capability matrix + `can()` |
| `src/lib/permissions.test.ts` | Vitest unit tests for the matrix |
| `src/lib/auth.ts` | `getSession`, `requireUser`, `requireCapability` (server) |
| `src/middleware.ts` | Session refresh + coarse auth gate |
| `src/lib/supabase/middleware.ts` | Cookie-wiring helper for middleware |
| `src/components/session-provider.tsx` | Client context + `usePermissions()` |
| `src/components/blocked-screen.tsx` | "Owner access required" screen |
| `src/app/login/page.tsx` | Centered-card login (production UI) |
| `src/app/login/actions.ts` | `signIn` / `signOut` server actions |
| `src/components/layout/top-bar.tsx` | Real user + role badge + sign out (modify) |
| `src/components/layout/dev-user-switcher.tsx` | Dev-only role switcher |
| `src/lib/nav.ts` | Add `capability` per item (modify) |
| `supabase/migrations/0009_profile_trigger.sql` | Profile-on-signup trigger |

## UI direction (production-grade)

Driven through the `frontend-design` skill at implementation time, not default
scaffolding:

- **`/login`** — centered card, brand mark, email + password, inline error on bad
  credentials, disabled/loading submit state, dark-mode aware.
- **`BlockedScreen`** — states the restriction plainly, shows the current role,
  offers a route back to Dashboard. Not a raw 403.
- **Top bar** — real full name, email, role badge, working sign out.
- **Dev switcher** — visually marked as a dev affordance so it never reads as
  product chrome.

## Error handling

- Invalid credentials → inline form error ("Invalid email or password"), no
  user enumeration (same message for unknown email and wrong password).
- Missing profile row for an authed user → treated as no capabilities; blocked
  screen rather than a crash.
- Middleware/network failure on session refresh → treat as unauthenticated and
  redirect to `/login`.

## Verification

- **Vitest:** `can()` for every role × capability; explicit assertions that the
  matrix matches the SQL helpers (`view_financials` ⇔ owner/finance,
  `view_audit`/`manage_users` ⇔ owner only).
- **Browser (the phase's acceptance test):**
  1. Log in as `management@tradeflow.example`.
  2. Navigate to `/accounts` → BlockedScreen.
  3. **Hard-reload** `/accounts` → still blocked (the demo's bug).
  4. Type `/audit`, `/settings/users`, `/reports` directly → all blocked.
  5. Sidebar shows no Finance/System items for Management.
  6. Log in as `owner@` → all routes render; sidebar complete.
  7. Sign out → redirected to `/login`; typed `/dashboard` bounces to `/login`.
- `npm run build` + `tsc --noEmit` + `eslint` clean.

## Out of scope (deferred)

- Users & Roles management UI (Phase 9).
- Gating financial *widgets* inside `/dashboard` (Phase 7).
- Password reset / email flows, MFA, rate limiting (Phase 10 security pass).
- Additional role tiers beyond owner/management being *used* (schema and matrix
  already support `finance`/`warehouse`; no UI exercises them in v1).
