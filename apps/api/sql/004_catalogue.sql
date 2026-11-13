-- Product categories become rows staff can add to and rename.
create table categories (
  id text primary key,
  name_en text not null,
  name_ar text not null,
  sort int not null default 0,
  active boolean not null default true
);
insert into categories (id, name_en, name_ar, sort) values
  ('ghutra', 'Ghutra', 'غتر', 0),
  ('agal', 'Agal', 'عقال', 1),
  ('sandals', 'Sandals', 'نعال', 2),
  ('fragrance', 'Fragrance', 'عطور', 3),
  ('accessories', 'Accessories', 'إكسسوارات', 4);
-- Anything already filed under another name keeps working.
insert into categories (id, name_en, name_ar, sort)
  select distinct p.category, initcap(p.category), p.category, 100 from products p
   where p.category not in (select id from categories);
alter table products add constraint products_category_fkey foreign key (category) references categories(id);

-- Which of the app's collar drawings a collar uses.
alter table collars add column shape text not null default 'classic-qatari'
  check (shape in ('classic-qatari', 'mandarin-band', 'round-neck', 'wide-collar'));
update collars set shape = id where id in ('classic-qatari', 'mandarin-band', 'round-neck', 'wide-collar');

-- Product photos uploaded from the admin. Kept in the database so no separate
-- storage account is needed; move to object storage if the catalogue grows large.
create table media (
  id uuid primary key default gen_random_uuid(),
  content_type text not null,
  bytes bytea not null,
  size int not null,
  staff_id uuid references staff_users(id) on delete set null,
  created_at timestamptz not null default now()
);
