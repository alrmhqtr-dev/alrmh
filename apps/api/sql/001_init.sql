create extension if not exists pgcrypto;

create table settings (
  key text primary key,
  value jsonb not null
);

create table branches (
  id uuid primary key default gen_random_uuid(),
  name_en text not null,
  name_ar text not null,
  address_en text not null,
  address_ar text not null,
  phone text not null,
  whatsapp text not null,
  hours_en text not null,
  hours_ar text not null,
  open_minute int not null default 960,
  close_minute int not null default 1260,
  slot_minutes int not null default 60,
  slot_capacity int not null default 2,
  closed_weekdays int[] not null default '{5}',
  lat double precision,
  lng double precision,
  active boolean not null default true,
  sort int not null default 0
);

create table customers (
  id uuid primary key default gen_random_uuid(),
  phone text not null unique,
  name text,
  email text,
  language text not null default 'en',
  created_at timestamptz not null default now(),
  deleted_at timestamptz
);

create table otp_codes (
  phone text primary key,
  code_hash text not null,
  expires_at timestamptz not null,
  attempts int not null default 0,
  sent_at timestamptz not null default now()
);

create table sessions (
  token_hash text primary key,
  customer_id uuid not null references customers(id) on delete cascade,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null
);

create table family_members (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references customers(id) on delete cascade,
  name text not null,
  relation text not null check (relation in ('self','father','son','brother','friend','other')),
  size text not null default 'adult' check (size in ('adult','child')),
  created_at timestamptz not null default now()
);

create table measurements (
  id uuid primary key default gen_random_uuid(),
  member_id uuid not null references family_members(id) on delete cascade,
  taken_at timestamptz not null default now(),
  method text not null default 'branch' check (method in ('branch','home')),
  branch_id uuid references branches(id),
  tailor_name text not null,
  length_cm numeric(5,1) not null,
  shoulder_cm numeric(5,1) not null,
  chest_cm numeric(5,1) not null,
  waist_cm numeric(5,1) not null,
  sleeve_cm numeric(5,1) not null,
  neck_cm numeric(5,1) not null,
  cuff_cm numeric(5,1) not null,
  remarks text
);
create index on measurements (member_id, taken_at desc);

create table addresses (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references customers(id) on delete cascade,
  label text not null,
  line1 text not null,
  area text not null,
  city text not null default 'Doha',
  notes text,
  is_default boolean not null default false,
  created_at timestamptz not null default now()
);

create table collars (
  id text primary key,
  name_en text not null,
  name_ar text not null,
  sort int not null default 0,
  active boolean not null default true
);

create table fabrics (
  id text primary key,
  name_en text not null,
  name_ar text not null,
  note_en text not null,
  note_ar text not null,
  price numeric(10,2) not null,
  sort int not null default 0,
  active boolean not null default true
);

create table colours (
  id text primary key,
  name_en text not null,
  name_ar text not null,
  hex text not null,
  sort int not null default 0
);

create table fabric_colours (
  fabric_id text not null references fabrics(id) on delete cascade,
  colour_id text not null references colours(id) on delete cascade,
  primary key (fabric_id, colour_id)
);

create table products (
  id text primary key,
  category text not null,
  name_en text not null,
  name_ar text not null,
  description_en text not null,
  description_ar text not null,
  price numeric(10,2) not null,
  sizes text[] not null default '{}',
  image_url text,
  active boolean not null default true,
  sort int not null default 0
);

create table appointments (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references customers(id) on delete cascade,
  member_id uuid not null references family_members(id) on delete cascade,
  kind text not null check (kind in ('branch','home')),
  branch_id uuid references branches(id),
  address_id uuid references addresses(id),
  starts_at timestamptz not null,
  status text not null default 'held' check (status in ('held','confirmed','done','cancelled')),
  order_id uuid,
  created_at timestamptz not null default now()
);
create index on appointments (kind, starts_at);

create table basket_items (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references customers(id) on delete cascade,
  kind text not null check (kind in ('thobe','product')),
  product_id text references products(id),
  size text,
  qty int not null default 1 check (qty between 1 and 20),
  thobe jsonb,
  member_id uuid references family_members(id) on delete cascade,
  measure_method text check (measure_method in ('saved','branch','home')),
  appointment_id uuid references appointments(id) on delete set null,
  remarks text,
  created_at timestamptz not null default now()
);

create sequence order_number_seq start 10527;

create table orders (
  id uuid primary key default gen_random_uuid(),
  number text not null unique,
  customer_id uuid not null references customers(id) on delete cascade,
  stage text not null default 'pending_payment',
  subtotal numeric(10,2) not null,
  delivery_fee numeric(10,2) not null,
  home_visit_fee numeric(10,2) not null default 0,
  discount numeric(10,2) not null default 0,
  discount_label text,
  total numeric(10,2) not null,
  voucher_id uuid,
  coupon_code text,
  address jsonb not null,
  points_to_earn int not null default 0,
  points_awarded boolean not null default false,
  expected_delivery date,
  created_at timestamptz not null default now(),
  paid_at timestamptz
);
create index on orders (customer_id, created_at desc);

create table order_items (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references orders(id) on delete cascade,
  kind text not null,
  snapshot jsonb not null,
  qty int not null,
  unit_price numeric(10,2) not null,
  line_total numeric(10,2) not null
);

create table order_events (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references orders(id) on delete cascade,
  stage text not null,
  at timestamptz not null default now(),
  note text
);

create table payments (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references orders(id) on delete cascade,
  provider text not null default 'sadad',
  amount numeric(10,2) not null,
  status text not null default 'pending' check (status in ('pending','paid','failed','cancelled')),
  provider_ref text,
  created_at timestamptz not null default now(),
  completed_at timestamptz
);

create table reward_options (
  id text primary key,
  kind text not null check (kind in ('discount','product')),
  percent int,
  product_id text references products(id),
  cost_points int not null,
  active boolean not null default true,
  sort int not null default 0
);

create table vouchers (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references customers(id) on delete cascade,
  code text not null unique,
  option_id text not null references reward_options(id),
  kind text not null,
  percent int,
  product_id text references products(id),
  cost_points int not null,
  status text not null default 'active' check (status in ('active','used','expired')),
  expires_at timestamptz not null,
  used_order_id uuid,
  created_at timestamptz not null default now()
);

create table points_ledger (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references customers(id) on delete cascade,
  kind text not null check (kind in ('earn','redeem','expire','adjust')),
  points int not null,
  remaining int not null default 0,
  expires_at timestamptz,
  order_id uuid references orders(id) on delete set null,
  voucher_id uuid references vouchers(id) on delete set null,
  label text,
  created_at timestamptz not null default now()
);
create index on points_ledger (customer_id, created_at desc);

create table coupons (
  code text primary key,
  percent int not null,
  max_discount numeric(10,2),
  starts_at timestamptz,
  expires_at timestamptz,
  active boolean not null default true
);

create table notifications (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references customers(id) on delete cascade,
  kind text not null,
  title_en text not null,
  title_ar text not null,
  body_en text not null,
  body_ar text not null,
  link text,
  created_at timestamptz not null default now(),
  read_at timestamptz
);
create index on notifications (customer_id, created_at desc);
