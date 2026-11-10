// Payroll — kỳ lương, tính lương, điều chỉnh, chốt, trả lương.
// Nguồn: CONTRACTS.md §4, API_SPEC.md §6, DATABASE_SCHEMA.md §6.
// net = base + commission (đã confirmed trong kỳ) + bonus + allowance
//      − deduction − advance (calculatePayrollNet, shared).
// Lương cơ bản lấy NGUYÊN tháng, không prorate (quyết định đã ghi rõ).
// Kỳ đã paid là bất biến: mọi PATCH/calculate sau đó -> 422.
// Lưu ý schema: payroll_periods KHÔNG có cột paid_at / confirmed_by —
// paid_at và confirmed_by nằm trên từng dòng payrolls.
import { Hono } from "hono";
import type { ZodError } from "zod";
import {
  apiError,
  calculatePayrollNet,
  type SessionContext,
} from "@quanly/shared";
import type { Env } from "../index.js";
import { authMiddleware } from "../auth.js";
import { requirePermission } from "../rbac.js";
import { auditInsertStatement } from "../audit.js";
import { newId, nowIso, pageMeta, pagination } from "../db.js";
import { payrollAdjustSchema, payrollPeriodSchema } from "../validation.js";

export const payrollRoutes = new Hono<{ Bindings: Env; Variables: { session: SessionContext } }>();

function zodMessage(err: ZodError): string {
  return err.issues.map((i) => `${i.path.join(".") || "body"}: ${i.message}`).join("; ");
}

const PERIOD_STATUSES = ["draft", "calculating", "confirmed", "paid"] as const;

interface PayrollPeriodRow {
  id: string;
  tenantId: string;
  branchId: string | null;
  periodStart: string;
  periodEnd: string;
  status: string;
  createdAt: string;
  updatedAt: string;
}

interface PayrollRow {
  id: string;
  payrollPeriodId: string;
  employeeId: string;
  tenantId: string;
  baseSalaryVnd: number;
  commissionVnd: number;
  bonusVnd: number;
  allowanceVnd: number;
  deductionVnd: number;
  advanceVnd: number;
  netVnd: number;
  status: string;
  paidAt: string | null;
  confirmedBy: string | null;
  createdAt: string;
  updatedAt: string;
}

interface PayrollItemRow {
  id: string;
  payrollId: string;
  type: string;
  label: string;
  amountVnd: number;
  createdAt: string;
}

const PERIOD_SELECT = `SELECT id, tenant_id AS tenantId, branch_id AS branchId,
  period_start AS periodStart, period_end AS periodEnd, status,
  created_at AS createdAt, updated_at AS updatedAt
  FROM payroll_periods`;

const PAYROLL_SELECT = `SELECT id, payroll_period_id AS payrollPeriodId,
  employee_id AS employeeId, tenant_id AS tenantId,
  base_salary_vnd AS baseSalaryVnd, commission_vnd AS commissionVnd,
  bonus_vnd AS bonusVnd, allowance_vnd AS allowanceVnd,
  deduction_vnd AS deductionVnd, advance_vnd AS advanceVnd,
  net_vnd AS netVnd, status, paid_at AS paidAt, confirmed_by AS confirmedBy,
  created_at AS createdAt, updated_at AS updatedAt
  FROM payrolls`;

const PAYROLL_ITEM_SELECT = `SELECT id, payroll_id AS payrollId, type, label,
  amount_vnd AS amountVnd, created_at AS createdAt FROM payroll_items`;

function branchOutOfScope(session: SessionContext, branchId: string): boolean {
  return !session.branchIds.includes(branchId);
}

/** Các tháng YYYY-MM nằm trong [periodStart, periodEnd]. */
function monthsInRange(periodStart: string, periodEnd: string): string[] {
  const months: string[] = [];
  const start = new Date(`${periodStart}T00:00:00.000Z`);
  const end = new Date(`${periodEnd}T00:00:00.000Z`);
  const cur = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), 1));
  const last = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), 1));
  while (cur <= last) {
    months.push(cur.toISOString().slice(0, 7));
    cur.setUTCMonth(cur.getUTCMonth() + 1);
  }
  return months;
}

/** Ngày cuối tháng (YYYY-MM-DD) của tháng chứa dateStr. */
function lastDayOfMonth(dateStr: string): string {
  const [y, m] = dateStr.split("-").map(Number);
  const last = new Date(Date.UTC(y as number, (m as number), 0)).getUTCDate();
  return `${String(y).padStart(4, "0")}-${String(m).padStart(2, "0")}-${String(last).padStart(2, "0")}`;
}

/** Các dòng payroll_items cho một payroll: base + commission luôn có; các khoản điều chỉnh chỉ ghi khi > 0. */
function payrollItemStmts(
  db: D1Database,
  payrollId: string,
  vals: {
    baseSalaryVnd: number;
    commissionVnd: number;
    bonusVnd: number;
    allowanceVnd: number;
    deductionVnd: number;
    advanceVnd: number;
  },
  now: string,
): D1PreparedStatement[] {
  const lines: { type: string; label: string; amount: number }[] = [
    { type: "base", label: "Lương cơ bản", amount: vals.baseSalaryVnd },
    { type: "commission", label: "Hoa hồng", amount: vals.commissionVnd },
    { type: "bonus", label: "Thưởng", amount: vals.bonusVnd },
    { type: "allowance", label: "Phụ cấp", amount: vals.allowanceVnd },
    { type: "deduction", label: "Khấu trừ", amount: vals.deductionVnd },
    { type: "advance", label: "Tạm ứng", amount: vals.advanceVnd },
  ];
  const stmts: D1PreparedStatement[] = [];
  for (const line of lines) {
    if (line.type !== "base" && line.type !== "commission" && line.amount === 0) continue;
    stmts.push(
      db
        .prepare(
          `INSERT INTO payroll_items (id, payroll_id, type, label, amount_vnd, created_at)
           VALUES (?, ?, ?, ?, ?, ?)`,
        )
        .bind(newId(), payrollId, line.type, line.label, line.amount, now),
    );
  }
  return stmts;
}

async function loadPeriodWithPayrolls(db: D1Database, periodId: string, tenantId: string) {
  const period = await db.prepare(`${PERIOD_SELECT} WHERE id = ? AND tenant_id = ?`)
    .bind(periodId, tenantId)
    .first<PayrollPeriodRow>();
  if (!period) return null;
  const payrolls = await db.prepare(`${PAYROLL_SELECT} WHERE payroll_period_id = ? ORDER BY created_at ASC, id ASC`)
    .bind(periodId)
    .all<PayrollRow>();
  const rows = payrolls.results ?? [];
  const itemsByPayroll = new Map<string, PayrollItemRow[]>();
  for (const p of rows) {
    const items = await db.prepare(`${PAYROLL_ITEM_SELECT} WHERE payroll_id = ? ORDER BY created_at ASC, id ASC`)
      .bind(p.id)
      .all<PayrollItemRow>();
    itemsByPayroll.set(p.id, items.results ?? []);
  }
  return {
    ...period,
    payrolls: rows.map((p) => ({ ...p, items: itemsByPayroll.get(p.id) ?? [] })),
  };
}

payrollRoutes.use("/payroll", authMiddleware);
payrollRoutes.use("/payroll/*", authMiddleware);

payrollRoutes.post("/payroll/periods", requirePermission("payroll.manage"), async (c) => {
  const session = c.get("session");
  const tenantId = session.tenantId;
  if (!tenantId) {
    return c.json(apiError("FORBIDDEN", "Platform Admin không truy cập dữ liệu nghiệp vụ tenant."), 403);
  }
  const body = await c.req.json().catch(() => null);
  const parsed = payrollPeriodSchema.safeParse(body);
  if (!parsed.success) {
    return c.json(apiError("VALIDATION_ERROR", `Dữ liệu không hợp lệ: ${zodMessage(parsed.error)}`), 400);
  }
  const d = parsed.data;
  if (d.branchId && branchOutOfScope(session, d.branchId)) {
    return c.json(apiError("FORBIDDEN", "Chi nhánh ngoài phạm vi được phân quyền."), 403);
  }
  // Kỳ lương là 1 tháng dương lịch: bắt đầu ngày 1, kết thúc ngày cuối tháng.
  if (!d.periodStart.endsWith("-01")) {
    return c.json(apiError("UNPROCESSABLE", "periodStart phải là ngày 1 đầu tháng."), 422);
  }
  if (d.periodEnd !== lastDayOfMonth(d.periodStart)) {
    return c.json(apiError("UNPROCESSABLE", "periodEnd phải là ngày cuối cùng của cùng tháng với periodStart."), 422);
  }
  const dup = await c.env.DB
    .prepare(`SELECT id, branch_id AS branchId FROM payroll_periods WHERE tenant_id = ? AND period_start = ?`)
    .bind(tenantId, d.periodStart)
    .all<{ id: string; branchId: string | null }>();
  if ((dup.results ?? []).some((r) => r.branchId === (d.branchId ?? null))) {
    return c.json(apiError("CONFLICT", "Kỳ lương này đã tồn tại cho chi nhánh này."), 409);
  }
  const now = nowIso();
  const periodId = newId();
  await c.env.DB.batch([
    c.env.DB.prepare(
      `INSERT INTO payroll_periods (id, tenant_id, branch_id, period_start, period_end, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 'draft', ?, ?)`,
    ).bind(periodId, tenantId, d.branchId ?? null, d.periodStart, d.periodEnd, now, now),
    auditInsertStatement(c.env.DB, {
      tenantId,
      userId: session.userId,
      action: "payroll.period.create",
      entityType: "payroll_period",
      entityId: periodId,
      branchId: d.branchId ?? null,
      metadata: { periodStart: d.periodStart, periodEnd: d.periodEnd },
    }),
  ]);
  return c.json(
    {
      data: {
        id: periodId, tenantId, branchId: d.branchId ?? null,
        periodStart: d.periodStart, periodEnd: d.periodEnd,
        status: "draft", createdAt: now, updatedAt: now,
      },
    },
    201,
  );
});

payrollRoutes.post("/payroll/periods/:id/calculate", requirePermission("payroll.manage"), async (c) => {
  const session = c.get("session");
  const tenantId = session.tenantId;
  if (!tenantId) {
    return c.json(apiError("FORBIDDEN", "Platform Admin không truy cập dữ liệu nghiệp vụ tenant."), 403);
  }
  const period = await c.env.DB.prepare(`${PERIOD_SELECT} WHERE id = ? AND tenant_id = ?`)
    .bind((c.req.param("id") ?? ""), tenantId)
    .first<PayrollPeriodRow>();
  if (!period) {
    return c.json(apiError("NOT_FOUND", "Không tìm thấy kỳ lương."), 404);
  }
  if (period.branchId && branchOutOfScope(session, period.branchId)) {
    return c.json(apiError("FORBIDDEN", "Chi nhánh ngoài phạm vi được phân quyền."), 403);
  }
  if (period.status !== "draft" && period.status !== "calculating") {
    return c.json(apiError("UNPROCESSABLE", "Chỉ tính lương khi kỳ đang ở trạng thái draft/calculating."), 422);
  }
  const months = monthsInRange(period.periodStart, period.periodEnd);
  const employees = await c.env.DB
    .prepare(
      `SELECT id, base_salary_vnd AS baseSalaryVnd FROM employees
       WHERE tenant_id = ? AND status = 'active' AND deleted_at IS NULL
       ${period.branchId ? "AND branch_id = ?" : ""}
       ORDER BY created_at ASC, id ASC`,
    )
    .bind(tenantId, ...(period.branchId ? [period.branchId] : []))
    .all<{ id: string; baseSalaryVnd: number }>();
  const now = nowIso();
  const stmts: D1PreparedStatement[] = [];
  for (const emp of employees.results ?? []) {
    // Hoa hồng = SUM commission_calculations đã confirmed trong kỳ (theo period YYYY-MM).
    const monthPlaceholders = months.map(() => "?").join(",");
    const comm = await c.env.DB
      .prepare(
        `SELECT COALESCE(SUM(cc.commission_vnd), 0) AS total
         FROM commission_calculations cc
         JOIN invoices i ON i.id = cc.invoice_id
         WHERE cc.tenant_id = ? AND cc.employee_id = ? AND cc.status = 'confirmed'
           AND cc.period IN (${monthPlaceholders})
           ${period.branchId ? "AND i.branch_id = ?" : ""}`,
      )
      .bind(tenantId, emp.id, ...months, ...(period.branchId ? [period.branchId] : []))
      .first<{ total: number }>();
    const commission = comm?.total ?? 0;
    const existing = await c.env.DB
      .prepare(
        `SELECT id, bonus_vnd AS bonusVnd, allowance_vnd AS allowanceVnd,
                deduction_vnd AS deductionVnd, advance_vnd AS advanceVnd
         FROM payrolls WHERE payroll_period_id = ? AND employee_id = ?`,
      )
      .bind(period.id, emp.id)
      .first<{ id: string; bonusVnd: number; allowanceVnd: number; deductionVnd: number; advanceVnd: number }>();
    // Tính lại giữ nguyên các khoản điều chỉnh tay đã nhập trước đó.
    const vals = {
      baseSalaryVnd: emp.baseSalaryVnd,
      commissionVnd: commission,
      bonusVnd: existing?.bonusVnd ?? 0,
      allowanceVnd: existing?.allowanceVnd ?? 0,
      deductionVnd: existing?.deductionVnd ?? 0,
      advanceVnd: existing?.advanceVnd ?? 0,
    };
    const net = calculatePayrollNet(vals);
    const payrollId = existing?.id ?? newId();
    if (existing) {
      stmts.push(
        c.env.DB.prepare(
          `UPDATE payrolls SET base_salary_vnd = ?, commission_vnd = ?, net_vnd = ?, updated_at = ?
           WHERE id = ? AND tenant_id = ?`,
        ).bind(vals.baseSalaryVnd, vals.commissionVnd, net, now, payrollId, tenantId),
      );
      stmts.push(c.env.DB.prepare(`DELETE FROM payroll_items WHERE payroll_id = ?`).bind(payrollId));
    } else {
      stmts.push(
        c.env.DB.prepare(
          `INSERT INTO payrolls
             (id, payroll_period_id, employee_id, tenant_id,
              base_salary_vnd, commission_vnd, bonus_vnd, allowance_vnd,
              deduction_vnd, advance_vnd, net_vnd, status, paid_at, confirmed_by,
              created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, 0, 0, 0, 0, ?, 'draft', NULL, NULL, ?, ?)`,
        ).bind(
          payrollId, period.id, emp.id, tenantId,
          vals.baseSalaryVnd, vals.commissionVnd, net, now, now,
        ),
      );
    }
    stmts.push(...payrollItemStmts(c.env.DB, payrollId, vals, now));
  }
  stmts.push(
    c.env.DB.prepare(`UPDATE payroll_periods SET status = 'calculating', updated_at = ? WHERE id = ? AND tenant_id = ?`)
      .bind(now, period.id, tenantId),
  );
  stmts.push(
    auditInsertStatement(c.env.DB, {
      tenantId,
      userId: session.userId,
      action: "payroll.period.calculate",
      entityType: "payroll_period",
      entityId: period.id,
      branchId: period.branchId,
      metadata: { periodStart: period.periodStart, employeeCount: (employees.results ?? []).length },
    }),
  );
  await c.env.DB.batch(stmts);
  const detail = await loadPeriodWithPayrolls(c.env.DB, period.id, tenantId);
  return c.json({ data: detail });
});

payrollRoutes.patch(
  "/payroll/periods/:id/payrolls/:payrollId",
  requirePermission("payroll.manage"),
  async (c) => {
    const session = c.get("session");
    const tenantId = session.tenantId;
    if (!tenantId) {
      return c.json(apiError("FORBIDDEN", "Platform Admin không truy cập dữ liệu nghiệp vụ tenant."), 403);
    }
    const body = await c.req.json().catch(() => null);
    const parsed = payrollAdjustSchema.safeParse(body);
    if (!parsed.success) {
      return c.json(apiError("VALIDATION_ERROR", `Dữ liệu không hợp lệ: ${zodMessage(parsed.error)}`), 400);
    }
    const period = await c.env.DB.prepare(`${PERIOD_SELECT} WHERE id = ? AND tenant_id = ?`)
      .bind((c.req.param("id") ?? ""), tenantId)
      .first<PayrollPeriodRow>();
    if (!period) {
      return c.json(apiError("NOT_FOUND", "Không tìm thấy kỳ lương."), 404);
    }
    if (period.branchId && branchOutOfScope(session, period.branchId)) {
      return c.json(apiError("FORBIDDEN", "Chi nhánh ngoài phạm vi được phân quyền."), 403);
    }
    // Kỳ đã confirmed/paid thì không sửa được nữa (paid là bất biến).
    if (period.status !== "draft" && period.status !== "calculating") {
      return c.json(apiError("UNPROCESSABLE", "Kỳ lương đã chốt hoặc đã trả, không thể điều chỉnh."), 422);
    }
    const payroll = await c.env.DB.prepare(`${PAYROLL_SELECT} WHERE id = ? AND payroll_period_id = ? AND tenant_id = ?`)
      .bind((c.req.param("payrollId") ?? ""), period.id, tenantId)
      .first<PayrollRow>();
    if (!payroll) {
      return c.json(apiError("NOT_FOUND", "Không tìm thấy dòng lương."), 404);
    }
    const d = parsed.data;
    if (
      d.bonusVnd === undefined &&
      d.allowanceVnd === undefined &&
      d.deductionVnd === undefined &&
      d.advanceVnd === undefined
    ) {
      return c.json(apiError("VALIDATION_ERROR", "Không có khoản nào để điều chỉnh."), 400);
    }
    const vals = {
      baseSalaryVnd: payroll.baseSalaryVnd,
      commissionVnd: payroll.commissionVnd,
      bonusVnd: d.bonusVnd ?? payroll.bonusVnd,
      allowanceVnd: d.allowanceVnd ?? payroll.allowanceVnd,
      deductionVnd: d.deductionVnd ?? payroll.deductionVnd,
      advanceVnd: d.advanceVnd ?? payroll.advanceVnd,
    };
    const net = calculatePayrollNet(vals);
    const now = nowIso();
    await c.env.DB.batch([
      c.env.DB.prepare(
        `UPDATE payrolls SET bonus_vnd = ?, allowance_vnd = ?, deduction_vnd = ?,
                advance_vnd = ?, net_vnd = ?, updated_at = ? WHERE id = ? AND tenant_id = ?`,
      ).bind(vals.bonusVnd, vals.allowanceVnd, vals.deductionVnd, vals.advanceVnd, net, now, payroll.id, tenantId),
      c.env.DB.prepare(`DELETE FROM payroll_items WHERE payroll_id = ?`).bind(payroll.id),
      ...payrollItemStmts(c.env.DB, payroll.id, vals, now),
      auditInsertStatement(c.env.DB, {
        tenantId,
        userId: session.userId,
        action: "payroll.adjust",
        entityType: "payroll",
        entityId: payroll.id,
        branchId: period.branchId,
        metadata: { periodId: period.id, netVnd: net },
      }),
    ]);
    const items = await c.env.DB.prepare(`${PAYROLL_ITEM_SELECT} WHERE payroll_id = ? ORDER BY created_at ASC, id ASC`)
      .bind(payroll.id)
      .all<PayrollItemRow>();
    return c.json({ data: { ...payroll, ...vals, netVnd: net, updatedAt: now, items: items.results ?? [] } });
  },
);

payrollRoutes.post("/payroll/periods/:id/confirm", requirePermission("payroll.manage"), async (c) => {
  const session = c.get("session");
  const tenantId = session.tenantId;
  if (!tenantId) {
    return c.json(apiError("FORBIDDEN", "Platform Admin không truy cập dữ liệu nghiệp vụ tenant."), 403);
  }
  const period = await c.env.DB.prepare(`${PERIOD_SELECT} WHERE id = ? AND tenant_id = ?`)
    .bind((c.req.param("id") ?? ""), tenantId)
    .first<PayrollPeriodRow>();
  if (!period) {
    return c.json(apiError("NOT_FOUND", "Không tìm thấy kỳ lương."), 404);
  }
  if (period.branchId && branchOutOfScope(session, period.branchId)) {
    return c.json(apiError("FORBIDDEN", "Chi nhánh ngoài phạm vi được phân quyền."), 403);
  }
  // CONTRACTS.md §4: confirm yêu cầu draft/calculating.
  if (period.status !== "draft" && period.status !== "calculating") {
    return c.json(apiError("UNPROCESSABLE", "Chỉ chốt được kỳ lương đang ở trạng thái draft/calculating."), 422);
  }
  const now = nowIso();
  await c.env.DB.batch([
    c.env.DB.prepare(`UPDATE payroll_periods SET status = 'confirmed', updated_at = ? WHERE id = ? AND tenant_id = ?`)
      .bind(now, period.id, tenantId),
    c.env.DB.prepare(
      `UPDATE payrolls SET status = 'confirmed', confirmed_by = ?, updated_at = ?
       WHERE payroll_period_id = ? AND tenant_id = ?`,
    ).bind(session.userId, now, period.id, tenantId),
    auditInsertStatement(c.env.DB, {
      tenantId,
      userId: session.userId,
      action: "payroll.period.confirm",
      entityType: "payroll_period",
      entityId: period.id,
      branchId: period.branchId,
      metadata: { periodStart: period.periodStart },
    }),
  ]);
  return c.json({ data: { ...period, status: "confirmed", updatedAt: now } });
});

payrollRoutes.post("/payroll/periods/:id/mark-paid", requirePermission("payroll.manage"), async (c) => {
  const session = c.get("session");
  const tenantId = session.tenantId;
  if (!tenantId) {
    return c.json(apiError("FORBIDDEN", "Platform Admin không truy cập dữ liệu nghiệp vụ tenant."), 403);
  }
  const period = await c.env.DB.prepare(`${PERIOD_SELECT} WHERE id = ? AND tenant_id = ?`)
    .bind((c.req.param("id") ?? ""), tenantId)
    .first<PayrollPeriodRow>();
  if (!period) {
    return c.json(apiError("NOT_FOUND", "Không tìm thấy kỳ lương."), 404);
  }
  if (period.branchId && branchOutOfScope(session, period.branchId)) {
    return c.json(apiError("FORBIDDEN", "Chi nhánh ngoài phạm vi được phân quyền."), 403);
  }
  if (period.status !== "confirmed") {
    return c.json(apiError("UNPROCESSABLE", "Chỉ đánh dấu đã trả cho kỳ lương đã chốt (confirmed)."), 422);
  }
  const now = nowIso();
  // payroll_periods không có cột paid_at: paid_at ghi trên từng dòng payrolls.
  await c.env.DB.batch([
    c.env.DB.prepare(`UPDATE payroll_periods SET status = 'paid', updated_at = ? WHERE id = ? AND tenant_id = ?`)
      .bind(now, period.id, tenantId),
    c.env.DB.prepare(
      `UPDATE payrolls SET status = 'paid', paid_at = ?, updated_at = ?
       WHERE payroll_period_id = ? AND tenant_id = ?`,
    ).bind(now, now, period.id, tenantId),
    auditInsertStatement(c.env.DB, {
      tenantId,
      userId: session.userId,
      action: "payroll.period.mark_paid",
      entityType: "payroll_period",
      entityId: period.id,
      branchId: period.branchId,
      metadata: { periodStart: period.periodStart, paidAt: now },
    }),
  ]);
  return c.json({ data: { ...period, status: "paid", updatedAt: now } });
});

payrollRoutes.get("/payroll/periods", requirePermission("payroll.view"), async (c) => {
  const session = c.get("session");
  const tenantId = session.tenantId;
  if (!tenantId) {
    return c.json(apiError("FORBIDDEN", "Platform Admin không truy cập dữ liệu nghiệp vụ tenant."), 403);
  }
  const { page, limit, offset } = pagination(c);
  const branchId = c.req.query("branch_id");
  const status = c.req.query("status");
  if (status && !PERIOD_STATUSES.includes(status as (typeof PERIOD_STATUSES)[number])) {
    return c.json(apiError("VALIDATION_ERROR", "Trạng thái kỳ lương không hợp lệ."), 400);
  }
  const conditions = ["tenant_id = ?"];
  const params: unknown[] = [tenantId];
  if (branchId) {
    if (branchOutOfScope(session, branchId)) {
      return c.json(apiError("FORBIDDEN", "Chi nhánh ngoài phạm vi được phân quyền."), 403);
    }
    conditions.push("branch_id = ?");
    params.push(branchId);
  } else if (session.branchIds.length > 0) {
    conditions.push(`(branch_id IS NULL OR branch_id IN (${session.branchIds.map(() => "?").join(",")}))`);
    params.push(...session.branchIds);
  }
  if (status) {
    conditions.push("status = ?");
    params.push(status);
  }
  const where = `WHERE ${conditions.join(" AND ")}`;
  const countRow = await c.env.DB.prepare(`SELECT COUNT(*) AS total FROM payroll_periods ${where}`)
    .bind(...params)
    .first<{ total: number }>();
  const total = countRow?.total ?? 0;
  const rows = await c.env.DB.prepare(
    `${PERIOD_SELECT} ${where} ORDER BY period_start DESC, created_at DESC LIMIT ? OFFSET ?`,
  )
    .bind(...params, limit, offset)
    .all<PayrollPeriodRow>();
  return c.json({ data: rows.results ?? [], meta: pageMeta(page, limit, total) });
});

payrollRoutes.get("/payroll/periods/:id", requirePermission("payroll.view"), async (c) => {
  const session = c.get("session");
  const tenantId = session.tenantId;
  if (!tenantId) {
    return c.json(apiError("FORBIDDEN", "Platform Admin không truy cập dữ liệu nghiệp vụ tenant."), 403);
  }
  const detail = await loadPeriodWithPayrolls(c.env.DB, (c.req.param("id") ?? ""), tenantId);
  if (!detail) {
    return c.json(apiError("NOT_FOUND", "Không tìm thấy kỳ lương."), 404);
  }
  if (detail.branchId && branchOutOfScope(session, detail.branchId)) {
    return c.json(apiError("FORBIDDEN", "Chi nhánh ngoài phạm vi được phân quyền."), 403);
  }
  // Technician chỉ thấy dòng lương của chính mình.
  if (session.role === "technician") {
    const emp = await c.env.DB
      .prepare(`SELECT id FROM employees WHERE tenant_id = ? AND user_id = ? AND deleted_at IS NULL`)
      .bind(tenantId, session.userId)
      .first<{ id: string }>();
    const ownId = emp?.id ?? null;
    return c.json({ data: { ...detail, payrolls: detail.payrolls.filter((p) => p.employeeId === ownId) } });
  }
  return c.json({ data: detail });
});

payrollRoutes.get("/payroll/me", requirePermission("payroll.view"), async (c) => {
  const session = c.get("session");
  const tenantId = session.tenantId;
  if (!tenantId) {
    return c.json(apiError("FORBIDDEN", "Platform Admin không truy cập dữ liệu nghiệp vụ tenant."), 403);
  }
  const { page, limit, offset } = pagination(c);
  const emp = await c.env.DB
    .prepare(`SELECT id FROM employees WHERE tenant_id = ? AND user_id = ? AND deleted_at IS NULL`)
    .bind(tenantId, session.userId)
    .first<{ id: string }>();
  if (!emp) {
    return c.json({ data: [], meta: pageMeta(page, limit, 0) });
  }
  const countRow = await c.env.DB
    .prepare(`SELECT COUNT(*) AS total FROM payrolls WHERE tenant_id = ? AND employee_id = ?`)
    .bind(tenantId, emp.id)
    .first<{ total: number }>();
  const total = countRow?.total ?? 0;
  const rows = await c.env.DB
    .prepare(
      `SELECT p.id, p.payroll_period_id AS payrollPeriodId,
              p.employee_id AS employeeId, p.tenant_id AS tenantId,
              p.base_salary_vnd AS baseSalaryVnd, p.commission_vnd AS commissionVnd,
              p.bonus_vnd AS bonusVnd, p.allowance_vnd AS allowanceVnd,
              p.deduction_vnd AS deductionVnd, p.advance_vnd AS advanceVnd,
              p.net_vnd AS netVnd, p.status, p.paid_at AS paidAt, p.confirmed_by AS confirmedBy,
              p.created_at AS createdAt, p.updated_at AS updatedAt
       FROM payrolls p
       JOIN payroll_periods pp ON pp.id = p.payroll_period_id
       WHERE p.tenant_id = ? AND p.employee_id = ?
       ORDER BY pp.period_start DESC, p.created_at DESC LIMIT ? OFFSET ?`,
    )
    .bind(tenantId, emp.id, limit, offset)
    .all<PayrollRow>();
  const data: Record<string, unknown>[] = [];
  for (const p of rows.results ?? []) {
    const items = await c.env.DB.prepare(`${PAYROLL_ITEM_SELECT} WHERE payroll_id = ? ORDER BY created_at ASC, id ASC`)
      .bind(p.id)
      .all<PayrollItemRow>();
    const period = await c.env.DB.prepare(
      `SELECT period_start AS periodStart, period_end AS periodEnd, status AS periodStatus,
              branch_id AS periodBranchId FROM payroll_periods WHERE id = ?`,
    )
      .bind(p.payrollPeriodId)
      .first<{ periodStart: string; periodEnd: string; periodStatus: string; periodBranchId: string | null }>();
    data.push({ ...p, ...period, items: items.results ?? [] });
  }
  return c.json({ data, meta: pageMeta(page, limit, total) });
});
