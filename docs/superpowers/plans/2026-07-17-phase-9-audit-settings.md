# Phase 9 — Audit Log + Settings Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** An owner-only Audit Log screen (stats, filters, SEQ+HASH entries, verify-chain) and three Settings screens (Users & Roles, Company Info, Preferences) whose stored values genuinely drive behavior.

**Architecture:** One column migration (`profiles.active`); the hash-chain and `verify_audit_chain()` already exist. `getSession` enforces deactivation at auth. Server-only data layers read the RLS'd tables; audited server actions write profiles/company/settings. The alert toggles are wired into `getOpenExceptions`. Pages are server components; the verify-chain button and the edit dialogs are client islands.

**Tech Stack:** Next.js 15 App Router, React 19, Supabase (Postgres 17, RLS, rpc), Zod 4, Vitest, Tailwind v4, shadcn/ui Dialog.

## Global Constraints

- **Next.js 15**, not 16.
- **Schema is sacred**: only DDL is `profiles.active` in `0016_audit_settings.sql`.
- **Deactivation enforced at auth**: `getSession` returns null for an inactive profile — not just UI-hidden.
- **Self-guard**: an owner cannot deactivate or change the role of their own account.
- **Every settings/user/company write is audited** via `writeAudit`.
- **`registrations` is read-only** (admin-locked).
- **Alert toggles drive display** (filter exception types in `getOpenExceptions`); the threshold drives generation (already wired in Phase 7).
- **Owner-only**: `/audit` gated `view_audit`; `/settings/*` gated `manage_users`.
- **Append-only audit_log**: the acceptance script never inserts rows it can't delete; the tamper test mutates one row and restores it exactly (net-zero). Never truncate/reseed or touch `LOT-2026-00301`.

---

## File Structure

**Create:**
- `supabase/migrations/0016_audit_settings.sql`, `supabase/tests/verify_phase9.sql`
- `src/lib/schemas/preferences.ts` + `.test.ts`
- `src/lib/audit-format.ts` + `.test.ts`
- `src/lib/audit-log.ts`
- `src/lib/users.ts`, `src/lib/company.ts`, `src/lib/preferences.ts`
- `src/app/(app)/audit/actions.ts`, `src/app/(app)/audit/verify-chain-button.tsx`
- `src/app/(app)/settings/users/actions.ts`, `src/app/(app)/settings/users/user-dialog.tsx`
- `src/app/(app)/settings/company/actions.ts`, `src/app/(app)/settings/company/company-form.tsx`
- `src/app/(app)/settings/preferences/actions.ts`, `src/app/(app)/settings/preferences/preferences-form.tsx`
- `scripts/verify-audit.ts`

**Modify:**
- `src/lib/auth.ts` — `Profile.active`, `getSession` block.
- `src/lib/exceptions.ts` — alert-toggle filter in `getOpenExceptions`.
- `src/app/(app)/audit/page.tsx`, `settings/users/page.tsx`, `settings/company/page.tsx`, `settings/preferences/page.tsx` — replace placeholders.

---

## Task 1: `profiles.active` migration + auth enforcement

**Files:**
- Create: `supabase/migrations/0016_audit_settings.sql`, `supabase/tests/verify_phase9.sql`
- Modify: `src/lib/auth.ts`

**Interfaces:**
- Produces: `profiles.active` column; `Profile.active: boolean`; `getSession` returns null for inactive users.

- [ ] **Step 1: Write the migration**

Create `supabase/migrations/0016_audit_settings.sql`:

```sql
-- Phase 9: deactivatable users. The audit chain (0007) already exists.
alter table profiles add column active boolean not null default true;
```

Create `supabase/tests/verify_phase9.sql`:

```sql
select 'profiles.active column' as check,
  exists(select 1 from information_schema.columns
          where table_name='profiles' and column_name='active') as ok
union all
select 'verify_audit_chain intact',
  (select public.verify_audit_chain()) is null;
```

- [ ] **Step 2: Apply + verify**

`node "$CLAUDE_JOB_DIR/tmp/run-sql.mjs" supabase/migrations/0016_audit_settings.sql` then run `verify_phase9.sql`.
Expected: both rows `ok = true` (column exists; chain currently intact).

- [ ] **Step 3: Enforce deactivation in `getSession`**

In `src/lib/auth.ts`, add `active: boolean` to `Profile`, and update the select + guard:

```ts
export type Profile = {
  id: string;
  full_name: string;
  role: AppRole;
  department: string | null;
  active: boolean;
};
```

```ts
  const { data: profile } = await supabase
    .from("profiles")
    .select("id, full_name, role, department, active")
    .eq("id", user.id)
    .single();

  // No profile, or a deactivated one, has no session — blocked by construction.
  if (!profile || profile.active === false) return null;
```

- [ ] **Step 4: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/0016_audit_settings.sql supabase/tests/verify_phase9.sql src/lib/auth.ts
git commit -m "feat(settings): profiles.active column, enforced at auth"
```

---

## Task 2: Preferences schema + audit label formatter (TDD)

**Files:**
- Create: `src/lib/schemas/preferences.ts` + `src/lib/schemas/preferences.test.ts`
- Create: `src/lib/audit-format.ts` + `src/lib/audit-format.test.ts`

**Interfaces:**
- Produces: `preferencesSchema`, `PreferencesInput`, `CURRENCIES`, `DATE_FORMATS`; `AUDIT_ACTION_LABELS`, `auditActionLabel`.

- [ ] **Step 1: Write the failing tests**

Create `src/lib/schemas/preferences.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { preferencesSchema } from "./preferences";

const base = {
  default_currency: "USD", date_format: "DD MMM YYYY", low_stock_threshold_pct: "80",
  overdue_invoices: true, over_capacity: true, missing_bl: false,
};

describe("preferencesSchema", () => {
  it("accepts valid preferences and coerces the threshold", () => {
    const r = preferencesSchema.parse(base);
    expect(r.low_stock_threshold_pct).toBe(80);
    expect(r.missing_bl).toBe(false);
  });
  it("rejects a threshold above 100", () => {
    expect(preferencesSchema.safeParse({ ...base, low_stock_threshold_pct: "150" }).success).toBe(false);
  });
  it("rejects a threshold below 1", () => {
    expect(preferencesSchema.safeParse({ ...base, low_stock_threshold_pct: "0" }).success).toBe(false);
  });
  it("rejects an unknown currency", () => {
    expect(preferencesSchema.safeParse({ ...base, default_currency: "BTC" }).success).toBe(false);
  });
});
```

Create `src/lib/audit-format.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { auditActionLabel } from "./audit-format";

describe("auditActionLabel", () => {
  it("labels known actions", () => {
    expect(auditActionLabel("create")).toBe("Created");
    expect(auditActionLabel("transition")).toBe("Status change");
  });
  it("passes through unknown actions", () => expect(auditActionLabel("frobnicate")).toBe("frobnicate"));
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run src/lib/schemas/preferences.test.ts src/lib/audit-format.test.ts`
Expected: FAIL (modules not found).

- [ ] **Step 3: Implement**

Create `src/lib/schemas/preferences.ts`:

```ts
import { z } from "zod";

export const CURRENCIES = ["USD", "EUR", "GBP", "AED"] as const;
export const DATE_FORMATS = ["DD MMM YYYY", "YYYY-MM-DD", "MM/DD/YYYY"] as const;

/** Booleans come pre-converted from checkbox presence in the action. */
export const preferencesSchema = z.object({
  default_currency: z.enum(CURRENCIES),
  date_format: z.enum(DATE_FORMATS),
  low_stock_threshold_pct: z.coerce.number().int().min(1).max(100),
  overdue_invoices: z.boolean(),
  over_capacity: z.boolean(),
  missing_bl: z.boolean(),
});

export type PreferencesInput = z.infer<typeof preferencesSchema>;
```

Create `src/lib/audit-format.ts`:

```ts
export const AUDIT_ACTION_LABELS: Record<string, string> = {
  create: "Created",
  update: "Updated",
  delete: "Deleted",
  transition: "Status change",
  resolve: "Resolved",
  flag: "Flagged",
};

export function auditActionLabel(action: string): string {
  return AUDIT_ACTION_LABELS[action] ?? action;
}
```

- [ ] **Step 4: Run to verify they pass**

Run: `npx vitest run src/lib/schemas/preferences.test.ts src/lib/audit-format.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/schemas/preferences.ts src/lib/schemas/preferences.test.ts src/lib/audit-format.ts src/lib/audit-format.test.ts
git commit -m "feat(settings): preferences schema and audit action labels with unit tests"
```

---

## Task 3: Audit data layer

**Files:**
- Create: `src/lib/audit-log.ts`

**Interfaces:**
- Consumes: `createClient` (server).
- Produces: `type AuditEntry`, `type AuditStats`; `listAuditEntries({actor?, action?}, limit?)`, `getAuditStats()`, `listActors()`, `verifyChain()`.

- [ ] **Step 1: Write the data layer**

Create `src/lib/audit-log.ts`:

```ts
import "server-only";

import { createClient } from "@/lib/supabase/server";

export type AuditEntry = {
  seq: number;
  action: string;
  entity_type: string;
  entity_id: string | null;
  actor: string | null;
  created_at: string;
  hash: string;
};

export type AuditStats = {
  total: number;
  actors: number;
  byAction: { action: string; count: number }[];
};

async function actorNames(supabase: Awaited<ReturnType<typeof createClient>>, ids: string[]) {
  const unique = [...new Set(ids.filter(Boolean))];
  if (unique.length === 0) return new Map<string, string>();
  const { data } = await supabase.from("profiles").select("id, full_name").in("id", unique);
  return new Map((data ?? []).map((p) => [p.id as string, p.full_name as string]));
}

export async function listAuditEntries(
  opts: { actor?: string; action?: string } = {},
  limit = 100,
): Promise<AuditEntry[]> {
  const supabase = await createClient();
  let query = supabase
    .from("audit_log")
    .select("seq, user_id, action, entity_type, entity_id, hash, created_at")
    .order("seq", { ascending: false })
    .limit(limit);
  if (opts.actor) query = query.eq("user_id", opts.actor);
  if (opts.action) query = query.eq("action", opts.action);

  const { data, error } = await query;
  if (error) throw new Error(`listAuditEntries: ${error.message}`);

  type Row = {
    seq: number; user_id: string | null; action: string; entity_type: string;
    entity_id: string | null; hash: string; created_at: string;
  };
  const rows = (data ?? []) as Row[];
  const names = await actorNames(supabase, rows.map((r) => r.user_id ?? ""));
  return rows.map((r) => ({
    seq: r.seq,
    action: r.action,
    entity_type: r.entity_type,
    entity_id: r.entity_id,
    actor: r.user_id ? names.get(r.user_id) ?? null : null,
    created_at: r.created_at,
    hash: r.hash,
  }));
}

export async function getAuditStats(): Promise<AuditStats> {
  const supabase = await createClient();
  const { data } = await supabase.from("audit_log").select("action, user_id");
  const rows = (data ?? []) as { action: string; user_id: string | null }[];
  const byAction = new Map<string, number>();
  const actors = new Set<string>();
  for (const r of rows) {
    byAction.set(r.action, (byAction.get(r.action) ?? 0) + 1);
    if (r.user_id) actors.add(r.user_id);
  }
  return {
    total: rows.length,
    actors: actors.size,
    byAction: [...byAction.entries()].map(([action, count]) => ({ action, count })).sort((a, b) => b.count - a.count),
  };
}

export async function listActors(): Promise<{ id: string; name: string }[]> {
  const supabase = await createClient();
  const { data } = await supabase.from("audit_log").select("user_id");
  const ids = [...new Set((data ?? []).map((r) => (r as { user_id: string | null }).user_id).filter(Boolean) as string[])];
  const names = await actorNames(supabase, ids);
  return ids.map((id) => ({ id, name: names.get(id) ?? "Unknown" })).sort((a, b) => a.name.localeCompare(b.name));
}

export async function verifyChain(): Promise<{ intact: boolean; badSeq: number | null }> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("verify_audit_chain");
  if (error) throw new Error(`verifyChain: ${error.message}`);
  const badSeq = data == null ? null : Number(data);
  return { intact: badSeq == null, badSeq };
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/lib/audit-log.ts
git commit -m "feat(audit): server-only data layer for entries, stats, and chain verification"
```

---

## Task 4: Audit Log screen

**Files:**
- Create: `src/app/(app)/audit/actions.ts`, `src/app/(app)/audit/verify-chain-button.tsx`
- Modify: `src/app/(app)/audit/page.tsx`

**Interfaces:**
- Consumes: `listAuditEntries`, `getAuditStats`, `listActors`, `verifyChain`, `auditActionLabel`, `AUDIT_ACTION_LABELS`.
- Produces: `verifyChainAction`; `VerifyChainButton`; the `/audit` UI.

- [ ] **Step 1: Write the verify action**

Create `src/app/(app)/audit/actions.ts`:

```ts
"use server";

import { requireCapability } from "@/lib/auth";
import { verifyChain } from "@/lib/audit-log";

export type VerifyState = { checked: boolean; intact: boolean; badSeq: number | null; error: string | null };

export async function verifyChainAction(): Promise<VerifyState> {
  const gate = await requireCapability("view_audit");
  if (!gate.allowed) return { checked: false, intact: false, badSeq: null, error: "Owner access required." };
  const { intact, badSeq } = await verifyChain();
  return { checked: true, intact, badSeq, error: null };
}
```

- [ ] **Step 2: Write the verify-chain button**

Create `src/app/(app)/audit/verify-chain-button.tsx`:

```tsx
"use client";

import { useActionState } from "react";
import { ShieldCheck, ShieldAlert } from "lucide-react";

import { Button } from "@/components/ui/button";
import { verifyChainAction, type VerifyState } from "./actions";

const initial: VerifyState = { checked: false, intact: false, badSeq: null, error: null };

export function VerifyChainButton() {
  const [state, action, pending] = useActionState(async () => verifyChainAction(), initial);
  return (
    <form action={action} className="flex items-center gap-3">
      <Button type="submit" variant="outline" size="sm" disabled={pending}>
        {pending ? "Verifying…" : "Verify chain"}
      </Button>
      {state.error ? (
        <span className="text-sm text-destructive">{state.error}</span>
      ) : state.checked ? (
        state.intact ? (
          <span className="flex items-center gap-1.5 text-sm text-[#0f9d8c]">
            <ShieldCheck className="size-4" /> Chain intact
          </span>
        ) : (
          <span className="flex items-center gap-1.5 text-sm text-destructive">
            <ShieldAlert className="size-4" /> Tampering detected at seq {state.badSeq}
          </span>
        )
      ) : null}
    </form>
  );
}
```

- [ ] **Step 3: Write the page**

Replace `src/app/(app)/audit/page.tsx`:

```tsx
import Link from "next/link";

import { requireCapability } from "@/lib/auth";
import { BlockedScreen } from "@/components/blocked-screen";
import { listAuditEntries, getAuditStats, listActors } from "@/lib/audit-log";
import { auditActionLabel, AUDIT_ACTION_LABELS } from "@/lib/audit-format";
import { VerifyChainButton } from "./verify-chain-button";

export default async function AuditPage({
  searchParams,
}: {
  searchParams: Promise<{ actor?: string; action?: string }>;
}) {
  const gate = await requireCapability("view_audit");
  if (!gate.allowed) return <BlockedScreen required="view_audit" role={gate.role} />;

  const sp = await searchParams;
  const [entries, stats, actors] = await Promise.all([
    listAuditEntries({ actor: sp.actor, action: sp.action }),
    getAuditStats(),
    listActors(),
  ]);

  const actions = Object.keys(AUDIT_ACTION_LABELS);
  const qs = (patch: Record<string, string | undefined>) => {
    const p = new URLSearchParams();
    const actor = patch.actor ?? sp.actor;
    const action = patch.action ?? sp.action;
    if (actor) p.set("actor", actor);
    if (action) p.set("action", action);
    const s = p.toString();
    return s ? `/audit?${s}` : "/audit";
  };

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-6">
      <div className="flex items-start justify-between gap-4">
        <div className="flex flex-col gap-1">
          <h1 className="text-2xl font-semibold tracking-tight">Audit Log</h1>
          <p className="text-sm text-muted-foreground">Append-only, hash-chained activity trail.</p>
        </div>
        <VerifyChainButton />
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <Stat label="Total entries" value={stats.total.toLocaleString("en-US")} />
        <Stat label="Actors" value={stats.actors.toLocaleString("en-US")} />
        <Stat label="Top action" value={stats.byAction[0] ? auditActionLabel(stats.byAction[0].action) : "—"} sub={stats.byAction[0] ? `${stats.byAction[0].count}` : undefined} />
      </div>

      {/* Action filter */}
      <div className="flex flex-wrap items-center gap-2">
        <Link href={qs({ action: undefined, actor: sp.actor })} className={chip(!sp.action)}>All actions</Link>
        {actions.map((a) => (
          <Link key={a} href={qs({ action: a })} className={chip(sp.action === a)}>{auditActionLabel(a)}</Link>
        ))}
      </div>
      {/* Actor filter */}
      {actors.length > 0 ? (
        <div className="flex flex-wrap items-center gap-2">
          <Link href={qs({ actor: undefined, action: sp.action })} className={chip(!sp.actor)}>All actors</Link>
          {actors.map((a) => (
            <Link key={a.id} href={qs({ actor: a.id })} className={chip(sp.actor === a.id)}>{a.name}</Link>
          ))}
        </div>
      ) : null}

      {entries.length === 0 ? (
        <div className="rounded-xl border border-dashed p-10 text-center text-sm text-muted-foreground">No entries match.</div>
      ) : (
        <div className="overflow-x-auto rounded-xl border">
          <table className="w-full text-sm">
            <thead className="border-b bg-muted/40">
              <tr className="text-left font-mono text-[0.6875rem] uppercase tracking-wider text-muted-foreground">
                <th className="px-4 py-2.5 font-medium">Seq</th>
                <th className="px-4 py-2.5 font-medium">Action</th>
                <th className="px-4 py-2.5 font-medium">Entity</th>
                <th className="px-4 py-2.5 font-medium">Actor</th>
                <th className="px-4 py-2.5 font-medium">When</th>
                <th className="px-4 py-2.5 font-medium">Hash</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((e) => (
                <tr key={e.seq} className="border-b last:border-0 hover:bg-muted/30">
                  <td className="px-4 py-2.5 font-mono text-xs tabular-nums">{e.seq}</td>
                  <td className="px-4 py-2.5">{auditActionLabel(e.action)}</td>
                  <td className="px-4 py-2.5 text-muted-foreground">
                    {e.entity_type}
                    {e.entity_id ? <span className="ml-1 font-mono text-[0.6875rem]">{e.entity_id.slice(0, 8)}</span> : null}
                  </td>
                  <td className="px-4 py-2.5">{e.actor ?? "System"}</td>
                  <td className="px-4 py-2.5 text-xs text-muted-foreground">{new Date(e.created_at).toLocaleString("en-US")}</td>
                  <td className="px-4 py-2.5 font-mono text-[0.6875rem] text-muted-foreground" title={e.hash}>{e.hash.slice(0, 12)}…</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function chip(active: boolean) {
  return `rounded-full border px-3 py-1 text-xs font-medium ${active ? "bg-foreground text-background" : "text-muted-foreground hover:text-foreground"}`;
}

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="flex flex-col gap-1 rounded-xl border p-5">
      <span className="font-mono text-[0.6875rem] uppercase tracking-wider text-muted-foreground">{label}</span>
      <span className="text-2xl font-semibold tabular-nums">{value}</span>
      {sub ? <span className="text-xs text-muted-foreground">{sub}</span> : null}
    </div>
  );
}
```

- [ ] **Step 4: Typecheck, lint**

Run: `npx tsc --noEmit && npx eslint "src/app/(app)/audit"`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add "src/app/(app)/audit"
git commit -m "feat(audit): log screen with stats, actor/action filters, and chain verification"
```

---

## Task 5: Users & Roles

**Files:**
- Create: `src/lib/users.ts`, `src/app/(app)/settings/users/actions.ts`, `src/app/(app)/settings/users/user-dialog.tsx`
- Modify: `src/app/(app)/settings/users/page.tsx`

**Interfaces:**
- Consumes: `requireCapability`, `writeAudit`, `can`, Dialog, `AppRole`.
- Produces: `listProfiles()`; `saveUser` action; `UserDialog`; the `/settings/users` UI.

- [ ] **Step 1: Write the data layer**

Create `src/lib/users.ts`:

```ts
import "server-only";

import { createClient } from "@/lib/supabase/server";
import type { AppRole } from "@/lib/permissions";

export type UserRow = {
  id: string; full_name: string; role: AppRole; department: string | null; active: boolean;
};

export async function listProfiles(): Promise<UserRow[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("profiles")
    .select("id, full_name, role, department, active")
    .order("full_name");
  if (error) throw new Error(`listProfiles: ${error.message}`);
  return (data ?? []) as UserRow[];
}
```

- [ ] **Step 2: Write the action (with self-guard)**

Create `src/app/(app)/settings/users/actions.ts`:

```ts
"use server";

import { revalidatePath } from "next/cache";

import { createClient } from "@/lib/supabase/server";
import { requireCapability } from "@/lib/auth";
import { writeAudit } from "@/lib/audit";
import { ALL_CAPABILITIES, type AppRole } from "@/lib/permissions";

export type UserActionState = { error: string | null; ok?: boolean };

const ROLES: AppRole[] = ["owner", "management", "finance", "warehouse"];

export async function saveUser(_prev: UserActionState, formData: FormData): Promise<UserActionState> {
  const gate = await requireCapability("manage_users");
  if (!gate.allowed) return { error: "Owner access required." };

  const id = String(formData.get("id") ?? "");
  const role = String(formData.get("role") ?? "") as AppRole;
  const active = formData.get("active") === "on";
  if (!id || !ROLES.includes(role)) return { error: "Pick a valid role." };

  // Self-guard: don't let an owner lock themselves out.
  if (id === gate.session.user.id && (!active || role !== "owner")) {
    return { error: "You can't change your own role or deactivate yourself." };
  }

  const supabase = await createClient();
  const { data: before } = await supabase.from("profiles").select("role, active").eq("id", id).maybeSingle();
  const { error } = await supabase.from("profiles").update({ role, active }).eq("id", id);
  if (error) return { error: error.message };

  await writeAudit("update", "user", id, { before, after: { role, active } });
  revalidatePath("/settings/users");
  return { error: null, ok: true };
}

/** One-line capability blurb per role, for the dialog. */
export function roleBlurb(role: AppRole): string {
  const caps = {
    owner: "Full access — financials, audit, users & settings.",
    management: "Operations and lots; no financials.",
    finance: "Operations, financials, and invoices.",
    warehouse: "Operations only.",
  } as const;
  return caps[role];
}

export { ROLES, ALL_CAPABILITIES };
```

- [ ] **Step 3: Write the dialog**

Create `src/app/(app)/settings/users/user-dialog.tsx`:

```tsx
"use client";

import { useActionState, useEffect, useState } from "react";
import { useFormStatus } from "react-dom";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { saveUser, roleBlurb, ROLES, type UserActionState } from "./actions";
import type { AppRole } from "@/lib/permissions";

const ROLE_LABELS: Record<AppRole, string> = { owner: "Owner", management: "Management", finance: "Finance", warehouse: "Warehouse" };

function SubmitButton() {
  const { pending } = useFormStatus();
  return <Button type="submit" disabled={pending}>{pending ? "Saving…" : "Save changes"}</Button>;
}

export function UserDialog({ user }: { user: { id: string; full_name: string; role: AppRole; active: boolean } }) {
  const [open, setOpen] = useState(false);
  const [state, formAction] = useActionState<UserActionState, FormData>(saveUser, { error: null });
  const [role, setRole] = useState<AppRole>(user.role);
  const [active, setActive] = useState(user.active);

  useEffect(() => {
    if (state.ok) setOpen(false);
  }, [state]);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button variant="outline" size="sm">Edit</Button>} />
      <DialogContent className="sm:max-w-md">
        <DialogTitle>{user.full_name}</DialogTitle>
        <DialogDescription>Role and access for this user.</DialogDescription>

        <form action={formAction} className="mt-2 flex flex-col gap-4">
          <input type="hidden" name="id" value={user.id} />

          <fieldset className="flex flex-col gap-2">
            {ROLES.map((r) => (
              <label key={r} className={`flex cursor-pointer flex-col gap-0.5 rounded-lg border p-3 ${role === r ? "border-ring ring-2 ring-ring/40" : ""}`}>
                <span className="flex items-center gap-2 text-sm font-medium">
                  <input type="radio" name="role" value={r} checked={role === r} onChange={() => setRole(r)} />
                  {ROLE_LABELS[r]}
                </span>
                <span className="pl-6 text-xs text-muted-foreground">{roleBlurb(r)}</span>
              </label>
            ))}
          </fieldset>

          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" name="active" checked={active} onChange={(e) => setActive(e.target.checked)} />
            Active (deactivated users cannot sign in)
          </label>

          {state.error ? (
            <p role="alert" className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">{state.error}</p>
          ) : null}

          <div className="mt-2 flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            <SubmitButton />
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 4: Write the page**

Replace `src/app/(app)/settings/users/page.tsx`:

```tsx
import { requireCapability } from "@/lib/auth";
import { BlockedScreen } from "@/components/blocked-screen";
import { listProfiles } from "@/lib/users";
import { UserDialog } from "./user-dialog";

const ROLE_LABELS: Record<string, string> = { owner: "Owner", management: "Management", finance: "Finance", warehouse: "Warehouse" };

export default async function UsersRolesPage() {
  const gate = await requireCapability("manage_users");
  if (!gate.allowed) return <BlockedScreen required="manage_users" role={gate.role} />;

  const users = await listProfiles();

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight">Users &amp; Roles</h1>
        <p className="text-sm text-muted-foreground">Assign roles and activate or deactivate access.</p>
      </div>

      <div className="overflow-x-auto rounded-xl border">
        <table className="w-full text-sm">
          <thead className="border-b bg-muted/40">
            <tr className="text-left font-mono text-[0.6875rem] uppercase tracking-wider text-muted-foreground">
              <th className="px-4 py-2.5 font-medium">Name</th>
              <th className="px-4 py-2.5 font-medium">Role</th>
              <th className="px-4 py-2.5 font-medium">Department</th>
              <th className="px-4 py-2.5 font-medium">Status</th>
              <th className="px-4 py-2.5" />
            </tr>
          </thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.id} className="border-b last:border-0 hover:bg-muted/30">
                <td className="px-4 py-2.5">{u.full_name}</td>
                <td className="px-4 py-2.5">{ROLE_LABELS[u.role] ?? u.role}</td>
                <td className="px-4 py-2.5 text-muted-foreground">{u.department ?? "—"}</td>
                <td className="px-4 py-2.5">
                  <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${u.active ? "bg-[#0f9d8c]/10 text-[#0f9d8c]" : "bg-muted text-muted-foreground"}`}>
                    {u.active ? "Active" : "Inactive"}
                  </span>
                </td>
                <td className="px-4 py-2.5 text-right">
                  <UserDialog user={{ id: u.id, full_name: u.full_name, role: u.role, active: u.active }} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
```

- [ ] **Step 5: Typecheck, lint**

Run: `npx tsc --noEmit && npx eslint "src/app/(app)/settings/users" src/lib/users.ts`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add "src/app/(app)/settings/users" src/lib/users.ts
git commit -m "feat(settings): users & roles with role radio, active toggle, self-guard, audited"
```

---

## Task 6: Company Info

**Files:**
- Create: `src/lib/company.ts`, `src/app/(app)/settings/company/actions.ts`, `src/app/(app)/settings/company/company-form.tsx`
- Modify: `src/app/(app)/settings/company/page.tsx`

**Interfaces:**
- Produces: `getCompany()`; `saveCompany` action; `CompanyForm`; the `/settings/company` UI.

- [ ] **Step 1: Data layer**

Create `src/lib/company.ts`:

```ts
import "server-only";

import { createClient } from "@/lib/supabase/server";

export type Company = {
  name: string; address: string | null; port: string | null;
  fiscal_year_start: string | null; registrations: Record<string, unknown>;
};

export async function getCompany(): Promise<Company | null> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("companies_profile")
    .select("name, address, port, fiscal_year_start, registrations")
    .eq("id", true)
    .maybeSingle();
  if (!data) return null;
  return { ...data, registrations: (data.registrations ?? {}) as Record<string, unknown> };
}
```

- [ ] **Step 2: Action**

Create `src/app/(app)/settings/company/actions.ts`:

```ts
"use server";

import { revalidatePath } from "next/cache";

import { createClient } from "@/lib/supabase/server";
import { requireCapability } from "@/lib/auth";
import { writeAudit } from "@/lib/audit";

export type CompanyActionState = { error: string | null; ok?: boolean };

const nz = (v: FormDataEntryValue | null) => { const s = String(v ?? "").trim(); return s ? s : null; };

export async function saveCompany(_prev: CompanyActionState, formData: FormData): Promise<CompanyActionState> {
  const gate = await requireCapability("manage_users");
  if (!gate.allowed) return { error: "Owner access required." };

  const name = String(formData.get("name") ?? "").trim();
  if (name.length < 2) return { error: "Company name is required." };

  // registrations is admin-locked — never written here.
  const patch = {
    name,
    address: nz(formData.get("address")),
    port: nz(formData.get("port")),
    fiscal_year_start: nz(formData.get("fiscal_year_start")),
  };

  const supabase = await createClient();
  const { data: before } = await supabase
    .from("companies_profile")
    .select("name, address, port, fiscal_year_start")
    .eq("id", true)
    .maybeSingle();
  const { error } = await supabase.from("companies_profile").update(patch).eq("id", true);
  if (error) return { error: error.message };

  await writeAudit("update", "company", "profile", { before, after: patch });
  revalidatePath("/settings/company");
  return { error: null, ok: true };
}
```

- [ ] **Step 3: Form**

Create `src/app/(app)/settings/company/company-form.tsx`:

```tsx
"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { saveCompany, type CompanyActionState } from "./actions";
import type { Company } from "@/lib/company";

const labelClass = "font-mono text-[0.6875rem] uppercase tracking-wider text-muted-foreground";

function SubmitButton() {
  const { pending } = useFormStatus();
  return <Button type="submit" disabled={pending}>{pending ? "Saving…" : "Save changes"}</Button>;
}

export function CompanyForm({ company }: { company: Company }) {
  const [state, formAction] = useActionState<CompanyActionState, FormData>(saveCompany, { error: null });
  const regs = Object.entries(company.registrations);

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <Field name="name" label="Company name" defaultValue={company.name} required />
      <Field name="address" label="Address" defaultValue={company.address ?? ""} />
      <Field name="port" label="Port" defaultValue={company.port ?? ""} />
      <Field name="fiscal_year_start" label="Fiscal year start" type="date" defaultValue={company.fiscal_year_start ?? ""} />

      <div className="flex flex-col gap-2 rounded-xl border bg-muted/20 p-4">
        <span className={labelClass}>Registrations (admin-locked)</span>
        {regs.length === 0 ? (
          <span className="text-sm text-muted-foreground">None on file.</span>
        ) : (
          <dl className="flex flex-col gap-1">
            {regs.map(([k, v]) => (
              <div key={k} className="flex items-baseline justify-between gap-3 text-sm">
                <dt className="text-muted-foreground">{k}</dt>
                <dd className="font-mono text-xs">{String(v)}</dd>
              </div>
            ))}
          </dl>
        )}
      </div>

      {state.error ? (
        <p role="alert" className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">{state.error}</p>
      ) : state.ok ? (
        <p className="text-sm text-[#0f9d8c]">Saved.</p>
      ) : null}

      <div className="flex justify-end"><SubmitButton /></div>
    </form>
  );
}

function Field({ name, label, defaultValue, type, required }: { name: string; label: string; defaultValue: string; type?: string; required?: boolean }) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={`c-${name}`} className={labelClass}>{label}</Label>
      <Input id={`c-${name}`} name={name} type={type} defaultValue={defaultValue} required={required} />
    </div>
  );
}
```

- [ ] **Step 4: Page**

Replace `src/app/(app)/settings/company/page.tsx`:

```tsx
import { requireCapability } from "@/lib/auth";
import { BlockedScreen } from "@/components/blocked-screen";
import { getCompany } from "@/lib/company";
import { CompanyForm } from "./company-form";

export default async function CompanyInfoPage() {
  const gate = await requireCapability("manage_users");
  if (!gate.allowed) return <BlockedScreen required="manage_users" role={gate.role} />;

  const company = await getCompany();

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight">Company Info</h1>
        <p className="text-sm text-muted-foreground">Used on invoices and delivery documents.</p>
      </div>
      {company ? <CompanyForm company={company} /> : <p className="text-sm text-muted-foreground">No company profile found.</p>}
    </div>
  );
}
```

- [ ] **Step 5: Typecheck, lint**

Run: `npx tsc --noEmit && npx eslint "src/app/(app)/settings/company" src/lib/company.ts`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add "src/app/(app)/settings/company" src/lib/company.ts
git commit -m "feat(settings): editable company info with admin-locked registrations, audited"
```

---

## Task 7: Preferences + alert-toggle wiring

**Files:**
- Create: `src/lib/preferences.ts`, `src/app/(app)/settings/preferences/actions.ts`, `src/app/(app)/settings/preferences/preferences-form.tsx`
- Modify: `src/app/(app)/settings/preferences/page.tsx`, `src/lib/exceptions.ts`

**Interfaces:**
- Consumes: `preferencesSchema`, `CURRENCIES`, `DATE_FORMATS`; `requireCapability`, `writeAudit`.
- Produces: `getPreferences()`, `type Preferences`, `getAlertToggles()`; `savePreferences`; `PreferencesForm`; the `/settings/preferences` UI; alert-filtered `getOpenExceptions`.

- [ ] **Step 1: Data layer**

Create `src/lib/preferences.ts`:

```ts
import "server-only";

import { createClient } from "@/lib/supabase/server";

export type AlertToggles = { overdue_invoices: boolean; over_capacity: boolean; missing_bl: boolean };
export type Preferences = {
  default_currency: string; date_format: string; low_stock_threshold_pct: number; alerts: AlertToggles;
};

const DEFAULTS: Preferences = {
  default_currency: "USD", date_format: "DD MMM YYYY", low_stock_threshold_pct: 80,
  alerts: { overdue_invoices: true, over_capacity: true, missing_bl: true },
};

export async function getPreferences(): Promise<Preferences> {
  const supabase = await createClient();
  const { data } = await supabase.from("settings").select("key, value")
    .in("key", ["default_currency", "date_format", "low_stock_threshold_pct", "alerts"]);
  const map = new Map((data ?? []).map((r) => [r.key as string, (r as { value: unknown }).value]));
  const alerts = (map.get("alerts") ?? {}) as Partial<AlertToggles>;
  return {
    default_currency: (map.get("default_currency") as string) ?? DEFAULTS.default_currency,
    date_format: (map.get("date_format") as string) ?? DEFAULTS.date_format,
    low_stock_threshold_pct: Number(map.get("low_stock_threshold_pct") ?? DEFAULTS.low_stock_threshold_pct),
    alerts: { ...DEFAULTS.alerts, ...alerts },
  };
}

/** Lightweight read for the exceptions filter (avoids pulling currency/date). */
export async function getAlertToggles(): Promise<AlertToggles> {
  return (await getPreferences()).alerts;
}
```

- [ ] **Step 2: Action**

Create `src/app/(app)/settings/preferences/actions.ts`:

```ts
"use server";

import { revalidatePath } from "next/cache";

import { createClient } from "@/lib/supabase/server";
import { requireCapability } from "@/lib/auth";
import { writeAudit } from "@/lib/audit";
import { preferencesSchema } from "@/lib/schemas/preferences";

export type PrefActionState = { error: string | null; fieldErrors?: Record<string, string>; ok?: boolean };

export async function savePreferences(_prev: PrefActionState, formData: FormData): Promise<PrefActionState> {
  const gate = await requireCapability("manage_users");
  if (!gate.allowed) return { error: "Owner access required." };

  const parsed = preferencesSchema.safeParse({
    default_currency: formData.get("default_currency"),
    date_format: formData.get("date_format"),
    low_stock_threshold_pct: formData.get("low_stock_threshold_pct"),
    overdue_invoices: formData.get("overdue_invoices") === "on",
    over_capacity: formData.get("over_capacity") === "on",
    missing_bl: formData.get("missing_bl") === "on",
  });
  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {};
    for (const i of parsed.error.issues) { const k = String(i.path[0] ?? ""); if (k && !fieldErrors[k]) fieldErrors[k] = i.message; }
    return { error: null, fieldErrors };
  }

  const v = parsed.data;
  const rows = [
    { key: "default_currency", value: v.default_currency },
    { key: "date_format", value: v.date_format },
    { key: "low_stock_threshold_pct", value: v.low_stock_threshold_pct },
    { key: "alerts", value: { overdue_invoices: v.overdue_invoices, over_capacity: v.over_capacity, missing_bl: v.missing_bl } },
  ];

  const supabase = await createClient();
  const { error } = await supabase.from("settings").upsert(rows, { onConflict: "key" });
  if (error) return { error: error.message };

  await writeAudit("update", "settings", "preferences", { after: Object.fromEntries(rows.map((r) => [r.key, r.value])) });
  revalidatePath("/settings/preferences");
  revalidatePath("/dashboard");
  revalidatePath("/live-ops");
  return { error: null, ok: true };
}
```

- [ ] **Step 3: Form**

Create `src/app/(app)/settings/preferences/preferences-form.tsx`:

```tsx
"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { savePreferences, type PrefActionState } from "./actions";
import { CURRENCIES, DATE_FORMATS } from "@/lib/schemas/preferences";
import type { Preferences } from "@/lib/preferences";

const labelClass = "font-mono text-[0.6875rem] uppercase tracking-wider text-muted-foreground";
const selectClass = "h-9 rounded-lg border bg-background px-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50";

function SubmitButton() {
  const { pending } = useFormStatus();
  return <Button type="submit" disabled={pending}>{pending ? "Saving…" : "Save preferences"}</Button>;
}

const TOGGLES: { key: "overdue_invoices" | "over_capacity" | "missing_bl"; label: string }[] = [
  { key: "overdue_invoices", label: "Overdue invoice alerts" },
  { key: "over_capacity", label: "Over-capacity alerts" },
  { key: "missing_bl", label: "Missing B/L alerts" },
];

export function PreferencesForm({ prefs }: { prefs: Preferences }) {
  const [state, formAction] = useActionState<PrefActionState, FormData>(savePreferences, { error: null });

  return (
    <form action={formAction} className="flex flex-col gap-5">
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="p-cur" className={labelClass}>Default currency</Label>
          <select id="p-cur" name="default_currency" defaultValue={prefs.default_currency} className={selectClass}>
            {CURRENCIES.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="p-fmt" className={labelClass}>Date format</Label>
          <select id="p-fmt" name="date_format" defaultValue={prefs.date_format} className={selectClass}>
            {DATE_FORMATS.map((f) => <option key={f} value={f}>{f}</option>)}
          </select>
        </div>
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="p-thr" className={labelClass}>Low-capacity threshold (%)</Label>
        <Input id="p-thr" name="low_stock_threshold_pct" type="number" min="1" max="100" defaultValue={prefs.low_stock_threshold_pct} className="max-w-32" />
        {state.fieldErrors?.low_stock_threshold_pct ? <p className="text-xs text-destructive">{state.fieldErrors.low_stock_threshold_pct}</p> : null}
        <p className="text-xs text-muted-foreground">Storing a lot past this occupancy raises a low-capacity exception.</p>
      </div>

      <fieldset className="flex flex-col gap-2">
        <span className={labelClass}>Alert types</span>
        {TOGGLES.map((t) => (
          <label key={t.key} className="flex items-center gap-2 text-sm">
            <input type="checkbox" name={t.key} defaultChecked={prefs.alerts[t.key]} />
            {t.label}
          </label>
        ))}
        <p className="text-xs text-muted-foreground">Unchecked types are hidden from the Action Center and Live Ops.</p>
      </fieldset>

      {state.error ? (
        <p role="alert" className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">{state.error}</p>
      ) : state.ok ? (
        <p className="text-sm text-[#0f9d8c]">Saved.</p>
      ) : null}

      <div className="flex justify-end"><SubmitButton /></div>
    </form>
  );
}
```

- [ ] **Step 4: Page**

Replace `src/app/(app)/settings/preferences/page.tsx`:

```tsx
import { requireCapability } from "@/lib/auth";
import { BlockedScreen } from "@/components/blocked-screen";
import { getPreferences } from "@/lib/preferences";
import { PreferencesForm } from "./preferences-form";

export default async function PreferencesPage() {
  const gate = await requireCapability("manage_users");
  if (!gate.allowed) return <BlockedScreen required="manage_users" role={gate.role} />;

  const prefs = await getPreferences();

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight">Preferences</h1>
        <p className="text-sm text-muted-foreground">Currency, date format, thresholds, and alert types.</p>
      </div>
      <PreferencesForm prefs={prefs} />
    </div>
  );
}
```

- [ ] **Step 5: Wire toggles into `getOpenExceptions`**

In `src/lib/exceptions.ts`, import `getAlertToggles` and drop disabled types before returning from `getOpenExceptions`:

```ts
import { getAlertToggles } from "@/lib/preferences";

// map exception type → toggle key; types without a toggle always show.
const TOGGLE_FOR: Record<string, keyof Awaited<ReturnType<typeof getAlertToggles>>> = {
  overdue_invoice: "overdue_invoices",
  low_capacity: "over_capacity",
  missing_bl: "missing_bl",
};
```

Then inside `getOpenExceptions`, after building `rows` and before the `sortBySeverity` call:

```ts
  const toggles = await getAlertToggles();
  const enabled = rows.filter((r) => {
    const key = TOGGLE_FOR[r.type];
    return key ? toggles[key] : true;
  });
  const sorted = sortBySeverity(enabled);
```

(Replace the existing `const sorted = sortBySeverity(rows);` line.)

- [ ] **Step 6: Typecheck, lint, build**

Run: `npx tsc --noEmit && npx eslint "src/app/(app)/settings/preferences" src/lib/preferences.ts src/lib/exceptions.ts && npx next build`
Expected: all clean.

- [ ] **Step 7: Commit**

```bash
git add "src/app/(app)/settings/preferences" src/lib/preferences.ts src/lib/exceptions.ts
git commit -m "feat(settings): preferences drive the threshold and alert-type visibility, audited"
```

---

## Task 8: Acceptance script + final gates

**Files:**
- Create: `scripts/verify-audit.ts`

**Interfaces:**
- Consumes: `@supabase/supabase-js`, `.env.local`; the service-role runner for the tamper test.

- [ ] **Step 1: Write the acceptance script**

Create `scripts/verify-audit.ts`. It uses the anon key for owner/management and the **service-role key** only for the tamper-and-restore (append-only is revoked for app users):

```ts
import { config } from "dotenv";
config({ path: ".env.local" });
import { createClient } from "@supabase/supabase-js";

let failed = 0;
function check(name: string, pass: boolean, detail = "") {
  console.log(`${pass ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
  if (!pass) failed++;
}

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const service = process.env.SUPABASE_SERVICE_ROLE_KEY!;

async function asUser(email: string) {
  const c = createClient(url, anon, { auth: { persistSession: false } });
  const { error } = await c.auth.signInWithPassword({ email, password: "TradeFlow!2026" });
  if (error) throw new Error(`login ${email}: ${error.message}`);
  return c;
}

async function main() {
  const owner = await asUser("owner@tradeflow.example");
  const mgmt = await asUser("management@tradeflow.example");
  const svc = createClient(url, service, { auth: { persistSession: false } });

  // 1. Phase 3-8 mutations are logged (read-only: expected action types present).
  const { data: actionsData } = await owner.from("audit_log").select("action");
  const actions = new Set((actionsData ?? []).map((r) => r.action));
  check("log contains create/update actions", actions.has("create") && actions.has("update"), [...actions].join(","));

  // 2. Chain is intact.
  const { data: v0 } = await owner.rpc("verify_audit_chain");
  check("verify_audit_chain reports intact", v0 == null, `badSeq=${v0}`);

  // 3. Tamper test — mutate one row's details (service role), detect, restore.
  const { data: last } = await svc.from("audit_log").select("seq, details").order("seq", { ascending: false }).limit(1).single();
  const original = last!.details;
  await svc.from("audit_log").update({ details: { tampered: true } }).eq("seq", last!.seq);
  const { data: v1 } = await owner.rpc("verify_audit_chain");
  check("tampering is detected at the altered seq", Number(v1) === Number(last!.seq), `badSeq=${v1}`);
  await svc.from("audit_log").update({ details: original }).eq("seq", last!.seq);
  const { data: v2 } = await owner.rpc("verify_audit_chain");
  check("chain intact again after restore", v2 == null, `badSeq=${v2}`);

  // 4. RLS: Management cannot read the log or write profiles/settings.
  const { data: mAudit } = await mgmt.from("audit_log").select("seq").limit(1);
  check("Management cannot read audit_log", (mAudit?.length ?? 0) === 0);
  const { data: pUpd } = await mgmt.from("profiles").update({ department: "hax" }).neq("id", "00000000-0000-0000-0000-000000000000").select();
  check("Management cannot update profiles", (pUpd?.length ?? 0) === 0);

  console.log(failed === 0 ? "\nAll checks passed." : `\n${failed} check(s) FAILED.`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
```

- [ ] **Step 2: Run the acceptance script**

Run: `npx tsx scripts/verify-audit.ts`
Expected: all checks PASS; the audit chain ends **intact** (the tamper is restored).

- [ ] **Step 3: Run the full gate suite**

Run: `npx vitest run && npx tsc --noEmit && npx eslint . && npx next build`
Expected: all tests pass, no type/lint errors, build succeeds.

- [ ] **Step 4: Commit**

```bash
git add scripts/verify-audit.ts
git commit -m "test(audit): Phase 9 acceptance verification with tamper-and-restore"
```

- [ ] **Step 5: Finish the branch**

Announce: "I'm using the finishing-a-development-branch skill to complete this work." Then follow superpowers:finishing-a-development-branch — verify tests, present the four options, execute the choice.

---

## Self-Review Notes

- **Spec coverage:** audit screen stats/filters/SEQ+HASH/verify (Tasks 3,4); Users & Roles with role radio + capability text + active toggle + shadcn Dialog + self-guard (Task 5); Company Info editable + admin-locked registrations (Task 6); Preferences currency/date/threshold/toggles that drive alerts (Tasks 2,7); `profiles.active` enforced at auth (Task 1). Verify checklist → Task 8 (mutations logged, chain passes, tamper detected then restored).
- **Type consistency:** `AuditEntry`/`AuditStats` (Task 3) → Task 4; `UserRow` (Task 5); `Company` (Task 6); `Preferences`/`AlertToggles` (Task 7) consumed by the exceptions wiring; `preferencesSchema`/`CURRENCIES`/`DATE_FORMATS` (Task 2) → Task 7; `AppRole` matches `permissions.ts`.
- **Financial/safety:** all screens owner-gated; `audit_log` owner-read by RLS; tamper test is net-zero (restored + re-verified); self-guard prevents owner lockout.
- **No placeholders:** every code step is complete. The audit page's illustrative empty `<form>` block is called out in Task 4 Step 4 to delete — not a shipped stub.
```