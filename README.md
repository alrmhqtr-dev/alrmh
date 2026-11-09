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

## Deployment

See [docs/deployment.md](docs/deployment.md). In short: Railway builds `apps/api/Dockerfile` from the root `railway.json`, runs migrations as a pre-deploy step and checks `/health/live`; two Vercel projects (Root Directory `apps/mobile` and `apps/admin`) build with Turbo and only rebuild when their app changed. CI in `.github/workflows/ci.yml` type-checks, builds and runs the API smoke test on every push.

## Preview mode

The preview runs without real SMS or payments:

- **Login:** any Qatar mobile number (8 digits starting 3, 5, 6 or 7) with code `123456`.
- **Demo account:** `5555 1234` has a family, measurements, past orders, an order at Stitching, 1,240 points and a 10% voucher.
- **Payment:** checkout opens a test SADAD page where you can pay, decline or cancel. No money moves.
- **Coupons:** `EID20` (20% off, capped at QAR 100) works; `SUMMER24` shows the expired message.

Order stages, measurements, fees, catalogue and coupons are managed by staff in the admin app.

## Admin app

Staff sign in with email and password. The first owner is created from `ADMIN_EMAIL` and `ADMIN_PASSWORD` when the API starts. Every change is recorded in the Activity log with the staff member's name.

| Role | Can |
| --- | --- |
| Owner | Everything, including staff accounts |
| Manager | Everything except staff accounts: cancel orders, adjust points, edit catalogue, fees, branches, rewards and coupons |
| Tailor | Move orders through stages, record measurements, manage appointments |
| Support | Read only: look up customers, orders and appointments |

## What's not real yet

| Area | Now | To go live |
| --- | --- | --- |
| SMS login | Fixed preview code | Set `OTP_MODE=sms` and plug the Qatar SMS provider into `sendSms` in `apps/api/src/modules/auth.controller.ts` |
| Payment | Test SADAD page | SADAD merchant credentials and callback verification; set `PAYMENT_MODE=sadad` |
| Push notifications | In-app list only | Expo push tokens + FCM/APNs once the store builds exist |
| Native apps | PWA only | EAS builds from `apps/mobile/eas.json` once the Apple and Google accounts exist |
| Product images | Placeholders | Client renders, uploaded to storage |
| POS and operational dashboards | Not started | Waiting for the specs |
| Hosting region | Railway and Vercel default regions | Confirm data-residency needs before launch |
