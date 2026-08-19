# AYF Agro Investment — Stripe Backend

> Stripe-powered farm investment platform: investors fund farms, payments via Stripe PaymentIntents, ROI payouts via Stripe Transfers, all hardened for production.

[![Node](https://img.shields.io/badge/node-%3E%3D18-brightgreen)]()
[![TypeScript](https://img.shields.io/badge/typescript-5.9-blue)]()
[![Stripe](https://img.shields.io/badge/stripe-20.x-6772e5)]()
[![License](https://img.shields.io/badge/license-ISC-lightgrey)]()

---

## Table of Contents

- [Architecture](#architecture)
- [Quick Start](#quick-start)
- [Environment](#environment)
- [Seeding](#seeding)
- [API Overview](#api-overview)
- [Stripe Flow](#stripe-flow)
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
   ├─ POST /api/investments { farmId, amount } → creates Investment(pending) + Stripe PI → returns clientSecret
   ├─ Stripe.js confirms PI on client → Stripe → POST /api/webhooks/stripe (raw body) → marks completed + $inc fundedAmount + email
   └─ ROI worker (daily midnight, maturity-gated) → Stripe Transfers → marks roiPaid

MongoDB (Mongoose) owns: User, Farm, Investment, WebhookEvent
```

**Key design decisions**

- Webhook raw body must be *before* `express.json()` (Stripe signature needs exact bytes).
- Idempotency: `WebhookEvent.stripeEventId` unique index + catch `11000`; PaymentIntent creation uses `idempotencyKey: pi-${investmentId}`; Transfers use `roi-transfer-${investmentId}`.
- `fundedAmount` updated atomically with `$inc`, not read-modify-save.
- `maturityDate = createdAt + durationMonths` computed in Investment `pre("validate")`.
- Stripe singleton `getStripe()` so API version & config are centralized.

---

## Quick Start

```bash
# 1. Clone
git clone <repo>
cd Agro-Investment-Stripe-Backend
git checkout arena/01a01939-agro-investment-stripe-backend # this session

# 2. Env
cp .env.example .env
# edit .env: set MONGO_URI, JWT_SECRET (32+ chars), STRIPE_SECRET_KEY, etc.

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
# { success:true, db:"connected", stripe:"configured", ... }
```

**Requirements:** Node ≥18, MongoDB ≥6 (or Atlas URI), Stripe test keys.

---

## Environment

See `.env.example` for full annotated list. Required:

| Key | Description |
|-----|-------------|
| `PORT` | HTTP port (default 5000) |
| `MONGO_URI` | Mongo connection string |
| `JWT_SECRET` | HS256 secret ≥32 chars (change default!) |
| `STRIPE_SECRET_KEY` | `sk_test_...` or `sk_live_...` |
| `STRIPE_WEBHOOK_SECRET` | `whsec_...` from `stripe listen` |
| `CLIENT_URL` | Frontend origin for CORS |
| `EMAIL_HOST/PORT/USER/PASS/FROM` | Nodemailer SMTP (mocked if missing) |
| `CLOUDINARY_*` | Optional image uploads |
| `ADMIN_EMAIL/PASSWORD/NAME` | Seed admin |
| `RATE_LIMIT_WINDOW_MS/MAX` | Global rate limit (default 15m/100) |
| `ENABLE_ROI_WORKER` | `true` to run cron (default true) |

---

## Seeding

```bash
npm run seed:admin
# or custom:
ADMIN_EMAIL=myadmin@corp.com ADMIN_PASSWORD='S3cure!123' npm run seed:admin
```

Also set admin from mongo shell:
```js
db.users.updateOne({email:"user@x.com"}, {$set:{role:"admin"}})
```

---

## API Overview

Base: `/api`

### Auth

| Method | Path | Auth | Role | Body |
|--------|------|------|------|------|
| POST | `/auth/signup` | — | — | `{name,email,password,country?,photo?}` → `{token,refreshToken,user}` |
| POST | `/auth/login` | — | — | `{email,password}` |
| POST | `/auth/refresh` | — | — | `{refreshToken}` or cookie → new tokens |
| POST | `/auth/logout` | — | — | — (clears cookie) |
| GET | `/auth/me` | Bearer | any | — → current user |
| PATCH | `/auth/me` | Bearer | any | `{name?,country?,photo?}` |

> **Security note:** `role` sent in signup is *ignored* — all signups are `investor`. Admin must be seeded.

### Farms

| Method | Path | Auth | Role | Notes |
|--------|------|------|------|-------|
| POST | `/farms` | Bearer | admin | Zod validated `farmCreateSchema` |
| PUT | `/farms/:id` | Bearer | admin | Whitelisted fields only |
| DELETE | `/farms/:id` | Bearer | admin |  |
| GET | `/farms?page=1&limit=10&search=maize&status=active&sort=-createdAt` | Bearer | investor,admin | Paginated, text search, filtering, sorting |
| GET | `/farms/:id` | Bearer | investor,admin |  |
| GET | `/farms/stats/summary` | Bearer | admin | Aggregated goals/funded/avgROI |

### Investments

| Method | Path | Auth | Role | Notes |
|--------|------|------|------|-------|
| POST | `/investments` | Bearer | investor | `{farmId,amount,currency?}` → `{clientSecret,paymentIntentId,investmentId}` |
| GET | `/investments/me?page=&limit=&status=` | Bearer | investor,admin | My investments paginated |
| GET | `/investments/my/:id` | Bearer | owner/admin | Single |
| GET | `/investments/:id` | Bearer | owner/admin | Single |
| GET | `/investments?page=&limit=&status=&farmId=` | Bearer | admin | All investments |
| POST | `/investments/:id/complete` | Bearer | admin | Manual complete (idempotent) |
| POST | `/investments/:id/cancel` | Bearer | owner,admin | Cancels pending, tries Stripe cancel |

### Users (Admin)

| Method | Path | Auth | Role |
|--------|------|------|------|
| GET | `/users?search=&role=&page=&limit=` | Bearer | admin |
| GET | `/users/:id` | Bearer | admin |
| PATCH | `/users/:id` | Bearer | admin | Whitelist: `name,email,role,country,photo,isVerified,stripeAccountId,stripeCustomerId` |
| DELETE | `/users/:id` | Bearer | admin |

### System

| Method | Path |  |
|--------|------|--|
| GET | `/` | `{status, env, version}` |
| GET | `/health` | `{db, stripe, email, uptime}` |
| POST | `/api/webhooks/stripe` | **Raw body**, Stripe-signed — do not send JSON. |

**Errors** are `{ success:false, message, code?, stack? (dev) }` with codes like `VALIDATION_ERROR`, `UNAUTHORIZED`, `FORBIDDEN`, `DUPLICATE_KEY`, `CAST_ERROR`.

All list endpoints return `{ success:true, data, pagination:{page,limit,total,pages} }`.

---

## Stripe Flow

1. **Invest** `POST /api/investments` creates `Investment{pending, maturityDate}` and `stripe.paymentIntents.create({amount*100, automatic_payment_methods, metadata:{investmentId}, idempotencyKey})` → returns `clientSecret`.
2. **Client confirms** with Stripe.js `stripe.confirmPayment({clientSecret})`.
3. **Webhook** `POST /api/webhooks/stripe` (use `stripe listen --forward-to localhost:5000/api/webhooks/stripe` for local dev):
   ```bash
   stripe listen --forward-to localhost:5000/api/webhooks/stripe
   stripe trigger payment_intent.succeeded
   ```
   Webhook verifies signature via `STRIPE_WEBHOOK_SECRET`, inserts `WebhookEvent` atomically, handles `payment_intent.succeeded|payment_failed|canceled`, increments farm `fundedAmount` atomically, marks farm `funded` if goal met, sends non-blocking email.

4. If Stripe is not configured, investing returns `503 Payments unavailable`.

---

## ROI Worker

- **When:** Daily at midnight + once 5s after server boot (if `ENABLE_ROI_WORKER != "false"`).
- **What:** `processDueROIs()` queries `{status:completed, roiPaid:false, maturityDate:$lte:now}` → for each, requires `user.stripeAccountId`; creates `stripe.transfers.create({amount: projectedReturn*100, destination, idempotencyKey})` → sets `roiPaid:true`.
- **Run standalone:**
  ```bash
  npm run worker:roi
  ```
- **Manual trigger** (in code): `await processDueROIs()`

> Add `stripeAccountId` to investors via `PATCH /api/users/:id {stripeAccountId:"acct_..."} ` (Connect Express/Custom).

---

## Security Notes

- Signup **cannot** become admin by passing `role`. See `src/modules/auth/auth.service.ts: signupUser` forces `investor`.
- Passwords use `bcryptjs` with `genSalt(12)` + `select:false`; never returned in JSON (see `sanitizeUser`).
- JWT: `15m` access, `7d` refresh (httpOnly cookie `secure` in prod, `sameSite:lax`), distinct errors for expired/invalid.
- CORS: reflects `CLIENT_URL` + localhost in dev, not `origin:true` globally in prod.
- Rate limiting: `100/15m` global, `20/15m` on `/api/auth`.
- Sanitization: `sanitize` middleware strips `$`/`.` keys and `<script>` tags.
- Validation: Zod schemas for signup/login/farm/invest; malformed `ObjectId` yields `400 CastError`, not 500.
- Webhook: raw body, signature checked, idempotency via unique index.

Set a strong `JWT_SECRET` and rotate `.env` if you ever committed the default `super_super_secret_key`.

---

## Scripts

| Command | Description |
|---------|-------------|
| `npm run dev` | ts-node-dev with transpile-only & respawn |
| `npm run build` | `tsc` to `dist/` |
| `npm start` | `node dist/server.js` |
| `npm run worker:roi` | Run ROI worker standalone |
| `npm run seed:admin` | Seed admin user |
| `npm run typecheck` | `tsc --noEmit` |

---

## Project Structure

```
src/
  app.ts                     # Express setup (helmet, cors, raw webhook, morgan, limits, routes, 404)
  server.ts                  # connectDB + listen + startROIWorker + graceful shutdown
  config/ { env.ts, db.ts, stripe.ts, cloudinary.ts }
  middlewares/ { auth, role, error, validate, sanitize }
  modules/
    auth/ { controller, service, routes }
    users/ { model, routes }    # admin user management
    farms/ { model, controller, routes }
    investments/ { model, controller, routes }
    payments/ { service, webhook, roi.service, webhookEvent.model }
  utils/ { AppError, catchAsync, email, validation (zod), pagination }
  workers/ { processROI.ts }
  scripts/ { seedAdmin.ts }
  types/ { express.d.ts }
```

---

## Troubleshooting

**`Webhook Error: No signatures found`** → Ensure route is `express.raw` *before* `express.json()` (fixed) and `STRIPE_WEBHOOK_SECRET` matches `stripe listen` secret. Check header is `stripe-signature` (lowercase).

**`MongoDB connection failed`** → Verify `MONGO_URI` (Atlas needs IP allowlist). Test with `mongosh "<uri>"`.

**`Email timeout`** → If `EMAIL_*` unconfigured, emails are mocked (log shows `[EMAIL MOCK]`). No failure blocks investing.

**`Farm already fully funded`** → `POST /invest` checks `goal - fundedAmount`. Delete investments or increase `investmentGoal`.

**Tests fail with `self-signed certificate`** → `NODE_TLS_REJECT_UNAUTHORIZED=0` for local (not prod).

---

## Roadmap (see AUDIT.md for details)

- Jest + mongodb-memory-server + Stripe mock tests
- Swagger OpenAPI at `/api-docs`
- BullMQ/Redis queue for email/ROI
- Password reset & email verification
- Cloudinary image upload endpoint
- Dockerfile + CI

---

## License

ISC — © AYF
