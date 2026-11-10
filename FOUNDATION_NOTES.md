# FOUNDATION_NOTES — Phase 3 Foundation (local only)

Ngày: 2026-11-10. Môi trường: Node v24.22.1, npm 10.9.4, Wrangler 4.159.0.
KHÔNG push GitHub, KHÔNG deploy Cloudflare, KHÔNG secret thật.

## Quyết định OTP đã áp dụng (Kalvin chốt 10/11/2026)

- **Email OTP miễn phí qua Resend là kênh chính** cho đăng nhập chủ tiệm / nhân viên.
  Tham chiếu free tier: 3.000 email/tháng, tối đa 100/ngày. Chỉ placeholder
  `RESEND_API_KEY=` trong `.env.example`; key thật đặt bằng
  `wrangler secret put RESEND_API_KEY`, không hardcode, không commit.
- `EmailOtpSender` trong `packages/shared/src/otp.ts`: gửi qua Resend API bằng
  fetch; thiếu key thì throw lỗi cấu hình rõ ràng, không giả vờ đã gửi.
- **SMS OTP giữ dạng stub** (`SmsOtpSender` throw "chưa được cấu hình") để cắm
  provider sau. Khách đặt lịch online trong MVP: giữ SĐT làm định danh,
  chưa gửi OTP SMS.
- OTP: hash SHA-256, hết hạn 5 phút, tối đa 5 lần nhập sai, gửi lại sau 60 giây,
  tối đa 5 lần gửi/giờ. Không log OTP, không lưu plaintext.

## Đã làm xong

- Monorepo scaffold: workspaces `apps/*`, `workers/*`, `packages/*`; TS strict
  (`noUncheckedIndexedAccess`); ESLint flat; `.env.example`; `.gitignore`; README;
  GitHub Actions CI (typecheck + lint + test + web build).
- `workers/api`: Hono app, `/api/v1/health`, auth middleware (Bearer token ->
  tra `sessions` bằng token hash, kiểm tra hết hạn/revoke, nạp tenant/branch
  context), RBAC helper, error chuẩn, không lộ stack/SQL. Login thật và OTP
  endpoint thật làm ở Phase 4 — hiện trả lỗi rõ ràng, không giả vờ.
- Drizzle schema + migration `0001_identity_saas.sql`: 12 bảng Identity & SaaS
  (tenants, branches, users, user_tenants, roles, permissions, role_permissions,
  user_branch_access, sessions, audit_logs, plans, subscriptions), integer VND,
  UTC TEXT, index tenant_id/branch_id.
- `apps/web`: Vite React shell, routing, bottom nav 5 mục + drawer 11 mục theo
  DESIGN_SYSTEM.md, login page gọi API thật (hiện lỗi thật), các trang chỉ có
  empty state trung thực, nút "Thu tiền cọc" hiện "Sắp ra mắt" (không logic
  thanh toán). Manifest PWA có sẵn; service worker chưa làm.
- `packages/shared`: booking transitions + overlap, invoice total/payroll net,
  tenant/branch guard, permission keys, OTP abstraction, error codes.
- `apps/booking`, `apps/admin`: stub + README, làm ở Phase 4 / sau MVP.

## Kết quả kiểm tra (lệnh thật, chạy local)

| Lệnh | Kết quả |
|---|---|
| `npm install --no-audit --no-fund` | PASS — 337 packages (cảnh báo deprecated eslint 9.39.5, không lỗi) |
| `npm test` | PASS — 17/17 test (tenant isolation, booking transition/overlap, invoice/payroll, OTP hash/expiry/rate-limit, Email OTP thiếu key, SMS stub) |
| `npm run typecheck` | PASS — exit 0 (đã sửa: vite web 6 -> 7.3.8 để khớp 1 bản vite duy nhất; thêm `vite/client` types cho `import.meta.env`) |
| `npm run lint` | PASS — 0 error, 0 warning (đã sửa 1 lỗi unused var ở SMS stub) |
| `npm run build --workspace=@quanly/web` | PASS — vite build 3.87s, `dist/index.html` 0.53 kB, JS 289.78 kB (gzip 90.69 kB) |
| `sqlite3 /tmp/quanly-test.db < workers/api/drizzle/0001_identity_saas.sql` + `.tables` + `PRAGMA foreign_key_check` | PASS — tạo đủ 12 bảng, FK check không lỗi |
| `npx wrangler deploy --dry-run` (trong `workers/api`) | PASS — upload 65.14 KiB, nhận đủ bindings DB (D1), FILES (R2), OTP_SENDER="email", EMAIL_FROM, OTP_DEV_MODE="false" |

Lưu ý: 1 test fail ban đầu do lỗi logic trong test (`isOtpExpired` truyền
`expiresAt` quá khứ) — đã sửa test, không sửa logic OTP; sau đó 17/17 pass.

## Cập nhật 2026-11-10 (sau khi Kalvin gửi database_id)

- `database_id = "b61411fd-1dbd-4ff0-80f0-c442ac48d683"` đã điền vào
  `workers/api/wrangler.toml` và `D1_DATABASE_ID` trong `.env.example`.
- Phát hiện và sửa: Wrangler mặc định tìm migration ở `./migrations`, còn
  migration Drizzle nằm ở `./drizzle` — đã thêm `migrations_dir = "drizzle"`
  vào `[[d1_databases]]` trong `wrangler.toml`.
- `wrangler d1 migrations apply DB --local` PASS: 0001_identity_saas.sql
  ✅, 23 commands executed, kiểm tra lại bằng `d1 execute` thấy đủ các bảng
  (tenants, users, roles, sessions, subscriptions, user_tenants,
  user_branch_access, ...). `npm test` vẫn 17/17 pass sau thay đổi.

## Chưa kiểm tra / chưa làm (ghi rõ, không giấu)

- `wrangler d1 migrations apply DB --remote` CHƯA chạy: cần đăng nhập tài
  khoản Cloudflare của Kalvin bằng Wrangler (Muse không có quyền Cloudflare).
  Chạy remote sau khi push code lên repo và Kalvin đăng nhập Wrangler.
- `wrangler dev` (API chạy thật) CHƯA chạy vì cùng lý do D1 id.
- Đăng nhập thật (hash mật khẩu, tạo session, reset password) CHƯA làm — Phase 4.
- Gửi Email OTP thật CHƯA thử: chưa có RESEND_API_KEY thật (chưa tạo tài khoản
  Resend / chưa có key). Code chỉ gọi Resend API khi có key.
- Service worker PWA CHƯA làm (mới có manifest). Icon PWA 192/512 chưa có file thật.
- Visual QA (mở web trên trình duyệt, chụp mobile/desktop) CHƯA làm.
- Chưa push, chưa deploy — chờ repo tồn tại.

## Sẵn sàng để push khi repo tồn tại

Toàn bộ thư mục `code/` (trừ `node_modules/`, `dist/`, `*.tsbuildinfo`) push lên
`kiettuann/quanly-store` nhánh `main`. Sau đó làm theo README.md § Deploy.

## Còn cần Kalvin

1. Tạo repo `kiettuann/quanly-store` (private) trên GitHub + gắn vào Muse GitHub App.
2. Tạo D1 `quanly-store-db` + R2 bucket `quanly-store-files` trên Cloudflare,
   điền `database_id` vào `workers/api/wrangler.toml`.
3. Tạo tài khoản Resend + `wrangler secret put RESEND_API_KEY` (+ `SESSION_SECRET`)
   khi tới bước test Email OTP thật. Lưu ý giới hạn free tier 100 email/ngày.
4. Tên miền: dùng tạm tên miền random Cloudflare (quanly.store chưa mua).
