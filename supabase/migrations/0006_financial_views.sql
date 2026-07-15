create view public.commodities_view with (security_invoker = on) as
select
  id, name, hs_code, category, bag_weight_kg, created_at,
  case when can_view_financials() then market_price_per_mt end as market_price_per_mt
from public.commodities;

create view public.lots_view with (security_invoker = on) as
select
  l.id, l.lot_number, l.direction, l.commodity_id, l.client_id, l.quantity_mt,
  l.warehouse_id, l.shed_id, l.status, l.origin_country, l.destination_country,
  l.vessel_name, l.bl_number, l.export_ref, l.payment_terms, l.eta,
  l.arrival_date, l.dispatch_date, l.notes, l.created_by, l.created_at, l.updated_at,
  round(l.quantity_mt * 1000 / c.bag_weight_kg) as bags,
  case when can_view_financials() then round(l.quantity_mt * c.market_price_per_mt, 2) end as market_value
from public.lots l
join public.commodities c on c.id = l.commodity_id;

grant select on public.commodities_view, public.lots_view to authenticated, anon;
