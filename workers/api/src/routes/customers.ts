// Customers — Phase 4 (MVP part 1). Nguồn: CONTRACTS.md §3–§4, DATABASE_SCHEMA.md §3.
// SĐT duy nhất trong tenant (chỉ xét khách chưa xoá mềm). Xoá mềm bị chặn khi
// còn booking đang mở hoặc hoá đơn chưa thanh toán xong.
import { Hono, type Context } from "hono";
import { apiError, BOOKING_ACTIVE_STATUSES, type SessionContext } from "@quanly/shared";
import type { Env } from "../index.js";
import { authMiddleware } from "../auth.js";
import { requirePermission } from "../rbac.js";
import { newId, nowIso, pageMeta, pagination } from "../db.js";
import { customerSchema } from "../validation.js";
import { auditInsertStatement } from "../audit.js";
import type { z } from "zod";

export const customersRoutes = new Hono<{ Bindings: Env; Variables: { session: SessionContext } }>();

type AppCtx = Context<{ Bindings: Env; Variables: { session: SessionContext } }>;

/** Route param (luôn có khi route khớp); fallback '' để qua strict null check. */
function param(c: AppCtx, name: string): string {
  return c.req.param(name) ?? "";
}

interface CustomerRow {
  id: string;
  tenantId: string;
  branchId: string | null;
  fullName: string;
  phone: string;
  email: string | null;
  dob: string | null;
  gender: string | null;
  notes: string | null;
  totalSpentVnd: number;
  totalVisits: number;
  lastVisitAt: string | null;
  createdAt: string;
  updatedAt: string;
}

const CUSTOMER_SELECT = `id, tenant_id AS tenantId, branch_id AS branchId, full_name AS fullName,
  phone, email, dob, gender, notes, total_spent_vnd AS totalSpentVnd,
  total_visits AS totalVisits, last_visit_at AS lastVisitAt,
  created_at AS createdAt, updated_at AS updatedAt`;

function formatZodError(error: z.ZodError): string {
  return error.issues.map((i) => `${i.path.join(".") || "body"}: ${i.message}`).join("; ");
}

async function readBody(c: AppCtx): Promise<unknown> {
  try {
    return (await c.req.json()) as unknown;
  } catch {
    return null;
  }
}

function tenantOrNull(c: AppCtx): string | null {
  return c.get("session").tenantId;
}

function branchInScope(c: AppCtx, branchId: string): boolean {
  return c.get("session").branchIds.includes(branchId);
}

async function loadCustomer(c: AppCtx, tenantId: string, id: string): Promise<CustomerRow | null> {
  return c.env.DB.prepare(
    `SELECT ${CUSTOMER_SELECT} FROM customers WHERE id = ? AND tenant_id = ? AND deleted_at IS NULL LIMIT 1`,
  )
    .bind(id, tenantId)
    .first<CustomerRow>();
}

async function findPhoneDuplicate(
  c: AppCtx,
  tenantId: string,
  phone: string,
  excludeId?: string,
): Promise<CustomerRow | null> {
  const sql = excludeId
    ? `SELECT ${CUSTOMER_SELECT} FROM customers WHERE tenant_id = ? AND phone = ? AND deleted_at IS NULL AND id != ? LIMIT 1`
    : `SELECT ${CUSTOMER_SELECT} FROM customers WHERE tenant_id = ? AND phone = ? AND deleted_at IS NULL LIMIT 1`;
  const params = excludeId ? [tenantId, phone, excludeId] : [tenantId, phone];
  return c.env.DB.prepare(sql).bind(...params).first<CustomerRow>();
}

// ---------- GET /customers ----------
customersRoutes.get("/customers", authMiddleware, requirePermission("customer.view"), async (c) => {
  const session = c.get("session");
  const tenantId = tenantOrNull(c);
  if (!tenantId) {
    return c.json(apiError("FORBIDDEN", "Phiên không gắn với tenant nào."), 403);
  }
  const branchId = c.req.query("branch_id");
  if (branchId && !branchInScope(c, branchId)) {
    return c.json(apiError("FORBIDDEN", "Chi nhánh ngoài phạm vi được phân quyền."), 403);
  }
  const search = c.req.query("search")?.trim();
  const { page, limit, offset } = pagination(c);
  const where: string[] = [`tenant_id = ?`, `deleted_at IS NULL`];
  const params: unknown[] = [tenantId];
  if (branchId) {
    where.push(`branch_id = ?`);
    params.push(branchId);
  } else if (session.role !== "tenant_owner") {
    // Người không phải Owner chỉ thấy khách của chi nhánh trong phạm vi.
    if (session.branchIds.length === 0) {
      return c.json({ data: [], meta: pageMeta(page, limit, 0) });
    }
    where.push(`branch_id IN (${session.branchIds.map(() => "?").join(",")})`);
    params.push(...session.branchIds);
  }
  if (search) {
    where.push(`(full_name LIKE ? OR phone LIKE ?)`);
    params.push(`%${search}%`, `%${search}%`);
  }
  const whereSql = where.join(" AND ");
  const totalRow = await c.env.DB.prepare(`SELECT COUNT(*) AS total FROM customers WHERE ${whereSql}`)
    .bind(...(params as string[]))
    .first<{ total: number }>();
  const rows = await c.env.DB.prepare(
    `SELECT ${CUSTOMER_SELECT} FROM customers WHERE ${whereSql} ORDER BY created_at DESC LIMIT ? OFFSET ?`,
  )
    .bind(...(params as string[]), limit, offset)
    .all<CustomerRow>();
  return c.json({ data: rows.results ?? [], meta: pageMeta(page, limit, totalRow?.total ?? 0) });
});

// ---------- POST /customers ----------
customersRoutes.post("/customers", authMiddleware, requirePermission("customer.manage"), async (c) => {
  const tenantId = tenantOrNull(c);
  if (!tenantId) {
    return c.json(apiError("FORBIDDEN", "Phiên không gắn với tenant nào."), 403);
  }
  const parsed = customerSchema.safeParse(await readBody(c));
  if (!parsed.success) {
    return c.json(apiError("VALIDATION_ERROR", formatZodError(parsed.error)), 400);
  }
  const d = parsed.data;
  if (d.branchId && !branchInScope(c, d.branchId)) {
    return c.json(apiError("FORBIDDEN", "Chi nhánh ngoài phạm vi được phân quyền."), 403);
  }
  if (d.branchId) {
    const branch = await c.env.DB.prepare(`SELECT id FROM branches WHERE id = ? AND tenant_id = ? LIMIT 1`)
      .bind(d.branchId, tenantId)
      .first<{ id: string }>();
    if (!branch) {
      return c.json(apiError("NOT_FOUND", "Không tìm thấy chi nhánh."), 404);
    }
  }
  const dup = await findPhoneDuplicate(c, tenantId, d.phone);
  if (dup) {
    return c.json(apiError("CONFLICT", "Số điện thoại này đã có khách hàng trong tiệm."), 409);
  }
  const id = newId();
  const now = nowIso();
  await c.env.DB.batch([
    c.env.DB.prepare(
      `INSERT INTO customers (id, tenant_id, branch_id, full_name, phone, email, dob, gender, notes,
         total_spent_vnd, total_visits, last_visit_at, deleted_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0, NULL, NULL, ?, ?)`,
    ).bind(
      id,
      tenantId,
      d.branchId ?? null,
      d.fullName,
      d.phone,
      d.email ?? null,
      d.dob ?? null,
      d.gender ?? null,
      d.notes ?? null,
      now,
      now,
    ),
    auditInsertStatement(c.env.DB, {
      tenantId,
      userId: c.get("session").userId,
      action: "customer.create",
      entityType: "customer",
      entityId: id,
      branchId: d.branchId ?? null,
    }),
  ]);
  const row = await loadCustomer(c, tenantId, id);
  return c.json({ data: row }, 201);
});

// ---------- GET /customers/:id ----------
customersRoutes.get("/customers/:id", authMiddleware, requirePermission("customer.view"), async (c) => {
  const tenantId = tenantOrNull(c);
  if (!tenantId) {
    return c.json(apiError("FORBIDDEN", "Phiên không gắn với tenant nào."), 403);
  }
  const row = await loadCustomer(c, tenantId, param(c, "id"));
  if (!row) {
    return c.json(apiError("NOT_FOUND", "Không tìm thấy khách hàng."), 404);
  }
  if (row.branchId && !branchInScope(c, row.branchId)) {
    return c.json(apiError("FORBIDDEN", "Khách hàng thuộc chi nhánh ngoài phạm vi của bạn."), 403);
  }
  return c.json({ data: row });
});

// ---------- PATCH /customers/:id ----------
customersRoutes.patch("/customers/:id", authMiddleware, requirePermission("customer.manage"), async (c) => {
  const tenantId = tenantOrNull(c);
  if (!tenantId) {
    return c.json(apiError("FORBIDDEN", "Phiên không gắn với tenant nào."), 403);
  }
  const row = await loadCustomer(c, tenantId, param(c, "id"));
  if (!row) {
    return c.json(apiError("NOT_FOUND", "Không tìm thấy khách hàng."), 404);
  }
  if (row.branchId && !branchInScope(c, row.branchId)) {
    return c.json(apiError("FORBIDDEN", "Khách hàng thuộc chi nhánh ngoài phạm vi của bạn."), 403);
  }
  const parsed = customerSchema.partial().safeParse(await readBody(c));
  if (!parsed.success) {
    return c.json(apiError("VALIDATION_ERROR", formatZodError(parsed.error)), 400);
  }
  const d = parsed.data;
  if (d.branchId && !branchInScope(c, d.branchId)) {
    return c.json(apiError("FORBIDDEN", "Chi nhánh ngoài phạm vi được phân quyền."), 403);
  }
  if (d.phone && d.phone !== row.phone) {
    const dup = await findPhoneDuplicate(c, tenantId, d.phone, row.id);
    if (dup) {
      return c.json(apiError("CONFLICT", "Số điện thoại này đã có khách hàng trong tiệm."), 409);
    }
  }
  const now = nowIso();
  await c.env.DB.batch([
    c.env.DB.prepare(
      `UPDATE customers SET branch_id = ?, full_name = ?, phone = ?, email = ?, dob = ?, gender = ?, notes = ?, updated_at = ? WHERE id = ?`,
    ).bind(
      d.branchId !== undefined ? d.branchId : row.branchId,
      d.fullName ?? row.fullName,
      d.phone ?? row.phone,
      d.email !== undefined ? d.email : row.email,
      d.dob !== undefined ? d.dob : row.dob,
      d.gender !== undefined ? d.gender : row.gender,
      d.notes !== undefined ? d.notes : row.notes,
      now,
      row.id,
    ),
    auditInsertStatement(c.env.DB, {
      tenantId,
      userId: c.get("session").userId,
      action: "customer.update",
      entityType: "customer",
      entityId: row.id,
      branchId: row.branchId,
    }),
  ]);
  return c.json({ data: await loadCustomer(c, tenantId, row.id) });
});

// ---------- DELETE /customers/:id (soft delete; chặn khi còn booking/hóa đơn mở) ----------
customersRoutes.delete("/customers/:id", authMiddleware, requirePermission("customer.manage"), async (c) => {
  const tenantId = tenantOrNull(c);
  if (!tenantId) {
    return c.json(apiError("FORBIDDEN", "Phiên không gắn với tenant nào."), 403);
  }
  const row = await loadCustomer(c, tenantId, param(c, "id"));
  if (!row) {
    return c.json(apiError("NOT_FOUND", "Không tìm thấy khách hàng."), 404);
  }
  if (row.branchId && !branchInScope(c, row.branchId)) {
    return c.json(apiError("FORBIDDEN", "Khách hàng thuộc chi nhánh ngoài phạm vi của bạn."), 403);
  }
  const openBooking = await c.env.DB.prepare(
    `SELECT COUNT(*) AS n FROM bookings
     WHERE customer_id = ? AND tenant_id = ? AND status IN (${BOOKING_ACTIVE_STATUSES.map(() => "?").join(",")})`,
  )
    .bind(row.id, tenantId, ...BOOKING_ACTIVE_STATUSES)
    .first<{ n: number }>();
  const openInvoice = await c.env.DB.prepare(
    `SELECT COUNT(*) AS n FROM invoices
     WHERE customer_id = ? AND tenant_id = ? AND status IN ('draft', 'unpaid', 'partially_paid')`,
  )
    .bind(row.id, tenantId)
    .first<{ n: number }>();
  if ((openBooking?.n ?? 0) > 0 || (openInvoice?.n ?? 0) > 0) {
    return c.json(
      apiError("UNPROCESSABLE", "Khách hàng còn lịch hẹn hoặc hóa đơn chưa hoàn tất nên không thể xoá."),
      422,
    );
  }
  const now = nowIso();
  await c.env.DB.batch([
    c.env.DB.prepare(`UPDATE customers SET deleted_at = ?, updated_at = ? WHERE id = ?`).bind(now, now, row.id),
    auditInsertStatement(c.env.DB, {
      tenantId,
      userId: c.get("session").userId,
      action: "customer.delete",
      entityType: "customer",
      entityId: row.id,
      branchId: row.branchId,
    }),
  ]);
  return c.json({ data: { id: row.id, deleted: true } });
});
