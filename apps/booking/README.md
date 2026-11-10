# Customer Booking Website (public)

Chưa triển khai ở Phase 3 Foundation. Sẽ làm ở Phase 4, sau module Booking nội bộ.

Luồng (UX_FLOWS.md §3): chọn chi nhánh → dịch vụ → kỹ thuật viên (hoặc tự chọn)
→ ngày → giờ trống thật → SĐT → xác minh OTP → xem lại → đặt cọc nếu chi nhánh
yêu cầu (hiện chỉ hiển thị "Sắp ra mắt") → xác nhận booking.

OTP — Kalvin chốt 10/11/2026: Email OTP miễn phí qua Resend (free tier 3.000
email/tháng, tối đa 100/ngày) là kênh chính cho đăng nhập chủ tiệm / nhân viên.
Khách đặt lịch online trong MVP: giữ SĐT làm định danh, chưa gửi OTP SMS.
SMS OTP chỉ còn dạng stub trong abstraction (`packages/shared/src/otp.ts`)
để cắm provider sau. Chưa có RESEND_API_KEY thật — đặt bằng
`wrangler secret put RESEND_API_KEY`, không hardcode, không commit key.
