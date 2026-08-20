# Agro Investment Stripe Backend — Deep Audit

**Date:** 2026-08-19  
**Branch:** arena/01a01939-agro-investment-stripe-backend  
**Base commit:** bdf6ec738be77092acb0377759ec609082221773  
**Auditor:** Agent Mode (Arena.ai)

---

## Executive Summary

The repo is a functional MVP for an agro-investment platform (farms, investments, Stripe payments, ROI payouts) but is **not production-ready**. It has **8 critical/high security bugs** (role escalation, password leak, webhook idempotency, NoSQL injection, etc.), **~15 data-integrity / business-logic flaws** (orphaned investments, double-fundedAmount, webhook never matches, ROI paid immediately, etc.), **broken middleware ordering** that breaks Stripe, and **many missing operational features** (pagination, filtering, .env.example, seed, health, graceful shutdown, docs).

**Build status before fix:** `tsc --noEmit` passed (types loosely satisfied) but runtime is broken (webhook signature always fails, investments never complete, ROI always skipped).

**Build status after fix:** `tsc --noEmit` clean, `npm run build` clean, 0 `npm audit` vulnerabilities, webhook verified, idempotency atomic, ROI maturity-gated, pagination/filtering, hardening applied.

---

## 1. What's Wrong — Detailed Findings

### 1.1 🔴 Critical Security

| # | File | Issue | Impact | Severity |
|---|------|-------|--------|----------|
| S1 | `src/modules/auth/auth.service.ts:17` + `auth.controller.ts:11` | **Privilege escalation**: `role` taken directly from `req.body` and persisted. Any caller can `POST /api/auth/signup { role: "admin" }` and become admin. `signupUser(role="admin")` is unguarded. | Full admin takeover. | **Critical** |
| S2 | `src/modules/auth/auth.controller.ts:11,22` | **Password hash leaked**: `res.json({ user })` returns full Mongoose doc including `password` (hashed). No `select: false` on schema and no sanitization. | Leaks hashes, aids offline cracking. | **Critical** |
| S3 | `src/app.ts:18-31` | **Stripe webhook broken by middleware order**: `app.use(express.json())` runs before `app.post("/api/webhooks/stripe", express.raw(...))`. Body is already consumed → `stripe.webhooks.constructEvent` always throws → payments never confirm. | All investments remain `pending` forever. | **Critical** |
| S4 | `src/modules/users/user.model.ts` | `password` has no `select: false`, no `lowercase`/`trim` on email, no format validation, no `stripeAccountId`/`stripeCustomerId` fields (yet referenced by ROI worker). | Auth bypass via case sensitivity, ROI always `skipped`. | **High** |
| S5 | `src/modules/farms/farm.controller.ts:6` | **Mass assignment**: `Farm.create(req.body)` allows client to set `fundedAmount`, `status`, even `_id` arbitrarily. | Fund manipulation, overwrite. | **High** |
| S6 | `src/middlewares/auth.middleware.ts` | Uses `(req as any).user`; token not checked for `TokenExpiredError` vs `JsonWebTokenError`; no handling for missing Bearer prefix; attaches raw Mongoose doc with password. | Poor DX, leaks. | **High** |
| S7 | `src/app.ts:14-17` | **CORS wide open with credentials**: `cors({ origin: true, credentials: true })` reflects any origin. | CSRF/credential leakage. | **High** |
| S8 | `src/modules/auth/auth.service.ts` | No input validation (empty name/email, invalid email, short password accepted); no rate-limit on auth per-route. | Abuse, injection. | **Medium** |
| S9 | `src/app.ts` + middlewares | **No NoSQL injection / XSS sanitization**. `req.query.search` fed directly into `$text`/`$regex` without sanitization; `$` keys not stripped. | Injection. | **Medium** |
| S10 | `src/utils/email.ts` | `transporter` created per-request, no error handling; `await sendEmail` blocks payment flow; credentials logged implicitly if `EMAIL_*` missing. | DoS on email failure. | **Medium** |

### 1.2 🟠 Data-Integrity & Logic

| # | File | Issue | Impact |
|---|------|-------|--------|
| D1 | `src/modules/investments/investment.model.ts` | **Missing `stripePaymentIntentId` field** but webhook queries `Investment.findOne({ stripePaymentIntentId: pi.id })` → always `null` → “Investment not found” → `fundedAmount` never incremented, email never sent. | Core payment flow broken. |
| D2 | `src/modules/investments/investment.controller.ts:27-47` | **Orphaned investment on Stripe failure**: creates `Investment(status:pending)` *before* `stripe.paymentIntents.create`. If Stripe throws, pending doc remains. No transaction, no cleanup. | DB junk, phantom pending. |
| D3 | `src/modules/investments/investment.controller.ts:83-86` | **Double counting `fundedAmount`**: `completeInvestment` (admin manual) does `farm.fundedAmount += amount` and webhook *also* does it → if both paths used, farm over-counted 2×. | Financial incorrectness. |
| D4 | `src/modules/investments/investment.controller.ts:83-86` | `fundedAmount` updated via `farm.save()` (read-modify-write) not atomic ` $inc` → race if two investments complete concurrently. | Lost updates. |
| D5 | `src/modules/investments/investment.controller.ts:61-87` | `completeInvestment` sends email to `req.user.email` (the admin completing), not the investor: `const investor = req.user!` then `investor.email`. | Wrong recipient. |
| D6 | `src/modules/payments/payment.webhook.ts:34-38` | After `populate("farm")`, code does `investment.investor.email` without populating `investor` → `investment.investor` is ObjectId → `.email` is undefined → email throws. | Silent failure. |
| D7 | `src/modules/payments/payment.webhook.ts:23-29,66` | **Race in idempotency**: check-then-create `WebhookEvent` not atomic. Concurrent retries can both pass `findOne` then both process and both `create`, one fails duplicate but after side-effects. Also `payment_failed` not handled (never marks `failed`). | Duplicate transfers or missed failures. |
| D8 | `src/modules/investments/investment.controller.ts:18-26` | **Oversubscription not prevented**: no check `fundedAmount + amount <= investmentGoal`. Farm can exceed goal by arbitrary amount. | Business rule violation. |
| D9 | `src/modules/payments/roi.service.ts:19` + `src/workers/processROI.ts:11` | **ROI maturity ignored**: `processROIs` finds `{status:"completed", roiPaid:false}` and pays *immediately*, ignoring `durationMonths`. Should wait until maturityDate. | Pays months/years early. |
| D10 | `src/modules/users/user.model.ts` | `stripeAccountId` missing → `processROI` always logs “no Stripe account linked” and skips → ROI never paid. | Feature dead. |
| D11 | `src/modules/investments/investment.model.ts` | No `maturityDate`, no `currency`, no `stripeCustomerId`, no indexes on `investor+status`, `farm+status`, `maturityDate`. Queries are collection scans. | Perf + logic. |
| D12 | `src/modules/investments/investment.controller.ts:60` | `getMyInvestments` has no pagination, no filtering → returns all investments for user (could be thousands) in one response. | DoS / memory. |
| D13 | `src/modules/farms/farm.controller.ts:37` | Same: `Farm.find()` without pagination/limit → unbounded. | DoS. |
| D14 | `src/modules/farms/farm.model.ts` | `minimumInvestment` validation compares to `investmentGoal` via validator that uses `this.investmentGoal` which may be undefined on `findByIdAndUpdate` (validator `this` is query, not doc). | Validation bypass on update. |
| D15 | `src/modules/payments/payment.service.ts` | Duplicate of controller logic, unused, uses deprecated `payment_method_types:["card"]`. | Dead code, confusion. |

### 1.3 🟡 Architecture & Operational

| # | File | Issue |
|---|------|-------|
| A1 | `src/app.ts` | No `cookieParser`, no `morgan` request logging, no `notFound` 404 handler, health check is trivial `{status}`, no Stripe/email config reporting, no API versioning. |
| A2 | `src/middlewares/error.middleware.ts` | Only handles `AppError`; unhandled `ValidationError`, `CastError` (bad ObjectId), `11000 duplicate`, `ZodError`, `JsonWebTokenError` all bubble as 500 with stack leak in prod or generic 500. |
| A3 | `src/workers/processROI.ts` | **Top-level side effects on import**: `mongoose.connect(...)` at module scope, `processROIs().then(...)` executes immediately, and `cron.schedule` runs even when imported by tests. Causes double connections. No `startROIWorker()` export, no `enable` flag. |
| A4 | `src/server.ts` | No graceful shutdown, no `unhandledRejection`/`uncaughtException` handlers, `ENV.PORT` is string not number, `connectDB` exits inside helper (hard to test). |
| A5 | `src/config/env.ts` | Only validates 3 keys; `STRIPE_WEBHOOK_SECRET` accessed with `!` but not required; `PORT` not coerced to number; `CLOUDINARY_*` not validated; no `CLIENT_URL`, `RATE_LIMIT_*`, `JWT_EXPIRES*`. |
| A6 | `src/config/db.ts` | No `autoIndex`, no disconnect helper, no `error`/`disconnected` event listeners. |
| A7 | `src/config/stripe.ts`, `src/config/cloudinary.ts` | Missing entirely despite `stripe` and `cloudinary` in `package.json`. Stripe instantiated in 4 different files with preview apiVersion `2025-12-15.clover`. |
| A8 | `package.json` | `nodemailer@7.0.12` has 6 high CVEs; `mongodb` direct dep redundant with `mongoose`; missing `zod`, `morgan`, `cookie-parser`, `ts-node`; scripts only `dev/build/start`; `main: index.js` wrong; `license ISC` but private? |
| A9 | `.env` | Contains weak `JWT_SECRET=super_super_secret_key` (checked in), no `.env.example`, no documentation. |
| A10 | `README.md` | Empty (1 newline). No setup, no API docs, no env table, no architecture. |
| A11 | `tsconfig.json` | `rootDir:src`, `outDir:dist` ok, but no `resolveJsonModule`, no `allowSyntheticDefaultImports` nuances, no path aliases. |
| A12 | `src/modules/auth/auth.service.ts` | `expiresIn: "15m"` hard-coded, refresh token never stored/rotated, no `refresh` endpoint despite issuing refresh tokens. |
| A13 | `src/types/express.d.ts` | Declares but `auth.middleware` still uses `(req as any).user`, not typed. |
| A14 | `src/workers/processROI.ts:9` | Uses `ENV.MONGO_URI` at import time before dotenv? Actually `ENV` imports `dotenv.config()` so ok, but side effect still. |
| A15 | `src/modules/payments/roi.service.ts` | Calculates `amountCents = projectedReturn()*100` (principal+profit) but Stripe Connect `transfers` need sufficient balance; no check for `currency`; idempotency key correct but transfer amount arguably should be *profit only*? Ambiguous spec. |
| A16 | No user management routes for admin, no profile `GET /api/auth/me`, no `GET /api/users`, no farm stats, no investment cancel, no `GET /api/investments/:id`. |

---

## 2. What's Missing — Feature Gaps

### 2.1 Security Hardening
- [ ] Request validation (Zod/Joi) for all inputs
- [ ] Rate limiting per route (auth stricter)
- [ ] Mongo sanitize + XSS sanitize
- [ ] Helmet CSP tuning
- [ ] CORS allowlist (not reflect all)
- [ ] Password `select:false`
- [ ] Secure cookie storage for refresh tokens
- [ ] `restrictTo` typed properly
- [ ] Centralized `sanitizeUser` to never leak hashes

### 2.2 Domain
- [ ] Field whitelisting for farm create/update
- [ ] Pagination (`page`, `limit`, `skip`, `total`, `pages`) for farms & investments
- [ ] Search (`?search=` text index), filtering (`?status=`), sorting (`?sort=-createdAt`)
- [ ] `maturityDate` on Investment (computed from `createdAt + durationMonths`)
- [ ] `stripePaymentIntentId` indexing + `currency`, `stripeCustomerId`
- [ ] Oversubscription guard + atomic `fundedAmount: $inc`
- [ ] Idempotent PaymentIntent creation (`idempotencyKey: pi-${investmentId}`)
- [ ] Webhook fallback lookup via `metadata.investmentId` + amount validation
- [ ] Investment `cancel`/`failed` handling and `GET /me/:id`, `GET /` (admin)
- [ ] User `stripeAccountId` / `stripeCustomerId` support
- [ ] Farm `status` enum, `fundedPercentage` virtual, `createdBy`, `stats/summary`

### 2.3 Payments
- [ ] Stripe singleton (`getStripe()`) + `isStripeConfigured()` guard
- [ ] Webhook idempotency via atomic upsert (`create` with unique index → catch 11000) instead of find-then-create
- [ ] Handle `payment_intent.payment_failed`, `payment_intent.canceled`
- [ ] Non-blocking email (`sendEmailNonBlocking`) after commit
- [ ] Transfer idempotency for ROI + maturity check

### 2.4 Operational
- [ ] `.env.example` with all keys documented
- [ ] `src/config/cloudinary.ts`, `src/config/stripe.ts`
- [ ] `src/scripts/seedAdmin.ts` for first admin
- [ ] Health check (`/health`) reporting DB, Stripe, email
- [ ] Graceful shutdown (SIGTERM/SIGINT, 10s force, `disconnectDB`)
- [ ] ROI worker `startROIWorker()` factory + `ENABLE_ROI_WORKER` flag, cron daily midnight, immediate run delayed 5s
- [ ] `morgan` logging, `cookie-parser`, `sanitize` middleware
- [ ] `notFound` 404 middleware + enriched `errorHandler` (ValidationError, CastError, duplicate, Zod, JWT, Stripe)
- [ ] `src/utils/catchAsync`, `src/utils/pagination`, `src/utils/validation` (Zod schemas)
- [ ] `src/middlewares/validate`, `src/middlewares/sanitize`
- [ ] Admin `GET /api/users` management routes
- [ ] Admin `GET /api/investments` + investor `GET /api/investments/me` + `GET /:id` + `POST /:id/cancel` + `POST /:id/complete`
- [ ] `README.md` with setup, env table, API table, architecture, design decisions

### 2.5 DevEx
- [ ] Fix `package.json` scripts (`seed:admin`, `worker:roi`, `lint`, `typecheck`), `main: dist/server.js`, remove redundant `mongodb`, fix `nodemailer` CVEs (→ 9.0.5), add `zod`, `morgan`, `cookie-parser`, `ts-node`
- [ ] Engine `node >=18`
- [ ] `tsc` build works with `chmod +x` + `npx tsc`

### 2.6 Future (not blocking, recommended)
- Swagger/OpenAPI (`/api-docs`)
- Jest + Supertest integration tests (auth, farms, investments, webhook)
- BullMQ + Redis queue for emails/ROI instead of `node-cron` in-process
- Cloudinary signed upload endpoint (`POST /api/farms/:id/image`)
- Password reset (`/auth/forgot` + `/auth/reset`) + email verification
- Multi-currency support, FX
- Admin dashboard metrics (total invested, ROI pending)

---

## 3. What Was Implemented (Fix Log)

### 3.1 Config
- **`src/config/env.ts`** — Full validation: `PORT` coerced to number, `JWT_EXPIRES*`, `CLIENT_URL`, `EMAIL_FROM`, `CLOUDINARY_*`, `RATE_LIMIT_*`; warns if Stripe/email missing; `isProd`/`isDev` helpers.
- **`src/config/db.ts`** — `autoIndex`, `disconnectDB()`, event listeners `error`/`disconnected`.
- **`src/config/stripe.ts` (new)** — Singleton `getStripe()` + `isStripeConfigured()`, removed preview `apiVersion`, lazy init, clear error if missing.
- **`src/config/cloudinary.ts` (new)** — Configures `cloudinary` from env, warns if missing.
- **`src/config/index.ts` (new)** — Barrel exports.

### 3.2 Types & Utils
- **`src/types/express.d.ts`** — Cleaned, `export {}` to ensure global augment.
- **`src/utils/AppError.ts`** — Added `code` field, `isAppError` helper, proper prototype.
- **`src/utils/catchAsync.ts` (new)** — `catchAsync` wrapper.
- **`src/utils/email.ts`** — Singleton transporter, `sendEmail` with graceful mock when not configured, `sendEmailNonBlocking`, `emailTemplates` (pending/completed/failed/ROI), HTML sanitization, non-blocking by default.
- **`src/utils/validation.ts` (new)** — Zod schemas: `signupSchema`, `loginSchema`, `farmCreateSchema`, `farmUpdateSchema`, `investSchema`, `paginationSchema` with defaults/coercions.
- **`src/utils/pagination.ts` (new)** — `parsePagination` helper.

### 3.3 Middlewares
- **`src/middlewares/auth.middleware.ts`** — Correctly extracts Bearer *or* cookie, distinguishes `TokenExpiredError` vs `JsonWebTokenError`, uses `select("+password")` then strips password, types `req.user`, added `optionalAuth`.
- **`src/middlewares/role.middleware.ts`** — Uses `req.user` typed, adds `code: FORBIDDEN`.
- **`src/middlewares/error.middleware.ts`** — Handles `ValidationError` → 400, duplicate `11000` → 409, `CastError` → 400, `ZodError` (both `.issues` and `.errors` for v3/v4), `JsonWebTokenError`/`TokenExpiredError`, Stripe typed errors, stacks only in dev, operacional check.
- **`src/middlewares/validate.middleware.ts` (new)** — Generic `validate(schema, source)` → parses, replaces `req[source]` with coercions/defaults, maps Zod issues to `AppError 400`.
- **`src/middlewares/sanitize.middleware.ts` (new)** — Strips `$` / `.` keys (NoSQL injection) and `<script>` tags.
- **`notFound` exported** from error middleware.

### 3.4 Models
- **`src/modules/users/user.model.ts`** — `password: select:false`, email `lowercase/trim/match`, `stripeAccountId`/`stripeCustomerId`, `passwordResetToken/Expires` (select:false), indexes, `pre("save")` with `bcrypt.genSalt(12)`, `toJSON` strips sensitive.
- **`src/modules/farms/farm.model.ts`** — Required `image` URL regex, `investmentGoal`/`minimumInvestment`/`roi`/`durationMonths` bounds, `status` enum (`active|funded|completed|cancelled`), `createdBy`, `fundedPercentage` virtual, `$text` index, `status+createdAt` index, removed broken cross-field validator from schema (now in controller).
- **`src/modules/investments/investment.model.ts`** — **Added missing fields**: `stripePaymentIntentId` (unique sparse index), `stripeCustomerId`, `currency`, `maturityDate` (required, indexed), `status` now includes `failed`; indexes on `investor+status`, `farm+status`, `status+roiPaid+maturityDate`; methods `projectedReturn` + `projectedProfit`; `pre("validate")` computes `maturityDate = createdAt + durationMonths`.
- **`src/modules/payments/webhookEvent.model.ts`** — Added `type`, TTL 30d, index on `stripeEventId`.

### 3.5 Auth
- **`src/modules/auth/auth.service.ts`** — `signToken` uses `ENV.JWT_EXPIRES*`; `signupUser` forces `role=investor` (ignores input), `sanitizeUser`; `verifyRefreshToken`.
- **`src/modules/auth/auth.controller.ts`** — `signup` ignores `role`, validates presence, `sanitizeUser`, sets `httpOnly` refresh cookie (`secure` in prod), `sendTokenResponse` shared, `refresh` (cookie or body), `logout` (clearCookie), `getMe` + `updateMe` (whitelist `name/country/photo`).
- **`src/modules/auth/auth.routes.ts`** — `POST /signup` + `POST /login` validated via Zod, `POST /refresh`, `POST /logout`, `GET /me` + `PATCH /me` protected.

### 3.6 Farms
- **`src/modules/farms/farm.controller.ts`** — Whitelist `allowedCreateFields`/`allowedUpdateFields`, forbids `fundedAmount` direct write, validates `minimum <= goal`, pagination (`page/limit/skip/sort/search/status`), `Farm.find().sort().skip().limit().lean()`, `getFarmStats` aggregation.
- **`src/modules/farms/farm.routes.ts`** — `GET /` + `GET /stats/summary` + `GET /:id` protected `investor,admin`; `POST/PUT/DELETE` admin only with Zod validation.

### 3.7 Investments
- **`src/modules/investments/investment.controller.ts`** — Full rewrite:
  - `investInFarm`: validates `farmId` ObjectId, checks `farm.status===active`, `minimum`, oversubscription (`remaining`), Stripe guard `isStripeConfigured()`, creates Investment *first* with `currency`, then `stripe.paymentIntents.create` with `automatic_payment_methods`, `metadata {investmentId,farmId,investorId}`, `idempotencyKey: pi-${id}`, on Stripe failure deletes Investment, backfills `stripePaymentIntentId`, non-blocking email, returns `{clientSecret, investmentId, paymentIntentId}`.
  - `markInvestmentCompleted` helper (idempotent): loads with `populate("farm investor")`, skips if already `completed`, checks `cancelled/failed`, sets `completed`, `save()`, **atomic** `Farm $inc fundedAmount`, auto-marks `funded` if goal met, non-blocking email to real investor (not admin) with correct farm name.
  - `completeInvestment` wraps helper.
  - `getMyInvestments`: paginated, optional `?status`, maps `projectedReturn/Profit`, `maturityDate`, `roiPaid`.
  - `getMyInvestment`, `getAllInvestments` (admin), `cancelInvestment` (owner or admin, Stripe cancel best-effort).
  - Exports `_markInvestmentCompleted` for webhook reuse.
- **`src/modules/investments/investment.routes.ts`** — `POST /` investor Zod `investSchema`, `GET /me`, `GET /my/:id`, `GET /` admin, `POST /:id/complete` admin, `POST /:id/cancel` (owner/admin), `GET /:id` (owner/admin).

### 3.8 Payments
- **`src/modules/payments/payment.service.ts`** — Uses `getStripe()`, `automatic_payment_methods`, supports `metadata` + `idempotencyKey`, `retrievePaymentIntent`, `createTransfer`.
- **`src/modules/payments/payment.webhook.ts`** — **Fixed critical order dependency** (now expects raw body from `app.ts`); guards missing `STRIPE_WEBHOOK_SECRET`/`stripe-signature`; **atomic idempotency** via `WebhookEvent.create` catching `11000`; handles `payment_intent.succeeded|payment_failed|canceled`; `findInvestmentForPI` with 3-tier fallback (`stripePaymentIntentId` → `metadata.investmentId` with backfill → null), validates `amount_received`, atomic `$inc`, non-blocking emails, handles `customer` saving.
- **`src/modules/payments/roi.service.ts`** — Checks `roiPaid`, **maturity** (`maturityDate <= now`), `isStripeConfigured`, idempotency `roi-transfer-${id}`, non-blocking `roiPaid` email, new `processDueROIs` that queries `{status:completed, roiPaid:false, maturityDate:$lte:now}` with counts `paid/skipped/failed`.

### 3.9 Workers
- **`src/workers/processROI.ts`** — No top-level side effects. Exports `startROIWorker()` which ensures DB, runs after 5s, then daily midnight via `node-cron`, logs counts. Standalone mode when `require.main === module`. Alias `processROIs` kept.

### 3.10 Users (new)
- **`src/modules/users/user.routes.ts`** — Admin `GET /` (paginated search/role), `GET /:id`, `PATCH /:id` (whitelist), `DELETE /:id`, all `protect + restrictTo("admin")`.

### 3.11 App & Server
- **`src/app.ts`** — **Fixed middleware order**: raw stripe route *before* `express.json()`. Added `trust proxy:1`, narrowed `cors` to reflect `CLIENT_URL` (+ allow dev localhost), added `cookieParser`, `morgan`, `sanitize`, `notFound`, global `/api` limiter (`RATE_LIMIT_*`), stricter `authLimiter` (20/15m), health `GET /` + `GET /health` (DB state, Stripe, email), mounted `userRoutes`.
- **`src/server.ts`** — `async startServer`, coerced `ENV.PORT` number, `startROIWorker()` gated by `ENABLE_ROI_WORKER`, graceful shutdown on `SIGTERM/SIGINT` with `server.close` → `disconnectDB` (10s forced), handlers for `unhandledRejection`/`uncaughtException`.

### 3.12 Config & Scripts
- **`package.json`** — Added `zod`, `morgan`, `cookie-parser`, `ts-node`, `@types/*`; **fixed `nodemailer` CVE → 9.0.5**; removed redundant `mongodb`; `main: dist/server.js`; new scripts `worker:roi`, `seed:admin`, `lint`, `typecheck`; `engines: node>=18`.
- **`src/scripts/seedAdmin.ts` (new)** — Creates first admin from `ADMIN_*` env or defaults `admin@ayf.local/Admin123!`, idempotent.
- **`.env.example` (new)** — Full table of all env keys with defaults/notes.
- **`src/utils/pagination.ts`, `src/config/index.ts`** — Helpers.

### 3.13 Docs
- **`AUDIT.md` (this file)**
- **`README.md` (rewritten)** — Architecture, setup, env table, API table, Stripe flow, ROI flow, role matrix, testing guide, roadmap.

---

## 4. Verification

- `npm audit` → `0 vulnerabilities` (was 31, 2 low, 19 moderate, 9 high, 1 critical)
- `npx tsc --noEmit` → `EXIT:0` (clean)
- `npm run build` (`npx tsc`) → `EXIT:0`, `dist/` populated with all modules
- `GET /health` → reports `db`, `stripe`, `email` states
- Auth role escalation → blocked (test `POST /api/auth/signup {role:"admin"}` → created as investor)
- Password not leaked (test `POST /signup` response has no `password` field)
- Stripe webhook with `express.raw` → `constructEvent` succeeds (tested with Stripe CLI `stripe trigger payment_intent.succeeded`)
- Oversubscription → `400 Only $X remaining`
- ROI worker → respects `maturityDate`

---

## 5. Risk Rating After Fix

| Area | Before | After |
|------|--------|-------|
| Security | 🔴 Critical | 🟢 Low (needs pen test) |
| Payment integrity | 🔴 Broken | 🟢 Correct (idempotent, atomic) |
| ROI correctness | 🔴 Never due / pays early | 🟢 Maturity-gated |
| Operational | 🟡 Manual | 🟢 Observable (health, logs, graceful) |
| DevEx | 🟡 Poor | 🟢 Good (seed, .env.example, pagination) |

---

## 6. Recommended Next Steps (not yet done)

1. Add `jest` + `supertest` + `mongodb-memory-server` integration tests for `auth`, `farms`, `investments`, `webhook` (coverage ≥80%).
2. Swagger at `/api-docs` (e.g., `swagger-jsdoc` + `swagger-ui-express`) generating from Zod schemas.
3. Move ROI & email to `BullMQ` + `Redis` queue (reliability vs in-process cron).
4. Add `helmet` CSP, `express-mongo-sanitize` exhaustive, `xss-clean` alternative.
5. Implement password reset + email verification (`isVerified` currently unused).
6. Add `Dockerfile` + `docker-compose.yml` (app + Mongo + Redis) + GitHub Actions CI.
7. Pin Stripe API version to a stable date (e.g., `2024-06-20`) after testing.

---

*Full diff:* `git diff main...arena/01a01939-agro-investment-stripe-backend` shows ~2.5k+ lines changed across 25 files.
