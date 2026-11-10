# PHASES_PROGRESS — quanly.store (cập nhật 2026-11-10)

> Tài liệu tiến độ duy nhất — thay thế `FOUNDATION_NOTES.md` (Phase 3).
> Local only: **KHÔNG push GitHub, KHÔNG deploy, KHÔNG secret thật.**
> Môi trường: Node v24.22.1, npm 10.9.4, Wrangler 4.159.0.

## Kết quả xác minh (2026-11-10, sau Phase 4–7)

| Kiểm tra | Kết quả |
|---|---|
| `npm test` | **50/50 pass** (17 Phase 3 + 13 shared mới + 20 API e2e) |
| `npm run typecheck` | sạch, 0 lỗi |
| `npm run lint` | 0 lỗi, 3 warning (console.log trong `scripts/create-platform-admin.mjs` — CLI, cố ý) |
| Build `apps/web` | pass — 437 kB JS (121 kB gzip) |
| Build `apps/booking` | pass — 261 kB JS (78 kB gzip) |
| Build `apps/admin` | pass — 327 kB JS (100 kB gzip) |
| `wrangler d1 migrations apply DB --local` | pass — 0001 + 0002 (83 lệnh) |
| `wrangler deploy --dry-run` | pass — 498.58 KiB, bindings DB + FILES |
| Test API e2e thật | Hono thật + SQLite thật, migration thật, không mock |

## Phase 1 — Discovery ✅ (2026-11-10)

Node/npm/Wrangler/git, GitHub `kiettuann` đã kết nối, repo `kiettuann/App-Quan-Ly`
(public, `main`) làm repo chính sau khi tạo repo riêng thất bại 403.
Domain `quanly.store` chưa mua — dùng domain random Cloudflare tạm.

## Phase 2 — Blueprint ✅ (2026-11-10)

8 tài liệu trong `../files/`: PRD, ARCHITECTURE, DATABASE_SCHEMA, PERMISSIONS,
API_SPEC, DESIGN_SYSTEM, UX_FLOWS, IMPLEMENTATION_PLAN. Xem thêm `CONTRACTS.md`
trong `code/` (quy ước tích hợp duy nhất: raw D1 SQL, envelope `{data}` /
`{error:{code,message}}`, pagination, tenant từ session).

## Phase 3 — Foundation ✅ local (2026-11-10)

Monorepo `apps/*`, `workers/*`, `packages/*`; Hono API + auth/tenant middleware;
migration `0001_identity_saas.sql` (12 bảng Identity & SaaS); React shell;
`packages/shared` (booking/invoice/payroll math, OTP abstraction).
**Chưa push, chưa deploy** — Kalvin/bên khác phụ trách git.

## Phase 4 — Core Modules ✅ local (2026-11-10)

- **(1) Auth + tenant onboarding:** đăng ký tenant (owner + chi nhánh đầu +
  trial 14 ngày), login PBKDF2-SHA256 100k vòng, session token hash, logout
  revoke, quên/đặt lại mật khẩu (link 1 giờ, email wording riêng — không dùng
  chung template OTP), Email OTP qua Resend abstraction (chưa có key thật),
  SMS chỉ là stub. `scripts/create-platform-admin.mjs` tạo Platform Admin.
- **(2) Org/branch:** CRUD chi nhánh, trạng thái, giờ làm việc.
- **(3) Users/roles/permissions:** 26 quyền seed, 6 role hệ thống (owner,
  branch_manager, receptionist, technician, accountant, platform_admin),
  role tùy chỉnh, mời nhân viên, phân quyền theo chi nhánh, `GET /permissions`.
- **(4) Services:** danh mục, dịch vụ (giá snapshot, thời lượng), giá theo
  chi nhánh (override), sản phẩm.
- **(5) Booking:** tạo (server tự tính tổng + giờ kết thúc), xung đột 409
  (cùng KTV), availability theo giờ VN (08:00–20:00), chuyển trạng thái theo
  đúng chuỗi (sai → 422), hủy/no-show, ngày nghỉ KTV.
- **(6) Customers:** CRUD, trùng SĐT trong tenant → 409, lịch sử, tổng chi.
- **(7) POS/invoice:** tạo từ booking (chỉ khi completed, chống tạo trùng 409)
  hoặc hóa đơn tay, snapshot giá, tồn kho trừ theo số lượng (vượt tồn → 422),
  thanh toán từng phần, hoàn tiền (Branch Manager giới hạn 500.000đ — đề xuất
  trong PERMISSIONS.md §5, **Kalvin chưa xác nhận**), void.
- **(8) Commission:** rule kết hợp (service/product/employee/role/branch/
  sales_tier), ưu tiên, giới hạn tối đa, simulator, version snapshot (v1 khi
  tạo rule), tính khi hóa đơn chuyển sang paid, confirm/reverse khi refund.
- **(9) Employee + attendance:** CRUD nhân viên, check-in/out (trùng → 409),
  trễ sau 09:00 VN, ca làm việc.
- **(10) Payroll:** kỳ lương, tính (lương cơ bản + hoa hồng đã confirm −
  khấu trừ), điều chỉnh, chốt, đánh dấu đã trả; sau khi trả thì không tính
  lại (422).
- **(11) Inventory:** sản phẩm, danh mục, nhà cung cấp, đơn mua hàng,
  nhập/xuất kho, cảnh báo tồn thấp, **không cho tồn âm**.
- **(12) Expenses + reports:** danh mục chi, chi phí, báo cáo tổng quan /
  doanh thu / lợi nhuận / top dịch vụ / hiệu suất nhân viên.
- **(13) Customer booking website (`apps/booking`, port 5174):** xem chi nhánh
  / dịch vụ / slot (giờ VN) → đặt bằng SĐT → tra cứu + hủy bằng SĐT.
- **(14) Platform Admin (`apps/admin`, port 5175):** xem/suspend/activate
  tenant, gói + đăng ký, audit logs, hỗ trợ (chỉ tóm tắt tenant, **không**
  dữ liệu nghiệp vụ).
- **Frontend `apps/web`:** 15 trang được bảo vệ + login/register/forgot/reset,
  gọi API thật; nút nạp tiền/hiển thị thanh toán ghi rõ "Sắp ra mắt".

## Phase 5 — Integration ✅ (đã kiểm chứng bằng test API e2e)

- Booking completed → tạo hóa đơn (tổng 200.000đ, số `HD-2026-0001`).
- Invoice paid → hoa hồng 20.000đ (rule 10%) + cập nhật tổng chi khách.
- Hóa đơn tay: 2 sản phẩm → tồn 10 → 8; nhập kho +5 → 13.
- Refund 50.000đ → hóa đơn `partially_refunded`, hoa hồng pending bị reversed.
- Commission confirmed → cộng vào payroll (net 5.020.000đ).
- Mọi mutation đều ghi audit log; tenant isolation + branch scope kiểm chứng.

## Phase 6 — Testing ✅ (2026-11-10)

- `workers/api/src/api.test.ts` — 20 test e2e trên app Hono thật + SQLite thật:
  đăng ký/login (sai 401), validation 400, booking conflict 409, trạng thái
  sai 422, availability, hóa đơn/thanh toán/hoàn tiền, tồn kho, báo cáo,
  chấm công, payroll, public booking, tenant A vs B (404/403), RBAC lễ tân
  hoàn tiền 403, OTP dev-mode (sai 401, đúng login được), session hết hạn
  401, logout revoke 401, Platform Admin (đăng nhập, xem tenants, không đọc
  business 403), route lạ 404.
- `packages/shared`: 30 test (tenant isolation, booking overlap, invoice/
  payroll math, commission engine, inventory, OTP).
- **2 bug thật tìm ra và sửa trong lúc test:**
  1. Hono `use("*", authMiddleware)` ở 8 route file bị leak sang cả route
     public (`/public/*` trả 401) và chặn route lạ thành 403 thay vì 404.
     Sửa: middleware gắn theo từng tiền tố (`use("/commission", …)` +
     `use("/commission/*", …)`). Lưu ý: Hono 4.13 `use()` chỉ nhận ĐÚNG 1
     chuỗi path (không nhận nhiều path, không nhận array).
  2. Availability nội bộ (`bookings.ts`) tính slot theo giờ UTC trong khi
     booking lưu theo giờ VN — slot 09:00 VN hiển thị trống dù đã có lịch.
     Sửa: slot + cửa sổ ngày tính theo `+07:00` (đã khớp với `public.ts`).

## Phase 7 — Deployment prep ✅ (chỉ chuẩn bị, KHÔNG deploy)

- `wrangler.toml` đã có D1 id + R2 bucket; `migrations_dir = "drizzle"`.
- `wrangler d1 migrations apply DB --local` pass; `wrangler deploy --dry-run` pass.
- `DEPLOY.md`: từng bước push → migration remote → secret → Platform Admin →
  deploy API → deploy 3 Pages app → kiểm chứng → rollback.
- PWA `apps/web`: icon 192/512 thật (Navy #244B70 + chữ Q trắng — placeholder,
  Kalvin có thể gửi logo thật để thay), service worker (cache app shell,
  không cache `/api/*`), manifest đã có maskable 512.

## Chưa làm / chưa xác minh — nói thẳng

- **Chưa chạy thật trên Cloudflare:** không có lần chạy API nào trên D1/R2
  thật; chưa deploy; chưa chạy remote migration.
- **Chưa gửi Email OTP thật:** chưa có `RESEND_API_KEY` (chưa tạo tài khoản
  Resend); chỉ test ở dev-mode.
- **Chưa QA giao diện bằng trình duyệt thật:** build pass + typecheck/lint
  sạch, nhưng chưa ai mở web/booking/admin trên trình duyệt để bấm thử.
  PWA service worker + icon chưa test cài đặt trên điện thoại thật.
- **Rate limit chỉ là in-memory theo từng Worker isolate** (best-effort,
  không phải giới hạn toàn cục).
- **Tra cứu booking online chỉ cần SĐT** (yếu — ai biết SĐT cũng xem/hủy
  được; đã ghi rõ trong code + DEPLOY, chưa có giải pháp thay thế).
- **Báo cáo doanh thu = SUM(payments), chưa trừ tiền hoàn.** Ví dụ test:
  thu 600.000đ, hoàn 50.000đ, báo cáo vẫn ghi doanh thu 600.000đ (lãi
  100.000đ sau khi trừ chi phí 500.000đ). Cần Kalvin quyết: doanh thu báo
  cáo tính gộp hay trừ hoàn.
- **Void hóa đơn không hoàn tồn kho** (không có quy tắc trong blueprint).
- **Trial 14 ngày** và **giới hạn hoàn tiền 500.000đ của Branch Manager**
  là quyết định kỹ thuật nội bộ, Kalvin chưa xác nhận.
- **Icon PWA là placeholder** (chữ Q trắng trên nền navy); Kalvin có thể
  gửi logo thật.

## Còn cần Kalvin (theo thứ tự)

1. Push code lên `kiettuann/App-Quan-Ly` (main) — hoặc nhờ bên khác.
2. `wrangler d1 migrations apply DB --remote` (sau khi backup D1).
3. `wrangler secret put SESSION_SECRET` (bắt buộc) và `RESEND_API_KEY`
   (sau khi tạo tài khoản/key Resend).
4. Tạo tài khoản Platform Admin (`scripts/create-platform-admin.mjs`).
5. Duyệt deploy: `wrangler deploy --env production` + 3 Pages app
   (`VITE_API_URL` trỏ về Worker URL).
6. Quyết: doanh thu báo cáo có trừ tiền hoàn không; giới hạn hoàn tiền
   Branch Manager 500.000đ có giữ không; trial 14 ngày có giữ không;
   có gửi logo thật để thay icon PWA không.
7. Mua/gắn domain `quanly.store` khi sẵn sàng.
