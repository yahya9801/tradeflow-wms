# Phase 6 — Finance: AR/AP — Design Spec

**Date:** 2026-07-17
**Branch:** `phase-6-finance`
**Status:** Approved (design), pending implementation plan

## Goal

Invoice CRUD with partial payments linked to lots and clients, plus an Accounts
screen (Overview, Receivable, Payable) showing net position, aging buckets,
currency exposure, overdue badging, and click-through to the referenced lot and
client. End-to-end Owner/Finance only, enforced in the database.

## Scope (from PLAN.md Phase 6)

- Invoice CRUD linked to lots/clients; payments (partial → status partial/paid).
- Accounts screen: Overview (net position, AR/AP outstanding, aging buckets,
  currency exposure), Receivable tab, **Payable tab actually implemented**
  (demo bug fix), overdue auto-badging, status filters, **click-through from
  invoice → lot/client** (demo gap fix).
- Owner/Finance only end-to-end.
- **Verify:** aging buckets sum to AR outstanding; partial payment math correct;
  Management gets a blocked screen.

## What already exists (build on, do not rebuild)

- `invoices` table (Phase 1): `id, invoice_no unique, lot_id → lots(on delete
  set null), client_id → clients (not null), type (receivable|payable),
  status (pending|partial|paid), currency char(3), amount numeric(14,2) ≥ 0,
  amount_paid numeric(14,2) ≥ 0 default 0, due_date, description, created_at`.
  Indexes on `(lot_id)`, `(client_id)`, `(type, status)`.
- Invoice RLS (Phase 1): `inv_all for all to authenticated using
  (can_view_financials()) with check (can_view_financials())`. Management (no
  `view_financials`) receives nothing on read **or** write — the security
  spine of this phase is already in place.
- `can_view_financials()`, `is_owner()`, `current_app_role()` SQL helpers.
- `permissions.ts`: `Capability` already includes `manage_invoices` and
  `view_financials`. Role map: `owner` = all; `management` =
  `view_operations, manage_lots`; reserved `finance` =
  `view_operations, view_financials, manage_invoices`; `warehouse` =
  `view_operations`.
- `clients.ts#getClientInvoices` and `lots.ts#getLotInvoices` already read
  invoices for the Phase 5 client profile and the Phase 4 lot detail. The lot
  detail (`src/app/(app)/lots/[id]/page.tsx`) already renders a gated invoice
  list; this phase adds a "Raise invoice" action above it.
- `src/app/(app)/accounts/page.tsx` is a placeholder gated on
  `view_financials` — this phase replaces its body.
- `writeAudit` server helper (used by `lots/actions.ts`,
  `clients/actions.ts`) and the append-only `audit_log`.
- UI patterns to mirror: `client-dialog.tsx` (controlled inputs, React-19
  reset workaround, `render={<Button>}` Base UI trigger, close-on-`state.ok`),
  `delete-client-button.tsx`, the shared `money()` formatter used in lot
  detail / client profile.

## Architecture

Four layers, matching the established phase structure:

1. **Schema migration** — the only new database objects (payments ledger,
   invoice numbering, a write-capability helper, and derivation/guard triggers).
2. **Zod schemas** — one source of truth for invoice and payment input,
   unit-tested.
3. **Server-only data layer** (`src/lib/finance.ts`) — all reads go through the
   RLS'd `invoices`/`payments`, so Management is masked by the database, not by
   the UI. Plus pure functions for the money math so they can be unit-tested
   without a database.
4. **UI + server actions** — the Accounts screen (three tabs), invoice and
   payment dialogs, the Lot-Detail "Raise invoice" action, and audit-logged
   mutations gated by `requireCapability("manage_invoices")`.

## 1. Schema migration — `supabase/migrations/0013_finance.sql`

Schema is sacred (PLAN §5.3): this migration is reviewed before it runs.

### 1a. Invoice numbering (auto-generate, mirror `lot_number`)

`invoice_no` is currently `not null unique` with no default, so callers must
supply it. Add:

```sql
create sequence invoice_number_seq;
alter table invoices
  alter column invoice_no set default
    ('INV-' || to_char(now(),'YYYY') || '-' || lpad(nextval('invoice_number_seq')::text, 5, '0'));
```

Manual entry remains possible (still `unique`); the app will not send
`invoice_no` and let the default fire.

### 1b. Payments ledger table

```sql
create table payments (
  id uuid primary key default gen_random_uuid(),
  invoice_id uuid not null references invoices(id) on delete cascade,
  amount numeric(14,2) not null check (amount > 0),
  paid_on date not null default current_date,
  method text,
  note text,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);
create index on payments (invoice_id);
```

Deleting an invoice cascades its payments. `amount > 0` (a payment is always
positive; corrections are handled by editing/deleting the payment row).

### 1c. Derivation trigger — `amount_paid` and `status` are computed

`invoices.amount_paid` and `invoices.status` become **derived** from the
payments ledger, so they can never drift from reality:

```sql
create function sync_invoice_paid() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  inv_id uuid := coalesce(new.invoice_id, old.invoice_id);
  inv_amount numeric(14,2);
  paid numeric(14,2);
begin
  select amount into inv_amount from invoices where id = inv_id;
  select coalesce(sum(amount), 0) into paid from payments where invoice_id = inv_id;
  if paid > inv_amount then
    raise exception 'payment total % exceeds invoice amount %', paid, inv_amount;
  end if;
  update invoices set
    amount_paid = paid,
    status = case when paid >= inv_amount and inv_amount > 0 then 'paid'
                  when paid > 0 then 'partial'
                  else 'pending' end
  where id = inv_id;
  return coalesce(new, old);
end $$;

create trigger payments_sync
  after insert or update or delete on payments
  for each row execute function sync_invoice_paid();
```

`security definer` so the trigger can update `invoices` regardless of the
caller's row visibility, keeping the derivation authoritative. The overpayment
guard lives here (defense in depth alongside the server-side check).

When an invoice's `amount` is edited, its status must also be re-derived. A
second trigger recomputes status on `invoices.amount` change:

```sql
create function resync_invoice_status() returns trigger
language plpgsql security definer set search_path = public as $$
declare paid numeric(14,2);
begin
  select coalesce(sum(amount), 0) into paid from payments where invoice_id = new.id;
  if paid > new.amount then
    raise exception 'invoice amount % is below payments already recorded %', new.amount, paid;
  end if;
  new.amount_paid := paid;
  new.status := case when paid >= new.amount and new.amount > 0 then 'paid'
                     when paid > 0 then 'partial'
                     else 'pending' end;
  return new;
end $$;

create trigger invoices_resync_status
  before update of amount on invoices
  for each row execute function resync_invoice_status();
```

### 1d. Write-capability helper + tightened policies (RLS before UI)

The capability model separates `view_financials` (read) from `manage_invoices`
(write), but the current invoice policy uses `can_view_financials()` for writes.
In v1 both coincide (Owner only), but the correct enforcement is:

```sql
create function can_manage_invoices() returns boolean
language sql stable security definer set search_path = public as $$
  select current_app_role() in ('owner','finance')
$$;

-- Tighten invoice writes; reads stay on view_financials.
drop policy inv_all on invoices;
create policy inv_select on invoices for select to authenticated
  using (can_view_financials());
create policy inv_write on invoices for all to authenticated
  using (can_manage_invoices()) with check (can_manage_invoices());

-- Payments: read with financials, write with manage_invoices.
alter table payments enable row level security;
create policy pay_select on payments for select to authenticated
  using (can_view_financials());
create policy pay_write on payments for all to authenticated
  using (can_manage_invoices()) with check (can_manage_invoices());
grant select, insert, update, delete on payments to authenticated;
```

Note: a `for all` policy already covers select, but splitting select onto
`can_view_financials()` lets a future read-only financial role see invoices
without write rights. This is the single discipline that keeps redaction
consistent.

## 2. Data layer — `src/lib/finance.ts` (server-only)

All queries read the RLS'd tables; Management is masked by the database.

```ts
export type Currency = string; // 'USD' | 'EUR' | 'GBP' | 'AED' in practice

export type InvoiceRow = {
  id: string;
  invoice_no: string;
  type: "receivable" | "payable";
  status: "pending" | "partial" | "paid";
  currency: string;
  amount: number;
  amount_paid: number;
  outstanding: number;          // amount - amount_paid
  due_date: string | null;
  overdue: boolean;             // due_date < today && status != 'paid'
  client_id: string;
  client_name: string;
  lot_id: string | null;
  lot_number: string | null;
  description: string | null;
};

export type CurrencyPosition = {
  currency: string;
  ar_outstanding: number;
  ap_outstanding: number;
  net: number;                  // ar_outstanding - ap_outstanding
};

export type AccountsSummary = {
  positions: CurrencyPosition[];      // one row per currency in use
  ar_count: number;
  ap_count: number;
  overdue_count: number;
};

export type AgingBucket = { label: string; from: number; to: number | null; amount: number };

// listInvoices({ type?, status?, q? }): InvoiceRow[]  — joins lot_number + client name
// getInvoice(id): InvoiceRow | null
// getPayments(invoiceId): PaymentRow[]
// getAccountsSummary(): AccountsSummary
// getAging(type: "receivable" | "payable"): AgingBucket[]  — buckets sum to outstanding
```

Money math is factored into **pure functions** (no DB) so they are unit-tested
directly:

- `src/lib/finance-math.ts`:
  - `deriveStatus(amount, amountPaid): "pending" | "partial" | "paid"`
  - `agingBuckets(invoices: {due_date, outstanding}[], today: Date): AgingBucket[]`
    with buckets **Current** (not yet due or no due date), **1–30**, **31–60**,
    **61–90**, **90+** days past due, on the unpaid balance.
  - `isOverdue(dueDate, status, today): boolean`

## 3. Validation — Zod schemas (shared, unit-tested)

`src/lib/schemas/invoice.ts`:

```ts
invoiceSchema = z.object({
  type: z.enum(["receivable", "payable"]),
  client_id: z.string().uuid(),
  lot_id: z.string().uuid().optional().or(z.literal("")),   // "" → null
  currency: z.enum(["USD", "EUR", "GBP", "AED"]).default("USD"),
  amount: z.coerce.number().positive(),
  due_date: z.string().optional().or(z.literal("")),        // "" → null
  description: z.string().max(500).optional().or(z.literal("")),
});
```

`src/lib/schemas/payment.ts`:

```ts
paymentSchema = z.object({
  invoice_id: z.string().uuid(),
  amount: z.coerce.number().positive(),
  paid_on: z.string().min(1),        // ISO date; defaults to today in the form
  method: z.string().max(60).optional().or(z.literal("")),
  note: z.string().max(300).optional().or(z.literal("")),
});
```

The server action additionally checks the payment will not exceed the invoice's
remaining balance (the DB trigger is the backstop).

## 4. UI + server actions

### 4a. Accounts screen — `src/app/(app)/accounts/page.tsx`

Gate on `view_financials`; keep the existing `BlockedScreen` for Management.
Three tabs (Base UI Tabs component):

- **Overview:** per-currency stat cards (Net position, AR outstanding, AP
  outstanding), aging-bucket bars (AR by default, with an AP view), currency
  exposure list. "New invoice" action gated on `manage_invoices`.
- **Receivable:** status filter (all/pending/partial/paid) + search, invoice
  table (invoice_no, client, lot, amount, paid, outstanding, due, overdue
  badge). Rows link to the lot and the client. Create/edit/pay actions gated.
- **Payable:** identical treatment for `type = payable` (the demo's empty
  Payable tab, now real).

Tabs and filters are URL-driven (`?tab=`, `?status=`, `?q=`) so state survives
reload and is linkable, matching the Phase 5 pattern.

### 4b. Invoice dialog — `src/app/(app)/accounts/invoice-dialog.tsx`

Client component, controlled inputs (React-19 reset workaround as in
`client-dialog.tsx`). Fields: type, client (select), lot (optional select),
currency, amount, due date, description. Reused for create and edit. Closes on
`state.ok`. When opened from Lot Detail it is prefilled with `lot_id` +
`client_id` and the type defaults from lot direction (export → receivable,
import → payable) — editable.

### 4c. Payment dialog — `src/app/(app)/accounts/payment-dialog.tsx`

Records a payment against one invoice. Shows amount, amount paid, and remaining
balance; the amount field is capped at the remaining balance client-side and
validated server-side + by the trigger.

### 4d. Lot Detail "Raise invoice" — modify `src/app/(app)/lots/[id]/page.tsx`

Add a gated (`manage_invoices`) "Raise invoice" button in the Invoices section
header that opens the invoice dialog prefilled with the lot and its client. The
existing invoice list is unchanged.

### 4e. Server actions — `src/app/(app)/accounts/actions.ts`

`saveInvoice`, `deleteInvoice`, `recordPayment`, `deletePayment`. Each:
`requireCapability("manage_invoices")`, validate with the Zod schema, normalize
absent form fields (`formData.get(key) ?? undefined`, empty string → null for
`lot_id`/`due_date`), write via the RLS'd client, `writeAudit` with old→new,
`revalidatePath`. `deleteInvoice` cascades payments (DB); the action audit-logs
the deletion.

## 5. Testing & verification

- **Vitest unit:** `invoice.test.ts`, `payment.test.ts` (schema edge cases),
  `finance-math.test.ts` (`deriveStatus` boundaries: 0, partial, exact, and
  guard for over-amount; `agingBuckets` boundary days 0/1/30/31/60/61/90/91 and
  bucket-sum invariant; `isOverdue` with paid status and null due date).
- **Acceptance script** `scripts/verify-finance.ts` (service reads via signed-in
  clients, restores any writes it makes):
  1. Aging buckets returned by `getAging("receivable")` sum to AR outstanding.
  2. Recording a partial payment flips status `pending → partial`; a final
     payment flips `partial → paid`; `amount_paid` equals the ledger sum.
  3. A payment exceeding the remaining balance is rejected (trigger raises).
  4. Editing an invoice's `amount` re-derives status.
  5. **Management** session: `invoices` and `payments` selects return 0 rows;
     an insert into either errors (RLS).
  6. Every invoice's `lot_id`/`client_id` click-through target resolves.
  All test writes are deleted/restored; never touch `LOT-2026-00301` or
  reseed/truncate the shared database.
- **Static gates:** `tsc --noEmit`, `eslint`, `next build`, `vitest run` all
  clean before finishing the branch.

## Defaults (explicit, changeable)

- **No FX conversion.** Net position, aging, and exposure are per-currency
  (PLAN §6: v1 keeps currency math simple).
- **Overdue is a computed badge** in this phase. Auto-creating
  `overdue_invoice` *exceptions* is Phase 7.
- **Client profile invoice list stays read-only** (Phase 5); invoice creation
  from the client profile is out of scope.
- **Payments are positive-only ledger rows;** corrections are made by editing or
  deleting a payment, not by negative entries.

## Out of scope (later phases / backlog)

- `overdue_invoice` exception generation and the Action Center (Phase 7).
- P&L / balance-sheet reporting and collected/liquidation metrics (Phase 8).
- Multi-currency FX revaluation (v2 backlog, PLAN §6).
- Invoice/delivery-note PDF generation (v2 backlog).
```