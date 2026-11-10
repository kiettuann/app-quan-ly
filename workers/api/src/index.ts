// quanly.store API — Cloudflare Workers + Hono. Phase 3 Foundation.
// Một API duy nhất cho 3 app (web / booking / admin). Nguồn: ARCHITECTURE.md.
// Chưa có module nghiệp vụ (booking, POS...) — chỉ health, auth skeleton, tenant guard.
import { Hono } from "hono";
import { cors } from "hono/cors";
import { apiError } from "@quanly/shared";
import { authMiddleware } from "./auth.js";

export interface Env {
  DB: D1Database;
  FILES: R2Bucket;
  ENVIRONMENT?: string;
  OTP_SENDER?: string;
  OTP_DEV_MODE?: string;
  SESSION_SECRET?: string;
}

const app = new Hono<{ Bindings: Env }>();

app.use("*", cors({ origin: ["https://quanlynail1.pages.dev", "http://localhost:5173", "http://localhost:5174", "http://localhost:5175"], credentials: true }));

app.onError((_err, c) => {
  // Không lộ stack trace / SQL ra client (API_SPEC.md §3).
  console.error(JSON.stringify({ level: "error", message: "internal_error", requestId: c.req.header("cf-ray") }));
  return c.json(apiError("INTERNAL_ERROR", "Đã có lỗi xảy ra. Vui lòng thử lại sau."), 500);
});

app.get("/api/v1/health", (c) => c.json({ data: { status: "ok", environment: c.env.ENVIRONMENT ?? "dev" } }));

// --- Auth (Foundation skeleton: login thật làm ở Phase 4) ---
app.post("/api/v1/auth/login", (c) =>
  c.json(
    apiError("UNPROCESSABLE", "Đăng nhập chưa được triển khai ở Phase 3 Foundation. Sẽ có ở Phase 4."),
    422,
  ),
);

// --- OTP (Email OTP qua Resend — xem packages/shared/src/otp.ts) ---
// Kênh đã chốt: Email OTP (Resend free tier 3.000/tháng, tối đa 100/ngày).
// Endpoint thật làm ở Phase 4 sau khi có RESEND_API_KEY (wrangler secret put).
// Chưa có key -> hệ thống từ chối gửi, KHÔNG giả vờ đã gửi OTP.
app.post("/api/v1/customers/otp/send", (c) =>
  c.json(
    apiError(
      "UNPROCESSABLE",
      "Email OTP chưa được cấu hình (thiếu RESEND_API_KEY). Hệ thống không giả vờ đã gửi OTP.",
    ),
    422,
  ),
);

// --- Ví dụ route có guard tenant: chỉ để chứng minh middleware chạy ---
// Mọi route nghiệp vụ Phase 4 đều đi qua authMiddleware + kiểm tra tenant/branch
// bằng canAccessRecord() trong @quanly/shared trước khi trả dữ liệu.
app.get("/api/v1/tenants/me", authMiddleware, (c) => {
  const session = c.get("session");
  return c.json({ data: { tenantId: session.tenantId, userId: session.userId } });
});

app.notFound((c) => c.json(apiError("NOT_FOUND", "Không tìm thấy đường dẫn này."), 404));

export default app;
