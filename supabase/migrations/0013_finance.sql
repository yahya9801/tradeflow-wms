-- Phase 6: Finance (AR/AP). Payments ledger, invoice numbering, write helper,
-- derivation + guard triggers, tightened RLS.

-- 1a. Invoice number auto-generation (mirrors lot_number).
create sequence if not exists invoice_number_seq;
alter table invoices
  alter column invoice_no set default
    ('INV-' || to_char(now(),'YYYY') || '-' || lpad(nextval('invoice_number_seq')::text, 5, '0'));

-- 1b. Payments ledger.
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

-- 1c. Derivation: amount_paid and status are computed from the ledger.
create or replace function sync_invoice_paid() returns trigger
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
    status = (case when paid >= inv_amount and inv_amount > 0 then 'paid'
                   when paid > 0 then 'partial'
                   else 'pending' end)::invoice_status
  where id = inv_id;
  return coalesce(new, old);
end $$;

create trigger payments_sync
  after insert or update or delete on payments
  for each row execute function sync_invoice_paid();

-- Re-derive status/guard when an invoice's amount is edited.
create or replace function resync_invoice_status() returns trigger
language plpgsql security definer set search_path = public as $$
declare paid numeric(14,2);
begin
  select coalesce(sum(amount), 0) into paid from payments where invoice_id = new.id;
  if paid > new.amount then
    raise exception 'invoice amount % is below payments already recorded %', new.amount, paid;
  end if;
  new.amount_paid := paid;
  new.status := (case when paid >= new.amount and new.amount > 0 then 'paid'
                      when paid > 0 then 'partial'
                      else 'pending' end)::invoice_status;
  return new;
end $$;

create trigger invoices_resync_status
  before update of amount on invoices
  for each row execute function resync_invoice_status();

-- 1d. Write-capability helper + tightened policies (RLS before UI).
create or replace function can_manage_invoices() returns boolean
language sql stable security definer set search_path = public as $$
  select current_app_role() in ('owner','finance')
$$;

drop policy inv_all on invoices;
create policy inv_select on invoices for select to authenticated
  using (can_view_financials());
create policy inv_write on invoices for all to authenticated
  using (can_manage_invoices()) with check (can_manage_invoices());

alter table payments enable row level security;
create policy pay_select on payments for select to authenticated
  using (can_view_financials());
create policy pay_write on payments for all to authenticated
  using (can_manage_invoices()) with check (can_manage_invoices());
grant select, insert, update, delete on payments to authenticated;
