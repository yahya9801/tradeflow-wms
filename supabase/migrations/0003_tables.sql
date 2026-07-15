-- Single-row company profile (id always true → at most one row)
create table companies_profile (
  id boolean primary key default true,
  name text not null,
  address text,
  port text,
  fiscal_year_start date,
  registrations jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  constraint companies_profile_singleton check (id)
);

create table profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text not null,
  role app_role not null default 'management',
  department text,
  created_at timestamptz not null default now()
);

create table warehouses (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  address text,
  capacity_mt numeric(12,3) not null default 0,
  created_at timestamptz not null default now()
);

create table sheds (
  id uuid primary key default gen_random_uuid(),
  warehouse_id uuid not null references warehouses(id) on delete cascade,
  name text not null,
  capacity_mt numeric(12,3) not null default 0,
  created_at timestamptz not null default now()
);

create table commodities (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  hs_code text,
  category text,
  market_price_per_mt numeric(14,2),
  bag_weight_kg numeric(8,2) not null default 50,
  created_at timestamptz not null default now()
);

create table clients (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  type client_type not null,
  country text,
  contact_name text,
  email citext,
  phone text,
  currency char(3) not null default 'USD',
  created_at timestamptz not null default now()
);

create sequence lot_number_seq;
create table lots (
  id uuid primary key default gen_random_uuid(),
  lot_number text not null unique
    default ('LOT-' || to_char(now(),'YYYY') || '-' || lpad(nextval('lot_number_seq')::text, 5, '0')),
  direction lot_direction not null,
  commodity_id uuid not null references commodities(id),
  client_id uuid not null references clients(id),
  quantity_mt numeric(12,3) not null check (quantity_mt > 0),
  warehouse_id uuid references warehouses(id),
  shed_id uuid references sheds(id),
  status lot_status not null default 'pending',
  origin_country text,
  destination_country text,
  vessel_name text,
  bl_number text,
  export_ref text,
  payment_terms payment_terms,
  eta date,
  arrival_date date,
  dispatch_date date,
  notes text,
  created_by uuid references profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table invoices (
  id uuid primary key default gen_random_uuid(),
  invoice_no text not null unique,
  lot_id uuid references lots(id) on delete set null,
  client_id uuid not null references clients(id),
  type invoice_type not null,
  status invoice_status not null default 'pending',
  currency char(3) not null default 'USD',
  amount numeric(14,2) not null check (amount >= 0),
  amount_paid numeric(14,2) not null default 0 check (amount_paid >= 0),
  due_date date,
  description text,
  created_at timestamptz not null default now()
);

create table exceptions (
  id uuid primary key default gen_random_uuid(),
  lot_id uuid references lots(id) on delete cascade,
  type exception_type not null,
  severity exception_severity not null,
  description text not null,
  status exception_status not null default 'open',
  resolved_by uuid references profiles(id),
  resolved_at timestamptz,
  note text,
  created_at timestamptz not null default now()
);

create table audit_log (
  seq bigserial primary key,
  user_id uuid,
  action text not null,
  entity_type text not null,
  entity_id text,
  details jsonb not null default '{}'::jsonb,
  hash text not null,
  prev_hash text,
  created_at timestamptz not null default now()
);

create table settings (
  key text primary key,
  value jsonb not null,
  updated_at timestamptz not null default now()
);

create index on sheds (warehouse_id);
create index on lots (status);
create index on lots (commodity_id);
create index on lots (client_id);
create index on lots (shed_id);
create index on invoices (lot_id);
create index on invoices (client_id);
create index on invoices (type, status);
create index on exceptions (lot_id) where status = 'open';
