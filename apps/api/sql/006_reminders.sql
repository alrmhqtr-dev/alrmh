-- Each visit and each points award is reminded about once.
alter table appointments add column reminded_at timestamptz;
alter table points_ledger add column reminded_at timestamptz;
