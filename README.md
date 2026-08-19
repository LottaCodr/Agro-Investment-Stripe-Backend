# AYF Agro Investment — Flutterwave Backend

> Flutterwave-powered farm investment platform (Nigeria-first): investors fund farms, payments via Flutterwave Checkout, ROI payouts via Flutterwave Transfers, all hardened for production.

[![Node](https://img.shields.io/badge/node-%3E%3D18-brightgreen)]()
[![TypeScript](https://img.shields.io/badge/typescript-5.9-blue)]()
[![Flutterwave](https://img.shields.io/badge/flutterwave-v3-F5A623)]()
[![License](https://img.shields.io/badge/license-ISC-lightgrey)]()

> **Migration note:** This repo was originally Stripe-based. All Stripe code is now deprecated/removed. Use Flutterwave env vars (`FLW_*`). Legacy `stripe` files are kept as shims.

---

## Table of Contents

- [Architecture](#architecture)
- [Quick Start](#quick-start)
- [Environment](#environment)
- [Seeding](#seeding)
- [API Overview](#api-overview)
- [Flutterwave Flow](#flutterwave-flow)
- [ROI Worker](#roi-worker)
- [Security Notes](#security-notes)
- [Scripts](#scripts)
- [Project Structure](#project-structure)
- [Troubleshooting](#troubleshooting)
- [Roadmap](#roadmap)

---

## Architecture

```
Client (web/mobile)
   │
   ├─ POST /api/auth/signup|login → JWT (15m) + refresh (7d, httpOnly cookie)
   ├─ POST /api/farms (admin) → Farm { goal, min, roi, duration, fundedAmount }
   ├─ POST /api/investments { farmId, amount, currency? } → creates Investment(pending, tx_ref: AYF-<id>-<ts>, paymentProvider:flutterwave) + Flutterwave /v3/payments → returns { paymentLink, tx_ref }
   ├─ Client redirects to paymentLink (Flutterwave Checkout: card, bank transfer, USSD, mobile money) → Pays → Flutterwave → POST /api/webhooks/flutterwave (verif-hash + verify /v3/transactions/{id}/verify) → marks completed + $inc fundedAmount + email
   ├─ (Optional) GET /api/investments/:id/verify?transaction_id=xxx&tx_ref=yyy → server verifies with Flutterwave and marks completed (for redirect polling fallback)
   └─ ROI worker (daily midnight, maturity-gated) → Flutterwave /v3/transfers (account_bank + account_number) → marks roiPaid
MongoDB (Mongoose) owns: User, Farm, Investment, WebhookEvent
```

**Key design decisions**

- Flutterwave webhook uses `verif-hash` header (your secret hash from Dashboard → Settings → Webhooks) + **server-side verification** via `GET /v3/transactions/{id}/verify` before marking `completed`. Never trust redirect params alone.
- Idempotency: `WebhookEvent.stripeEventId` unique index + catch `11000` (despite name, stores `dedupId` = `transactionId || tx_ref-event-flwRef`); Transfers use `reference: roi-${investmentId}-${Date.now()}`.
- `fundedAmount` updated atomically with `$inc`, not read-modify-save.
- `maturityDate = createdAt + durationMonths` computed in Investment `pre("validate")`.
- `tx_ref` format `AYF-<investmentId>-<timestamp>` encodes `investmentId` for webhook lookup even if meta lost.
- Flutterwave helpers in `src/config/flutterwave.ts` (fetch-based, uses `FLW_BASE_URL`, `FLW_SECRET_KEY`).

---

## Quick Start

```bash
# 1. Clone
git clone <repo>
cd Agro-Investment-Stripe-Backend
git checkout arena/01a01939-agro-investment-stripe-backend

# 2. Env
cp .env.example .env
# edit .env: set MONGO_URI, JWT_SECRET (32+ chars), FLW_SECRET_KEY, FLW_WEBHOOK_SECRET_HASH, etc.

# 3. Install
npm install

# 4. Build
npm run build  # or ./node_modules/.bin/tsc

# 5. Seed first admin (idempotent)
npm run seed:admin
# default: admin@ayf.local / Admin123!  (override via ADMIN_EMAIL, ADMIN_PASSWORD)

# 6. Run
npm run dev      # ts-node-dev with reload
# or
npm start        # node dist/server.js (production)

# 7. Health
curl http://localhost:5000/health
# { success:true, db:"connected", flutterwave:"configured", ... }
```

**Requirements:** Node ≥18, MongoDB ≥6 (or Atlas URI), Flutterwave test keys from dashboard.

---

## Environment

See `.env.example` for full annotated list. Required for Flutterwave:

| Key | Description |
|-----|-------------|
| `PORT` | HTTP port (default 5000) |
| `MONGO_URI` | Mongo connection string |
| `JWT_SECRET` | HS256 secret ≥32 chars |
| `FLW_PUBLIC_KEY` | `FLWPUBK_TEST-...` (for inline) |
| `FLW_SECRET_KEY` | `FLWSECK_TEST-...` or `FLUTTERWAVE_SECRET_KEY` |
| `FLW_ENCRYPTION_KEY` | `FLWSECK_TEST...` (if using card encryption) |
| `FLW_WEBHOOK_SECRET_HASH` | Secret hash you set in Dashboard → Settings → Webhooks (`verif-hash`) |
| `FLW_BASE_URL` | `https://api.flutterwave.com/v3` (default) |
| `FLW_REDIRECT_URL` | After payment redirect (default `${CLIENT_URL}/payment/callback`) |
| `FLW_CURRENCY` | Default payout/payin currency (default `NGN`) |
| `CLIENT_URL` | Frontend origin for CORS |
| `EMAIL_HOST/PORT/USER/PASS/FROM` | Nodemailer SMTP (mocked if missing) |
| `CLOUDINARY_*` | Optional image uploads |
| `ADMIN_EMAIL/PASSWORD/NAME` | Seed admin |
| `RATE_LIMIT_WINDOW_MS/MAX` | Global rate limit (default 15m/100) |
| `ENABLE_ROI_WORKER` | `true` to run cron (default true) |

Legacy `STRIPE_*` kept as stubs (deprecated).

---

## Seeding

```bash
npm run seed:admin
# or custom:
ADMIN_EMAIL=myadmin@corp.com ADMIN_PASSWORD='S3cure!123' npm run seed:admin
```

Also:
```js
db.users.updateOne({email:"user@x.com"}, {$set:{role:"admin"}})
db.users.updateOne({email:"investor@x.com"}, {$set:{flutterwaveAccountNumber:"0123456789", flutterwaveBankCode:"044", flutterwaveAccountName:"John Doe"}})
```

**Bank codes:** List via `GET https://api.flutterwave.com/v3/banks/NG` or dashboard. Common `044=Access Bank`, `058=GTBank`, `011=First Bank`, `232=Sterling`.

---

## API Overview

Base: `/api`

### Auth

| Method | Path | Auth | Role | Body |
|--------|------|------|------|------|
| POST | `/auth/signup` | — | — | `{name,email,password,country?,photo?,phone?}` → `{token,refreshToken,user}` |
| POST | `/auth/login` | — | — | `{email,password}` |
| POST | `/auth/refresh` | — | — | `{refreshToken}` or cookie → new tokens |
| POST | `/auth/logout` | — | — | — (clears cookie) |
| GET | `/auth/me` | Bearer | any | — → current user |
| PATCH | `/auth/me` | Bearer | any | `{name?,country?,photo?,phone?}` |

> `role` in signup is ignored — all signups are `investor`.

### Farms

| Method | Path | Auth | Role | Notes |
|--------|------|------|------|-------|
| POST | `/farms` | Bearer | admin | Zod validated |
| PUT | `/farms/:id` | Bearer | admin | Whitelisted only |
| DELETE | `/farms/:id` | Bearer | admin |  |
| GET | `/farms?page=1&limit=10&search=maize&status=active&sort=-createdAt` | Bearer | investor,admin | Paginated |
| GET | `/farms/:id` | Bearer | investor,admin |  |
| GET | `/farms/stats/summary` | Bearer | admin | Aggregated |

### Investments (Flutterwave)

| Method | Path | Auth | Role | Notes |
|--------|------|------|------|-------|
| POST | `/investments` | Bearer | investor | `{farmId,amount,currency?}` → `{paymentLink, tx_ref, investmentId, redirectUrl}` |
| GET | `/investments/me?page=&limit=&status=` | Bearer | investor,admin | My investments paginated |
| GET | `/investments/my/:id` | Bearer | owner/admin | Single |
| GET | `/investments/:id` | Bearer | owner/admin | Single |
| GET | `/investments?page=&limit=&status=&farmId=` | Bearer | admin | All |
| **GET** | `/investments/:id/verify?transaction_id=123&tx_ref=AYF-...` | Bearer | owner/admin | **Verify Flutterwave transaction and mark completed (fallback to webhook)** |
| GET | `/investments/verify?tx_ref=...` | Bearer | owner/admin | Same |
| POST | `/investments/:id/complete` | Bearer | admin | Manual complete (idempotent, for admin) |
| POST | `/investments/:id/cancel` | Bearer | owner,admin | Cancels pending |

**Response for invest:** includes `paymentLink` (Flutterwave Checkout URL). Frontend should `window.location = paymentLink` or use `FlutterwaveCheckout({public_key, tx_ref, amount, currency, customer, callback: verify})`.

### Users (Admin)

| Method | Path | Auth | Role |
|--------|------|------|------|
| GET | `/users?search=&role=&page=&limit=` | Bearer | admin |
| GET | `/users/:id` | Bearer | admin |
| PATCH | `/users/:id` | Bearer | admin | Whitelist: `name,email,role,country,photo,phone,isVerified,flutterwaveAccountNumber,flutterwaveBankCode,flutterwaveAccountName,flutterwaveCustomerId,stripeAccountId(legacy)` |
| DELETE | `/users/:id` | Bearer | admin |

### System

| Method | Path |  |
|--------|------|--|
| GET | `/` | `{status:"AYF Backend running (Flutterwave)", provider:"flutterwave"}` |
| GET | `/health` | `{db, flutterwave, stripe(legacy), email, uptime}` |
| POST | `/api/webhooks/flutterwave` | **Flutterwave webhook** — `verif-hash` header, JSON body. **Primary** |
| POST | `/api/webhooks/stripe` | **Legacy Stripe raw webhook** — alias to Flutterwave handler (for migration) |
| POST | `/api/webhooks/flutterwave/verify` | Alias |
| POST | `/api/payments/webhook` | Alias |

**Errors** are `{ success:false, message, code }` with codes like `VALIDATION_ERROR`, `UNAUTHORIZED`, `FORBIDDEN`, `DUPLICATE_KEY`, `CAST_ERROR`.

---

## Flutterwave Flow

### Payment (payin)

1. **Invest** `POST /api/investments` creates `Investment{pending, flutterwaveTxRef: AYF-<id>-<ts>, maturityDate}` and `POST https://api.flutterwave.com/v3/payments` with `tx_ref`, `amount`, `currency`, `redirect_url`, `customer`, `meta:{investmentId}`, `customizations`. Returns `link`. Stores `flutterwaveTxRef`, `flutterwavePaymentLink`.

2. **Client redirects** to `link`. User pays via card/bank transfer/USSD/mobile money.

3. **Webhook** `POST /api/webhooks/flutterwave`
   - Verifies `verif-hash` header equals `FLW_WEBHOOK_SECRET_HASH` (if set).
   - Extracts `data.id` (transactionId), `tx_ref`, `status`, `amount`, `currency`.
   - **Verifies server-side** via `GET /v3/transactions/{id}/verify` with `Bearer FLW_SECRET_KEY`. Checks `status==="successful"`, `amount`, `currency`, `tx_ref`.
   - Finds Investment by `flutterwaveTxRef` or encoded `investmentId` in `tx_ref`, marks `completed`, `$inc` farm `fundedAmount`, marks farm `funded` if goal met, sends email.

   Local test:
   ```bash
   # Use Flutterwave dashboard → Settings → Webhooks → Test, or
   curl -X POST http://localhost:5000/api/webhooks/flutterwave \
     -H "verif-hash: $FLW_WEBHOOK_SECRET_HASH" \
     -H "Content-Type: application/json" \
     -d '{"event":"charge.completed","data":{"id":123456,"tx_ref":"AYF-...","flw_ref":"FLW...","amount":50000,"currency":"NGN","status":"successful","customer":{"email":"test@x.com"}}}'
   ```

4. **Fallback verify** after redirect: Flutterwave redirects to `FLW_REDIRECT_URL?transaction_id=xxx&tx_ref=yyy&status=successful`. Frontend should call:
   ```bash
   GET /api/investments/<investmentId>/verify?transaction_id=xxx&tx_ref=yyy
   ```
   Server verifies via API and marks completed (idempotent with webhook).

   If Flutterwave not configured, investing returns `503`.

### Payout (ROI)

- **When:** Daily midnight + 5s after boot (`processDueROIs`).
- **Query:** `{status:completed, roiPaid:false, maturityDate:$lte:now}`.
- **Requires:** `user.flutterwaveAccountNumber` + `user.flutterwaveBankCode` (set via `PATCH /api/users/:id`). Without, `skipped` + warning.
- **Call:** `POST /v3/transfers` with `account_bank`, `account_number`, `amount: projectedReturn()`, `currency: investment.currency || FLW_CURRENCY`, `reference: roi-${id}-${Date.now()}`, `beneficiary_name`, `meta`. On success sets `roiPaid:true`, `roiFlutterwaveTransferId`, `flutterwaveTransferId`.
- **Standalone:**
  ```bash
  npm run worker:roi
  # or
  node dist/workers/processROI.js
  ```

> Set bank details: `PATCH /api/users/<investorId> {flutterwaveAccountNumber:"0690000040", flutterwaveBankCode:"044", flutterwaveAccountName:"John Doe"}`

---

## Security Notes

- Signup cannot become admin.
- Passwords `bcrypt(12)` + `select:false`; `sanitizeUser`.
- JWT `15m`/`7d` httpOnly `secure` in prod.
- CORS allowlist `CLIENT_URL` + localhost in dev.
- Rate limit `100/15m` global, `20/15m` auth.
- `sanitize` strips `$`/` .` + `<script>`.
- Zod validation; `CastError`→400.
- Webhook: `verif-hash` + **API verification** + idempotency via unique `stripeEventId` (dedupId). Never trust redirect query alone.

Set strong `JWT_SECRET` + `FLW_WEBHOOK_SECRET_HASH` (random 16+). Rotate if leaked.

---

## Scripts

| Command | Description |
|---------|-------------|
| `npm run dev` | ts-node-dev |
| `npm run build` | `tsc` → `dist/` |
| `npm start` | `node dist/server.js` |
| `npm run worker:roi` | ROI standalone |
| `npm run seed:admin` | Seed admin |
| `npm run typecheck` | `tsc --noEmit` |

---

## Project Structure

```
src/
  app.ts                     # helmet, cors, webhooks (flutterwave json + stripe raw), morgan, limits, routes
  server.ts                  # connectDB + listen + startROIWorker + graceful shutdown
  config/ { env.ts, db.ts, flutterwave.ts, stripe.ts(shim), cloudinary.ts }
  middlewares/ { auth, role, error, validate, sanitize }
  modules/
    auth/ { controller, service, routes }
    users/ { model, routes }
    farms/ { model, controller, routes }
    investments/ { model, controller, routes }  # flutterwave tx_ref + verify endpoint
    payments/ { service(flutterwave), webhook(flutterwave), roi.service, webhookEvent.model }
  utils/ { AppError, catchAsync, email, validation, pagination }
  workers/ { processROI.ts }
  scripts/ { seedAdmin.ts }
  types/ { express.d.ts }
```

---

## Troubleshooting

**`Invalid webhook hash`** → Ensure dashboard Settings → Webhooks → Secret Hash == `FLW_WEBHOOK_SECRET_HASH` and header `verif-hash` matches exactly. In dev without hash set, verification is skipped (warn).

**`Could not verify Flutterwave transaction`** → Check `FLW_SECRET_KEY` correct and network. Test via `curl https://api.flutterwave.com/v3/transactions/<id>/verify -H "Authorization: Bearer $FLW_SECRET_KEY"`.

**`Payments unavailable (Flutterwave not configured)`** → Set `FLW_SECRET_KEY` (test `FLWSECK_TEST-...` then live `FLWSECK-...`).

**`Investor has no payout bank details – skipping ROI`** → PATCH user with `flutterwaveAccountNumber`/`flutterwaveBankCode`.

**`MongoDB connection failed`** → Check `MONGO_URI` + Atlas IP whitelist. Degraded mode still serves `/health` and validation, but DB ops timeout 10s.

---

## Roadmap

- Jest + mongodb-memory-server + Flutterwave mock tests
- Swagger at `/api-docs`
- BullMQ/Redis queue for email/ROI
- Password reset & email verification
- Cloudinary image upload
- Dockerfile + CI

---

## License

ISC — © AYF
