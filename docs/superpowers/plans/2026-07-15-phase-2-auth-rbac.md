# Phase 2 — Auth + RBAC Plumbing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire TradeFlow WMS to real Supabase Auth — server-held sessions, middleware-protected routes, and one pure capability helper that mirrors the Phase 1 SQL helpers — plus production-grade login, blocked-screen, and user-menu UI.

**Architecture:** A pure `can(role, capability)` module is the single source of truth for permissions, unit-tested against the CLAUDE.md §3 matrix. Server components read the session (user + profile) through a request-cached `getSession()`; middleware refreshes the auth cookie and does the coarse authenticated/anonymous gate only. Protected pages call `requireCapability()` and render `BlockedScreen` when denied. A client `SessionProvider` exposes `usePermissions()` for cosmetic nav filtering — never as the enforcement mechanism.

**Tech Stack:** Next.js 15 (App Router, Server Actions), React 19, `@supabase/ssr`, Tailwind v4, shadcn/ui on Base UI, Vitest.

## Global Constraints

- Stack is pinned: **Next.js 15 / React 19 / Tailwind v4 / shadcn (Base UI)**. Do not upgrade.
- shadcn here uses **Base UI**, not Radix: triggers take a `render` prop (not `asChild`), and `DropdownMenuLabel` **must** be wrapped in `DropdownMenuGroup` (it is Base UI's `Menu.GroupLabel` and throws "MenuGroupContext is missing" otherwise).
- **Schema is sacred** (PLAN.md §5.3): only additive, newly-numbered migrations. Phase 1's `0001`–`0008` are untouched.
- **RLS before UI** (PLAN.md §5.4): the database already enforces the matrix. UI gating is cosmetic on top, never the mechanism.
- The capability matrix must match the SQL helpers exactly: `view_financials` ⇔ `can_view_financials()` (`role in ('owner','finance')`); `view_audit`/`manage_users` ⇔ `is_owner()`.
- Seeded test users: `owner@tradeflow.example`, `management@tradeflow.example`, password `TradeFlow!2026`.
- `.env.local` is git-ignored and already holds all Supabase keys. Never commit secrets.
- Production UI: invoke the **frontend-design** skill before writing the login page, blocked screen, and user menu. No default scaffolding.

## File structure

| File | Responsibility |
|---|---|
| `src/lib/permissions.ts` | Pure capability matrix + `can()` — no I/O |
| `src/lib/permissions.test.ts` | Vitest unit tests for the matrix |
| `vitest.config.ts` | Vitest config (node env, `src/**/*.test.ts`) |
| `src/lib/auth.ts` | `getSession`, `requireUser`, `requireCapability` (server-only) |
| `src/lib/supabase/middleware.ts` | Cookie-wiring helper returning `{ supabaseResponse, user }` |
| `src/middleware.ts` | Session refresh + coarse auth gate |
| `src/components/session-provider.tsx` | Client context + `useSession()` / `usePermissions()` |
| `src/components/blocked-screen.tsx` | "Owner access required" screen |
| `src/app/login/page.tsx` | Login route (server) |
| `src/app/login/login-form.tsx` | Login form (client, `useActionState`) |
| `src/app/login/actions.ts` | `signIn` / `signOut` server actions |
| `src/components/layout/dev-user-switcher.tsx` | Dev-only role switcher |
| `src/lib/nav.ts` | Add `capability` per nav item (modify) |
| `src/components/layout/sidebar.tsx` | Filter nav by capability (modify) |
| `src/components/layout/top-bar.tsx` | Real user, role badge, sign out (modify) |
| `src/components/layout/app-shell.tsx` | Accept + pass session (modify) |
| `src/app/(app)/layout.tsx` | Fetch session, wrap in provider (modify) |
| `supabase/migrations/0009_profile_trigger.sql` | Profile-on-signup trigger |

---

### Task 1: Permissions module (TDD)

**Files:**
- Create: `vitest.config.ts`, `src/lib/permissions.ts`, `src/lib/permissions.test.ts`
- Modify: `package.json` (devDep + `test` script)

**Interfaces:**
- Produces: `type AppRole = "owner"|"management"|"warehouse"|"finance"`; `type Capability = "view_operations"|"manage_lots"|"view_financials"|"manage_invoices"|"view_audit"|"manage_users"`; `can(role: AppRole|null|undefined, capability: Capability): boolean`. Consumed by Tasks 3, 5, 7, 8.

- [ ] **Step 1: Install Vitest**

Run: `npm i -D vitest`
Expected: installs without error.

- [ ] **Step 2: Create `vitest.config.ts`**

```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
});
```

- [ ] **Step 3: Add the test script to `package.json`**

Add to `"scripts"`:
```json
"test": "vitest run",
"test:watch": "vitest"
```

- [ ] **Step 4: Write the failing test — `src/lib/permissions.test.ts`**

```ts
import { describe, it, expect } from "vitest";
import { can, ALL_CAPABILITIES, type Capability } from "./permissions";

describe("can()", () => {
  it("gives owner every capability", () => {
    for (const cap of ALL_CAPABILITIES) {
      expect(can("owner", cap)).toBe(true);
    }
  });

  it("gives management only operations and lot management", () => {
    expect(can("management", "view_operations")).toBe(true);
    expect(can("management", "manage_lots")).toBe(true);
    expect(can("management", "view_financials")).toBe(false);
    expect(can("management", "manage_invoices")).toBe(false);
    expect(can("management", "view_audit")).toBe(false);
    expect(can("management", "manage_users")).toBe(false);
  });

  it("denies everything when role is null or undefined", () => {
    for (const cap of ALL_CAPABILITIES) {
      expect(can(null, cap)).toBe(false);
      expect(can(undefined, cap)).toBe(false);
    }
  });

  // These three lock the TS matrix to the Phase 1 SQL helpers. If they drift,
  // the UI and RLS disagree — the exact bug class this project exists to kill.
  it("matches SQL can_view_financials(): role in (owner, finance)", () => {
    const expected: Record<string, boolean> = {
      owner: true, finance: true, management: false, warehouse: false,
    };
    for (const [role, want] of Object.entries(expected)) {
      expect(can(role as never, "view_financials")).toBe(want);
    }
  });

  it("matches SQL is_owner() for view_audit", () => {
    expect(can("owner", "view_audit")).toBe(true);
    for (const role of ["management", "finance", "warehouse"] as const) {
      expect(can(role, "view_audit")).toBe(false);
    }
  });

  it("matches SQL is_owner() for manage_users", () => {
    expect(can("owner", "manage_users")).toBe(true);
    for (const role of ["management", "finance", "warehouse"] as const) {
      expect(can(role, "manage_users")).toBe(false);
    }
  });

  it("reserved roles carry their v2 capabilities", () => {
    expect(can("finance", "manage_invoices")).toBe(true);
    expect(can("finance", "manage_users")).toBe(false);
    expect(can("warehouse", "view_operations")).toBe(true);
    expect(can("warehouse", "manage_lots")).toBe(false);
  });
});
```

- [ ] **Step 5: Run the test to verify it fails**

Run: `npm test`
Expected: FAIL — cannot resolve `./permissions`.

- [ ] **Step 6: Implement `src/lib/permissions.ts`**

```ts
/**
 * The single source of truth for "what can this role do?".
 *
 * This mirrors the Phase 1 SQL helpers exactly (can_view_financials(),
 * is_owner()). RLS is the enforcement mechanism; this module exists so the
 * server can gate routes and the UI can hide what the user cannot use.
 * If the two ever disagree, permissions.test.ts fails.
 */
export type AppRole = "owner" | "management" | "warehouse" | "finance";

export type Capability =
  | "view_operations"
  | "manage_lots"
  | "view_financials"
  | "manage_invoices"
  | "view_audit"
  | "manage_users";

export const ALL_CAPABILITIES: readonly Capability[] = [
  "view_operations",
  "manage_lots",
  "view_financials",
  "manage_invoices",
  "view_audit",
  "manage_users",
];

const ROLE_CAPABILITIES: Record<AppRole, readonly Capability[]> = {
  owner: ALL_CAPABILITIES,
  management: ["view_operations", "manage_lots"],
  // Reserved for v2; schema and matrix already support them.
  finance: ["view_operations", "view_financials", "manage_invoices"],
  warehouse: ["view_operations"],
};

export function can(role: AppRole | null | undefined, capability: Capability): boolean {
  if (!role) return false;
  return ROLE_CAPABILITIES[role]?.includes(capability) ?? false;
}
```

- [ ] **Step 7: Run the test to verify it passes**

Run: `npm test`
Expected: PASS — 7 tests passing.

- [ ] **Step 8: Commit**

```bash
git add vitest.config.ts src/lib/permissions.ts src/lib/permissions.test.ts package.json package-lock.json
git commit -m "feat(auth): capability matrix with unit tests"
```

---

### Task 2: Profile-on-signup trigger

**Files:**
- Create: `supabase/migrations/0009_profile_trigger.sql`

**Interfaces:**
- Produces: `handle_new_user()` trigger on `auth.users`. Any new auth user automatically gets a `profiles` row with role `management`.

- [ ] **Step 1: Write `supabase/migrations/0009_profile_trigger.sql`**

```sql
create or replace function public.handle_new_user()
returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  insert into public.profiles (id, full_name, role)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'full_name', split_part(new.email, '@', 1)),
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

- [ ] **Step 2: Apply to cloud**

Run:
```bash
export SUPABASE_ACCESS_TOKEN="$(node -e 'const fs=require("fs");const m=fs.readFileSync(".env.local","utf8").match(/^SUPABASE_ACCESS_TOKEN=(.*)$/m);process.stdout.write(m[1].trim())')"
DBPW="$(node -e 'const fs=require("fs");const m=fs.readFileSync(".env.local","utf8").match(/^SUPABASE_DB_PASSWORD=(.*)$/m);process.stdout.write(m[1].trim())')"
echo "y" | npx supabase db push --password "$DBPW"
```
Expected: `Applying migration 0009_profile_trigger.sql...` then `Finished supabase db push.`

- [ ] **Step 3: Verify the trigger exists**

Run: `npx tsx scripts/db.ts "select tgname from pg_trigger where tgname='on_auth_user_created'"`
Expected: one row, `on_auth_user_created`.

- [ ] **Step 4: Verify it actually creates a profile (behavioral test)**

Create `scripts/verify-trigger.ts`:
```ts
import { config } from "dotenv";
config({ path: ".env.local" });
import { createClient } from "@supabase/supabase-js";

const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
  auth: { persistSession: false },
});

async function main() {
  const email = `trigger-test-${Date.now()}@tradeflow.example`;
  const { data, error } = await db.auth.admin.createUser({ email, password: "Throwaway!2026", email_confirm: true });
  if (error) throw error;
  const { data: profile } = await db.from("profiles").select("id, full_name, role").eq("id", data.user.id).single();
  console.log("profile created:", profile);
  const ok = profile?.role === "management";
  await db.auth.admin.deleteUser(data.user.id); // cleanup
  console.log(ok ? "PASS: trigger created profile with default role management" : "FAIL");
  process.exit(ok ? 0 : 1);
}
main().catch((e) => { console.error(e); process.exit(1); });
```

Run: `npx tsx scripts/verify-trigger.ts`
Expected: `PASS: trigger created profile with default role management`, exit 0.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/0009_profile_trigger.sql scripts/verify-trigger.ts
git commit -m "feat(db): auto-create profile row on auth user creation"
```

---

### Task 3: Server session helpers

**Files:**
- Create: `src/lib/auth.ts`
- Modify: `package.json` (add `server-only`)

**Interfaces:**
- Consumes: `can()` from Task 1; `createClient()` from `@/lib/supabase/server` (existing, async).
- Produces:
  - `type Profile = { id: string; full_name: string; role: AppRole; department: string | null }`
  - `type Session = { user: { id: string; email: string | null }; profile: Profile }`
  - `getSession(): Promise<Session | null>` (request-cached)
  - `requireUser(): Promise<Session>`
  - `type Gate = { allowed: true; session: Session } | { allowed: false; role: AppRole }`
  - `requireCapability(capability: Capability): Promise<Gate>`

> **Contract note (refines the spec):** `requireCapability` redirects to `/login` **only** when unauthenticated (it delegates to `requireUser`). For an authenticated user who lacks the capability it returns `{ allowed: false }` so the caller renders `BlockedScreen`. The capability decision itself never redirects.

- [ ] **Step 1: Install `server-only`**

Run: `npm i server-only`
Expected: installs without error. (Guards against this module being pulled into a client bundle.)

- [ ] **Step 2: Create `src/lib/auth.ts`**

```ts
import "server-only";
import { cache } from "react";
import { redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";
import { can, type AppRole, type Capability } from "@/lib/permissions";

export type Profile = {
  id: string;
  full_name: string;
  role: AppRole;
  department: string | null;
};

export type Session = {
  user: { id: string; email: string | null };
  profile: Profile;
};

/**
 * The authenticated user plus their profile, or null.
 * `cache()` keeps this to one round-trip per request even when several
 * server components ask for it.
 */
export const getSession = cache(async (): Promise<Session | null> => {
  const supabase = await createClient();

  // getUser() revalidates the JWT with Supabase — do not trust getSession()
  // on the server, which only reads the cookie.
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const { data: profile } = await supabase
    .from("profiles")
    .select("id, full_name, role, department")
    .eq("id", user.id)
    .single();

  // An authed user with no profile row has no capabilities rather than crashing.
  if (!profile) return null;

  return {
    user: { id: user.id, email: user.email ?? null },
    profile: profile as Profile,
  };
});

export async function requireUser(): Promise<Session> {
  const session = await getSession();
  if (!session) redirect("/login");
  return session;
}

export type Gate =
  | { allowed: true; session: Session }
  | { allowed: false; role: AppRole };

export async function requireCapability(capability: Capability): Promise<Gate> {
  const session = await requireUser();
  if (!can(session.profile.role, capability)) {
    return { allowed: false, role: session.profile.role };
  }
  return { allowed: true, session };
}
```

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: exit 0, no output.

- [ ] **Step 4: Commit**

```bash
git add src/lib/auth.ts package.json package-lock.json
git commit -m "feat(auth): server session helpers with capability gate"
```

---

### Task 4: Middleware — session refresh + auth gate

**Files:**
- Create: `src/lib/supabase/middleware.ts`, `src/middleware.ts`

**Interfaces:**
- Produces: `updateSession(request: NextRequest): Promise<{ supabaseResponse: NextResponse; user: User | null }>`; Next middleware protecting every non-public route.

- [ ] **Step 1: Create `src/lib/supabase/middleware.ts`**

```ts
import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

/**
 * Refreshes the Supabase auth cookie and reports the current user.
 * The cookie dance below is required: the response must carry any refreshed
 * cookies back to the browser or the session silently expires.
 */
export async function updateSession(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          supabaseResponse = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options),
          );
        },
      },
    },
  );

  const {
    data: { user },
  } = await supabase.auth.getUser();

  return { supabaseResponse, user };
}
```

- [ ] **Step 2: Create `src/middleware.ts`**

```ts
import { NextResponse, type NextRequest } from "next/server";

import { updateSession } from "@/lib/supabase/middleware";

const PUBLIC_PATHS = ["/login"];

function isPublic(pathname: string) {
  return PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

/**
 * Coarse auth gate only: authenticated vs not. Capability/role checks belong
 * in server components, where the profile is read from the database —
 * middleware must never be the security boundary for roles.
 */
export async function middleware(request: NextRequest) {
  const { supabaseResponse, user } = await updateSession(request);
  const { pathname } = request.nextUrl;

  if (!user && !isPublic(pathname)) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.search = "";
    url.searchParams.set("next", pathname);
    return NextResponse.redirect(url);
  }

  if (user && isPublic(pathname)) {
    const url = request.nextUrl.clone();
    url.pathname = "/dashboard";
    url.search = "";
    return NextResponse.redirect(url);
  }

  return supabaseResponse;
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
```

- [ ] **Step 3: Verify the gate redirects**

Run in one shell: `npm run dev`
Then: `curl -s -o /dev/null -w "%{http_code} %{redirect_url}\n" http://localhost:3000/dashboard`
Expected: `307 http://localhost:3000/login?next=%2Fdashboard`

- [ ] **Step 4: Commit**

```bash
git add src/lib/supabase/middleware.ts src/middleware.ts
git commit -m "feat(auth): middleware session refresh and route gate"
```

---

### Task 5: Login page + auth actions (production UI)

**Files:**
- Create: `src/app/login/actions.ts`, `src/app/login/login-form.tsx`, `src/app/login/page.tsx`

**Interfaces:**
- Consumes: `createClient()` from `@/lib/supabase/server`.
- Produces: `signIn(prevState: SignInState, formData: FormData): Promise<SignInState>` where `type SignInState = { error: string | null }`; `signOut(): Promise<void>` (consumed by Task 8).

> **Invoke the `frontend-design` skill before writing the JSX.** Layout is a centered card (approved), identical at all breakpoints. It must not read as default scaffolding: deliberate type scale, a brand mark, considered spacing, visible focus states, dark-mode aware, and a real loading state on submit.

- [ ] **Step 1: Create `src/app/login/actions.ts`**

```ts
"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";

import { createClient } from "@/lib/supabase/server";

export type SignInState = { error: string | null };

export async function signIn(_prev: SignInState, formData: FormData): Promise<SignInState> {
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  const next = String(formData.get("next") ?? "") || "/dashboard";

  if (!email || !password) {
    return { error: "Enter your email and password." };
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({ email, password });

  // One message for both unknown email and wrong password — no user enumeration.
  if (error) return { error: "Invalid email or password." };

  revalidatePath("/", "layout");
  redirect(next);
}

export async function signOut(): Promise<void> {
  const supabase = await createClient();
  await supabase.auth.signOut();
  revalidatePath("/", "layout");
  redirect("/login");
}
```

- [ ] **Step 2: Create `src/app/login/login-form.tsx`**

```tsx
"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";

import { Button } from "@/components/ui/button";
import { signIn, type SignInState } from "./actions";

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" size="lg" className="w-full" disabled={pending}>
      {pending ? "Signing in…" : "Sign in"}
    </Button>
  );
}

export function LoginForm({ next }: { next: string }) {
  const [state, formAction] = useActionState<SignInState, FormData>(signIn, { error: null });

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <input type="hidden" name="next" value={next} />

      <div className="flex flex-col gap-1.5">
        <label htmlFor="email" className="text-sm font-medium">Email</label>
        <input
          id="email"
          name="email"
          type="email"
          autoComplete="email"
          required
          className="h-10 rounded-lg border bg-background px-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <label htmlFor="password" className="text-sm font-medium">Password</label>
        <input
          id="password"
          name="password"
          type="password"
          autoComplete="current-password"
          required
          className="h-10 rounded-lg border bg-background px-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
        />
      </div>

      {state.error ? (
        <p role="alert" className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {state.error}
        </p>
      ) : null}

      <SubmitButton />
    </form>
  );
}
```

- [ ] **Step 3: Create `src/app/login/page.tsx`**

```tsx
import { Package } from "lucide-react";

import { LoginForm } from "./login-form";

export const metadata = { title: "Sign in — TradeFlow WMS" };

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const { next } = await searchParams;

  return (
    <main className="flex min-h-svh items-center justify-center bg-muted/40 px-4 py-10">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex flex-col items-center gap-3 text-center">
          <div className="flex size-11 items-center justify-center rounded-xl bg-primary text-primary-foreground">
            <Package className="size-6" />
          </div>
          <div>
            <h1 className="text-lg font-semibold tracking-tight">TradeFlow WMS</h1>
            <p className="text-sm text-muted-foreground">
              Commodity trade &amp; warehouse operations
            </p>
          </div>
        </div>

        <div className="rounded-xl border bg-background p-6 shadow-sm">
          <LoginForm next={next ?? "/dashboard"} />
        </div>

        <p className="mt-6 text-center text-xs text-muted-foreground">
          Access is provisioned by your administrator.
        </p>
      </div>
    </main>
  );
}
```

- [ ] **Step 4: Verify login works end-to-end**

Run: `npm run dev`, open `http://localhost:3000/dashboard`.
Expected: redirected to `/login?next=%2Fdashboard`. Sign in as `management@tradeflow.example` / `TradeFlow!2026` → lands on `/dashboard`. A wrong password shows "Invalid email or password." inline.

- [ ] **Step 5: Commit**

```bash
git add src/app/login
git commit -m "feat(auth): login page and sign-in/out server actions"
```

---

### Task 6: SessionProvider + layout wiring

**Files:**
- Create: `src/components/session-provider.tsx`
- Modify: `src/app/(app)/layout.tsx`, `src/components/layout/app-shell.tsx`

**Interfaces:**
- Consumes: `getSession()`/`requireUser()` (Task 3), `can()` (Task 1).
- Produces:
  - `type SessionValue = { userId: string; email: string | null; fullName: string; role: AppRole }`
  - `<SessionProvider value={SessionValue}>`
  - `useSession(): SessionValue` (throws outside provider)
  - `usePermissions(): { role: AppRole; can: (c: Capability) => boolean }`
  - `AppShell` now takes a required `session: SessionValue` prop.

- [ ] **Step 1: Create `src/components/session-provider.tsx`**

```tsx
"use client";

import { createContext, useContext, type ReactNode } from "react";

import { can, type AppRole, type Capability } from "@/lib/permissions";

export type SessionValue = {
  userId: string;
  email: string | null;
  fullName: string;
  role: AppRole;
};

const SessionContext = createContext<SessionValue | null>(null);

export function SessionProvider({
  value,
  children,
}: {
  value: SessionValue;
  children: ReactNode;
}) {
  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionValue {
  const session = useContext(SessionContext);
  if (!session) throw new Error("useSession must be used inside <SessionProvider>");
  return session;
}

/**
 * Cosmetic helper: hides what the user cannot use. The server already gated
 * the route and RLS already filtered the data — this is never the mechanism.
 */
export function usePermissions() {
  const session = useSession();
  return {
    role: session.role,
    can: (capability: Capability) => can(session.role, capability),
  };
}
```

- [ ] **Step 2: Modify `src/app/(app)/layout.tsx`**

Replace the whole file with:
```tsx
import type { ReactNode } from "react";

import { AppShell } from "@/components/layout/app-shell";
import { requireUser } from "@/lib/auth";

export default async function AppLayout({ children }: { children: ReactNode }) {
  const { user, profile } = await requireUser();

  return (
    <AppShell
      session={{
        userId: user.id,
        email: user.email,
        fullName: profile.full_name,
        role: profile.role,
      }}
    >
      {children}
    </AppShell>
  );
}
```

- [ ] **Step 3: Modify `src/components/layout/app-shell.tsx`**

Add the import:
```tsx
import { SessionProvider, type SessionValue } from "@/components/session-provider";
```
Change the signature and wrap the tree:
```tsx
export function AppShell({
  children,
  session,
}: {
  children: ReactNode;
  session: SessionValue;
}) {
```
Wrap the existing outermost `<div className="flex min-h-svh">…</div>` in:
```tsx
<SessionProvider value={session}>
  {/* existing div tree unchanged */}
</SessionProvider>
```

- [ ] **Step 4: Typecheck and verify**

Run: `npx tsc --noEmit`
Expected: exit 0.
Run `npm run dev`, sign in, load `/dashboard`.
Expected: shell renders as before, no console errors.

- [ ] **Step 5: Commit**

```bash
git add src/components/session-provider.tsx "src/app/(app)/layout.tsx" src/components/layout/app-shell.tsx
git commit -m "feat(auth): session provider wired through app shell"
```

---

### Task 7: BlockedScreen + per-route capability gates + nav filtering

**Files:**
- Create: `src/components/blocked-screen.tsx`
- Modify: `src/lib/nav.ts`, `src/components/layout/sidebar.tsx`
- Modify (gate): `src/app/(app)/accounts/page.tsx`, `src/app/(app)/reports/page.tsx`, `src/app/(app)/audit/page.tsx`, `src/app/(app)/settings/users/page.tsx`, `src/app/(app)/settings/company/page.tsx`, `src/app/(app)/settings/preferences/page.tsx`

**Interfaces:**
- Consumes: `requireCapability()` (Task 3), `usePermissions()` (Task 6), `Capability` (Task 1).
- Produces: `<BlockedScreen required={Capability} role={AppRole} />`; `NavItem` gains `capability: Capability`.

> **Invoke the `frontend-design` skill before writing `BlockedScreen`.** It should explain the restriction like a product, not a raw 403.

- [ ] **Step 1: Create `src/components/blocked-screen.tsx`**

```tsx
import Link from "next/link";
import { Lock } from "lucide-react";

import { Button } from "@/components/ui/button";
import type { AppRole, Capability } from "@/lib/permissions";

const CAPABILITY_LABELS: Record<Capability, string> = {
  view_operations: "Operations access",
  manage_lots: "Lot management",
  view_financials: "Financial access",
  manage_invoices: "Invoice management",
  view_audit: "Audit log access",
  manage_users: "User & settings management",
};

const ROLE_LABELS: Record<AppRole, string> = {
  owner: "Owner",
  management: "Management",
  finance: "Finance",
  warehouse: "Warehouse",
};

export function BlockedScreen({
  required,
  role,
}: {
  required: Capability;
  role: AppRole;
}) {
  return (
    <div className="mx-auto flex min-h-[60vh] max-w-md flex-col items-center justify-center gap-5 text-center">
      <div className="flex size-12 items-center justify-center rounded-full bg-muted text-muted-foreground">
        <Lock className="size-6" />
      </div>
      <div className="flex flex-col gap-2">
        <h1 className="text-xl font-semibold tracking-tight">Owner access required</h1>
        <p className="text-sm text-muted-foreground">
          This screen needs <span className="font-medium text-foreground">{CAPABILITY_LABELS[required]}</span>.
          You&apos;re signed in as <span className="font-medium text-foreground">{ROLE_LABELS[role]}</span>,
          which doesn&apos;t include it.
        </p>
        <p className="text-sm text-muted-foreground">
          Ask an Owner if you need access.
        </p>
      </div>
      <Button render={<Link href="/dashboard">Back to Dashboard</Link>} />
    </div>
  );
}
```

- [ ] **Step 2: Gate the six restricted pages**

`src/app/(app)/accounts/page.tsx` — replace the whole file:
```tsx
import { BlockedScreen } from "@/components/blocked-screen";
import { PlaceholderPage } from "@/components/placeholder-page";
import { requireCapability } from "@/lib/auth";

export default async function AccountsPage() {
  const gate = await requireCapability("view_financials");
  if (!gate.allowed) return <BlockedScreen required="view_financials" role={gate.role} />;

  return (
    <PlaceholderPage
      title="Accounts"
      description="AR/AP overview, aging buckets, currency exposure — Receivable and Payable tabs."
      phase="Phase 6"
    />
  );
}
```

`src/app/(app)/reports/page.tsx`:
```tsx
import { BlockedScreen } from "@/components/blocked-screen";
import { PlaceholderPage } from "@/components/placeholder-page";
import { requireCapability } from "@/lib/auth";

export default async function ReportsPage() {
  const gate = await requireCapability("view_financials");
  if (!gate.allowed) return <BlockedScreen required="view_financials" role={gate.role} />;

  return (
    <PlaceholderPage
      title="Balance Sheet / P&L"
      description="Executive summary, commodity performance, and currency exposure over a date range."
      phase="Phase 8"
    />
  );
}
```

`src/app/(app)/audit/page.tsx`:
```tsx
import { BlockedScreen } from "@/components/blocked-screen";
import { PlaceholderPage } from "@/components/placeholder-page";
import { requireCapability } from "@/lib/auth";

export default async function AuditLogPage() {
  const gate = await requireCapability("view_audit");
  if (!gate.allowed) return <BlockedScreen required="view_audit" role={gate.role} />;

  return (
    <PlaceholderPage
      title="Audit Log"
      description="Append-only, hash-chained activity trail with a verify-chain function."
      phase="Phase 9"
    />
  );
}
```

`src/app/(app)/settings/users/page.tsx`:
```tsx
import { BlockedScreen } from "@/components/blocked-screen";
import { PlaceholderPage } from "@/components/placeholder-page";
import { requireCapability } from "@/lib/auth";

export default async function UsersRolesPage() {
  const gate = await requireCapability("manage_users");
  if (!gate.allowed) return <BlockedScreen required="manage_users" role={gate.role} />;

  return (
    <PlaceholderPage
      title="Users & Roles"
      description="Add/deactivate users and assign roles with capability descriptions."
      phase="Phase 9"
    />
  );
}
```

`src/app/(app)/settings/company/page.tsx`:
```tsx
import { BlockedScreen } from "@/components/blocked-screen";
import { PlaceholderPage } from "@/components/placeholder-page";
import { requireCapability } from "@/lib/auth";

export default async function CompanyInfoPage() {
  const gate = await requireCapability("manage_users");
  if (!gate.allowed) return <BlockedScreen required="manage_users" role={gate.role} />;

  return (
    <PlaceholderPage
      title="Company Info"
      description="Company profile used on invoices and delivery documents."
      phase="Phase 9"
    />
  );
}
```

`src/app/(app)/settings/preferences/page.tsx`:
```tsx
import { BlockedScreen } from "@/components/blocked-screen";
import { PlaceholderPage } from "@/components/placeholder-page";
import { requireCapability } from "@/lib/auth";

export default async function PreferencesPage() {
  const gate = await requireCapability("manage_users");
  if (!gate.allowed) return <BlockedScreen required="manage_users" role={gate.role} />;

  return (
    <PlaceholderPage
      title="Preferences"
      description="Default currency, date format, alert thresholds, and toggles."
      phase="Phase 9"
    />
  );
}
```

- [ ] **Step 3: Add `capability` to nav items — replace `src/lib/nav.ts` entirely**

```ts
import {
  LayoutDashboard,
  Radar,
  Warehouse,
  Boxes,
  ArrowDownToLine,
  ArrowUpFromLine,
  Users,
  Wallet,
  BarChart3,
  ScrollText,
  UsersRound,
  Building2,
  SlidersHorizontal,
  type LucideIcon,
} from "lucide-react";

import type { Capability } from "@/lib/permissions";

export type NavItem = {
  title: string;
  href: string;
  icon: LucideIcon;
  capability: Capability;
};

export type NavGroup = {
  label: string;
  items: NavItem[];
};

/**
 * Single source of truth for navigation. The sidebar (desktop) and the
 * mobile bottom tab bar both derive from this, so the module grouping in
 * CLAUDE.md §1 lives in exactly one place.
 *
 * `capability` drives cosmetic filtering only — the server gates the route
 * and RLS filters the data.
 */
export const navGroups: NavGroup[] = [
  {
    label: "Overview",
    items: [
      { title: "Dashboard", href: "/dashboard", icon: LayoutDashboard, capability: "view_operations" },
      { title: "Live Ops", href: "/live-ops", icon: Radar, capability: "view_operations" },
    ],
  },
  {
    label: "Warehouse",
    items: [
      { title: "Warehouses", href: "/warehouses", icon: Warehouse, capability: "view_operations" },
      { title: "Lots", href: "/lots", icon: Boxes, capability: "view_operations" },
    ],
  },
  {
    label: "Trade",
    items: [
      { title: "Imports", href: "/imports", icon: ArrowDownToLine, capability: "view_operations" },
      { title: "Exports", href: "/exports", icon: ArrowUpFromLine, capability: "view_operations" },
      { title: "Clients", href: "/clients", icon: Users, capability: "view_operations" },
    ],
  },
  {
    label: "Finance",
    items: [
      { title: "Accounts", href: "/accounts", icon: Wallet, capability: "view_financials" },
      { title: "Reports", href: "/reports", icon: BarChart3, capability: "view_financials" },
      { title: "Audit Log", href: "/audit", icon: ScrollText, capability: "view_audit" },
    ],
  },
  {
    label: "System",
    items: [
      { title: "Users & Roles", href: "/settings/users", icon: UsersRound, capability: "manage_users" },
      { title: "Company Info", href: "/settings/company", icon: Building2, capability: "manage_users" },
      { title: "Preferences", href: "/settings/preferences", icon: SlidersHorizontal, capability: "manage_users" },
    ],
  },
];

/** Flattened list of all nav items, handy for lookups. */
export const allNavItems: NavItem[] = navGroups.flatMap((g) => g.items);

/**
 * Mobile bottom tab bar — one representative destination per module group,
 * kept to five so touch targets stay comfortable on a phone.
 */
export const bottomNavItems: NavItem[] = [
  { title: "Dashboard", href: "/dashboard", icon: LayoutDashboard, capability: "view_operations" },
  { title: "Lots", href: "/lots", icon: Boxes, capability: "view_operations" },
  { title: "Clients", href: "/clients", icon: Users, capability: "view_operations" },
  { title: "Accounts", href: "/accounts", icon: Wallet, capability: "view_financials" },
  { title: "Settings", href: "/settings/users", icon: SlidersHorizontal, capability: "manage_users" },
];
```

> Note: for a Management user the bottom bar drops to three tabs (Dashboard, Lots, Clients). That's correct — showing tabs that lead to blocked screens would be worse.

- [ ] **Step 4: Filter the sidebar in `src/components/layout/sidebar.tsx`**

Add the import:
```tsx
import { usePermissions } from "@/components/session-provider";
```
Inside `SidebarNav`, after `const pathname = usePathname();` add:
```tsx
const { can } = usePermissions();
```
Replace `{navGroups.map((group) => (` with a filtered version:
```tsx
{navGroups
  .map((group) => ({ ...group, items: group.items.filter((item) => can(item.capability)) }))
  .filter((group) => group.items.length > 0)
  .map((group) => (
```
(the rest of the group JSX is unchanged).

Do the same in `src/components/layout/bottom-nav.tsx`: add `const { can } = usePermissions();` and change `{bottomNavItems.map(` to `{bottomNavItems.filter((item) => can(item.capability)).map(`.

- [ ] **Step 5: Verify**

Run: `npx tsc --noEmit` → exit 0.
Run `npm run dev`, sign in as `management@tradeflow.example`:
- Sidebar shows Overview / Warehouse / Trade only — no Finance or System groups.
- Type `/accounts` → BlockedScreen ("Owner access required").
- **Hard-reload** `/accounts` → still blocked.
Sign in as `owner@tradeflow.example`: all groups present, `/accounts` renders the placeholder.

- [ ] **Step 6: Commit**

```bash
git add src/components/blocked-screen.tsx src/lib/nav.ts src/components/layout/sidebar.tsx src/components/layout/bottom-nav.tsx "src/app/(app)"
git commit -m "feat(auth): blocked screen, per-route capability gates, nav filtering"
```

---

### Task 8: Real user menu + dev-only switcher

**Files:**
- Create: `src/components/layout/dev-user-switcher.tsx`
- Modify: `src/components/layout/top-bar.tsx`, `src/app/login/actions.ts`

**Interfaces:**
- Consumes: `useSession()` (Task 6), `signOut()` (Task 5).
- Produces: `devSignInAs(email: string): Promise<void>` server action (dev-only, throws in production).

> **Invoke the `frontend-design` skill before restyling the menu.** The dev switcher must be visually marked as a dev affordance so it never reads as product chrome.

- [ ] **Step 1: Add the dev-only action to `src/app/login/actions.ts`**

Append:
```ts
/**
 * Dev-only: sign in as a seeded test user to exercise RBAC quickly.
 * Hard-fails in production so it can never become a login bypass.
 */
export async function devSignInAs(email: string): Promise<void> {
  if (process.env.NODE_ENV === "production") {
    throw new Error("devSignInAs is disabled in production");
  }
  const supabase = await createClient();
  await supabase.auth.signOut();
  const { error } = await supabase.auth.signInWithPassword({
    email,
    password: "TradeFlow!2026",
  });
  if (error) throw new Error(`dev sign-in failed: ${error.message}`);
  revalidatePath("/", "layout");
  redirect("/dashboard");
}
```

- [ ] **Step 2: Create `src/components/layout/dev-user-switcher.tsx`**

```tsx
"use client";

import { FlaskConical } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { devSignInAs } from "@/app/login/actions";

const TEST_USERS = [
  { email: "owner@tradeflow.example", label: "Ava Owner", role: "Owner" },
  { email: "management@tradeflow.example", label: "Marcus Manager", role: "Management" },
];

/** Dev affordance — deliberately styled as a tool, not product chrome. */
export function DevUserSwitcher() {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button variant="outline" size="sm" className="gap-1.5 border-dashed text-muted-foreground">
            <FlaskConical className="size-3.5" />
            <span className="hidden sm:inline">Dev</span>
          </Button>
        }
      />
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuGroup>
          {/* Base UI: GroupLabel must live inside a Group. */}
          <DropdownMenuLabel>Switch user (dev only)</DropdownMenuLabel>
        </DropdownMenuGroup>
        {TEST_USERS.map((u) => (
          <DropdownMenuItem key={u.email} onClick={() => devSignInAs(u.email)}>
            <span className="flex flex-col">
              <span>{u.label}</span>
              <span className="text-xs text-muted-foreground">{u.role}</span>
            </span>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
```

- [ ] **Step 3: Rewrite `src/components/layout/top-bar.tsx`**

```tsx
"use client";

import type { ReactNode } from "react";
import { ChevronDown, LogOut } from "lucide-react";

import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useSession } from "@/components/session-provider";
import { DevUserSwitcher } from "@/components/layout/dev-user-switcher";
import { signOut } from "@/app/login/actions";
import type { AppRole } from "@/lib/permissions";

const ROLE_LABELS: Record<AppRole, string> = {
  owner: "Owner",
  management: "Management",
  finance: "Finance",
  warehouse: "Warehouse",
};

function initials(name: string) {
  return name
    .split(" ")
    .map((p) => p[0])
    .filter(Boolean)
    .slice(0, 2)
    .join("")
    .toUpperCase();
}

export function TopBar({ leftSlot }: { leftSlot?: ReactNode }) {
  const session = useSession();
  const isDev = process.env.NODE_ENV !== "production";

  return (
    <header className="sticky top-0 z-30 flex h-14 items-center gap-2 border-b bg-background/95 px-4 backdrop-blur supports-[backdrop-filter]:bg-background/60">
      {leftSlot}
      <div className="flex-1" />

      {isDev ? <DevUserSwitcher /> : null}

      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button variant="ghost" className="h-9 gap-2 px-2">
              <Avatar className="size-7">
                <AvatarFallback className="text-xs">{initials(session.fullName)}</AvatarFallback>
              </Avatar>
              <span className="hidden text-sm font-medium sm:inline">{session.fullName}</span>
              <span className="hidden rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground md:inline">
                {ROLE_LABELS[session.role]}
              </span>
              <ChevronDown className="hidden size-4 text-muted-foreground sm:inline" />
            </Button>
          }
        />
        <DropdownMenuContent align="end" className="w-60">
          <DropdownMenuGroup>
            {/* Base UI: GroupLabel must live inside a Group. */}
            <DropdownMenuLabel className="flex flex-col">
              <span>{session.fullName}</span>
              <span className="text-xs font-normal text-muted-foreground">{session.email}</span>
            </DropdownMenuLabel>
          </DropdownMenuGroup>
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={() => signOut()}>
            <LogOut className="size-4" />
            Sign out
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </header>
  );
}
```

- [ ] **Step 4: Verify**

Run: `npx tsc --noEmit` → exit 0.
Run `npm run dev`, sign in as Owner:
- Top bar shows "Ava Owner" + "Owner" badge; menu shows the real email.
- Dev switcher → "Marcus Manager" → page reloads as Management; sidebar loses Finance/System.
- Sign out → redirected to `/login`.

- [ ] **Step 5: Commit**

```bash
git add src/components/layout/top-bar.tsx src/components/layout/dev-user-switcher.tsx src/app/login/actions.ts
git commit -m "feat(auth): real user menu, sign out, dev-only user switcher"
```

---

### Task 9: Full acceptance verification

**Files:** none (verification only)

- [ ] **Step 1: Static gates**

Run: `npm test` → all permission tests PASS.
Run: `npx tsc --noEmit` → exit 0.
Run: `npm run lint` → exit 0.
Run: `npm run build` → succeeds.

- [ ] **Step 2: The phase's acceptance test (browser)**

With `npm run dev` running, verify each:

1. Logged out, GET `/dashboard` → redirected to `/login?next=%2Fdashboard`.
2. Sign in as `management@tradeflow.example` → lands on `/dashboard`.
3. Navigate `/accounts` → BlockedScreen.
4. **Hard-reload `/accounts` (F5)** → still blocked. *(This is the demo bug this phase exists to kill.)*
5. Type `/audit`, `/reports`, `/settings/users` directly → all blocked.
6. Sidebar shows no Finance/System groups.
7. Sign out → `/login`; typed `/dashboard` bounces back to `/login`.
8. Sign in as `owner@tradeflow.example` → every route renders; sidebar complete.

- [ ] **Step 3: Confirm RLS still backs the UI (defence in depth)**

Run: `npx tsx scripts/verify-rls.ts`
Expected: all PASS — proves the database still refuses financial data to Management regardless of the UI.

- [ ] **Step 4: Commit any fixes**

```bash
git add -A
git commit -m "test(auth): Phase 2 acceptance verification"
```

---

## Phase 2 Done — Verify Checklist (PLAN.md)

- [ ] Supabase Auth email/password login working; no public signup exists.
- [ ] `profiles` row auto-created on new auth user (trigger verified behaviorally).
- [ ] Server-side session: hard-reload on `/accounts` as Management → **still blocked**.
- [ ] Typed URLs cannot escalate (`/audit`, `/reports`, `/settings/*` all blocked).
- [ ] `can(user, capability)` is the only permission question the app asks; unit-tested against the SQL helpers.
- [ ] BlockedScreen shown for unauthorized direct navigation.
- [ ] Dev-only switch-user dropdown backed by real sessions.
- [ ] `npm test`, `tsc --noEmit`, `lint`, `build` all clean.

## Self-review notes (author)

- **Spec coverage:** capability model → Task 1; trigger → Task 2; server session → Task 3; middleware → Task 4; login UI + actions → Task 5; provider/`usePermissions` → Task 6; BlockedScreen + route table + nav filtering → Task 7; top bar + dev switcher → Task 8; verification → Task 9. No spec section is unimplemented.
- **Contract refinement:** the spec said `requireCapability` "never redirects"; Task 3 clarifies it redirects only for *unauthenticated* users (delegating to `requireUser`) and returns `{ allowed: false }` for authenticated-but-unauthorized. Flagged inline in Task 3.
- **Type consistency:** `Capability`/`AppRole` names identical across Tasks 1/3/6/7/8; `SessionValue` fields (`userId`, `email`, `fullName`, `role`) match between Task 6's provider and Task 8's consumer; `SignInState` matches between action and form.
- **Base UI trap:** every `DropdownMenuLabel` in Tasks 7–8 is wrapped in `DropdownMenuGroup`, and triggers use `render` — the Phase 0 crash is not reintroduced.
- **Known deviation:** `Button render={<Link/>}` in BlockedScreen relies on Base UI's `render` prop; if it misbehaves at runtime, fall back to wrapping `<Link>` around a plain `<Button>` and verify in the browser.
