# AlRmh

Customer app for AlRmh tailored thobes (Doha): design a thobe, book a measurement, pay, track the order, and earn and redeem points. English and Arabic (right-to-left). Staff run the business from the admin app.

pnpm + Turborepo monorepo:

| Folder | What it is | Runs on |
| --- | --- | --- |
| `apps/mobile` | Expo (React Native) app: the web PWA now, iOS and Android later from the same code | Vercel |
| `apps/api` | NestJS API on PostgreSQL: auth, catalogue, family and measurements, bookings, basket, orders, payments, points, staff and audit log | Railway (Docker) + Railway Postgres |
| `apps/admin` | Admin web app for staff (React + Vite): orders board, appointments, customers and measurements, catalogue, branches, fees, rewards, staff | Vercel |
| `docs/deployment.md` | Step-by-step setup for GitHub, Railway and Vercel | |

Designs: [AlRMH in Figma](https://www.figma.com/design/wb9npW3MTKUTTmddJIChnf/AlRMH).

## Local development

Needs Node 24 (`.nvmrc`), pnpm 12 (`corepack enable`) and a local PostgreSQL.

```bash
cd /Users/owaisiqbal/Documents/Claude/Projects/AlRMH/alrmh
corepack enable
pnpm install
cp apps/api/.env.example apps/api/.env
cp apps/mobile/.env.example apps/mobile/.env
cp apps/admin/.env.example apps/admin/.env
pnpm dev
```

`pnpm dev` starts the API on `:4000` (migrates and seeds on start), the customer app on `:8081` and the admin on `:5174`. Run one app with `pnpm dev:api`, `pnpm dev:mobile` or `pnpm dev:admin`.

| Command | Does |
| --- | --- |
| `pnpm build` | Builds all three apps (Turbo caches unchanged ones) |
| `pnpm type-check` | Type-checks all three apps |
| `pnpm db:migrate` | Runs API migrations against `DATABASE_URL` |
| `pnpm db:seed` | Loads the catalogue and demo data |

API smoke test (creates a customer, books, pays and delivers an order; signs in as the owner from `ADMIN_EMAIL`/`ADMIN_PASSWORD`): `API=http://localhost:4000 python3 apps/api/scripts/smoke.py 55559999`

Regression checks for the money, booking, points and sign-in rules (needs `psql`, and the API started with `RATE_LIMITS=off`, `SEED_DEMO=true`, `HOUSEKEEPING_SECONDS=5`, `QUIET_HOURS=off` and `CORS_ORIGINS=http://localhost:8081`): `API=http://localhost:4000 python3 apps/api/scripts/regress.py`

Browser checks (need Google Chrome and `pip install playwright`; the app served on 8081 and the admin on 5174 against a fresh database):
- `tests/e2e/journey.py` signs up, designs, books, pays and follows an order through every stage in the admin, in English and Arabic, and checks the crash screens.
- `tests/e2e/a11y.py` runs axe-core over 26 screens in both languages; set `AXE` to the path of `axe.min.js` (`npm install --prefix /tmp/axe axe-core@4`).

CI runs all of these on every push.

## Deployment

See [docs/deployment.md](docs/deployment.md). In short: Railway builds `apps/api/Dockerfile` from the root `railway.json`, runs migrations as a pre-deploy step and checks `/health/live`; two Vercel projects (Root Directory `apps/mobile` and `apps/admin`) build with Turbo and only rebuild when their app changed. CI in `.github/workflows/ci.yml` type-checks, builds and runs the API smoke test on every push.

## Preview mode

The preview runs without real SMS or payments:

- **Login:** any Qatar mobile number (8 digits starting 3, 5, 6 or 7) with code `123456`.
- **Demo account:** `5555 1234` has a family, measurements, past orders, an order at Stitching, 1,240 points and a 10% voucher.
- **Payment:** checkout opens a test SADAD page where you can pay, decline or cancel. No money moves.
- **Coupons:** `EID20` (20% off, capped at QAR 100, once per customer) works; `SUMMER24` shows the expired message. Both are demo data (`SEED_DEMO=true`).

Order stages, measurements, fees, catalogue and coupons are managed by staff in the admin app.

## Admin app

Staff sign in with email and password. The first owner is created from `ADMIN_EMAIL` and `ADMIN_PASSWORD` when the API starts. Every change is recorded in the Activity log with the staff member's name.

| Role | Can |
| --- | --- |
| Owner | Everything, including staff accounts |
| Manager | Everything except staff accounts: cancel orders, adjust points, edit catalogue, fees, branches, rewards and coupons |
| Tailor | Move orders through stages, record measurements, manage appointments |
| Support | Read only: look up customers, orders and appointments |

## Rules the API enforces

- **Sign-in codes:** 5 guesses per code, 5 codes per number per hour, and per-address limits on requesting and checking codes.
- **Staff sign-in:** an account locks for 15 minutes after 10 wrong passwords.
- **Checkout:** one open checkout per customer; starting a new one closes the earlier unpaid attempt, so a voucher or coupon is paid for once.
- **Bookings:** a held time is checked again at checkout; a visit booked on its own is one per person at a time and can be cancelled by the customer.
- **Coupons:** optional uses per customer (default 1), total uses and minimum subtotal, set in the admin.
- **Catalogue:** categories, collars (each with one of the app's four collar drawings), fabrics, colours, products and their photos are managed in the admin. Photos are JPEG, PNG or WebP up to 2 MB; the admin shrinks large ones first.
- **Branches:** several branches can be live; customers pick one when booking. A branch needs its map position for the Directions button.
- **Staying current:** an open tracking screen asks for the stage every 10 seconds, the orders list and home every 20 to 30, and the catalogue is re-read after 30 seconds when a screen opens or the app returns to the front.
- **Push notifications:** every in-app notification is also sent to the customer's phones that turned notifications on (Account > Notifications, or after an order). Only known push services are accepted as addresses.
- **Checkout:** a payment page left open over 30 minutes can no longer be paid; every 10 minutes the API also closes such checkouts, releases unused held times and clears expired sign-ins.
- **Reminders:** a visit inside the next 24 hours gets one reminder (not when it was booked less than 6 hours ahead), and points expiring within the warning period in Settings get one notice. Nothing is sent during quiet hours (`QUIET_HOURS`, default 22-8 Doha time); they go out after.
- **Crashes:** a screen that fails shows a bilingual recovery screen with Try again and Home; in the admin only the page area is replaced and the menu keeps working.
- **Refunds:** staff record refunds made in SADAD on the order (in parts if needed, never more than was paid); cancelled paid orders are listed as refunds due on the overview, and the customer is notified.
- **Exports:** managers download paid orders (by date) and customers as CSV from the Orders and Customers pages.
- **Home visits booked on their own:** the fee is recorded on the visit and marked as collected by staff.
- **Delete account:** removes the profile, family, measurements, addresses, points and notifications; past orders stay as sales records. Refused while an order is in progress.

## What's not real yet

| Area | Now | To go live |
| --- | --- | --- |
| SMS login | Fixed preview code | Set `OTP_MODE=sms` and plug the Qatar SMS provider into `sendSms` in `apps/api/src/modules/auth.controller.ts`. Until then SMS mode refuses to issue codes |
| Payment | Test SADAD page (only reachable while `PAYMENT_MODE=mock`) | SADAD merchant credentials and callback verification; set `PAYMENT_MODE=sadad` |
| Push notifications | Web Push for the installed app (Android, and iPhone once added to the Home Screen), when `VAPID_PUBLIC_KEY` and `VAPID_PRIVATE_KEY` are set | Expo push tokens + FCM/APNs for the native builds |
| Native apps | PWA only | EAS builds from `apps/mobile/eas.json` once the Apple and Google accounts exist |
| Product images | Uploaded per product in the admin (Catalogue > Products) and kept in the database; products without one show a placeholder | The client's photos. Move to object storage if the catalogue grows into the hundreds |
| POS and operational dashboards | Not started | Waiting for the specs |
| Hosting region | Railway and Vercel default regions | Confirm data-residency needs before launch |
