-- profiles ---------------------------------------------------------------
alter table profiles enable row level security;
create policy profiles_select on profiles for select to authenticated
  using (id = auth.uid() or is_owner());
create policy profiles_write on profiles for all to authenticated
  using (is_owner()) with check (is_owner());

-- companies_profile ------------------------------------------------------
alter table companies_profile enable row level security;
create policy company_select on companies_profile for select to authenticated using (true);
create policy company_write on companies_profile for all to authenticated
  using (is_owner()) with check (is_owner());

-- warehouses -------------------------------------------------------------
alter table warehouses enable row level security;
create policy wh_select on warehouses for select to authenticated using (true);
create policy wh_write on warehouses for all to authenticated
  using (is_owner()) with check (is_owner());

-- sheds ------------------------------------------------------------------
alter table sheds enable row level security;
create policy sheds_select on sheds for select to authenticated using (true);
create policy sheds_write on sheds for all to authenticated
  using (is_owner()) with check (is_owner());

-- commodities ------------------------------------------------------------
alter table commodities enable row level security;
create policy comm_select on commodities for select to authenticated using (true);
create policy comm_write on commodities for all to authenticated
  using (is_owner()) with check (is_owner());

-- clients ----------------------------------------------------------------
alter table clients enable row level security;
create policy clients_select on clients for select to authenticated using (true);
create policy clients_write on clients for all to authenticated
  using (is_owner()) with check (is_owner());

-- lots -------------------------------------------------------------------
alter table lots enable row level security;
create policy lots_select on lots for select to authenticated using (true);
create policy lots_insert on lots for insert to authenticated
  with check (current_app_role() in ('owner','management'));
create policy lots_update on lots for update to authenticated
  using (current_app_role() in ('owner','management'))
  with check (current_app_role() in ('owner','management'));
create policy lots_delete on lots for delete to authenticated
  using (is_owner());

-- exceptions -------------------------------------------------------------
alter table exceptions enable row level security;
create policy exc_select on exceptions for select to authenticated using (true);
create policy exc_write on exceptions for all to authenticated
  using (current_app_role() in ('owner','management'))
  with check (current_app_role() in ('owner','management'));

-- invoices (financial — the core rule) -----------------------------------
alter table invoices enable row level security;
create policy inv_all on invoices for all to authenticated
  using (can_view_financials()) with check (can_view_financials());

-- settings ---------------------------------------------------------------
alter table settings enable row level security;
create policy settings_select on settings for select to authenticated using (true);
create policy settings_write on settings for all to authenticated
  using (is_owner()) with check (is_owner());

-- audit_log (owner reads; append-only) -----------------------------------
alter table audit_log enable row level security;
create policy audit_select on audit_log for select to authenticated using (is_owner());
create policy audit_insert on audit_log for insert to authenticated with check (true);
revoke update, delete on audit_log from authenticated, anon;
