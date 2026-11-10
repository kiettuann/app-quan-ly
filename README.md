# quanly.store — SaaS quản lý tiệm nail (multi-tenant, thị trường Việt Nam)

> Trạng thái: **Phase 3 — Foundation**. Scaffold + auth/tenant guard + migration 0001
> + test nền tảng. Chưa có module nghiệp vụ (booking, POS, hoa hồng... — Phase 4).
> Chưa push lên GitHub (repo `kiettuann/quanly-store` private chưa được tạo — Kalvin
> tạo tay trên GitHub), chưa deploy Cloudflare.

Tài liệu Blueprint (Phase 2) ở `../files/`: PRD, ARCHITECTURE, DATABASE_SCHEMA,
PERMISSIONS, API_SPEC, DESIGN_SYSTEM, UX_FLOWS, IMPLEMENTATION_PLAN.

## Quyết định đã chốt

- PWA, mobile-first, light theme. Navy `#244B70`, Blue `#3979A8`, nền `#F7F7F5`.
- Frontend: React + TS + Vite, React Router, Tailwind, TanStack Query,
  React Hook Form + Zod, Lucide. Backend: Cloudflare Workers + Hono + TS + Drizzle.
  DB: Cloudflare D1 (SQLite). File: R2.
- Tiền integer VND, thời gian lưu UTC, hiển thị Asia/Ho_Chi_Minh.
- Tên miền `quanly.store` chưa mua — dùng tạm tên miền random của Cloudflare
  (`*.pages.dev` / `*.workers.dev`) khi deploy.
- Tiền cọc / thanh toán online: **chỉ hiển thị "Sắp ra mắt" trong MVP**,
  không có logic thanh toán.
- **OTP: Email OTP miễn phí qua Resend** (free tier 3.000 email/tháng, tối đa
  100/ngày) — kênh chính cho đăng nhập chủ tiệm / nhân viên. SMS OTP chỉ là
  stub trong abstraction để cắm provider sau. Khách đặt lịch online trong MVP:
  giữ SĐT làm định danh, chưa gửi OTP SMS. OTP chỉ lưu dạng hash, hết hạn
  5 phút, tối đa 5 lần nhập sai, gửi lại sau 60 giây, không log OTP.

## Cấu trúc

```
apps/web/       Owner/Management App — shell + routing + bottom nav + drawer + login
apps/booking/   Customer Booking Website — stub, Phase 4
apps/admin/     Platform Admin — stub, sau MVP
workers/api/    Hono API: health, auth middleware, RBAC helper, tenant guard
packages/shared/ Types, Zod, booking/invoice/tenant/OTP logic + test
drizzle/        (trong workers/api) migration 0001 — Identity & SaaS
```

## Chạy local

```bash
npm install
npm test            # vitest — test tenant isolation, booking, invoice, OTP
npm run typecheck   # tsc -b
npm run dev:web     # http://localhost:5173
npm run dev:api     # wrangler dev — cần D1 local (xem dưới)
```

## D1 local (chưa chạy ở Phase 3 — cần wrangler + D1 id)

```bash
wrangler d1 create quanly-store-db
# điền database_id vào workers/api/wrangler.toml
npm run db:migrate:local --workspace=@quanly/api
```

## Deploy (thủ công, sau khi repo tồn tại)

1. Kalvin tạo repo `kiettuann/quanly-store` (private) trên GitHub, gắn repo vào
   ứng dụng GitHub của Muse.
2. Push code này lên `main` (mỗi push cần Kalvin duyệt).
3. Cloudflare: tạo D1 `quanly-store-db`, R2 bucket `quanly-store-files`,
   Workers `quanly-store-api` — điền `database_id` vào `wrangler.toml`.
4. Đặt secret (không commit):
   ```bash
   wrangler secret put SESSION_SECRET
   wrangler secret put RESEND_API_KEY   # Email OTP — tạo key trên resend.com
   ```
5. `wrangler deploy` (API) + deploy `apps/web` lên Cloudflare Pages/Workers Assets
   với tên miền random tạm thời. Kiểm tra URL live trả đúng nội dung mới gọi là xong.

## Nguyên tắc không vi phạm

- Tenant context lấy từ phiên đã xác minh, không tin `tenant_id` client gửi.
- Mọi tính tiền ở backend, integer VND. Không dữ liệu giả, không nút giả.
- Không log OTP, token, mật khẩu. Không commit secret.
