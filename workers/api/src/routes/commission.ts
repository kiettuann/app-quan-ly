// Commission — rules (versioned), calculations, simulator.
// Nguồn: CONTRACTS.md §4, API_SPEC.md §6, DATABASE_SCHEMA.md §6, PERMISSIONS.md.
// Rule versioned: tạo version mới snapshot toàn bộ rule JSON vào
// commission_rule_versions + tăng commission_rules.version; calculation luôn
// lưu rule_version_id đã dùng; đổi rule không tính lại lịch sử.
import { Hono } from "hono";
import { z } from "zod";
import type { ZodError } from "zod";
import {
  apiError,
  calculateCommissions,
  isoDate,
  isoDateTime,
  vndInt,
  type CommissionItemInput,
  type SessionContext,
} from "@quanly/shared";
import type { Env } from "../index.js";
import { authMiddleware } from "../auth.js";
import { requirePermission } from "../rbac.js";
import { auditInsertStatement } from "../audit.js";
import { newId, nowIso, pageMeta, pagination } from "../db.js";
import { commissionRuleSchema } from "../validation.js";
import { loadActiveCommissionRules } from "./invoices.js";

export const commissionRoutes = new Hono<{ Bindings: Env; Variables: { session: SessionContext } }>();

function zodMessage(err: ZodError): string {
  return err.issues.map((i) => `${i.path.join(".") || "body"}: ${i.message}`).join("; ");
}

const SCOPE_TYPES = ["service", "product", "employee", "role", "branch", "sales_tier"] as const;
const RULE_STATUSES = ["active", "inactive", "draft"] as const;
const CALC_STATUSES = ["pending", "confirmed", "paid", "reversed"] as const;

interface CommissionRuleRow {
  id: string;
  tenantId: string;
  name: string;
  scopeType: string;
  scopeRefId: string | null;
  rateType: string;
  rateValue: number;
  minSalesVnd: number | null;
  maxAmountVnd: number | null;
  priority: number;
  validFrom: string;
  validTo: string | null;
  status: string;
  version: number;
  createdAt: string;
  updatedAt: string;
}

const RULE_SELECT = `SELECT id, tenant_id AS tenantId, name,
  scope_type AS scopeType, scope_ref_id AS scopeRefId,
  rate_type AS rateType, rate_value AS rateValue,
  min_sales_vnd AS minSalesVnd, max_amount_vnd AS maxAmountVnd,
  priority, valid_from AS validFrom, valid_to AS validTo,
  status, version, created_at AS createdAt, updated_at AS updatedAt
  FROM commission_rules`;

/** Snapshot JSON của một rule tại thời điểm chốt version (bất biến). */
function ruleSnapshot(rule: {
  id: string;
  name: string;
  scopeType: string;
  scopeRefId: string | null;
  rateType: string;
  rateValue: number;
  minSalesVnd: number | null;
  maxAmountVnd: number | null;
  priority: number;
  validFrom: string;
  validTo: string | null;
  status: string;
  version: number;
}): string {
  return JSON.stringify({
    id: rule.id,
    name: rule.name,
    scopeType: rule.scopeType,
    scopeRefId: rule.scopeRefId,
    rateType: rule.rateType,
    rateValue: rule.rateValue,
    minSalesVnd: rule.minSalesVnd,
    maxAmountVnd: rule.maxAmountVnd,
    priority: rule.priority,
    validFrom: rule.validFrom,
    validTo: rule.validTo,
    status: rule.status,
    version: rule.version,
  });
}

function branchOutOfScope(session: SessionContext, branchId: string): boolean {
  return !session.branchIds.includes(branchId);
}

/** Kiểm tra rate percent 0–100 (business rule -> 422, không phải lỗi zod 400). */
function percentError(rateType: string, rateValue: number): string | null {
  if (rateType === "percent" && (!Number.isInteger(rateValue) || rateValue < 0 || rateValue > 100)) {
    return "Tỷ lệ hoa hồng % phải là số nguyên 0–100.";
  }
  return null;
}

function validityError(validFrom: string, validTo: string | null | undefined): string | null {
  if (validTo && validTo <= validFrom) {
    return "Ngày hết hiệu lực (validTo) phải sau ngày bắt đầu (validFrom).";
  }
  return null;
}

commissionRoutes.use("/commission", authMiddleware);
commissionRoutes.use("/commission/*", authMiddleware);

commissionRoutes.get("/commission/rules", requirePermission("commission.manage"), async (c) => {
  const session = c.get("session");
  const tenantId = session.tenantId;
  if (!tenantId) {
    return c.json(apiError("FORBIDDEN", "Platform Admin không truy cập dữ liệu nghiệp vụ tenant."), 403);
  }
  const { page, limit, offset } = pagination(c);
  const status = c.req.query("status");
  if (status && !RULE_STATUSES.includes(status as (typeof RULE_STATUSES)[number])) {
    return c.json(apiError("VALIDATION_ERROR", "Trạng thái rule không hợp lệ."), 400);
  }
  const where = status ? "WHERE r.tenant_id = ? AND r.status = ?" : "WHERE r.tenant_id = ?";
  const params: unknown[] = status ? [tenantId, status] : [tenantId];
  const countRow = await c.env.DB.prepare(`SELECT COUNT(*) AS total FROM commission_rules r ${where}`)
    .bind(...params)
    .first<{ total: number }>();
  const total = countRow?.total ?? 0;
  // Kèm version hiện tại + snapshot (version = rule.version).
  const rows = await c.env.DB
    .prepare(
      `${RULE_SELECT.replace("FROM commission_rules", "FROM commission_rules r")}
       ${where}
       ORDER BY r.priority ASC, r.created_at ASC LIMIT ? OFFSET ?`,
    )
    .bind(...params, limit, offset)
    .all<CommissionRuleRow>();
  type RuleWithVersion = CommissionRuleRow & {
    currentVersion: { id: string | null; version: number; snapshot: Record<string, unknown> | null };
  };
  const data: RuleWithVersion[] = (rows.results ?? []).map((r) => ({
    ...r,
    currentVersion: { id: null, version: r.version, snapshot: null },
  }));
  // Nạp snapshot của version hiện tại cho từng rule (truy vấn riêng, rõ ràng).
  for (const rule of data) {
    const v = await c.env.DB
      .prepare(
        `SELECT id, snapshot_json AS snapshotJson FROM commission_rule_versions
         WHERE rule_id = ? AND version = ?`,
      )
      .bind(rule.id, rule.version)
      .first<{ id: string; snapshotJson: string }>();
    rule.currentVersion = {
      id: v?.id ?? null,
      version: rule.version,
      snapshot: v ? (JSON.parse(v.snapshotJson) as Record<string, unknown>) : null,
    };
  }
  return c.json({ data, meta: pageMeta(page, limit, total) });
});

commissionRoutes.post("/commission/rules", requirePermission("commission.manage"), async (c) => {
  const session = c.get("session");
  const tenantId = session.tenantId;
  if (!tenantId) {
    return c.json(apiError("FORBIDDEN", "Platform Admin không truy cập dữ liệu nghiệp vụ tenant."), 403);
  }
  const body = await c.req.json().catch(() => null);
  const parsed = commissionRuleSchema.safeParse(body);
  if (!parsed.success) {
    return c.json(apiError("VALIDATION_ERROR", `Dữ liệu không hợp lệ: ${zodMessage(parsed.error)}`), 400);
  }
  const d = parsed.data;
  const pctErr = percentError(d.rateType, d.rateValue);
  if (pctErr) return c.json(apiError("UNPROCESSABLE", pctErr), 422);
  const valErr = validityError(d.validFrom, d.validTo ?? null);
  if (valErr) return c.json(apiError("UNPROCESSABLE", valErr), 422);
  const now = nowIso();
  const ruleId = newId();
  const versionId = newId();
  const rule: CommissionRuleRow = {
    id: ruleId,
    tenantId,
    name: d.name,
    scopeType: d.scopeType,
    scopeRefId: d.scopeRefId ?? null,
    rateType: d.rateType,
    rateValue: d.rateValue,
    minSalesVnd: d.minSalesVnd ?? null,
    maxAmountVnd: d.maxAmountVnd ?? null,
    priority: d.priority,
    validFrom: d.validFrom,
    validTo: d.validTo ?? null,
    status: d.status ?? "active",
    version: 1,
    createdAt: now,
    updatedAt: now,
  };
  await c.env.DB.batch([
    c.env.DB.prepare(
      `INSERT INTO commission_rules
         (id, tenant_id, name, scope_type, scope_ref_id, rate_type, rate_value,
          min_sales_vnd, max_amount_vnd, priority, valid_from, valid_to, status,
          version, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`,
    ).bind(
      ruleId, tenantId, d.name, d.scopeType, d.scopeRefId ?? null, d.rateType, d.rateValue,
      d.minSalesVnd ?? null, d.maxAmountVnd ?? null, d.priority, d.validFrom, d.validTo ?? null,
      d.status ?? "active", now, now,
    ),
    c.env.DB.prepare(
      `INSERT INTO commission_rule_versions (id, rule_id, version, snapshot_json, created_at)
       VALUES (?, ?, 1, ?, ?)`,
    ).bind(versionId, ruleId, ruleSnapshot(rule), now),
    auditInsertStatement(c.env.DB, {
      tenantId,
      userId: session.userId,
      action: "commission.rule.create",
      entityType: "commission_rule",
      entityId: ruleId,
      metadata: { name: d.name, scopeType: d.scopeType, rateType: d.rateType, rateValue: d.rateValue, version: 1 },
    }),
  ]);
  return c.json(
    { data: { ...rule, currentVersion: { id: versionId, version: 1, snapshot: JSON.parse(ruleSnapshot(rule)) } } },
    201,
  );
});

commissionRoutes.post(
  "/commission/rules/:id/versions",
  requirePermission("commission.manage"),
  async (c) => {
    const session = c.get("session");
    const tenantId = session.tenantId;
    if (!tenantId) {
      return c.json(apiError("FORBIDDEN", "Platform Admin không truy cập dữ liệu nghiệp vụ tenant."), 403);
    }
    const body = await c.req.json().catch(() => null);
    const parsed = commissionRuleSchema.safeParse(body);
    if (!parsed.success) {
      return c.json(apiError("VALIDATION_ERROR", `Dữ liệu không hợp lệ: ${zodMessage(parsed.error)}`), 400);
    }
    const d = parsed.data;
    const pctErr = percentError(d.rateType, d.rateValue);
    if (pctErr) return c.json(apiError("UNPROCESSABLE", pctErr), 422);
    const valErr = validityError(d.validFrom, d.validTo ?? null);
    if (valErr) return c.json(apiError("UNPROCESSABLE", valErr), 422);
    const rule = await c.env.DB.prepare(`${RULE_SELECT} WHERE id = ? AND tenant_id = ?`)
      .bind(c.req.param("id"), tenantId)
      .first<CommissionRuleRow>();
    if (!rule) {
      return c.json(apiError("NOT_FOUND", "Không tìm thấy rule hoa hồng."), 404);
    }
    const now = nowIso();
    const newVersion = rule.version + 1;
    const updated: CommissionRuleRow = {
      ...rule,
      name: d.name,
      scopeType: d.scopeType,
      scopeRefId: d.scopeRefId ?? null,
      rateType: d.rateType,
      rateValue: d.rateValue,
      minSalesVnd: d.minSalesVnd ?? null,
      maxAmountVnd: d.maxAmountVnd ?? null,
      priority: d.priority,
      validFrom: d.validFrom,
      validTo: d.validTo ?? null,
      status: d.status ?? rule.status,
      version: newVersion,
      updatedAt: now,
    };
    const versionId = newId();
    await c.env.DB.batch([
      c.env.DB.prepare(
        `UPDATE commission_rules SET name = ?, scope_type = ?, scope_ref_id = ?,
                rate_type = ?, rate_value = ?, min_sales_vnd = ?, max_amount_vnd = ?,
                priority = ?, valid_from = ?, valid_to = ?, status = ?,
                version = ?, updated_at = ? WHERE id = ? AND tenant_id = ?`,
      ).bind(
        d.name, d.scopeType, d.scopeRefId ?? null, d.rateType, d.rateValue,
        d.minSalesVnd ?? null, d.maxAmountVnd ?? null, d.priority, d.validFrom,
        d.validTo ?? null, d.status ?? rule.status, newVersion, now, rule.id, tenantId,
      ),
      c.env.DB.prepare(
        `INSERT INTO commission_rule_versions (id, rule_id, version, snapshot_json, created_at)
         VALUES (?, ?, ?, ?, ?)`,
      ).bind(versionId, rule.id, newVersion, ruleSnapshot(updated), now),
      auditInsertStatement(c.env.DB, {
        tenantId,
        userId: session.userId,
        action: "commission.rule.version",
        entityType: "commission_rule",
        entityId: rule.id,
        metadata: { version: newVersion, rateType: d.rateType, rateValue: d.rateValue },
      }),
    ]);
    // Calculation cũ giữ nguyên rule_version_id cũ — không tính lại.
    return c.json(
      {
        data: {
          ...updated,
          currentVersion: { id: versionId, version: newVersion, snapshot: JSON.parse(ruleSnapshot(updated)) },
        },
      },
      201,
    );
  },
);

// PATCH chỉ đổi metadata (tên/trạng thái/ưu tiên/hiệu lực), KHÔNG tạo version.
// Đổi tỷ lệ (rateType/rateValue) hay phạm vi (scopeType/scopeRefId/
// minSalesVnd/maxAmountVnd) phải qua POST /commission/rules/:id/versions -> 422.
const commissionRulePatchSchema = z.object({
  name: z.string().trim().min(1).max(100).optional(),
  status: z.enum(["active", "inactive", "draft"]).optional(),
  priority: z.number().int().min(1).max(100).optional(),
  validFrom: isoDate.optional(),
  validTo: isoDate.optional().nullable(),
  rateType: z.enum(["percent", "fixed"]).optional(),
  rateValue: z.number().int().optional(),
  scopeType: z.enum(SCOPE_TYPES).optional(),
  scopeRefId: z.string().optional().nullable(),
  minSalesVnd: vndInt.optional().nullable(),
  maxAmountVnd: vndInt.optional().nullable(),
});

commissionRoutes.patch("/commission/rules/:id", requirePermission("commission.manage"), async (c) => {
  const session = c.get("session");
  const tenantId = session.tenantId;
  if (!tenantId) {
    return c.json(apiError("FORBIDDEN", "Platform Admin không truy cập dữ liệu nghiệp vụ tenant."), 403);
  }
  const body = await c.req.json().catch(() => null);
  const parsed = commissionRulePatchSchema.safeParse(body);
  if (!parsed.success) {
    return c.json(apiError("VALIDATION_ERROR", `Dữ liệu không hợp lệ: ${zodMessage(parsed.error)}`), 400);
  }
  const d = parsed.data;
  if (
    d.rateType !== undefined ||
    d.rateValue !== undefined ||
    d.scopeType !== undefined ||
    d.scopeRefId !== undefined ||
    d.minSalesVnd !== undefined ||
    d.maxAmountVnd !== undefined
  ) {
    return c.json(
      apiError(
        "UNPROCESSABLE",
        "Đổi tỷ lệ hoặc phạm vi của rule phải tạo version mới qua POST /commission/rules/:id/versions.",
      ),
      422,
    );
  }
  const rule = await c.env.DB.prepare(`${RULE_SELECT} WHERE id = ? AND tenant_id = ?`)
    .bind(c.req.param("id"), tenantId)
    .first<CommissionRuleRow>();
  if (!rule) {
    return c.json(apiError("NOT_FOUND", "Không tìm thấy rule hoa hồng."), 404);
  }
  const effFrom = d.validFrom ?? rule.validFrom;
  const effTo = d.validTo !== undefined ? d.validTo : rule.validTo;
  const valErr = validityError(effFrom, effTo);
  if (valErr) return c.json(apiError("UNPROCESSABLE", valErr), 422);
  const sets: string[] = [];
  const params: unknown[] = [];
  if (d.name !== undefined) {
    sets.push("name = ?");
    params.push(d.name);
  }
  if (d.status !== undefined) {
    sets.push("status = ?");
    params.push(d.status);
  }
  if (d.priority !== undefined) {
    sets.push("priority = ?");
    params.push(d.priority);
  }
  if (d.validFrom !== undefined) {
    sets.push("valid_from = ?");
    params.push(d.validFrom);
  }
  if (d.validTo !== undefined) {
    sets.push("valid_to = ?");
    params.push(d.validTo);
  }
  if (sets.length === 0) {
    return c.json(apiError("VALIDATION_ERROR", "Không có trường metadata nào để cập nhật."), 400);
  }
  const now = nowIso();
  sets.push("updated_at = ?");
  params.push(now);
  await c.env.DB.batch([
    c.env.DB.prepare(`UPDATE commission_rules SET ${sets.join(", ")} WHERE id = ? AND tenant_id = ?`)
      .bind(...params, rule.id, tenantId),
    auditInsertStatement(c.env.DB, {
      tenantId,
      userId: session.userId,
      action: "commission.rule.update",
      entityType: "commission_rule",
      entityId: rule.id,
      metadata: { fields: Object.keys(d) },
    }),
  ]);
  const updated: CommissionRuleRow = {
    ...rule,
    name: d.name ?? rule.name,
    status: d.status ?? rule.status,
    priority: d.priority ?? rule.priority,
    validFrom: d.validFrom ?? rule.validFrom,
    validTo: d.validTo !== undefined ? d.validTo : rule.validTo,
    updatedAt: now,
  };
  return c.json({ data: updated });
});

commissionRoutes.get("/commission/calculations", requirePermission("payroll.view"), async (c) => {
  const session = c.get("session");
  const tenantId = session.tenantId;
  if (!tenantId) {
    return c.json(apiError("FORBIDDEN", "Platform Admin không truy cập dữ liệu nghiệp vụ tenant."), 403);
  }
  const { page, limit, offset } = pagination(c);
  const employeeId = c.req.query("employee_id");
  const period = c.req.query("period");
  const status = c.req.query("status");
  const branchId = c.req.query("branch_id");
  if (status && !CALC_STATUSES.includes(status as (typeof CALC_STATUSES)[number])) {
    return c.json(apiError("VALIDATION_ERROR", "Trạng thái commission không hợp lệ."), 400);
  }
  if (period && !/^\d{4}-\d{2}$/.test(period)) {
    return c.json(apiError("VALIDATION_ERROR", "Period phải đúng định dạng YYYY-MM."), 400);
  }
  // Technician chỉ được xem hoa hồng của chính mình.
  let forcedEmployeeId: string | null = null;
  if (session.role === "technician") {
    const emp = await c.env.DB
      .prepare(`SELECT id FROM employees WHERE tenant_id = ? AND user_id = ? AND deleted_at IS NULL`)
      .bind(tenantId, session.userId)
      .first<{ id: string }>();
    if (!emp) return c.json({ data: [], meta: pageMeta(page, limit, 0) });
    forcedEmployeeId = emp.id;
    if (employeeId && employeeId !== forcedEmployeeId) {
      return c.json(apiError("FORBIDDEN", "Chỉ được xem hoa hồng của mình."), 403);
    }
  }
  const effEmployeeId = forcedEmployeeId ?? employeeId ?? null;
  const conditions = ["cc.tenant_id = ?"];
  const params: unknown[] = [tenantId];
  if (branchId) {
    if (branchOutOfScope(session, branchId)) {
      return c.json(apiError("FORBIDDEN", "Chi nhánh ngoài phạm vi được phân quyền."), 403);
    }
    conditions.push("i.branch_id = ?");
    params.push(branchId);
  } else if (session.branchIds.length > 0) {
    conditions.push(`i.branch_id IN (${session.branchIds.map(() => "?").join(",")})`);
    params.push(...session.branchIds);
  } else {
    conditions.push("1 = 0");
  }
  if (effEmployeeId) {
    conditions.push("cc.employee_id = ?");
    params.push(effEmployeeId);
  }
  if (period) {
    conditions.push("cc.period = ?");
    params.push(period);
  }
  if (status) {
    conditions.push("cc.status = ?");
    params.push(status);
  }
  const where = `WHERE ${conditions.join(" AND ")}`;
  const join = `FROM commission_calculations cc
    JOIN invoices i ON i.id = cc.invoice_id
    LEFT JOIN employees e ON e.id = cc.employee_id`;
  const countRow = await c.env.DB.prepare(`SELECT COUNT(*) AS total ${join} ${where}`)
    .bind(...params)
    .first<{ total: number }>();
  const total = countRow?.total ?? 0;
  const rows = await c.env.DB
    .prepare(
      `SELECT cc.id, cc.tenant_id AS tenantId, cc.invoice_id AS invoiceId,
              cc.employee_id AS employeeId, cc.rule_version_id AS ruleVersionId,
              cc.base_amount_vnd AS baseAmountVnd, cc.commission_vnd AS commissionVnd,
              cc.status, cc.period, cc.created_at AS createdAt, cc.updated_at AS updatedAt,
              e.full_name AS employeeName, i.invoice_no AS invoiceNo, i.branch_id AS branchId
       ${join} ${where} ORDER BY cc.created_at DESC, cc.id DESC LIMIT ? OFFSET ?`,
    )
    .bind(...params, limit, offset)
    .all();
  return c.json({ data: rows.results ?? [], meta: pageMeta(page, limit, total) });
});

commissionRoutes.post(
  "/commission/calculations/:id/confirm",
  requirePermission("commission.manage"),
  async (c) => {
    const session = c.get("session");
    const tenantId = session.tenantId;
    if (!tenantId) {
      return c.json(apiError("FORBIDDEN", "Platform Admin không truy cập dữ liệu nghiệp vụ tenant."), 403);
    }
    const calc = await c.env.DB
      .prepare(
        `SELECT id, tenant_id AS tenantId, invoice_id AS invoiceId, employee_id AS employeeId,
                rule_version_id AS ruleVersionId, base_amount_vnd AS baseAmountVnd,
                commission_vnd AS commissionVnd, status, period,
                created_at AS createdAt, updated_at AS updatedAt
         FROM commission_calculations WHERE id = ? AND tenant_id = ?`,
      )
      .bind(c.req.param("id"), tenantId)
      .first<{
        id: string;
        tenantId: string;
        invoiceId: string;
        employeeId: string;
        ruleVersionId: string;
        baseAmountVnd: number;
        commissionVnd: number;
        status: string;
        period: string;
        createdAt: string;
        updatedAt: string;
      }>();
    if (!calc) {
      return c.json(apiError("NOT_FOUND", "Không tìm thấy bản tính hoa hồng."), 404);
    }
    if (calc.status !== "pending") {
      return c.json(apiError("UNPROCESSABLE", "Chỉ xác nhận được hoa hồng đang chờ (pending)."), 422);
    }
    const now = nowIso();
    await c.env.DB.batch([
      c.env.DB.prepare(`UPDATE commission_calculations SET status = 'confirmed', updated_at = ? WHERE id = ? AND tenant_id = ?`)
        .bind(now, calc.id, tenantId),
      auditInsertStatement(c.env.DB, {
        tenantId,
        userId: session.userId,
        action: "commission.calculation.confirm",
        entityType: "commission_calculation",
        entityId: calc.id,
        metadata: {},
      }),
    ]);
    return c.json({ data: { ...calc, status: "confirmed", updatedAt: now } });
  },
);

const simulateSchema = z.object({
  items: z
    .array(
      z.object({
        itemType: z.enum(["service", "product"]),
        refId: z.string().nullable().optional(),
        lineTotalVnd: vndInt,
        employeeId: z.string().uuid().nullable().optional(),
        employeeRole: z.string().nullable().optional(),
        branchId: z.string().uuid(),
      }),
    )
    .min(1, "Cần ít nhất 1 dòng để mô phỏng."),
  at: isoDateTime.optional(),
});

commissionRoutes.post("/commission/simulate", requirePermission("commission.simulate"), async (c) => {
  const session = c.get("session");
  const tenantId = session.tenantId;
  if (!tenantId) {
    return c.json(apiError("FORBIDDEN", "Platform Admin không truy cập dữ liệu nghiệp vụ tenant."), 403);
  }
  const body = await c.req.json().catch(() => null);
  const parsed = simulateSchema.safeParse(body);
  if (!parsed.success) {
    return c.json(apiError("VALIDATION_ERROR", `Dữ liệu không hợp lệ: ${zodMessage(parsed.error)}`), 400);
  }
  for (const item of parsed.data.items) {
    if (branchOutOfScope(session, item.branchId)) {
      return c.json(apiError("FORBIDDEN", "Chi nhánh ngoài phạm vi được phân quyền."), 403);
    }
  }
  const at = parsed.data.at ?? nowIso();
  const active = await loadActiveCommissionRules(c.env.DB, tenantId);
  const inputs: CommissionItemInput[] = parsed.data.items.map((item) => ({
    id: newId(),
    itemType: item.itemType,
    refId: item.refId ?? null,
    lineTotalVnd: item.lineTotalVnd,
    employeeId: item.employeeId ?? null,
    employeeRole: item.employeeRole ?? null,
    branchId: item.branchId,
  }));
  // Chỉ tính thử — không ghi dữ liệu, không ảnh hưởng payroll.
  const result = calculateCommissions(inputs, active.map((a) => a.rule), at);
  return c.json({ data: result });
});

commissionRoutes.get("/commission/me", requirePermission("payroll.view"), async (c) => {
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
    .prepare(`SELECT COUNT(*) AS total FROM commission_calculations WHERE tenant_id = ? AND employee_id = ?`)
    .bind(tenantId, emp.id)
    .first<{ total: number }>();
  const total = countRow?.total ?? 0;
  const rows = await c.env.DB
    .prepare(
      `SELECT cc.id, cc.tenant_id AS tenantId, cc.invoice_id AS invoiceId,
              cc.employee_id AS employeeId, cc.rule_version_id AS ruleVersionId,
              cc.base_amount_vnd AS baseAmountVnd, cc.commission_vnd AS commissionVnd,
              cc.status, cc.period, cc.created_at AS createdAt, cc.updated_at AS updatedAt,
              i.invoice_no AS invoiceNo, i.branch_id AS branchId
       FROM commission_calculations cc
       JOIN invoices i ON i.id = cc.invoice_id
       WHERE cc.tenant_id = ? AND cc.employee_id = ?
       ORDER BY cc.created_at DESC, cc.id DESC LIMIT ? OFFSET ?`,
    )
    .bind(tenantId, emp.id, limit, offset)
    .all();
  return c.json({ data: rows.results ?? [], meta: pageMeta(page, limit, total) });
});
