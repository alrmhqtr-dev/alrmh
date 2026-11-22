/*
 * Counter changes, 22 Nov 2026:
 * - agents and service types are retired;
 * - thobes are priced by the metre of cloth, chosen per thobe, with a cuff style beside the collar, and no colour;
 * - collars and cuffs carry a picture;
 * - order numbers lose the "AR-" prefix;
 * - reminders for thobes due tomorrow and thobes waiting to be collected.
 */

-- Agents and service types.
alter table orders drop column if exists agent_id;
alter table orders drop column if exists service_type_id;
drop table if exists agents;
drop table if exists service_types;

-- Cloth price is per metre from now on. Existing prices were per thobe at the cloth's usual length,
-- so the per-thobe price stays the same at that length.
update fabrics set price = round(price / metres_per_thobe, 2) where metres_per_thobe > 0;
comment on column fabrics.price is 'Price per metre (tax included).';
comment on column fabrics.metres_per_thobe is 'Usual metres for one thobe: the starting length at the counter and the length for app orders.';

-- Pictures for collar and cuff styles, uploaded in the admin.
alter table collars add column if not exists image_url text;
create table cuffs (
  id text primary key,
  name_en text not null,
  name_ar text not null,
  image_url text,
  sort int not null default 0,
  active boolean not null default true
);
insert into cuffs (id, name_en, name_ar, sort) values
  ('single', 'Single cuff', 'كبك عادي', 0),
  ('double', 'Double cuff', 'كبك دبل', 1),
  ('round', 'Round cuff', 'كبك دائري', 2)
on conflict (id) do nothing;

-- Order numbers are plain numbers.
update orders set number = substr(number, 4) where number like 'AR-%';
update points_ledger set label = replace(label, '#AR-', '#') where label like '%#AR-%';
update notifications set body_en = replace(body_en, '#AR-', '#'), body_ar = replace(body_ar, '#AR-', '#') where body_en like '%#AR-%' or body_ar like '%#AR-%';
update settings set value = jsonb_set(value, '{prefix}', '""') where key = 'invoice' and value->>'prefix' = 'AR-';

-- Reminders sent once per order.
alter table orders add column if not exists due_reminded_at timestamptz;
alter table orders add column if not exists pickup_reminded_at timestamptz;

-- New stock arriving, entered straight on the stock page (cloth in metres, products by quantity).
alter table stock_moves drop constraint if exists stock_moves_reason_check;
alter table stock_moves add constraint stock_moves_reason_check
  check (reason in ('opening','purchase','purchase_return','sale','sale_return','cancel','adjust','transfer_in','transfer_out','received'));
