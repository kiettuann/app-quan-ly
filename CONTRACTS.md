# CONTRACTS — Phase 4–7 (read before writing any module)

Single source of truth for how modules interoperate. If a contract below conflicts
with a guess, the contract wins. Do NOT change these contracts without the coordinator.

## 0. Stack / style
- Backend: Cloudflare Workers + Hono + TypeScript strict (`noUncheckedIndexedAccess`).
  DB access is RAW D1 SQL only: `c.env.DB.prepare(sql).bind(...).first<T>()` /
  `.all<T>()` / `.run()`, and `c.env.DB.batch([stmt, ...])` for multi-write atomicity.
  Do NOT add an ORM runtime. Drizzle `workers/api/src/db/schema.ts` is only the
  drizzle-kit schema (kept in sync with migrations by hand).
- Money: integer VND everywhere. Time: TEXT ISO 8601 UTC in DB, display Asia/Ho_Chi_Minh.
- IDs: `crypto.randomUUID()` from `newId()` in `workers/api/src/db.ts`.
  Timestamps: `nowIso()` from the same file.
- Response envelope: success `{ "data": ..., "meta": { page, limit, total, total_pages }? }`,
  error `{ "error": { "code", "message" } }` via `apiError()` from `@quanly/shared`.
  HTTP codes: 400 VALIDATION_ERROR (zod fail — return 400 per API_SPEC §3 table; the
  422 in §1 text is superseded by the table), 401 UNAUTHORIZED, 403 FORBIDDEN,
  404 NOT_FOUND, 409 CONFLICT, 422 UNPROCESSABLE (business-rule violation, e.g. bad
  status transition, insufficient stock, refund over paid), 429 RATE_LIMITED,
  500 INTERNAL_ERROR (never leak stack/SQL).
- Validation: zod schemas live in `workers/api/src/validation.ts` (shared by routes).
  Parse with `schema.safeParse(body)`; on failure return 400 with field list in message.
- Pagination: `?page=1&limit=20` (default 20, max 100). List endpoints return `meta`.
- Auth: every business route starts with `authMiddleware`, then `requirePermission(...)`
  (or platform-admin guard for /admin/*). Tenant context comes ONLY from `c.get("session")`
  (`SessionContext` in `@quanly/shared`): `session.tenantId` (null = Platform Admin),
  `session.role`, `session.branchIds`, `session.permissions`, `session.isPlatformAdmin`.
  NEVER trust `tenant_id`/`branch_id` from the client as tenant context — a client-sent
  `branch_id` is only a filter/scope that must be inside `session.branchIds` (Owner sees
  all branches of the tenant; others only their `user_branch_access` rows).
- Audit: every create/update/delete/status-change/payment/refund/rule/payroll action
  calls `insertAudit(db, { tenantId, userId, action, entityType, entityId, branchId?, metadata? })`
  from `workers/api/src/audit.ts`. Never log OTP, token, password.

## 1. Helpers (already written — import, do not re-implement)
- `workers/api/src/db.ts`: `newId()`, `nowIso()`, `pagination(c)` → `{page, limit, offset}`,
  `pageMeta(page, limit, total)`, `isValidUuid(v)`, `toInt(v, fallback)`.
- `workers/api/src/crypto.ts`: `hashPassword(pw)` / `verifyPassword(pw, hash)` (PBKDF2-SHA256,
  100k iterations, salt$hash), `randomToken(n=32)` (hex), `sha256Hex(s)`.
- `workers/api/src/audit.ts`: `insertAudit(db, input)` (one prepared statement, reuse in batch).
- `workers/api/src/roles.ts`: `ROLE_PERMISSIONS: Record<RoleName, PermissionKey[]>` and
  `rolePermissionsFor(role)`; `SYSTEM_ROLE_IDS` fixed ids used by migration 0002 seed.
- `workers/api/src/auth.ts`: `authMiddleware` (loads role name + permissions + branchIds;
  Platform Admin has tenantId null, role `platform_admin`), `hashToken`, `createSession(db, userId, days=7)`,
  `revokeSession(db, tokenHash)`, `requirePlatformAdmin` middleware.
- `workers/api/src/rate-limit.ts`: `checkRateLimit(key, max, windowMs)` (in-memory per isolate;
  best effort — document the limitation in PHASES_PROGRESS.md).
- `packages/shared/src/commission.ts`: `CommissionRuleInput`, `calculateCommissions(items, rules, atIso)`
  → per-item breakdown `{ invoiceItemId, employeeId, ruleId, ruleVersionId, amountVnd }` + total.
  Rule matching: scope service/product/employee/role/branch/sales_tier; first matching rule
  per item wins, rules sorted by `priority` asc then `created_at` asc; percent = rateValue % of
  item line total; fixed = rateValue VND per item line (not per unit); `max_amount_vnd` caps the
  rule total per invoice; rule applies only when `valid_from <= at < valid_to` (or valid_to null)
  and `status='active'` and (min_sales_vnd null or invoice subtotal >= min_sales_vnd).
- `packages/shared/src/inventory.ts`: `checkStockAvailable(stock, qty)`, `movementQuantity(type, qty)`.
- `packages/shared/src/validation.ts` (in shared): zod helpers `vndInt`, `phoneVn`, `isoDateTime`.

## 2. Tables (migration 0002 — `workers/api/drizzle/0002_business.sql`)
All business tables have `tenant_id TEXT NOT NULL` (+ `branch_id` where the schema says so),
`created_at`/`updated_at` TEXT ISO. Column names are snake_case in SQL; use `AS alias` in
SELECTs to get camelCase in TS (pattern: `SELECT id, tenant_id AS tenantId, ...`).
Full column lists are in `DATABASE_SCHEMA.md` §3–§8 plus these additions:
- `email_otp_challenges` (id, email, otp_hash, purpose, expires_at, attempts, max_attempts=5,
  resend_after, created_at) — staff Email OTP login.
- `password_resets` (id, user_id, token_hash, expires_at, used_at, created_at).
- `invoices.status` also allows `partially_refunded` (derived: refunded>0 and refunded<paid).
  `refunds.status`: `completed`.
- `commission_calculations.status`: pending | confirmed | paid | reversed.
- `payroll_periods.status`: draft | calculating | confirmed | paid.
- Seed (idempotent INSERT OR IGNORE) in 0002: 26 permission rows (id `perm_<key>`),
  6 system roles (ids in `roles.ts` SYSTEM_ROLE_IDS), plan `plan_basic` ("Cơ bản", 0đ,
  3 branches, 10 users, 500 bookings/month).
- `users.password_hash` is NOT NULL: invited users get a random unusable hash
  (`hashPassword(randomToken())`); they set a real password via reset flow.

## 3. Route files (one file per module, mounted in `workers/api/src/index.ts`)
- `workers/api/src/routes/auth.ts` — POST /auth/login, /auth/logout, /auth/forgot-password,
  /auth/reset-password, GET /auth/me, POST /auth/otp/send, POST /auth/otp/verify,
  POST /tenants (public registration), GET /tenants/me.
- `workers/api/src/routes/branches.ts` — GET/POST /branches, GET/PATCH/DELETE /branches/:id.
- `workers/api/src/routes/users.ts` — GET/POST /users, GET/PATCH /users/:id,
  GET /roles, POST /roles, GET/PATCH /roles/:id, GET /permissions.
- `workers/api/src/routes/services.ts` — service categories + services + branch settings.
- `workers/api/src/routes/customers.ts` — GET/POST/PATCH/DELETE (soft) /customers, GET /customers/:id.
- `workers/api/src/routes/bookings.ts` — GET/POST /bookings, GET/PATCH /bookings/:id,
  POST /bookings/:id/status, POST /bookings/:id/cancel, GET /bookings/availability.
- `workers/api/src/routes/invoices.ts` — POST /invoices (from booking or manual),
  GET /invoices, GET /invoices/:id, POST /invoices/:id/payments, POST /invoices/:id/refunds,
  POST /invoices/:id/void, POST /bookings/:id/create-invoice (Phase 5).
- `workers/api/src/routes/commission.ts` — GET/POST /commission/rules,
  POST /commission/rules/:id/versions, GET /commission/calculations, POST /commission/calculations/:id/confirm,
  POST /commission/simulate, GET /commission/me.
- `workers/api/src/routes/employees.ts` — GET/POST/PATCH /employees, attendance check-in/out,
  GET /attendance, shifts GET/POST.
- `workers/api/src/routes/payroll.ts` — POST /payroll/periods, POST /payroll/periods/:id/calculate,
  POST /payroll/periods/:id/confirm, POST /payroll/periods/:id/mark-paid,
  GET /payroll/periods, GET /payroll/periods/:id, GET /payroll/me.
- `workers/api/src/routes/inventory.ts` — product categories, products, stock movements,
  purchase orders (+ receive), GET /inventory/low-stock.
- `workers/api/src/routes/expenses.ts` — expense categories + expenses.
- `workers/api/src/routes/reports.ts` — GET /reports/overview, /reports/revenue, /reports/profit,
  /reports/top-services, /reports/staff-performance.
- `workers/api/src/routes/public.ts` — GET /public/branches, /public/services, /public/availability,
  POST /public/bookings, GET /public/my-bookings?phone= (phone is the identifier; no SMS OTP in MVP).
- `workers/api/src/routes/admin.ts` — GET /admin/tenants, /admin/tenants/:id, /admin/plans,
  POST /admin/plans, /admin/subscriptions, /admin/audit-logs, POST /admin/support-access.
Each route file exports `export const <name>Routes = new Hono<{ Bindings: Env; Variables: { session: SessionContext } }>()`
and is mounted in `index.ts` as `app.route("/api/v1", <name>Routes)`.

## 4. Business rules that must hold (tests will check them)
- Booking create: server computes `end_at` from service durations; snapshots price/name/duration
  per item from `services` (+ branch override); conflict check = same technician, overlapping
  [start,end), status in BOOKING_ACTIVE_STATUSES → 409 `CONFLICT` ("Lịch đã trùng...").
  Technician null = system-assigned: pick any employee of the branch with no conflict (first by
  created_at); if none, 409. Status transitions only via BOOKING_TRANSITIONS, else 422, and every
  transition writes `booking_status_history`. `completed` only from `in_service`.
- Invoice: `total = subtotal − discount + surcharge` (integer, via `calculateInvoiceTotal`);
  items snapshot price/name; product items check stock and write `stock_movements` type `sale`
  in the same batch; insufficient stock → 422. Payment: amount>0, paid≤total; status derived via
  `deriveInvoiceStatus`; when status becomes `paid` → create commission calculations (pending)
  from active rules (snapshot rule_version_id) and update customer total_spent/total_visits.
  Refund: amount ≤ paid−refunded; invoice status → `partially_refunded`/`refunded`; related
  pending commission calculations → `reversed`; audit log. Paid invoice is never edited in place.
- Commission: rules versioned — creating a version snapshots the rule JSON into
  `commission_rule_versions` and bumps `commission_rules.version`; calculations always store
  the `rule_version_id` used; changing a rule never recomputes old calculations.
- Payroll: `net = base + commission(confirmed in period) + bonus + allowance − deduction − advance`
  via `calculatePayrollNet`; `paid` period is immutable (any PATCH → 422); confirm requires
  status draft/calculating; mark-paid requires confirmed.
- Inventory: every stock change writes a `stock_movements` row; `products.stock_quantity` is a
  cached sum updated in the same batch; never negative.
- Reports: revenue = SUM(payments.amount) in period for paid/partially_paid invoices;
  profit = revenue − SUM(expenses.amount) in period (state the formula in the response meta note);
  top-services from invoice_items; staff-performance from invoice_items technician + commission.
- Tenant isolation: every query filters `tenant_id = session.tenantId`; single-record fetch
  returns 404 (not 403) when the record belongs to another tenant (do not leak existence);
  branch filter outside `session.branchIds` → 403.

## 5. Frontend contracts (apps/web)
- API client: `apps/web/src/lib/api.ts` — `api<T>(path, {method, body, token?})`, token from
  `localStorage("ql_token")`, base `import.meta.env.VITE_API_URL ?? "http://localhost:8787"`.
  On 401 → clear token, redirect `/dang-nhap`. All pages use TanStack Query for lists.
- Auth: `apps/web/src/lib/auth.tsx` — AuthContext `{ token, user, login, logout }`, route guard
  in `App.tsx` (all routes except `/dang-nhap`, `/quen-mat-khau`, `/dang-ky` require login).
  Login page stores token on success and navigates to `/`. Register page creates tenant+owner.
- Design: tokens from DESIGN_SYSTEM.md only (Navy #244B70, Blue #3979A8, bg #F7F7F5, border
  #E5E9ED, text #203247 / #748294). Vietnamese labels. No fake data: loading/empty/error states
  on every page. Deposit/payment buttons show "Sắp ra mắt" and do nothing else.
- Routes: `/` Tổng quan, `/lich-hen`, `/ban-hang`, `/nhan-su`, `/dich-vu`, `/khach-hang`,
  `/kho-hang`, `/cham-cong`, `/hoa-hong`, `/bang-luong`, `/chi-phi`, `/bao-cao`, `/chi-nhanh`,
  `/cai-dat`, `/goi-dich-vu`, `/dang-nhap`, `/quen-mat-khau`, `/dang-ky`. Drawer items link to
  these routes (no "Sắp có" labels anymore, except "Gói dịch vụ" upgrade button = "Sắp ra mắt").

## 6. Frontend contracts (apps/booking, apps/admin)
- Both are standalone Vite + React + TS apps (copy `apps/web` package.json deps minus
  @tanstack/react-query? keep it — reuse the same dep set; own vite.config, tsconfig, index.html,
  manifest). No react-router needed for booking (step state); admin uses react-router.
- Booking flow: branch → services → technician (or "Hệ thống tự chọn") → date → time slot
  (from GET /public/availability) → phone → review → confirm. Deposit step shows "Sắp ra mắt".
  "Lịch của tôi": phone lookup → list own bookings, cancel own booking per policy (only pending/confirmed).
- Admin: login with platform_admin account; pages Tenants, Plans, Subscriptions, Audit logs,
  Support access (creates audit log, shows tenant summary only — never business data).

## 7. Tests (Phase 6)
- Pure logic: `packages/shared/src/*.test.ts` (commission, inventory, reports math, validation).
- API integration: `workers/api/src/api.test.ts` — real Hono app + real SQLite via
  `workers/api/src/test-d1.ts` (node:sqlite adapter implementing the D1 subset used:
  prepare/bind/first/all/run/batch). Runs migrations 0001+0002 SQL files against it, then
  exercises the full flow end-to-end plus isolation/RBAC/validation cases from
  IMPLEMENTATION_PLAN.md §5. No mocked business logic.
- `npm test`, `npm run typecheck`, `npm run lint`, web/booking/admin builds must all pass.
