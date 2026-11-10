# DEPLOY.md — quanly.store (Phase 7, chuẩn bị triển khai)

> Chỉ là hướng dẫn triển khai — **chưa deploy thật**. Mọi lệnh remote/D1/deploy
> đều do Kalvin (hoặc người được Kalvin chỉ định) chạy trên máy đã đăng nhập
> Cloudflare, vì Ember không có Cloudflare connector và không được chạy
> `wrangler deploy` hay lệnh remote.
>
> Đã xác minh local ngày 2026-11-10: `npm test` 50/50, `npm run typecheck` sạch,
> `npm run lint` 0 lỗi, build web/booking/admin đều pass,
> `wrangler d1 migrations apply DB --local` (0001+0002, 83 lệnh) pass,
> `wrangler deploy --dry-run` pass (498.58 KiB, bindings DB + FILES).

## 0. Trước khi bắt đầu

- [ ] Code đã lên GitHub: repo **`kiettuann/App-Quan-Ly`**, branch `main`
      (Kalvin/bên khác phụ trách push — Muse bị chặn 403 ở bulk push).
- [ ] Đã đăng nhập Cloudflare trên máy deploy: `npx wrangler login`
      (hoặc `wrangler whoami` xác nhận đúng tài khoản).
- [ ] D1 `quanly-store-db` (`b61411fd-1dbd-4ff0-80f0-c442ac48d683`) và R2
      `quanly-store-files` đã tồn tại (Kalvin đã tạo cả hai ngày 2026-11-10).
- [ ] Tên miền `quanly.store` **chưa mua** — deploy tạm bằng domain random
      `*.workers.dev` / `*.pages.dev`, gắn domain thật sau.

## 1. Áp migration lên D1 thật (remote)

Chạy từ `code/workers/api/`:

```bash
cd code/workers/api
npx wrangler d1 migrations apply DB --remote
```

Kiểm chứng: `npx wrangler d1 execute DB --remote --command "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name;"`
phải thấy đủ bảng 0001 (12 bảng Identity & SaaS) + 0002 (business: services,
bookings, invoices, commission_*, employees, payroll, products, expenses,
reports views...).

> Migration chỉ đi tới, **không có down-migration**. Sai sót thì khôi phục bằng
> backup D1 trên Cloudflare Dashboard (xem §6 Rollback).

## 2. Đặt secret (bắt buộc trước khi deploy)

```bash
cd code/workers/api
# Khóa ký session — tạo ngẫu nhiên, tối thiểu 32 byte, KHÔNG commit vào git:
openssl rand -base64 32 | npx wrangler secret put SESSION_SECRET
# Email OTP (Resend) — chỉ đặt SAU KHI tạo key thật trên resend.com.
# Chưa có key thì BỎ QUA bước này: đăng nhập bằng mật khẩu vẫn chạy,
# chỉ tính năng "đăng nhập bằng mã OTP email" báo lỗi gửi mail.
npx wrangler secret put RESEND_API_KEY
```

Kiểm tra: `npx wrangler secret list`. **Không** đặt secret vào `.env`,
`wrangler.toml` hay bất kỳ file nào trong repo.

## 3. Tạo tài khoản Platform Admin (quản trị nền tảng)

```bash
cd code
node scripts/create-platform-admin.mjs --email admin@quanly.store
# Script in ra câu lệnh SQL INSERT (mật khẩu đã hash PBKDF2) — chạy bằng:
npx wrangler d1 execute DB --remote --file <file-sql-duoc-in-ra>
```

Tài khoản này có `tenant_id = NULL`, chỉ dùng để vào app Admin
(`apps/admin`): xem tenant, gói, đăng ký; **không** đọc dữ liệu nghiệp vụ
của tenant (đã kiểm chứng bằng test: customer của tenant A trả 403).

## 4. Deploy API (Workers)

```bash
cd code/workers/api
npx wrangler deploy --env production
# -> https://quanly-store-api-production.<subdomain>.workers.dev
```

Kiểm chứng:

```bash
curl https://<worker-url>/api/v1/health
# {"data":{"status":"ok","environment":"production"}}
```

> `OTP_DEV_MODE` trong `wrangler.toml` đang là `"false"` — giữ nguyên ở
> production. Nếu để `"true"`, mã OTP sẽ lộ qua API (chỉ dùng ở dev local).

## 5. Deploy 3 web app (Cloudflare Pages)

Mỗi app build bằng Vite, trỏ về API qua biến `VITE_API_URL` (lúc build).

| App | Thư mục | Build | Output |
|---|---|---|---|
| Web quản lý (nhân viên/chủ tiệm) | `apps/web` | `npm run build --workspace=@quanly/web` | `apps/web/dist` |
| Đặt lịch online (khách) | `apps/booking` | `npm run build --workspace=@quanly/booking` | `apps/booking/dist` |
| Admin nền tảng | `apps/admin` | `npm run build --workspace=@quanly/admin` | `apps/admin/dist` |

Cách làm (Cloudflare Dashboard → Pages → Create project → kết nối repo
`kiettuann/App-Quan-Ly`, một project cho mỗi app):

- **Framework preset:** Vite
- **Build command:** `npm run build --workspace=@quanly/web` (đổi theo app)
- **Build output directory:** `apps/web/dist` (đổi theo app)
- **Environment variable:** `VITE_API_URL=https://<worker-url>` (URL ở §4,
  không có `/` cuối). Build lại nếu đổi URL này.
- **Root directory:** để trống (repo root) vì build command đã chỉ rõ workspace.

Kiểm chứng sau deploy: mở web app → trang đăng nhập hiện ra → đăng ký tenant
mới → tạo dịch vụ → đặt lịch → tạo hóa đơn → thanh toán. Nếu báo
`NETWORK_ERROR`, kiểm tra `VITE_API_URL` trong Pages settings và build lại.

## 6. Rollback

- **API (Workers):** Cloudflare giữ lại các bản deploy cũ.
  Dashboard → Workers & Pages → `quanly-store-api-production` →
  Deployments → chọn bản trước → **Rollback**. Hoặc CLI:
  `npx wrangler rollback --env production`.
- **Web app (Pages):** Deployments → chọn bản trước → **Rollback**,
  hoặc push lại commit cũ lên `main` để Pages build lại.
- **D1 (dữ liệu):** migration không rollback được. Khôi phục bằng cách restore
  backup/snapshot D1 trên Dashboard (D1 → `quanly-store-db` → Backups) về
  thời điểm trước khi apply migration lỗi. **Luôn chụp backup/snapshot trước
  khi apply migration remote lần đầu và trước mỗi lần đổi schema.**
- **Trường hợp xấu nhất:** giữ nguyên API cũ đang chạy, không deploy bản mới
  cho tới khi lỗi được sửa local và test lại 50/50.

## 7. Sau khi deploy lần đầu (checklist)

- [ ] `GET /api/v1/health` trả `ok`, `environment: production`.
- [ ] Đăng ký tenant mới trên web app thành công (trial 14 ngày).
- [ ] Đăng nhập bằng mật khẩu; tạo chi nhánh/dịch vụ/nhân viên/khách.
- [ ] Đặt lịch → hoàn thành → tạo hóa đơn → thanh toán → hoa hồng 10% hiện
      ở mục Hoa hồng (kiểm chứng nhanh với rule mẫu).
- [ ] Tạo tài khoản Resend, đặt `RESEND_API_KEY` (§2), thử "Gửi mã OTP"
      ở trang đăng nhập — nhận được email.
- [ ] Đăng nhập Admin bằng tài khoản §3, xem được danh sách tenant.
- [ ] Mua và gắn domain `quanly.store` (Workers Custom Domain + Pages
      Custom Domain) khi Kalvin quyết định.

## 8. Những gì KHÔNG làm ở bước deploy

- Không chạy `wrangler deploy` khi chưa có `SESSION_SECRET` — session sẽ
  không ký được, toàn bộ đăng nhập lỗi.
- Không bật `OTP_DEV_MODE=true` ở production.
- Không commit secret, không để key Resend trong repo.
- Không deploy file zip Phase 3 cũ (`quanly-store-phase3-foundation.zip`) —
  chỉ deploy code Phase 4–7 hoàn chỉnh trong repo (xem `PHASES_PROGRESS.md`).
