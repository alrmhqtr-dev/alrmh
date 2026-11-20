-- Point of sale: replaces Mada POS. Counter sales and deposits, cash registers,
-- stock per branch, suppliers and purchases, expenses, drafts and quotations,
-- sales returns, automatic discounts, roles with permissions.

/* ---------- roles and permissions ---------- */

create table roles (
  id text primary key,
  name_en text not null,
  name_ar text not null,
  permissions text[] not null default '{}',
  builtin boolean not null default false,
  created_at timestamptz not null default now()
);
insert into roles (id, name_en, name_ar, permissions, builtin) values
  ('owner', 'Owner', 'المالك', '{*}', true),
  ('manager', 'Manager', 'مدير', '{workshop,pos,pos.discount,returns,manage,products,purchases,contacts,expenses,reports,audit}', true),
  ('tailor', 'Tailor', 'خيّاط', '{workshop}', true),
  ('support', 'Customer support', 'خدمة العملاء', '{}', true),
  ('cashier', 'Cashier', 'كاشير', '{pos,contacts,expenses}', true);
alter table staff_users drop constraint if exists staff_users_role_check;
alter table staff_users add constraint staff_users_role_fkey foreign key (role) references roles(id);
alter table staff_users add column language text not null default 'ar' check (language in ('ar','en'));
alter table staff_users add column phone text;

/* ---------- contacts ---------- */

create table customer_groups (
  id uuid primary key default gen_random_uuid(),
  name_en text not null,
  name_ar text not null,
  discount_percent numeric(5,2) not null default 0 check (discount_percent between 0 and 100),
  active boolean not null default true,
  created_at timestamptz not null default now()
);
alter table customers add column group_id uuid references customer_groups(id) on delete set null;
alter table customers add column source text not null default 'app' check (source in ('app','pos','import'));
alter table customers add column notes text;

create table suppliers (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  business_name text,
  phone text,
  email text,
  tax_number text,
  address text,
  opening_balance numeric(12,2) not null default 0,
  notes text,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

-- Sales agents (الوكلاء): earn a commission on the sales they bring.
create table agents (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  phone text,
  email text,
  commission_percent numeric(5,2) not null default 0 check (commission_percent between 0 and 100),
  active boolean not null default true,
  created_at timestamptz not null default now()
);

/* ---------- products: brands, units, warranties, tax, variations ---------- */

create table brands (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  description text,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table units (
  id uuid primary key default gen_random_uuid(),
  name_en text not null,
  name_ar text not null,
  short_name text not null,
  allow_decimal boolean not null default false,
  created_at timestamptz not null default now()
);
insert into units (name_en, name_ar, short_name, allow_decimal) values
  ('Piece', 'قطعة', 'pc', false),
  ('Metre', 'متر', 'm', true),
  ('Box', 'علبة', 'box', false);

create table warranties (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  description text,
  months int not null default 0 check (months >= 0),
  created_at timestamptz not null default now()
);

-- Prices include tax; the tax part is shown on invoices and in the tax report.
create table tax_rates (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  percent numeric(5,2) not null check (percent between 0 and 100),
  active boolean not null default true,
  created_at timestamptz not null default now()
);

-- A list of values (e.g. sizes) that fills a product's sizes.
create table variation_templates (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  options text[] not null default '{}',
  created_at timestamptz not null default now()
);

alter table products add column sku text;
update products set sku = upper(id);
alter table products alter column sku set not null;
create unique index products_sku_key on products (upper(sku));
alter table products add column brand_id uuid references brands(id) on delete set null;
alter table products add column unit_id uuid references units(id) on delete set null;
alter table products add column warranty_id uuid references warranties(id) on delete set null;
alter table products add column tax_rate_id uuid references tax_rates(id) on delete set null;
alter table products add column cost numeric(10,2) not null default 0;
alter table products add column track_stock boolean not null default false;
alter table products add column alert_qty numeric(10,2) not null default 0;
-- Off: sold at the counter only, not shown in the app.
alter table products add column in_app boolean not null default true;

-- Cloth is bought and kept by the metre; each thobe uses some.
alter table fabrics add column sku text;
update fabrics set sku = 'F-' || upper(id);
alter table fabrics alter column sku set not null;
create unique index fabrics_sku_key on fabrics (upper(sku));
alter table fabrics add column cost numeric(10,2) not null default 0;
alter table fabrics add column track_stock boolean not null default false;
alter table fabrics add column alert_qty numeric(10,2) not null default 0;
alter table fabrics add column metres_per_thobe numeric(5,2) not null default 3.5 check (metres_per_thobe >= 0);

/* ---------- stock ---------- */

-- Every change to stock is a row; the level is the sum.
create table stock_moves (
  id bigserial primary key,
  branch_id uuid not null references branches(id),
  item_kind text not null check (item_kind in ('product','fabric')),
  item_id text not null,
  size text not null default '',
  qty numeric(12,2) not null,
  unit_cost numeric(10,2),
  reason text not null check (reason in ('opening','purchase','purchase_return','sale','sale_return','cancel','adjust','transfer_in','transfer_out')),
  ref_type text,
  ref_id text,
  note text,
  staff_id uuid references staff_users(id) on delete set null,
  created_at timestamptz not null default now()
);
create index on stock_moves (item_kind, item_id, branch_id);
create index on stock_moves (ref_type, ref_id);
create index on stock_moves (created_at);

create sequence adjustment_number_seq start 1001;
create table stock_adjustments (
  id uuid primary key default gen_random_uuid(),
  number text not null unique,
  branch_id uuid not null references branches(id),
  kind text not null default 'normal' check (kind in ('normal','abnormal')),
  reason text,
  staff_id uuid references staff_users(id) on delete set null,
  created_at timestamptz not null default now()
);

create sequence transfer_number_seq start 1001;
create table stock_transfers (
  id uuid primary key default gen_random_uuid(),
  number text not null unique,
  from_branch_id uuid not null references branches(id),
  to_branch_id uuid not null references branches(id),
  note text,
  staff_id uuid references staff_users(id) on delete set null,
  created_at timestamptz not null default now(),
  check (from_branch_id <> to_branch_id)
);

/* ---------- cash registers ---------- */

create table cash_registers (
  id uuid primary key default gen_random_uuid(),
  branch_id uuid not null references branches(id),
  staff_id uuid not null references staff_users(id),
  opened_at timestamptz not null default now(),
  opening_cash numeric(12,2) not null default 0 check (opening_cash >= 0),
  closed_at timestamptz,
  expected_cash numeric(12,2),
  counted_cash numeric(12,2),
  counted_card numeric(12,2),
  note text,
  closed_by uuid references staff_users(id) on delete set null
);
-- One open register per staff member.
create unique index cash_registers_one_open on cash_registers (staff_id) where closed_at is null;

create table register_moves (
  id uuid primary key default gen_random_uuid(),
  register_id uuid not null references cash_registers(id) on delete cascade,
  kind text not null check (kind in ('cash_in','cash_out')),
  amount numeric(12,2) not null check (amount > 0),
  note text,
  staff_id uuid references staff_users(id) on delete set null,
  created_at timestamptz not null default now()
);

/* ---------- sales: counter sales, deposits, service types, agents ---------- */

create table service_types (
  id uuid primary key default gen_random_uuid(),
  name_en text not null,
  name_ar text not null,
  charge_kind text not null default 'fixed' check (charge_kind in ('fixed','percent')),
  charge numeric(10,2) not null default 0 check (charge >= 0),
  -- Working days until thobes are ready; empty uses the usual lead time.
  lead_days int check (lead_days between 0 and 90),
  active boolean not null default true,
  sort int not null default 0,
  created_at timestamptz not null default now()
);
insert into service_types (name_en, name_ar, charge_kind, charge, lead_days, sort) values
  ('Standard', 'عادي', 'fixed', 0, null, 0),
  ('Express', 'مستعجل', 'fixed', 50, 3, 1);

-- Walk-in sales have no customer account.
alter table orders alter column customer_id drop not null;
alter table orders add column channel text not null default 'app' check (channel in ('app','staff','pos','import'));
update orders set channel = 'staff' where placed_by_staff_id is not null;
alter table orders add column branch_id uuid references branches(id);
update orders set branch_id = (address->>'branchId')::uuid where address ? 'branchId' and (address->>'branchId') ~ '^[0-9a-f-]{36}$';
alter table orders add column walk_in_name text;
alter table orders add column walk_in_phone text;
alter table orders add column agent_id uuid references agents(id) on delete set null;
alter table orders add column service_type_id uuid references service_types(id) on delete set null;
alter table orders add column service_charge numeric(10,2) not null default 0;
-- The tax part of the total (prices include tax).
alter table orders add column tax numeric(10,2) not null default 0;
alter table orders add column notes text;
alter table orders add column receipt_token text unique default encode(gen_random_bytes(16), 'hex');
update orders set receipt_token = encode(gen_random_bytes(16), 'hex') where receipt_token is null;
alter table orders alter column receipt_token set not null;
-- Courier and tracking for delivered shop orders.
alter table orders add column shipping jsonb;
alter table orders add column register_id uuid references cash_registers(id) on delete set null;
create index on orders (paid_at);
create index on orders (branch_id, created_at);

alter table order_items add column discount numeric(10,2) not null default 0;
alter table order_items add column unit_cost numeric(10,2) not null default 0;
alter table order_items add column tax numeric(10,2) not null default 0;
alter table order_items add column returned_qty int not null default 0;

-- Payments can be several per order (deposit now, balance at pickup) and by any method.
alter table payments add column register_id uuid references cash_registers(id) on delete set null;
alter table payments add column staff_id uuid references staff_users(id) on delete set null;
alter table payments add column note text;
create index on payments (completed_at) where status = 'paid';

/* ---------- drafts and quotations ---------- */

create sequence draft_number_seq start 1001;
create table pos_drafts (
  id uuid primary key default gen_random_uuid(),
  number text not null unique,
  kind text not null check (kind in ('draft','quotation')),
  branch_id uuid references branches(id),
  customer_id uuid references customers(id) on delete set null,
  walk_in_name text,
  walk_in_phone text,
  cart jsonb not null,
  total numeric(12,2) not null default 0,
  notes text,
  valid_until date,
  staff_id uuid references staff_users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  converted_order_id uuid references orders(id) on delete set null
);
create index on pos_drafts (kind, created_at desc);

/* ---------- sales returns ---------- */

create sequence return_number_seq start 1001;
create table sales_returns (
  id uuid primary key default gen_random_uuid(),
  number text not null unique,
  order_id uuid not null references orders(id) on delete cascade,
  branch_id uuid references branches(id),
  amount numeric(12,2) not null check (amount >= 0),
  method text not null,
  restock boolean not null default true,
  points_removed int not null default 0,
  note text,
  register_id uuid references cash_registers(id) on delete set null,
  staff_id uuid references staff_users(id) on delete set null,
  created_at timestamptz not null default now()
);
create table sales_return_lines (
  id uuid primary key default gen_random_uuid(),
  return_id uuid not null references sales_returns(id) on delete cascade,
  order_item_id uuid not null references order_items(id) on delete cascade,
  qty int not null check (qty > 0),
  amount numeric(12,2) not null
);
alter table refunds add column method text not null default 'sadad';
alter table refunds add column return_id uuid references sales_returns(id) on delete set null;
alter table refunds add column register_id uuid references cash_registers(id) on delete set null;

/* ---------- automatic discounts ---------- */

create table discounts (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  applies_to text not null check (applies_to in ('all','category','product','brand','fabric')),
  target_ids text[] not null default '{}',
  kind text not null check (kind in ('percent','fixed')),
  amount numeric(10,2) not null check (amount > 0),
  starts_at timestamptz,
  ends_at timestamptz,
  branch_id uuid references branches(id) on delete cascade,
  channel text not null default 'all' check (channel in ('all','pos','app')),
  priority int not null default 0,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

/* ---------- purchases ---------- */

create sequence purchase_number_seq start 1001;
create table purchases (
  id uuid primary key default gen_random_uuid(),
  number text not null unique,
  kind text not null default 'purchase' check (kind in ('purchase','return')),
  supplier_id uuid not null references suppliers(id),
  branch_id uuid not null references branches(id),
  status text not null default 'received' check (status in ('ordered','received','cancelled')),
  reference text,
  purchase_date date not null,
  subtotal numeric(12,2) not null default 0,
  discount numeric(12,2) not null default 0,
  tax numeric(12,2) not null default 0,
  shipping numeric(12,2) not null default 0,
  total numeric(12,2) not null default 0,
  notes text,
  return_of uuid references purchases(id) on delete set null,
  staff_id uuid references staff_users(id) on delete set null,
  created_at timestamptz not null default now(),
  received_at timestamptz
);
create index on purchases (supplier_id);
create index on purchases (purchase_date);
create table purchase_lines (
  id uuid primary key default gen_random_uuid(),
  purchase_id uuid not null references purchases(id) on delete cascade,
  item_kind text not null check (item_kind in ('product','fabric')),
  item_id text not null,
  size text not null default '',
  name text not null,
  qty numeric(12,2) not null check (qty > 0),
  unit_cost numeric(10,2) not null check (unit_cost >= 0),
  line_total numeric(12,2) not null
);
create table supplier_payments (
  id uuid primary key default gen_random_uuid(),
  supplier_id uuid not null references suppliers(id),
  purchase_id uuid references purchases(id) on delete set null,
  amount numeric(12,2) not null check (amount > 0),
  method text not null check (method in ('cash','card','bank_transfer','cheque')),
  reference text,
  paid_on date not null,
  note text,
  register_id uuid references cash_registers(id) on delete set null,
  staff_id uuid references staff_users(id) on delete set null,
  created_at timestamptz not null default now()
);
create index on supplier_payments (supplier_id);

/* ---------- expenses ---------- */

create table expense_categories (
  id uuid primary key default gen_random_uuid(),
  name_en text not null,
  name_ar text not null,
  active boolean not null default true,
  created_at timestamptz not null default now()
);
insert into expense_categories (name_en, name_ar) values
  ('Rent', 'الإيجار'),
  ('Salaries', 'الرواتب'),
  ('Utilities', 'الكهرباء والماء'),
  ('Tailoring supplies', 'مستلزمات الخياطة'),
  ('Marketing', 'التسويق'),
  ('Other', 'أخرى');

create sequence expense_number_seq start 1001;
create table expenses (
  id uuid primary key default gen_random_uuid(),
  number text not null unique,
  branch_id uuid not null references branches(id),
  category_id uuid references expense_categories(id) on delete set null,
  amount numeric(12,2) not null check (amount > 0),
  tax numeric(12,2) not null default 0,
  spent_on date not null,
  method text not null check (method in ('cash','card','bank_transfer','cheque')),
  reference text,
  note text,
  register_id uuid references cash_registers(id) on delete set null,
  staff_id uuid references staff_users(id) on delete set null,
  created_at timestamptz not null default now()
);
create index on expenses (spent_on);

/* ---------- thobe photos ---------- */

create table order_photos (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references orders(id) on delete cascade,
  media_id uuid not null references media(id) on delete cascade,
  caption text,
  staff_id uuid references staff_users(id) on delete set null,
  created_at timestamptz not null default now()
);
create index on order_photos (order_id);
create index on order_photos (created_at desc);
alter table fabrics add column tax_rate_id uuid references tax_rates(id) on delete set null;

-- Items added without a code get one from their id.
create function fill_sku() returns trigger language plpgsql as $$
begin
  if new.sku is null or new.sku = '' then
    new.sku := case when tg_table_name = 'fabrics' then 'F-' else '' end || upper(new.id);
  end if;
  return new;
end $$;
create trigger products_fill_sku before insert on products for each row execute function fill_sku();
create trigger fabrics_fill_sku before insert on fabrics for each row execute function fill_sku();
