# Đặt lịch — quanly.store (public, apps/booking)

Website đặt lịch công khai cho khách của một tiệm nail trên quanly.store.
Không cần đăng nhập, không cần tạo tài khoản.

## Chạy

```bash
npm run dev --workspace=@quanly/booking      # http://localhost:5174
npm run build --workspace=@quanly/booking
```

API: `VITE_API_URL` (mặc định `http://localhost:8787`), endpoint `/api/v1/public/*`.

## Luồng (10 bước, UX_FLOWS.md §3 — đã điều chỉnh theo quyết định MVP)

1. Nhập mã tiệm (slug), hoặc mở link có `?tenant=<slug>`.
2. Chọn chi nhánh — `GET /public/branches?tenant=<slug>`.
3. Chọn dịch vụ (nhiều dịch vụ, giá + thời lượng hiện trước) — `GET /public/services?branch_id=`.
4. Chọn kỹ thuật viên, hoặc "Hệ thống tự chọn" (danh sách lấy từ `GET /public/availability` nếu server trả kèm).
5. Chọn ngày (không cho ngày quá khứ).
6. Chọn giờ còn trống thật — `GET /public/availability?branch_id=&date=&technician_id=&service_id=`.
7. Nhập họ tên + số điện thoại (10 số, bắt đầu bằng 0).
8. Xem lại (chi nhánh, dịch vụ, kỹ thuật viên, ngày giờ, tổng tiền tính từ giá dịch vụ do server trả).
9. Đặt cọc: chỉ hiển thị **"Sắp ra mắt"** — không thu tiền, không có logic thanh toán.
10. Xác nhận — `POST /public/bookings` → màn hình xác nhận (mã lịch, ngày giờ, địa chỉ, tổng tiền do server trả).

Mục "Tra cứu lịch của tôi": nhập mã tiệm + SĐT (+ chi nhánh, không bắt buộc) →
`GET /public/my-bookings?phone=&branch_id=` → danh sách lịch của mình, hủy lịch
`pending`/`confirmed` qua `POST /public/my-bookings/:id/cancel`.

## Cố tình chưa làm

- **Không có màn hình OTP.** Kalvin chốt: SĐT là định danh của khách đặt lịch
  online trong MVP, không gửi OTP SMS thật. (Email OTP qua Resend chỉ dùng cho
  đăng nhập chủ tiệm / nhân viên; xem `packages/shared/src/otp.ts`.)
- **Không có cổng thanh toán / đặt cọc thật.** Chưa chốt gateway (API_SPEC.md §7).
- Mọi giá/tổng tiền hiển thị đều lấy từ server; không có dữ liệu giả.
  Mọi màn hình đều có trạng thái loading / empty / error.
