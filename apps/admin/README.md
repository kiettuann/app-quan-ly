# Platform Admin — quanly.store (apps/admin)

Bảng quản trị nền tảng cho đội vận hành quanly.store. Chỉ tài khoản
`platform_admin` mới đăng nhập được. Không phải app của chủ tiệm
(app chủ tiệm là `apps/web`).

## Chạy

```bash
npm run dev --workspace=@quanly/admin      # http://localhost:5175
npm run build --workspace=@quanly/admin
```

API: `VITE_API_URL` (mặc định `http://localhost:8787`), endpoint `/api/v1/admin/*`
và `/api/v1/auth/login`. Token lưu ở localStorage key `ql_admin_token`;
gặp 401 thì xóa token và chuyển về `/dang-nhap`.

## Trang

| Route | Trang | API |
|---|---|---|
| `/dang-nhap` | Đăng nhập platform_admin | `POST /auth/login` |
| `/` | Tenants — bảng + chi tiết, nút tạm khóa / mở lại | `GET /admin/tenants`, `GET /admin/tenants/:id`, `PATCH /admin/tenants/:id` (`{status}`) |
| `/goi-dich-vu` | Plans — bảng + form tạo/sửa gói | `GET /admin/plans`, `POST /admin/plans`, `PATCH /admin/plans/:id` |
| `/subscriptions` | Subscriptions — bảng, lọc theo trạng thái | `GET /admin/subscriptions` |
| `/audit-logs` | Audit logs — lọc theo tenant_id / action, phân trang | `GET /admin/audit-logs` |
| `/ho-tro` | Hỗ trợ — nhập tenantId + lý do → `POST /admin/support-access` | chỉ hiện **tóm tắt tenant** |

## Ranh giới (PERMISSIONS.md §4)

Trang Hỗ trợ **không bao giờ** hiển thị dữ liệu nghiệp vụ của tenant
(khách hàng, lịch hẹn, hóa đơn, doanh thu...). Mọi yêu cầu hỗ trợ đều ghi
audit log kèm lý do phía server.

## Cố tình chưa làm

- **Chưa có MFA cho Platform Admin.** Đăng nhập hiện chỉ có email + mật khẩu.
- **Không có cổng thanh toán** — trang Subscriptions chỉ hiển thị, không thu tiền.
- Không có dữ liệu giả: mọi trang đều có trạng thái loading / empty / error.
