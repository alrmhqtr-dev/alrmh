create table staff_users (
  id uuid primary key default gen_random_uuid(),
  email text not null unique,
  name text not null,
  role text not null check (role in ('owner','manager','tailor','support')),
  branch_id uuid references branches(id),
  password_hash text not null,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  last_login_at timestamptz
);

create table staff_sessions (
  token_hash text primary key,
  staff_id uuid not null references staff_users(id) on delete cascade,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null
);

create table audit_log (
  id bigserial primary key,
  staff_id uuid references staff_users(id) on delete set null,
  staff_name text,
  action text not null,
  entity text not null,
  entity_id text,
  data jsonb,
  at timestamptz not null default now()
);
create index on audit_log (at desc);
create index on audit_log (entity, entity_id);

alter table order_events add column staff_id uuid references staff_users(id) on delete set null;
alter table measurements add column staff_id uuid references staff_users(id) on delete set null;
alter table points_ledger add column staff_id uuid references staff_users(id) on delete set null;
