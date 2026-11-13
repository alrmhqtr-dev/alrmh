-- Login codes: how many were sent to a number in the current hour.
alter table otp_codes add column sends int not null default 1;
alter table otp_codes add column window_start timestamptz not null default now();

-- Staff sign-in lockout after repeated wrong passwords.
alter table staff_users add column failed_logins int not null default 0;
alter table staff_users add column locked_until timestamptz;

-- Coupon limits. Null means no limit. Existing coupons become one use per customer.
alter table coupons add column per_customer_limit int default 1;
alter table coupons add column max_uses int;
alter table coupons add column min_subtotal numeric(10,2);

create index on orders (coupon_code) where coupon_code is not null;
create index on appointments (member_id, status);
