# AlRmh

Customer app for AlRmh tailored thobes (Doha): design a thobe, book a measurement, pay, track the order, and earn and redeem points. English and Arabic (right-to-left).

| Folder | What it is |
| --- | --- |
| `apps/mobile` | Expo (React Native) app: iOS, Android and the web PWA from one codebase |
| `apps/api` | NestJS API on PostgreSQL: auth, catalogue, family and measurements, bookings, basket, orders, payments, points |
| `render.yaml` | Render blueprint for the API and its database |
| `.github/workflows/pwa.yml` | Builds the PWA and publishes it to GitHub Pages on every push to `main` |

Designs: [AlRMH in Figma](https://www.figma.com/design/wb9npW3MTKUTTmddJIChnf/AlRMH).

## Preview mode

The preview runs without real SMS or payments:

- **Login:** any Qatar mobile number (8 digits starting 3, 5, 6 or 7) with code `123456`.
- **Demo account:** `5555 1234` has a family, measurements, past orders, an order at Stitching, 1,240 points and a 10% voucher.
- **Payment:** checkout opens a test SADAD page where you can pay, decline or cancel. No money moves.
- **Coupons:** `EID20` (20% off, capped at QAR 100) works; `SUMMER24` shows the expired message.

Order stages and measurements are set by staff. Until the admin and POS screens are built, use the admin API (see below).

## First deployment

1. **API on Render.** In Render choose New > Blueprint and select this repo. It creates `alrmh-api` and `alrmh-db`. Set two values when asked:
   - `APP_URL` = the PWA address, e.g. `https://<owner>.github.io/<repo>`
   - `CORS_ORIGINS` = the PWA origin, e.g. `https://<owner>.github.io`
   
   The API runs migrations and loads the catalogue and demo data on start. Note the service URL, e.g. `https://alrmh-api.onrender.com`.
2. **PWA on GitHub Pages.** In the repo go to Settings > Pages and set Source to **GitHub Actions**. Then Settings > Secrets and variables > Actions > Variables and add `API_URL` = the Render URL from step 1. Push to `main` or run the workflow by hand.
3. Open `https://<owner>.github.io/<repo>/` on a phone. On iPhone use Share > Add to Home Screen; on Android use Install app.

Render's free tier sleeps after 15 minutes without traffic, so the first request after a pause takes about a minute. The free database expires 30 days after it is created; upgrade it to a paid plan before then to keep the data.

## Local development

```bash
cd apps/api && npm install && cp .env.example .env && npm run build && node --env-file=.env dist/main.js
cd apps/mobile && npm install && EXPO_PUBLIC_API_URL=http://localhost:4000 npx expo start --web
```

API smoke test (creates a customer, books, pays and delivers an order): `API=http://localhost:4000 python3 apps/api/scripts/smoke.py 55559999`

## Admin API (temporary, until the admin web app)

All admin calls need the header `X-Admin-Token` (Render generates `ADMIN_TOKEN`; find it in the service's Environment tab).

| Call | Does |
| --- | --- |
| `GET /v1/admin/orders?stage=stitching` | List orders |
| `POST /v1/admin/orders/:id/stage` `{"stage":"cutting"}` | Move an order forward; the customer gets a notification; `delivered` awards points |
| `GET /v1/admin/customers?phone=55551234` | Customer with family members |
| `POST /v1/admin/members/:id/measurements` | Record measurements: `tailorName`, `length_cm`, `shoulder_cm`, `chest_cm`, `waist_cm`, `sleeve_cm`, `neck_cm`, `cuff_cm`, optional `remarks`, `branchId`, `method` |

## What's not real yet

| Area | Now | To go live |
| --- | --- | --- |
| SMS login | Fixed preview code | Set `OTP_MODE=sms` and plug the Qatar SMS provider into `sendSms` in `apps/api/src/modules/auth.controller.ts` |
| Payment | Test SADAD page | SADAD merchant credentials and callback verification; set `PAYMENT_MODE=sadad` |
| Push notifications | In-app list only | Expo push tokens + FCM/APNs once the store builds exist |
| Product images | Placeholders | Client renders, uploaded to storage |
| Admin and POS | API only | Admin web app (Phase 1) and the operational dashboards |
| Hosting | Render (outside Qatar) | In-country region before launch |
