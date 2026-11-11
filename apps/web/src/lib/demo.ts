// Chế độ dùng thử tạm thời — CHƯA CẦN ĐĂNG NHẬP (Kalvin yêu cầu 2026-11-11).
//
// DEMO_NO_AUTH = true: mở web là vào thẳng app, không hiện màn hình đăng nhập.
// App tự đăng nhập thầm bằng tài khoản demo bên dưới (đúng API đăng nhập
// thật, token lưu đúng như đăng nhập bình thường).
//
// Đổi thành false để bật lại màn hình đăng nhập thật. KHÔNG xóa code auth.
//
// CẢNH BÁO: tài khoản demo nằm trong bundle client (ai mở bundle cũng thấy).
// Chỉ chấp nhận được vì tiệm demo CHỈ chứa dữ liệu mẫu. Khi bật lại đăng
// nhập thật, phải gỡ tài khoản này khỏi đây (và đổi mật khẩu demo trên D1).
export const DEMO_NO_AUTH = true;

/** Tài khoản chủ tiệm demo — tiệm "Nail Demo - Quận 1" (chỉ dữ liệu mẫu). */
export const DEMO_EMAIL = "chu@demo.quanly.store";
export const DEMO_PASSWORD = "Demo123456";
