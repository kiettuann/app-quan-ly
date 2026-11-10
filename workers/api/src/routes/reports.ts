// Reports routes — tính trực tiếp (live) từ payments / expenses / bookings /
// invoices / commission_calculations. Không có bảng tổng hợp riêng ở MVP.
// Công thức: lợi nhuận = doanh thu − chi phí (API_SPEC.md §6, CONTRACTS.md §4).
// Doanh thu = SUM(payments.amount_vnd) của các hóa đơn đã thanh toán
// (paid / partially_paid / partially_refunded) trong kỳ.
import { Hono } from "hono";
import { apiError, BOOKING_ACTIVE_STATUSES, type SessionContext } from "@quanly/shared";
import type { Env } from "../index.js";
import { authMiddleware } from "../auth.js";
import { requirePermission } from "../rbac.js";
import { nowIso } from "../db.js";

export const reportsRoutes = new Hono<{ Bindings: Env; Variables: { session: SessionContext } }>();

reportsRoutes.use("/reports", authMiddleware, requirePermission("report.view"));
reportsRoutes.use("/reports/*", authMiddleware, requirePermission("report.view"));

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const PROFIT_FORMULA_NOTE =
  "Lợi nhuận = doanh thu − chi phí. Doanh thu = tổng tiền đã thu (payments) của hóa đơn đã thanh toán trong kỳ; chi phí = tổng chi phí (expenses) trong kỳ.";

interface VnParts {
  year: number;
  month: number;
  day: number;
}

/** Ngày hiện tại theo múi giờ Asia/Ho_Chi_Minh. */
function vnToday(): VnParts {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Ho_Chi_Minh",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const get = (type: string): number => Number(parts.find((p) => p.type === type)?.value ?? 0);
  return { year: get("year"), month: get("month"), day: get("day") };
}

function lastDayOfMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

function defaultRange(): { from: string; to: string } {
  const t = vnToday();
  return {
    from: `${t.year}-${pad(t.month)}-01`,
    to: `${t.year}-${pad(t.month)}-${pad(lastDayOfMonth(t.year, t.month))}`,
  };
}

interface DateRange {
  from: string;
  to: string;
  fromIso: string;
  toExclusiveIso: string;
}

function parseRange(c: {
  req: { query: (k: string) => string | undefined };
}): DateRange | null {
  const def = defaultRange();
  const from = c.req.query("from") ?? def.from;
  const to = c.req.query("to") ?? def.to;
  if (!DATE_RE.test(from) || !DATE_RE.test(to) || from > to) return null;
  const toDate = new Date(`${to}T00:00:00.000Z`);
  toDate.setUTCDate(toDate.getUTCDate() + 1);
  return { from, to, fromIso: `${from}T00:00:00.000Z`, toExclusiveIso: toDate.toISOString() };
}

/**
 * Phạm vi chi nhánh: ?branch_id= phải nằm trong session.branchIds (không thì 403);
 * không có branch_id thì dùng toàn bộ branchIds của session.
 * Trả về danh sách branch id được phép (rỗng = không thấy dữ liệu nào).
 */
function resolveBranchIds(
  session: SessionContext,
  branchIdParam: string | undefined,
): { branchIds: string[] } | { forbidden: true } {
  if (branchIdParam) {
    if (!session.branchIds.includes(branchIdParam)) return { forbidden: true };
    return { branchIds: [branchIdParam] };
  }
  return { branchIds: [...session.branchIds] };
}

/** Mảnh SQL `alias.branch_id IN (?, ...)` + params; rỗng -> 1=0. */
function branchInSql(alias: string, branchIds: readonly string[]): { sql: string; params: unknown[] } {
  if (branchIds.length === 0) return { sql: "1 = 0", params: [] };
  return {
    sql: `${alias}.branch_id IN (${branchIds.map(() => "?").join(", ")})`,
    params: [...branchIds],
  };
}

/** [start, end) theo UTC của một ngày YYYY-MM-DD ở Asia/Ho_Chi_Minh (UTC+7). */
function vnDayBounds(date: string): { startIso: string; endIso: string } {
  const y = Number(date.slice(0, 4));
  const m = Number(date.slice(5, 7));
  const d = Number(date.slice(8, 10));
  const startMs = Date.UTC(y, m - 1, d) - 7 * 60 * 60 * 1000;
  return {
    startIso: new Date(startMs).toISOString(),
    endIso: new Date(startMs + 24 * 60 * 60 * 1000).toISOString(),
  };
}

async function sumRevenue(
  db: D1Database,
  tenantId: string,
  branchIds: readonly string[],
  range: DateRange,
): Promise<number> {
  const scope = branchInSql("i", branchIds);
  const row = await db
    .prepare(
      `SELECT COALESCE(SUM(p.amount_vnd), 0) AS total
       FROM payments p JOIN invoices i ON i.id = p.invoice_id
       WHERE p.tenant_id = ? AND i.status IN ('paid', 'partially_paid', 'partially_refunded')
         AND p.paid_at >= ? AND p.paid_at < ? AND ${scope.sql}`,
    )
    .bind(tenantId, range.fromIso, range.toExclusiveIso, ...scope.params)
    .first<{ total: number }>();
  return row?.total ?? 0;
}

async function sumExpenses(
  db: D1Database,
  tenantId: string,
  branchIds: readonly string[],
  range: DateRange,
): Promise<number> {
  const scope = branchInSql("e", branchIds);
  const row = await db
    .prepare(
      `SELECT COALESCE(SUM(e.amount_vnd), 0) AS total FROM expenses e
       WHERE e.tenant_id = ? AND e.expense_date >= ? AND e.expense_date <= ? AND ${scope.sql}`,
    )
    .bind(tenantId, range.from, range.to, ...scope.params)
    .first<{ total: number }>();
  return row?.total ?? 0;
}

function forbiddenBranch(c: {
  json: (body: unknown, status: number) => Response;
}): Response {
  return c.json(apiError("FORBIDDEN", "Chi nhánh ngoài phạm vi được phân quyền."), 403);
}

// ---------- Overview ----------
reportsRoutes.get("/reports/overview", async (c) => {
  const session = c.get("session");
  const range = parseRange(c);
  if (!range) {
    return c.json(
      apiError("VALIDATION_ERROR", "Khoảng ngày không hợp lệ (from/to dạng YYYY-MM-DD, from <= to)."),
      400,
    );
  }
  const resolved = resolveBranchIds(session, c.req.query("branch_id"));
  if ("forbidden" in resolved) return forbiddenBranch(c);
  const branchIds = resolved.branchIds;
  const tenantId = session.tenantId as string;
  const db = c.env.DB;

  const revenueVnd = await sumRevenue(db, tenantId, branchIds, range);
  const expensesVnd = await sumExpenses(db, tenantId, branchIds, range);
  const profitVnd = revenueVnd - expensesVnd;

  // Lịch hẹn hôm nay (theo ngày Asia/Ho_Chi_Minh), trừ lịch đã hủy / no-show.
  const today = vnToday();
  const todayStr = `${today.year}-${pad(today.month)}-${pad(today.day)}`;
  const todayBounds = vnDayBounds(todayStr);
  const bookingScope = branchInSql("b", branchIds);
  const bookingsTodayRow = await db
    .prepare(
      `SELECT COUNT(*) AS total FROM bookings b
       WHERE b.tenant_id = ? AND b.start_at >= ? AND b.start_at < ?
         AND b.status NOT IN ('cancelled', 'no_show') AND ${bookingScope.sql}`,
    )
    .bind(tenantId, todayBounds.startIso, todayBounds.endIso, ...bookingScope.params)
    .first<{ total: number }>();

  const bookingsCountRow = await db
    .prepare(
      `SELECT COUNT(*) AS total FROM bookings b
       WHERE b.tenant_id = ? AND b.start_at >= ? AND b.start_at < ?
         AND b.status NOT IN ('cancelled', 'no_show') AND ${bookingScope.sql}`,
    )
    .bind(tenantId, range.fromIso, range.toExclusiveIso, ...bookingScope.params)
    .first<{ total: number }>();

  // Khách hàng: lọc theo branch khi có branch_id cụ thể; khách chưa gán chi
  // nhánh (branch_id NULL) vẫn thuộc tenant nên được tính khi xem toàn tenant.
  const customerWhere =
    c.req.query("branch_id") != null
      ? `cu.tenant_id = ? AND cu.branch_id = ?`
      : `cu.tenant_id = ? AND (cu.branch_id IS NULL OR ${branchInSql("cu", branchIds).sql})`;
  const customerParams: unknown[] =
    c.req.query("branch_id") != null
      ? [tenantId, branchIds[0] as string]
      : [tenantId, ...branchInSql("cu", branchIds).params];
  const customersCountRow = await db
    .prepare(
      `SELECT COUNT(*) AS total FROM customers cu WHERE ${customerWhere} AND cu.deleted_at IS NULL`,
    )
    .bind(...customerParams)
    .first<{ total: number }>();

  const invoiceScope = branchInSql("i", branchIds);
  const invoicesCountRow = await db
    .prepare(
      `SELECT COUNT(*) AS total FROM invoices i
       WHERE i.tenant_id = ? AND i.created_at >= ? AND i.created_at < ? AND ${invoiceScope.sql}`,
    )
    .bind(tenantId, range.fromIso, range.toExclusiveIso, ...invoiceScope.params)
    .first<{ total: number }>();

  const lowStockRow = await db
    .prepare(
      `SELECT COUNT(*) AS total FROM products
       WHERE tenant_id = ? AND deleted_at IS NULL AND status = 'active'
         AND stock_quantity <= low_stock_threshold`,
    )
    .bind(tenantId)
    .first<{ total: number }>();

  const upcoming = await db
    .prepare(
      `SELECT b.id, b.branch_id AS branchId, b.customer_id AS customerId,
        cu.full_name AS customerName, b.technician_id AS technicianId,
        b.start_at AS startAt, b.end_at AS endAt, b.status, b.total_price_vnd AS totalPriceVnd
       FROM bookings b JOIN customers cu ON cu.id = b.customer_id
       WHERE b.tenant_id = ? AND b.start_at >= ? AND b.status IN (${BOOKING_ACTIVE_STATUSES.map(() => "?").join(", ")})
         AND ${bookingScope.sql}
       ORDER BY b.start_at ASC LIMIT 5`,
    )
    .bind(tenantId, nowIso(), ...BOOKING_ACTIVE_STATUSES, ...bookingScope.params)
    .all();

  return c.json({
    data: {
      revenueVnd,
      expensesVnd,
      profitVnd,
      bookingsToday: bookingsTodayRow?.total ?? 0,
      bookingsCount: bookingsCountRow?.total ?? 0,
      customersCount: customersCountRow?.total ?? 0,
      invoicesCount: invoicesCountRow?.total ?? 0,
      lowStockCount: lowStockRow?.total ?? 0,
      upcomingBookings: upcoming.results ?? [],
    },
    meta: {
      note: PROFIT_FORMULA_NOTE,
      from: range.from,
      to: range.to,
      branchId: c.req.query("branch_id") ?? null,
    },
  });
});

// ---------- Revenue by day ----------
reportsRoutes.get("/reports/revenue", async (c) => {
  const session = c.get("session");
  const range = parseRange(c);
  if (!range) {
    return c.json(
      apiError("VALIDATION_ERROR", "Khoảng ngày không hợp lệ (from/to dạng YYYY-MM-DD, from <= to)."),
      400,
    );
  }
  const resolved = resolveBranchIds(session, c.req.query("branch_id"));
  if ("forbidden" in resolved) return forbiddenBranch(c);
  const branchIds = resolved.branchIds;
  const tenantId = session.tenantId as string;
  const scope = branchInSql("i", branchIds);
  const rows = await c.env.DB.prepare(
    `SELECT substr(p.paid_at, 1, 10) AS date, COALESCE(SUM(p.amount_vnd), 0) AS revenueVnd,
       COUNT(DISTINCT p.invoice_id) AS invoicesCount
     FROM payments p JOIN invoices i ON i.id = p.invoice_id
     WHERE p.tenant_id = ? AND i.status IN ('paid', 'partially_paid', 'partially_refunded')
       AND p.paid_at >= ? AND p.paid_at < ? AND ${scope.sql}
     GROUP BY substr(p.paid_at, 1, 10) ORDER BY date ASC`,
  )
    .bind(tenantId, range.fromIso, range.toExclusiveIso, ...scope.params)
    .all<{ date: string; revenueVnd: number; invoicesCount: number }>();
  return c.json({ data: rows.results ?? [], meta: { from: range.from, to: range.to } });
});

// ---------- Profit ----------
reportsRoutes.get("/reports/profit", async (c) => {
  const session = c.get("session");
  const range = parseRange(c);
  if (!range) {
    return c.json(
      apiError("VALIDATION_ERROR", "Khoảng ngày không hợp lệ (from/to dạng YYYY-MM-DD, from <= to)."),
      400,
    );
  }
  const resolved = resolveBranchIds(session, c.req.query("branch_id"));
  if ("forbidden" in resolved) return forbiddenBranch(c);
  const branchIds = resolved.branchIds;
  const tenantId = session.tenantId as string;
  const db = c.env.DB;

  const revenueVnd = await sumRevenue(db, tenantId, branchIds, range);
  const expensesVnd = await sumExpenses(db, tenantId, branchIds, range);

  const invScope = branchInSql("i", branchIds);
  const revenueByDay = await db
    .prepare(
      `SELECT substr(p.paid_at, 1, 10) AS date, COALESCE(SUM(p.amount_vnd), 0) AS revenueVnd
       FROM payments p JOIN invoices i ON i.id = p.invoice_id
       WHERE p.tenant_id = ? AND i.status IN ('paid', 'partially_paid', 'partially_refunded')
         AND p.paid_at >= ? AND p.paid_at < ? AND ${invScope.sql}
       GROUP BY substr(p.paid_at, 1, 10) ORDER BY date ASC`,
    )
    .bind(tenantId, range.fromIso, range.toExclusiveIso, ...invScope.params)
    .all<{ date: string; revenueVnd: number }>();
  const expScope = branchInSql("e", branchIds);
  const expensesByDay = await db
    .prepare(
      `SELECT e.expense_date AS date, COALESCE(SUM(e.amount_vnd), 0) AS expensesVnd
       FROM expenses e
       WHERE e.tenant_id = ? AND e.expense_date >= ? AND e.expense_date <= ? AND ${expScope.sql}
       GROUP BY e.expense_date ORDER BY date ASC`,
    )
    .bind(tenantId, range.from, range.to, ...expScope.params)
    .all<{ date: string; expensesVnd: number }>();

  const byDayMap = new Map<string, { date: string; revenueVnd: number; expensesVnd: number }>();
  for (const r of revenueByDay.results ?? []) {
    byDayMap.set(r.date, { date: r.date, revenueVnd: r.revenueVnd, expensesVnd: 0 });
  }
  for (const r of expensesByDay.results ?? []) {
    const existing = byDayMap.get(r.date);
    if (existing) existing.expensesVnd = r.expensesVnd;
    else byDayMap.set(r.date, { date: r.date, revenueVnd: 0, expensesVnd: r.expensesVnd });
  }
  const byDay = [...byDayMap.values()].sort((a, b) => (a.date < b.date ? -1 : 1));
  return c.json({
    data: { revenueVnd, expensesVnd, profitVnd: revenueVnd - expensesVnd, byDay },
    meta: { note: PROFIT_FORMULA_NOTE, from: range.from, to: range.to },
  });
});

// ---------- Top services ----------
reportsRoutes.get("/reports/top-services", async (c) => {
  const session = c.get("session");
  const range = parseRange(c);
  if (!range) {
    return c.json(
      apiError("VALIDATION_ERROR", "Khoảng ngày không hợp lệ (from/to dạng YYYY-MM-DD, from <= to)."),
      400,
    );
  }
  const resolved = resolveBranchIds(session, c.req.query("branch_id"));
  if ("forbidden" in resolved) return forbiddenBranch(c);
  const branchIds = resolved.branchIds;
  const tenantId = session.tenantId as string;
  const scope = branchInSql("i", branchIds);
  const rows = await c.env.DB.prepare(
    `SELECT ii.ref_id AS serviceId, ii.name_snapshot AS name,
       COALESCE(SUM(ii.line_total_vnd), 0) AS revenueVnd, COUNT(*) AS count
     FROM invoice_items ii JOIN invoices i ON i.id = ii.invoice_id
     WHERE i.tenant_id = ? AND ii.item_type = 'service'
       AND i.created_at >= ? AND i.created_at < ? AND ${scope.sql}
     GROUP BY ii.ref_id, ii.name_snapshot
     ORDER BY revenueVnd DESC LIMIT 10`,
  )
    .bind(tenantId, range.fromIso, range.toExclusiveIso, ...scope.params)
    .all<{ serviceId: string | null; name: string; revenueVnd: number; count: number }>();
  return c.json({ data: rows.results ?? [], meta: { from: range.from, to: range.to } });
});

// ---------- Staff performance ----------
reportsRoutes.get("/reports/staff-performance", async (c) => {
  const session = c.get("session");
  const range = parseRange(c);
  if (!range) {
    return c.json(
      apiError("VALIDATION_ERROR", "Khoảng ngày không hợp lệ (from/to dạng YYYY-MM-DD, from <= to)."),
      400,
    );
  }
  const resolved = resolveBranchIds(session, c.req.query("branch_id"));
  if ("forbidden" in resolved) return forbiddenBranch(c);
  const branchIds = resolved.branchIds;
  const tenantId = session.tenantId as string;
  const db = c.env.DB;

  // Kỹ thuật viên chỉ thấy dòng của chính mình: map user -> employee.
  let technicianEmployeeId: string | null = null;
  if (session.role === "technician") {
    const me = await db
      .prepare(`SELECT id FROM employees WHERE tenant_id = ? AND user_id = ? AND deleted_at IS NULL`)
      .bind(tenantId, session.userId)
      .first<{ id: string }>();
    if (!me) return c.json({ data: [], meta: { from: range.from, to: range.to } });
    technicianEmployeeId = me.id;
  }

  const empScope = branchInSql("e", branchIds);
  const empWhere = technicianEmployeeId
    ? `e.tenant_id = ? AND e.id = ? AND e.deleted_at IS NULL`
    : `e.tenant_id = ? AND e.deleted_at IS NULL AND ${empScope.sql}`;
  const empParams: unknown[] = technicianEmployeeId
    ? [tenantId, technicianEmployeeId]
    : [tenantId, ...empScope.params];
  const employees = await db
    .prepare(
      `SELECT e.id, e.full_name AS fullName, e.branch_id AS branchId
       FROM employees e WHERE ${empWhere} ORDER BY e.full_name ASC`,
    )
    .bind(...empParams)
    .all<{ id: string; fullName: string; branchId: string }>();
  const employeeList = employees.results ?? [];
  if (employeeList.length === 0) {
    return c.json({ data: [], meta: { from: range.from, to: range.to } });
  }
  const employeeIds = employeeList.map((e) => e.id);
  const inList = employeeIds.map(() => "?").join(", ");

  const bookingScope = branchInSql("b", branchIds);
  const completed = await db
    .prepare(
      `SELECT b.technician_id AS employeeId, COUNT(*) AS total FROM bookings b
       WHERE b.tenant_id = ? AND b.status = 'completed'
         AND b.start_at >= ? AND b.start_at < ?
         AND b.technician_id IN (${inList}) AND ${bookingScope.sql}
       GROUP BY b.technician_id`,
    )
    .bind(tenantId, range.fromIso, range.toExclusiveIso, ...employeeIds, ...bookingScope.params)
    .all<{ employeeId: string; total: number }>();

  const invScope = branchInSql("i", branchIds);
  const revenue = await db
    .prepare(
      `SELECT ii.technician_id AS employeeId, COALESCE(SUM(ii.line_total_vnd), 0) AS total
       FROM invoice_items ii JOIN invoices i ON i.id = ii.invoice_id
       WHERE i.tenant_id = ? AND ii.technician_id IN (${inList})
         AND i.created_at >= ? AND i.created_at < ? AND ${invScope.sql}
       GROUP BY ii.technician_id`,
    )
    .bind(tenantId, ...employeeIds, range.fromIso, range.toExclusiveIso, ...invScope.params)
    .all<{ employeeId: string; total: number }>();

  const commission = await db
    .prepare(
      `SELECT cc.employee_id AS employeeId, COALESCE(SUM(cc.commission_vnd), 0) AS total
       FROM commission_calculations cc JOIN invoices i ON i.id = cc.invoice_id
       WHERE cc.tenant_id = ? AND cc.employee_id IN (${inList})
         AND i.created_at >= ? AND i.created_at < ? AND ${invScope.sql}
       GROUP BY cc.employee_id`,
    )
    .bind(tenantId, ...employeeIds, range.fromIso, range.toExclusiveIso, ...invScope.params)
    .all<{ employeeId: string; total: number }>();

  const byId = (rows: Array<{ employeeId: string; total: number }>): Map<string, number> => {
    const m = new Map<string, number>();
    for (const r of rows) m.set(r.employeeId, r.total);
    return m;
  };
  const completedMap = byId(completed.results ?? []);
  const revenueMap = byId(revenue.results ?? []);
  const commissionMap = byId(commission.results ?? []);

  return c.json({
    data: employeeList.map((e) => ({
      employeeId: e.id,
      employeeName: e.fullName,
      branchId: e.branchId,
      completedBookings: completedMap.get(e.id) ?? 0,
      revenueVnd: revenueMap.get(e.id) ?? 0,
      commissionVnd: commissionMap.get(e.id) ?? 0,
    })),
    meta: { from: range.from, to: range.to },
  });
});
