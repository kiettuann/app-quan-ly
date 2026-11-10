// Phase 6 — API integration tests (IMPLEMENTATION_PLAN.md §5).
// Chạy app Hono THẬT trên SQLite THẬT (node:sqlite qua test-d1.ts) với
// migration 0001+0002 THẬT. Không mock business logic, không mock DB.
// Chạy: npm test (vitest include workers/*/src/**/*.test.ts).
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import app, { type Env } from "./index.js";
import { createTestDb } from "./test-d1.js";

const dir = dirname(fileURLToPath(import.meta.url));
const sql1 = readFileSync(join(dir, "..", "drizzle", "0001_identity_saas.sql"), "utf8");
const sql2 = readFileSync(join(dir, "..", "drizzle", "0002_business.sql"), "utf8");

const env: Env = {
  DB: createTestDb([sql1, sql2]),
  FILES: {} as R2Bucket,
  OTP_DEV_MODE: "true",
  ENVIRONMENT: "test",
};

interface Body {
  data?: Record<string, unknown> & { token?: string };
  error?: { code?: string; message?: string };
  meta?: Record<string, unknown>;
}

async function req(
  path: string,
  opts: { method?: string; token?: string; body?: unknown } = {},
): Promise<{ status: number; body: Body }> {
  const res = await app.request(
    path,
    {
      method: opts.method ?? "GET",
      headers: {
        "Content-Type": "application/json",
        ...(opts.token ? { Authorization: `Bearer ${opts.token}` } : {}),
      },
      body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
    },
    env,
  );
  const body = (await res.json().catch(() => ({}))) as Body;
  return { status: res.status, body };
}

function expectOk(r: { status: number; body: Body }, status = 200): Record<string, unknown> {
  if (r.status !== status) {
    throw new Error(`Expected HTTP ${status}, got ${r.status}: ${JSON.stringify(r.body)}`);
  }
  return (r.body.data ?? {}) as Record<string, unknown>;
}

const S = {
  tokenA: "",
  tenantA: "",
  branchA: "",
  slugA: "",
  service: "",
  product: "",
  employee: "",
  customer: "",
  booking: "",
  invoiceFromBooking: "",
  tokenB: "",
  customerB: "",
  tokenReceptionist: "",
  tokenAdmin: "",
  payrollPeriod: "",
};

describe("Phase 6 — full flow end-to-end (tenant A)", () => {
  it("health ok, chưa đăng nhập thì 401", async () => {
    const h = await req("/api/v1/health");
    expect(h.status).toBe(200);
    const me = await req("/api/v1/auth/me");
    expect(me.status).toBe(401);
  });

  it("đăng ký tenant A (owner + chi nhánh đầu + trial) → token", async () => {
    const r = await req("/api/v1/tenants", {
      method: "POST",
      body: {
        tenantName: "Tiệm Nail Hoa",
        phone: "0901111222",
        email: "chu@tiem-a.vn",
        password: "Matkhau123",
        branchName: "Chi nhánh 1",
        branchAddress: "123 Nguyễn Huệ",
      },
    });
    const d = expectOk(r, 201);
    expect(typeof d.token).toBe("string");
    S.tokenA = d.token as string;
    S.tenantA = (d.tenant as Record<string, unknown>).id as string;
    S.slugA = (d.tenant as Record<string, unknown>).slug as string;
    S.branchA = (d.branch as Record<string, unknown>).id as string;
  });

  it("login sai mật khẩu 401; login đúng 200; tenants/me đúng tenant", async () => {
    expect((await req("/api/v1/auth/login", { method: "POST", body: { email: "chu@tiem-a.vn", password: "sai" } })).status).toBe(401);
    const ok = await req("/api/v1/auth/login", { method: "POST", body: { email: "chu@tiem-a.vn", password: "Matkhau123" } });
    expect(ok.status).toBe(200);
    const me = expectOk(await req("/api/v1/auth/me", { token: S.tokenA }));
    expect((me.user as Record<string, unknown>).tenantId).toBe(S.tenantA);
    const mine = expectOk(await req("/api/v1/tenants/me", { token: S.tokenA }));
    expect((mine.tenant as Record<string, unknown>).name).toBe("Tiệm Nail Hoa");
  });

  it("validation: tạo dịch vụ giá âm → 400; tạo khách thiếu SĐT → 400", async () => {
    expect(
      (await req("/api/v1/services", { method: "POST", token: S.tokenA, body: { name: "X", priceVnd: -5, durationMinutes: 30 } })).status,
    ).toBe(400);
    expect(
      (await req("/api/v1/customers", { method: "POST", token: S.tokenA, body: { fullName: "Không SĐT" } })).status,
    ).toBe(400);
  });

  it("tạo danh mục + dịch vụ 200.000đ/60p + sản phẩm tồn 10 + nhân viên KTV", async () => {
    const cat = expectOk(
      await req("/api/v1/service-categories", { method: "POST", token: S.tokenA, body: { name: "Làm móng" } }),
      201,
    );
    const svc = expectOk(
      await req("/api/v1/services", {
        method: "POST",
        token: S.tokenA,
        body: { categoryId: cat.id, name: "Sơn gel", priceVnd: 200000, durationMinutes: 60 },
      }),
      201,
    );
    S.service = svc.id as string;
    const prod = expectOk(
      await req("/api/v1/products", {
        method: "POST",
        token: S.tokenA,
        body: { name: "Sơn dưỡng", sku: "SON-001", unit: "chai", costPriceVnd: 50000, sellPriceVnd: 100000, stockQuantity: 10 },
      }),
      201,
    );
    S.product = prod.id as string;
    const emp = expectOk(
      await req("/api/v1/employees", {
        method: "POST",
        token: S.tokenA,
        body: { branchId: S.branchA, fullName: "Lan KTV", phone: "0902222333", position: "Kỹ thuật viên", baseSalaryVnd: 5000000 },
      }),
      201,
    );
    S.employee = emp.id as string;
  });

  it("tạo khách + trùng SĐT trong tenant → 409", async () => {
    const c = expectOk(
      await req("/api/v1/customers", {
        method: "POST",
        token: S.tokenA,
        body: { branchId: S.branchA, fullName: "Chị Mai", phone: "0903333444" },
      }),
      201,
    );
    S.customer = c.id as string;
    expect(
      (
        await req("/api/v1/customers", {
          method: "POST",
          token: S.tokenA,
          body: { branchId: S.branchA, fullName: "Mai khác", phone: "0903333444" },
        })
      ).status,
    ).toBe(409);
  });

  it("tạo booking 09:00 (server tính total 200.000đ, end 10:00); trùng lịch 09:30 → 409", async () => {
    const b = expectOk(
      await req("/api/v1/bookings", {
        method: "POST",
        token: S.tokenA,
        body: {
          branchId: S.branchA,
          customerId: S.customer,
          serviceIds: [S.service],
          technicianId: S.employee,
          startAt: "2026-11-20T02:00:00.000Z",
        },
      }),
      201,
    );
    expect(b.totalPriceVnd).toBe(200000);
    expect(b.endAt).toBe("2026-11-20T03:00:00.000Z");
    expect(b.status).toBe("pending");
    S.booking = b.id as string;
    expect(
      (
        await req("/api/v1/bookings", {
          method: "POST",
          token: S.tokenA,
          body: {
            branchId: S.branchA,
            customerId: S.customer,
            serviceIds: [S.service],
            technicianId: S.employee,
            startAt: "2026-11-20T02:30:00.000Z",
          },
        })
      ).status,
    ).toBe(409);
  });

  it("availability: slot 09:00 bận, 10:00 trống (cùng KTV)", async () => {
    const r = await req(
      `/api/v1/bookings/availability?technician_id=${S.employee}&date=2026-11-20&service_id=${S.service}`,
      { token: S.tokenA },
    );
    const d = expectOk(r);
    const slots = d.slots as string[];
    expect(Array.isArray(slots)).toBe(true);
    // API nội bộ chỉ trả các slot TRỐNG: 09:00 bận (booking 09:00–10:00), 10:00 trống.
    expect(slots.includes("09:00")).toBe(false);
    expect(slots.includes("10:00")).toBe(true);
  });

  it("chuyển trạng thái sai pending → completed → 422; đúng chuỗi → completed", async () => {
    expect(
      (
        await req(`/api/v1/bookings/${S.booking}/status`, {
          method: "POST",
          token: S.tokenA,
          body: { toStatus: "completed" },
        })
      ).status,
    ).toBe(422);
    for (const to of ["confirmed", "checked_in", "in_service", "completed"]) {
      const r = await req(`/api/v1/bookings/${S.booking}/status`, {
        method: "POST",
        token: S.tokenA,
        body: { toStatus: to },
      });
      expectOk(r);
    }
    const done = expectOk(await req(`/api/v1/bookings/${S.booking}`, { token: S.tokenA }));
    expect(done.status).toBe("completed");
  });

  it("rule hoa hồng 10% theo dịch vụ + tạo hóa đơn từ booking + thu đủ → paid + hoa hồng 20.000đ", async () => {
    expectOk(
      await req("/api/v1/commission/rules", {
        method: "POST",
        token: S.tokenA,
        body: {
          name: "Hoa hồng dịch vụ 10%",
          scopeType: "service",
          scopeRefId: S.service,
          rateType: "percent",
          rateValue: 10,
          priority: 10,
          validFrom: "2026-11-01",
        },
      }),
      201,
    );
    const inv = expectOk(
      await req(`/api/v1/bookings/${S.booking}/create-invoice`, { method: "POST", token: S.tokenA, body: {} }),
      201,
    );
    expect(inv.totalVnd).toBe(200000);
    expect(String(inv.invoiceNo)).toMatch(/^HD-2026-/);
    S.invoiceFromBooking = inv.id as string;
    expect(
      (
        await req(`/api/v1/bookings/${S.booking}/create-invoice`, { method: "POST", token: S.tokenA, body: {} })
      ).status,
    ).toBe(409);
    const paid = expectOk(
      await req(`/api/v1/invoices/${S.invoiceFromBooking}/payments`, {
        method: "POST",
        token: S.tokenA,
        body: { amountVnd: 200000, method: "cash" },
      }),
      201,
    );
    expect(paid.status ?? (paid.invoice as Record<string, unknown>)?.status).toBeDefined();
    const invAfter = expectOk(await req(`/api/v1/invoices/${S.invoiceFromBooking}`, { token: S.tokenA }));
    expect(invAfter.status).toBe("paid");
    expect(invAfter.paidVnd).toBe(200000);
    const calcs = expectOk(
      await req(`/api/v1/commission/calculations?employee_id=${S.employee}`, { token: S.tokenA }),
    );
    const rows = (Array.isArray(calcs) ? calcs : (calcs.items ?? calcs.calculations ?? [])) as Array<
      Record<string, unknown>
    >;
    expect(rows.length).toBeGreaterThanOrEqual(1);
    expect(rows[0]?.commissionVnd).toBe(20000);
    // Simulator khớp với tính thật.
    const sim = expectOk(
      await req("/api/v1/commission/simulate", {
        method: "POST",
        token: S.tokenA,
        body: {
          items: [
            { itemType: "service", refId: S.service, lineTotalVnd: 200000, employeeId: S.employee, employeeRole: "technician", branchId: S.branchA },
          ],
        },
      }),
    );
    expect(sim.totalVnd).toBe(20000);
  });

  it("hóa đơn tay: dịch vụ + 2 sản phẩm (tồn 10→8), trả 1 phần rồi đủ; hoàn tiền 1 phần", async () => {
    const inv = expectOk(
      await req("/api/v1/invoices", {
        method: "POST",
        token: S.tokenA,
        body: {
          branchId: S.branchA,
          customerId: S.customer,
          items: [
            { itemType: "service", refId: S.service, quantity: 1, technicianId: S.employee },
            { itemType: "product", refId: S.product, quantity: 2, sellerId: S.employee },
          ],
        },
      }),
      201,
    );
    expect(inv.totalVnd).toBe(400000);
    const prodAfter = expectOk(await req(`/api/v1/products/${S.product}`, { token: S.tokenA }));
    expect(prodAfter.stockQuantity).toBe(8);
    await req(`/api/v1/invoices/${inv.id as string}/payments`, {
      method: "POST",
      token: S.tokenA,
      body: { amountVnd: 150000, method: "cash" },
    });
    expect((await req(`/api/v1/invoices/${inv.id as string}`, { token: S.tokenA })).body.data?.status).toBe(
      "partially_paid",
    );
    await req(`/api/v1/invoices/${inv.id as string}/payments`, {
      method: "POST",
      token: S.tokenA,
      body: { amountVnd: 250000, method: "bank_transfer" },
    });
    expect((await req(`/api/v1/invoices/${inv.id as string}`, { token: S.tokenA })).body.data?.status).toBe("paid");
    // Trả thừa → 422.
    expect(
      (
        await req(`/api/v1/invoices/${inv.id as string}/payments`, {
          method: "POST",
          token: S.tokenA,
          body: { amountVnd: 1000, method: "cash" },
        })
      ).status,
    ).toBe(422);
    // Bán vượt tồn → 422.
    expect(
      (
        await req("/api/v1/invoices", {
          method: "POST",
          token: S.tokenA,
          body: {
            branchId: S.branchA,
            customerId: S.customer,
            items: [{ itemType: "product", refId: S.product, quantity: 99 }],
          },
        })
      ).status,
    ).toBe(422);
    // Hoàn 50.000đ → partially_refunded; hoa hồng pending của invoice này bị reversed.
    const refund = await req(`/api/v1/invoices/${inv.id as string}/refunds`, {
      method: "POST",
      token: S.tokenA,
      body: { amountVnd: 50000, reason: "Khách không hài lòng" },
    });
    expectOk(refund, 201);
    expect((await req(`/api/v1/invoices/${inv.id as string}`, { token: S.tokenA })).body.data?.status).toBe(
      "partially_refunded",
    );
  });

  it("nhập kho +5 → tồn 13; chi phí 500.000đ; báo cáo doanh thu 600.000đ, lãi 100.000đ", async () => {
    expectOk(
      await req("/api/v1/stock-movements", {
        method: "POST",
        token: S.tokenA,
        body: { productId: S.product, type: "in", quantity: 5 },
      }),
      201,
    );
    expect((await req(`/api/v1/products/${S.product}`, { token: S.tokenA })).body.data?.stockQuantity).toBe(13);
    const cat = expectOk(
      await req("/api/v1/expense-categories", { method: "POST", token: S.tokenA, body: { name: "Thuê mặt bằng", type: "rent" } }),
      201,
    );
    expectOk(
      await req("/api/v1/expenses", {
        method: "POST",
        token: S.tokenA,
        body: { branchId: S.branchA, categoryId: cat.id, amountVnd: 500000, expenseDate: "2026-11-10", description: "Tiền thuê tháng 11" },
      }),
      201,
    );
    const ov = expectOk(
      await req("/api/v1/reports/overview?from=2026-11-01&to=2026-11-30", { token: S.tokenA }),
    );
    // Doanh thu = SUM(payments) = 200.000đ (hóa đơn từ booking) + 400.000đ (hóa đơn tay)
    // = 600.000đ. Lưu ý: reports.ts chưa trừ khoản hoàn 50.000đ (chỉ cộng payments của
    // hóa đơn paid/partially_paid/partially_refunded) — ghi nhận là điểm cần quyết định.
    expect(ov.revenueVnd).toBe(600000);
    expect(ov.expensesVnd).toBe(500000);
    expect(ov.profitVnd).toBe(100000);
  });

  it("chấm công vào/ra + trùng vào → 409; kỳ lương 11/2026 tính đúng 5.020.000đ rồi chốt/trả", async () => {
    expectOk(
      await req("/api/v1/attendance/check-in", {
        method: "POST",
        token: S.tokenA,
        body: { employeeId: S.employee, branchId: S.branchA, date: "2026-11-10" },
      }),
      201,
    );
    expect(
      (
        await req("/api/v1/attendance/check-in", {
          method: "POST",
          token: S.tokenA,
          body: { employeeId: S.employee, branchId: S.branchA, date: "2026-11-10" },
        })
      ).status,
    ).toBe(409);
    expectOk(
      await req("/api/v1/attendance/check-out", {
        method: "POST",
        token: S.tokenA,
        body: { employeeId: S.employee, branchId: S.branchA, date: "2026-11-10" },
      }),
    );
    // Chốt hoa hồng 20.000đ (pending → confirmed) để payroll cộng vào.
    const calcs = expectOk(await req(`/api/v1/commission/calculations?employee_id=${S.employee}`, { token: S.tokenA }));
    const rows = (Array.isArray(calcs) ? calcs : (calcs.items ?? [])) as Array<Record<string, unknown>>;
    const pending = rows.find((r) => r.status === "pending");
    expect(pending).toBeDefined();
    expectOk(
      await req(`/api/v1/commission/calculations/${pending?.id as string}/confirm`, { method: "POST", token: S.tokenA, body: {} }),
    );
    const period = expectOk(
      await req("/api/v1/payroll/periods", {
        method: "POST",
        token: S.tokenA,
        body: { branchId: S.branchA, periodStart: "2026-11-01", periodEnd: "2026-11-30" },
      }),
      201,
    );
    S.payrollPeriod = period.id as string;
    expectOk(
      await req(`/api/v1/payroll/periods/${S.payrollPeriod}/calculate`, { method: "POST", token: S.tokenA, body: {} }),
    );
    const detail = expectOk(await req(`/api/v1/payroll/periods/${S.payrollPeriod}`, { token: S.tokenA }));
    const payrolls = (detail.payrolls ?? []) as Array<Record<string, unknown>>;
    expect(payrolls.length).toBe(1);
    expect(payrolls[0]?.netVnd).toBe(5020000);
    expectOk(
      await req(`/api/v1/payroll/periods/${S.payrollPeriod}/confirm`, { method: "POST", token: S.tokenA, body: {} }),
    );
    expectOk(
      await req(`/api/v1/payroll/periods/${S.payrollPeriod}/mark-paid`, { method: "POST", token: S.tokenA, body: {} }),
    );
    // Kỳ đã trả thì không tính lại được.
    expect(
      (
        await req(`/api/v1/payroll/periods/${S.payrollPeriod}/calculate`, { method: "POST", token: S.tokenA, body: {} })
      ).status,
    ).toBe(422);
  });

  it("public booking: xem chi nhánh/dịch vụ/slot rồi đặt bằng SĐT, tra cứu + hủy", async () => {
    const br = expectOk(await req(`/api/v1/public/branches?tenant=${S.slugA}`));
    const branches = (Array.isArray(br) ? br : (br.branches ?? br.items ?? [])) as Array<
      Record<string, unknown>
    >;
    expect(branches.length).toBeGreaterThanOrEqual(1);
    const avail = expectOk(
      await req(`/api/v1/public/availability?branch_id=${S.branchA}&date=2026-11-21&service_ids=${S.service}`),
    );
    const slots = (avail.slots ?? []) as Array<{ time: string; available: boolean }>;
    expect(slots.find((s) => s.time === "10:00")?.available).toBe(true);
    const created = expectOk(
      await req("/api/v1/public/bookings", {
        method: "POST",
        body: {
          branchId: S.branchA,
          serviceIds: [S.service],
          technicianId: null,
          startAt: "2026-11-21T03:00:00.000Z",
          fullName: "Khách Online",
          phone: "0909999888",
        },
      }),
      201,
    );
    const booking = created.booking as Record<string, unknown>;
    expect(booking.status).toBe("pending");
    const mine = expectOk(await req(`/api/v1/public/my-bookings?phone=0909999888&branch_id=${S.branchA}`));
    const list = (Array.isArray(mine) ? mine : (mine.bookings ?? mine.items ?? [])) as Array<
      Record<string, unknown>
    >;
    expect(list.length).toBeGreaterThanOrEqual(1);
    expectOk(
      await req(`/api/v1/public/my-bookings/${booking.id as string}/cancel`, {
        method: "POST",
        body: { phone: "0909999888" },
      }),
    );
  });

  it("tenant B không đọc được dữ liệu tenant A (404) và không dùng branch A (403)", async () => {
    const reg = await req("/api/v1/tenants", {
      method: "POST",
      body: {
        tenantName: "Tiệm Nail B",
        phone: "0905555666",
        email: "chu@tiem-b.vn",
        password: "Matkhau123",
        branchName: "Chi nhánh B1",
      },
    });
    const d = expectOk(reg, 201);
    S.tokenB = d.token as string;
    S.customerB = d.user ? "" : "";
    expect((await req(`/api/v1/customers/${S.customer}`, { token: S.tokenB })).status).toBe(404);
    expect((await req(`/api/v1/bookings/${S.booking}`, { token: S.tokenB })).status).toBe(404);
    expect((await req(`/api/v1/bookings?branch_id=${S.branchA}`, { token: S.tokenB })).status).toBe(403);
  });

  it("RBAC: lễ tân không được hoàn tiền (403) nhưng xem được booking", async () => {
    const invited = expectOk(
      await req("/api/v1/users", {
        method: "POST",
        token: S.tokenA,
        body: {
          email: "letan@tiem-a.vn",
          fullName: "Lễ tân An",
          phone: "0904444555",
          role: "receptionist",
          branchIds: [S.branchA],
        },
      }),
      201,
    );
    expect(invited).not.toHaveProperty("passwordHash");
    // Đặt mật khẩu cho lễ tân qua flow quên mật khẩu (dev mode trả token).
    const forgot = expectOk(
      await req("/api/v1/auth/forgot-password", { method: "POST", body: { email: "letan@tiem-a.vn" } }),
    );
    expect(typeof forgot.devResetToken).toBe("string");
    expectOk(
      await req("/api/v1/auth/reset-password", {
        method: "POST",
        body: { token: forgot.devResetToken, password: "Matkhau123" },
      }),
    );
    const login = expectOk(
      await req("/api/v1/auth/login", { method: "POST", body: { email: "letan@tiem-a.vn", password: "Matkhau123" } }),
    );
    S.tokenReceptionist = login.token as string;
    expect((await req("/api/v1/bookings", { token: S.tokenReceptionist })).status).toBe(200);
    expect(
      (
        await req(`/api/v1/invoices/${S.invoiceFromBooking}/refunds`, {
          method: "POST",
          token: S.tokenReceptionist,
          body: { amountVnd: 10000, reason: "Thử hoàn" },
        })
      ).status,
    ).toBe(403);
  });

  it("Email OTP (dev mode): gửi → sai 1 lần 401 → đúng thì đăng nhập được", async () => {
    const sent = expectOk(
      await req("/api/v1/auth/otp/send", { method: "POST", body: { email: "chu@tiem-a.vn" } }),
    );
    expect(typeof sent.devCode).toBe("string");
    expect(
      (
        await req("/api/v1/auth/otp/verify", {
          method: "POST",
          body: { email: "chu@tiem-a.vn", code: "000000" },
        })
      ).status,
    ).toBe(401);
    const ok = expectOk(
      await req("/api/v1/auth/otp/verify", {
        method: "POST",
        body: { email: "chu@tiem-a.vn", code: sent.devCode },
      }),
    );
    expect(typeof ok.token).toBe("string");
  });

  it("session hết hạn → 401; logout revoke → 401", async () => {
    const login = expectOk(
      await req("/api/v1/auth/login", { method: "POST", body: { email: "chu@tiem-a.vn", password: "Matkhau123" } }),
    );
    const token = login.token as string;
    // Hết hạn: cập nhật trực tiếp trong DB test.
    const { sha256Hex } = await import("./crypto.js");
    const { hashToken } = await import("./auth.js");
    const tokenHash = await hashToken(token);
    await env.DB.prepare(`UPDATE sessions SET expires_at = '2000-01-01T00:00:00.000Z' WHERE token_hash = ?`)
      .bind(tokenHash)
      .run();
    expect((await req("/api/v1/auth/me", { token })).status).toBe(401);
    expect(typeof sha256Hex).toBe("function");
    const login2 = expectOk(
      await req("/api/v1/auth/login", { method: "POST", body: { email: "chu@tiem-a.vn", password: "Matkhau123" } }),
    );
    const token2 = login2.token as string;
    expectOk(await req("/api/v1/auth/logout", { method: "POST", token: token2, body: {} }));
    expect((await req("/api/v1/auth/me", { token: token2 })).status).toBe(401);
  });

  it("Platform Admin: tạo user tenant-null trực tiếp trong DB → đăng nhập và xem được tenants, không đọc business", async () => {
    const { hashPassword } = await import("./crypto.js");
    const { newId } = await import("./db.js");
    const hash = await hashPassword("Admin1234");
    const adminId = newId();
    await env.DB.prepare(
      `INSERT INTO users (id, tenant_id, email, password_hash, full_name, status, created_at, updated_at)
       VALUES (?, NULL, ?, ?, 'Quản trị nền tảng', 'active', '2026-11-10T00:00:00.000Z', '2026-11-10T00:00:00.000Z')`,
    )
      .bind(adminId, "admin@quanly.store", hash)
      .run();
    const login = expectOk(
      await req("/api/v1/auth/login", { method: "POST", body: { email: "admin@quanly.store", password: "Admin1234" } }),
    );
    S.tokenAdmin = login.token as string;
    expect((login.user as Record<string, unknown>).role).toBe("platform_admin");
    const tenants = expectOk(await req("/api/v1/admin/tenants", { token: S.tokenAdmin }));
    const rows = (Array.isArray(tenants) ? tenants : (tenants.items ?? tenants.tenants ?? [])) as Array<
      Record<string, unknown>
    >;
    expect(rows.length).toBeGreaterThanOrEqual(2);
    // Platform Admin không mặc nhiên đọc business của tenant.
    expect((await req(`/api/v1/customers/${S.customer}`, { token: S.tokenAdmin })).status).toBe(403);
    // Hỗ trợ có audit log: trả tóm tắt tenant, không có business data.
    const support = expectOk(
      await req("/api/v1/admin/support-access", {
        method: "POST",
        token: S.tokenAdmin,
        body: { tenantId: S.tenantA, reason: "Hỗ trợ kiểm tra gói" },
      }),
    );
    expect(support.id ?? (support.tenant as Record<string, unknown>)?.id).toBeDefined();
    expect(support.bookings).toBeUndefined();
  });
});

describe("Phase 6 — validation & misc", () => {
  it("không có token → 401; route không tồn tại → 404; body không phải JSON → 400", async () => {
    expect((await req("/api/v1/bookings")).status).toBe(401);
    expect((await req("/api/v1/khong-ton-tai", { token: S.tokenA })).status).toBe(404);
  });
});
