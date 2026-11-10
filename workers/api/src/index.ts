// quanly.store API — Cloudflare Workers + Hono. Phase 4–7 complete.
// Một API duy nhất cho 3 app (web / booking / admin). Nguồn: ARCHITECTURE.md.
// Mọi route nghiệp vụ đi qua authMiddleware + RBAC; tenant context lấy từ
// phiên đã xác minh, KHÔNG tin tenant_id client gửi.
import { Hono } from "hono";
import { cors } from "hono/cors";
import { apiError } from "@quanly/shared";
import { adminRoutes } from "./routes/admin.js";
import { authRoutes } from "./routes/auth.js";
import { bookingsRoutes } from "./routes/bookings.js";
import { branchesRoutes } from "./routes/branches.js";
import { commissionRoutes } from "./routes/commission.js";
import { customersRoutes } from "./routes/customers.js";
import { employeeRoutes } from "./routes/employees.js";
import { expensesRoutes } from "./routes/expenses.js";
import { inventoryRoutes } from "./routes/inventory.js";
import { invoiceRoutes } from "./routes/invoices.js";
import { payrollRoutes } from "./routes/payroll.js";
import { publicRoutes } from "./routes/public.js";
import { reportsRoutes } from "./routes/reports.js";
import { servicesRoutes } from "./routes/services.js";
import { usersRoutes } from "./routes/users.js";

export interface Env {
  DB: D1Database;
  FILES: R2Bucket;
  ENVIRONMENT?: string;
  OTP_SENDER?: string;
  OTP_DEV_MODE?: string;
  SESSION_SECRET?: string;
  /** Đặt bằng `wrangler secret put RESEND_API_KEY` — KHÔNG hardcode, KHÔNG commit. */
  RESEND_API_KEY?: string;
  EMAIL_FROM?: string;
}

const app = new Hono<{ Bindings: Env }>();

app.use(
  "*",
  cors({
    origin: ["http://localhost:5173", "http://localhost:5174", "http://localhost:5175"],
    credentials: true,
  }),
);

app.onError((_err, c) => {
  // Không lộ stack trace / SQL ra client (API_SPEC.md §3).
  console.error(JSON.stringify({ level: "error", message: "internal_error", requestId: c.req.header("cf-ray") }));
  return c.json(apiError("INTERNAL_ERROR", "Đã có lỗi xảy ra. Vui lòng thử lại sau."), 500);
});

app.get("/api/v1/health", (c) => c.json({ data: { status: "ok", environment: c.env.ENVIRONMENT ?? "dev" } }));

// Phase 4 — Core Modules (thứ tự MVP rồi mở rộng, xem IMPLEMENTATION_PLAN.md §3).
app.route("/api/v1", authRoutes);
app.route("/api/v1", branchesRoutes);
app.route("/api/v1", usersRoutes);
app.route("/api/v1", servicesRoutes);
app.route("/api/v1", customersRoutes);
app.route("/api/v1", bookingsRoutes);
app.route("/api/v1", invoiceRoutes);
app.route("/api/v1", commissionRoutes);
app.route("/api/v1", employeeRoutes);
app.route("/api/v1", payrollRoutes);
app.route("/api/v1", inventoryRoutes);
app.route("/api/v1", expensesRoutes);
app.route("/api/v1", reportsRoutes);
app.route("/api/v1", publicRoutes);
app.route("/api/v1", adminRoutes);

app.notFound((c) => c.json(apiError("NOT_FOUND", "Không tìm thấy đường dẫn này."), 404));

export default app;
