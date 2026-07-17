-- Phase 8: reporting aggregation. SECURITY INVOKER so invoice RLS applies.
-- Reporting basis is due_date; null bounds mean "open" (All Time).

create or replace function public.report_pnl_summary(p_from date, p_to date)
returns table (
  revenue numeric, cost numeric, gross_profit numeric,
  ar_collected numeric, ar_outstanding numeric, ap_outstanding numeric
) language sql stable security invoker set search_path = public as $$
  with scoped as (
    select type, amount, amount_paid from public.invoices
     where (p_from is null or (due_date is not null and due_date >= p_from))
       and (p_to   is null or (due_date is not null and due_date <= p_to))
  )
  select
    coalesce(sum(amount) filter (where type = 'receivable'), 0),
    coalesce(sum(amount) filter (where type = 'payable'), 0),
    coalesce(sum(amount) filter (where type = 'receivable'), 0)
      - coalesce(sum(amount) filter (where type = 'payable'), 0),
    coalesce(sum(amount_paid) filter (where type = 'receivable'), 0),
    coalesce(sum(amount - amount_paid) filter (where type = 'receivable'), 0),
    coalesce(sum(amount - amount_paid) filter (where type = 'payable'), 0)
  from scoped;
$$;

create or replace function public.report_by_commodity(p_from date, p_to date)
returns table (commodity text, revenue numeric, cost numeric, profit numeric)
language sql stable security invoker set search_path = public as $$
  with scoped as (
    select i.type, i.amount, c.name as commodity
      from public.invoices i
      left join public.lots l on l.id = i.lot_id
      left join public.commodities c on c.id = l.commodity_id
     where (p_from is null or (i.due_date is not null and i.due_date >= p_from))
       and (p_to   is null or (i.due_date is not null and i.due_date <= p_to))
  )
  select
    coalesce(commodity, 'Unattributed'),
    coalesce(sum(amount) filter (where type = 'receivable'), 0),
    coalesce(sum(amount) filter (where type = 'payable'), 0),
    coalesce(sum(amount) filter (where type = 'receivable'), 0)
      - coalesce(sum(amount) filter (where type = 'payable'), 0)
  from scoped
  group by coalesce(commodity, 'Unattributed')
  order by 4 desc;
$$;

grant execute on function public.report_pnl_summary(date, date),
                        public.report_by_commodity(date, date) to authenticated;
