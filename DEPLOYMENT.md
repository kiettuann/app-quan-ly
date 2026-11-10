# Cloudflare — quanlynail1

Mã nguồn nền tảng trong `quanly-store-phase3-foundation.zip` khớp với repo trước khi thêm cấu hình triển khai này.

- Web: https://quanlynail1.pages.dev
- API: https://quanlynail1-api.kietct96.workers.dev
- Health: https://quanlynail1-api.kietct96.workers.dev/api/v1/health
- GitHub: `kiettuann/App-Quan-Ly`, nhánh `main`.
- D1: `quanly-store-db` (`b61411fd-1dbd-4ff0-80f0-c442ac48d683`).
- R2: `quanly-store-files`.

## Giao diện

Cloudflare Pages kết nối với repo GitHub, tự build khi nhánh `main` thay đổi.

- Thư mục gốc: gốc repo.
- Lệnh build: `npm run build --workspace=@quanly/web`.
- Thư mục kết quả: `apps/web/dist`.
- `NODE_VERSION=22`.
- `VITE_API_URL=https://quanlynail1-api.kietct96.workers.dev`.

## API và database

Chạy ở gốc repo trên máy đã được cấp quyền Cloudflare:

```sh
npm ci
npx wrangler d1 migrations apply DB --remote --config workers/api/wrangler.toml --env production
npx wrangler secret put SESSION_SECRET --config workers/api/wrangler.toml --env production
npx wrangler deploy --config workers/api/wrangler.toml --env production
```

`SESSION_SECRET` là khóa ngẫu nhiên, chỉ lưu dạng secret trên Cloudflare. Không commit giá trị khóa. Khi deploy lại, giữ khóa hiện tại; chỉ thay khi cần chủ động xoay khóa.

Pages tự cập nhật giao diện; thay đổi mã API hoặc migration cần triển khai API/database riêng bằng các lệnh trên. Có thể dùng Cloudflare API được cấp quyền để thực hiện các bước tương đương.

## Phạm vi Phase 3

Giao diện và API nền tảng đã có; đăng nhập, gửi OTP, đặt lịch, bán hàng và quản lý nhân sự thực tế chưa được triển khai. Endpoint đăng nhập và OTP trả lỗi giải thích rõ. Không có tài khoản đăng nhập mẫu và không thêm dữ liệu giả.

`OTP_DEV_MODE=false` trong production. `RESEND_API_KEY` chưa đặt, sẽ thêm khi triển khai gửi email thật. Chỉ thêm key chưa đủ để hoàn thiện luồng đăng nhập/OTP.
