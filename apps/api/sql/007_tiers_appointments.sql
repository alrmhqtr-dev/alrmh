-- Loyalty tiers, points spent at checkout, paid appointments and orders placed in store.

-- Tiers. A customer's tier is the highest one whose threshold they have reached,
-- counting every point ever earned (spending points never lowers the tier).
create table tiers (
  id text primary key,
  name_en text not null,
  name_ar text not null,
  min_points int not null default 0 check (min_points >= 0),
  points_per_product int not null default 0 check (points_per_product >= 0),
  points_per_thobe int not null default 0 check (points_per_thobe >= 0),
  colour text not null default '#B8B8B8',
  created_at timestamptz not null default now()
);
insert into tiers (id, name_en, name_ar, min_points, points_per_product, points_per_thobe, colour) values
  ('silver', 'Silver', 'فضي', 0, 10, 15, '#B8BCC2'),
  ('gold', 'Gold', 'ذهبي', 300, 15, 20, '#C9A35A')
on conflict (id) do nothing;

-- 'refund': points given back when an order that used them is cancelled. They can be
-- spent again but do not count towards a tier.
alter table points_ledger drop constraint if exists points_ledger_kind_check;
alter table points_ledger add constraint points_ledger_kind_check check (kind in ('earn','redeem','expire','adjust','refund'));

-- Points used at checkout (1 point = QAR 1).
alter table orders add column points_used int not null default 0;
-- Orders staff place in the admin at a visit, paid on the card machine.
alter table orders add column placed_by_staff_id uuid references staff_users(id) on delete set null;

-- A payment is for an order or for an appointment's booking fee.
alter table payments alter column order_id drop not null;
alter table payments add column appointment_id uuid references appointments(id) on delete cascade;
alter table payments add constraint payments_for_something check (order_id is not null or appointment_id is not null);
create index payments_appointment_idx on payments (appointment_id) where appointment_id is not null;
