# Deployment

AlRmh runs on three services:

| Part | Where | Folder | Address (example) |
| --- | --- | --- | --- |
| API + database | Railway (Docker + Postgres) | `apps/api` | `https://api.alrmh.qa` |
| Customer app (PWA) | Vercel | `apps/mobile` | `https://app.alrmh.qa` |
| Admin | Vercel | `apps/admin` | `https://admin.alrmh.qa` |

The repo is a pnpm + Turborepo monorepo (Node 24, pnpm 12). Each Vercel project builds only its own app and skips the build when nothing it depends on changed.

Order matters: the API goes first, because both web apps need its address at build time.

## 1. GitHub

The repo is `alrmhqtr-dev/alrmh`. Pushes use a project-only SSH key so it never mixes with other accounts on the same Mac.

Create the key and SSH alias:

```bash
cd /Users/owaisiqbal
ssh-keygen -t ed25519 -C "alrmh-deploy" -f /Users/owaisiqbal/.ssh/alrmh_ed25519
printf '\nHost github-alrmh\n  HostName github.com\n  User git\n  IdentityFile ~/.ssh/alrmh_ed25519\n  IdentitiesOnly yes\n' >> /Users/owaisiqbal/.ssh/config
pbcopy < /Users/owaisiqbal/.ssh/alrmh_ed25519.pub
```

Set a passphrase when `ssh-keygen` asks. Add the copied key in GitHub: repo > Settings > Deploy keys > Add deploy key, tick **Allow write access**.

Push:

```bash
cd /Users/owaisiqbal/Documents/Claude/Projects/AlRMH/alrmh
git remote add origin git@github-alrmh:alrmhqtr-dev/alrmh.git
ssh -T git@github-alrmh
git push -u origin main
```

Then in GitHub: Settings > Branches > add a rule for `main` requiring the **CI** checks (`Type-check and build`, `API smoke test`) to pass before merging.

CI (`.github/workflows/ci.yml`) runs on every push and pull request: frozen install, type-check and build of all three apps, then migrates a fresh Postgres, starts the API and runs the end-to-end smoke test (`apps/api/scripts/smoke.py`).

## 2. Railway: API and database

1. New Project > **Deploy from GitHub repo** > `alrmhqtr-dev/alrmh`. Railway reads `railway.json` at the repo root and builds `apps/api/Dockerfile`. Leave the service's Root Directory empty (the Docker build needs the whole workspace).
2. In the same project: **+ New > Database > PostgreSQL**.
3. API service > Variables:

| Variable | Value | Notes |
| --- | --- | --- |
| `DATABASE_URL` | `${{ Postgres.DATABASE_URL }}` | Reference to the Railway database |
| `DATABASE_SSL` | `false` | Railway's private network does not use TLS |
| `APP_URL` | `https://app.alrmh.qa` | Customer app; used for payment return links |
| `API_URL` | `https://api.alrmh.qa` | Public API address; used for the test payment page |
| `CORS_ORIGINS` | `https://app.alrmh.qa,https://admin.alrmh.qa` | Comma separated, no trailing slash. Add the `*.vercel.app` addresses until custom domains are live |
| `ADMIN_EMAIL` | owner's email | First owner account, created on first start |
| `ADMIN_PASSWORD` | a long random password | Change it after first sign-in |
| `OTP_MODE` | `preview` | Login code is always `OTP_PREVIEW_CODE` until SMS is connected. If unset in production the API uses `sms`, which refuses to issue codes until a provider is wired |
| `OTP_PREVIEW_CODE` | `123456` | |
| `PAYMENT_MODE` | `mock` | Test SADAD page until the merchant account is ready. If unset in production the API uses `sadad` and the test page does not exist |
| `SEED_ON_START` | `true` | Loads the sample catalogue, branch and settings if missing. Replace them with the real ones in the admin before launch |
| `SEED_DEMO` | `true` for preview, `false` for launch | Demo customer `5555 1234` with orders and points, and the coupons `EID20` and `SUMMER24`. Only `true` loads them |
| `MIGRATE_ON_START` | `false` | Migrations run in the pre-deploy step instead |

`PORT` is set by Railway; do not add it.

4. Settings > Networking > **Generate Domain**, or add the custom domain `api.alrmh.qa` and create the CNAME Railway shows.
5. Deploy. Each deploy:
   - builds the image (frozen pnpm install, Turbo build, production-only dependencies),
   - runs `node dist/migrate.js` as the **pre-deploy command** (a failed migration stops the release and keeps the old version running),
   - starts `node dist/main.js` and waits for `GET /health/live` to return 200 before switching traffic.

`GET /health` also checks the database; use it for uptime monitoring.

Optional: a second environment (Project > Environments > New, e.g. `staging`) with its own database and `SEED_DEMO=true`.

## 3. Vercel: customer app and admin

Create two Vercel projects from the same repo. In both, keep the defaults Vercel detects for pnpm; the build settings come from each app's `vercel.json`.

### Customer app (PWA)

| Setting | Value |
| --- | --- |
| Root Directory | `apps/mobile` |
| Include files outside the root directory | On (default) |
| Framework Preset | Other |
| Environment variable | `EXPO_PUBLIC_API_URL` = `https://api.alrmh.qa` (no `/v1`) |
| Domain | `app.alrmh.qa` |

`apps/mobile/vercel.json` builds with `pnpm turbo run build --filter=@alrmh/mobile...` (Expo web export plus the PWA head tags), serves `dist`, sends every app route to `index.html`, keeps `sw.js` uncached and caches hashed bundles for a year.

`EXPO_PUBLIC_API_URL` is baked into the bundle, so after changing it, redeploy.

### Admin

| Setting | Value |
| --- | --- |
| Root Directory | `apps/admin` |
| Framework Preset | Vite |
| Environment variable | `VITE_API_URL` = `https://api.alrmh.qa` |
| Domain | `admin.alrmh.qa` |

The admin is marked `noindex` and cannot be framed by other sites.

After both are live, make sure their addresses are in the API's `CORS_ORIGINS` and that `APP_URL` matches the customer app.

### Installing the PWA

Open the customer app address on a phone. iPhone: Safari > Share > **Add to Home Screen**. Android: Chrome > **Install app**. The app opens full screen, works offline for screens already visited, and shows an offline page otherwise.

## 4. Alternative: customer app on Railway

If you would rather keep everything on Railway, add a second service from the same repo with **Config-as-code path** set to `apps/mobile/railway.json`. It builds `apps/mobile/Dockerfile` (a small Node static server with the same routing and caching rules as Vercel, health check `/healthz`). Set the build variable `EXPO_PUBLIC_API_URL`; the build fails if it is missing.

## 5. Native apps (later)

When the Apple and Google developer accounts are ready, `apps/mobile/eas.json` has `development`, `preview` and `production` profiles. Update the API addresses in it, then:

```bash
cd /Users/owaisiqbal/Documents/Claude/Projects/AlRMH/alrmh/apps/mobile
pnpm dlx eas-cli login
pnpm dlx eas-cli build --profile preview --platform all
```

Bundle identifier and Android package are both `qa.alrmh.app`.

## Going live checklist

- Connect SMS: set `OTP_MODE` to the provider mode and its keys.
- Connect SADAD: set `PAYMENT_MODE` and the merchant keys.
- Set `SEED_DEMO=false` and remove demo data from the production database (the demo customer and the `EID20` and `SUMMER24` coupons).
- Replace the sample catalogue, prices, branch details and support numbers in the admin.
- Rotate `ADMIN_PASSWORD` and add staff from the admin Staff page.
- Turn on Railway database backups.
