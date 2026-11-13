-- Phones (installed web app for now) that asked to be notified.
create table push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references customers(id) on delete cascade,
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  failures int not null default 0,
  created_at timestamptz not null default now(),
  last_sent_at timestamptz
);
create index on push_subscriptions (customer_id);

-- Every notification is pushed once, after it is saved. Older ones count as sent.
alter table notifications add column pushed_at timestamptz;
update notifications set pushed_at = created_at;
create index notifications_unpushed on notifications (created_at) where pushed_at is null;

-- Refunds made in SADAD, recorded by staff.
create table refunds (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references orders(id) on delete cascade,
  amount numeric(10,2) not null check (amount > 0),
  reference text,
  note text,
  staff_id uuid references staff_users(id) on delete set null,
  created_at timestamptz not null default now()
);
create index on refunds (order_id);

-- A home visit booked on its own is paid at the visit.
alter table appointments add column fee numeric(10,2) not null default 0;
alter table appointments add column fee_paid_at timestamptz;
