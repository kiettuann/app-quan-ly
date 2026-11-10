// Branches — Phase 4 (MVP part 1). Nguồn: CONTRACTS.md §3–§4, PERMISSIONS.md §2.
import { Hono, type Context } from "hono";
import { apiError, type SessionContext } from "@quanly/shared";
import type { Env } from "../index.js";
import { authMiddleware } from "../auth.js";
import { requirePermission } from "../rbac.js";
import { newId, nowIso, pageMeta, pagination } from "../db.js";
import { branchSchema } from "../validation.js";
import { auditInsertStatement } from "../audit.js";
import type { z } from "zod";

export const branchesRoutes = new Hono<{ Bindings: Env; Variables: { session: SessionContext } }>();

type AppCtx = Context<{ Bindings: Env; Variables: { session: SessionContext } }>;

/** Route param (luôn có khi route khớp); fallback '' để qua strict null check. */
function param(c: AppCtx, name: string): string {
  return c.req.param(name) ?? "";
}

interface BranchRow {
  id: string;
  tenantId: string;
  name: string;
  address: string | null;
  phone: string | null;
  status: string;
  createdAt: string;
  updatedAt: string;
}

const BRANCH_SELECT = `id, tenant_id AS tenantId, name, address, phone, status,
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

/** Tenant của session, hoặc null khi là Platform Admin (không có tenant). */
function tenantIdOf(c: AppCtx): string | null {
  return c.get("session").tenantId;
}

function requireOwner(c: AppCtx): Response | null {
  if (c.get("session").role !== "tenant_owner") {
    return c.json(apiError("FORBIDDEN", "Chỉ chủ tiệm mới được quản lý chi nhánh."), 403);
  }
  return null;
}

async function loadBranch(c: AppCtx, tenantId: string, id: string): Promise<BranchRow | null> {
  return c.env.DB.prepare(`SELECT ${BRANCH_SELECT} FROM branches WHERE id = ? AND tenant_id = ? LIMIT 1`)
    .bind(id, tenantId)
    .first<BranchRow>();
}

// ---------- GET /branches ----------
branchesRoutes.get("/branches", authMiddleware, requirePermission("branch.view"), async (c) => {
  const session = c.get("session");
  const tenantId = tenantIdOf(c);
  if (!tenantId) {
    return c.json(apiError("FORBIDDEN", "Phiên không gắn với tenant nào."), 403);
  }
  const { page, limit, offset } = pagination(c);
  const isOwner = session.role === "tenant_owner";
  const where = isOwner ? `tenant_id = ?` : `tenant_id = ? AND id IN (${session.branchIds.map(() => "?").join(",") || "''"})`;
  const params: unknown[] = isOwner ? [tenantId] : [tenantId, ...session.branchIds];
  const totalRow = await c.env.DB.prepare(`SELECT COUNT(*) AS total FROM branches WHERE ${where}`)
    .bind(...(params as string[]))
    .first<{ total: number }>();
  const rows = await c.env.DB.prepare(
    `SELECT ${BRANCH_SELECT} FROM branches WHERE ${where} ORDER BY created_at ASC LIMIT ? OFFSET ?`,
  )
    .bind(...(params as string[]), limit, offset)
    .all<BranchRow>();
  return c.json({ data: rows.results ?? [], meta: pageMeta(page, limit, totalRow?.total ?? 0) });
});

// ---------- POST /branches (Owner only) ----------
branchesRoutes.post("/branches", authMiddleware, requirePermission("branch.manage"), async (c) => {
  const ownerErr = requireOwner(c);
  if (ownerErr) return ownerErr;
  const tenantId = tenantIdOf(c);
  if (!tenantId) {
    return c.json(apiError("FORBIDDEN", "Phiên không gắn với tenant nào."), 403);
  }
  const parsed = branchSchema.safeParse(await readBody(c));
  if (!parsed.success) {
    return c.json(apiError("VALIDATION_ERROR", formatZodError(parsed.error)), 400);
  }
  const session = c.get("session");
  const id = newId();
  const now = nowIso();
  await c.env.DB.batch([
    c.env.DB.prepare(
      `INSERT INTO branches (id, tenant_id, name, address, phone, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(id, tenantId, parsed.data.name, parsed.data.address ?? null, parsed.data.phone ?? null, parsed.data.status ?? "active", now, now),
    auditInsertStatement(c.env.DB, {
      tenantId,
      userId: session.userId,
      action: "branch.create",
      entityType: "branch",
      entityId: id,
      branchId: id,
    }),
  ]);
  const row = await loadBranch(c, tenantId, id);
  return c.json({ data: row }, 201);
});

// ---------- GET /branches/:id ----------
branchesRoutes.get("/branches/:id", authMiddleware, requirePermission("branch.view"), async (c) => {
  const tenantId = tenantIdOf(c);
  if (!tenantId) {
    return c.json(apiError("FORBIDDEN", "Phiên không gắn với tenant nào."), 403);
  }
  const row = await loadBranch(c, tenantId, param(c, "id"));
  if (!row) {
    return c.json(apiError("NOT_FOUND", "Không tìm thấy chi nhánh."), 404);
  }
  if (!c.get("session").branchIds.includes(row.id)) {
    return c.json(apiError("FORBIDDEN", "Chi nhánh ngoài phạm vi được phân quyền."), 403);
  }
  return c.json({ data: row });
});

// ---------- PATCH /branches/:id (Owner only) ----------
branchesRoutes.patch("/branches/:id", authMiddleware, requirePermission("branch.manage"), async (c) => {
  const ownerErr = requireOwner(c);
  if (ownerErr) return ownerErr;
  const tenantId = tenantIdOf(c);
  if (!tenantId) {
    return c.json(apiError("FORBIDDEN", "Phiên không gắn với tenant nào."), 403);
  }
  const row = await loadBranch(c, tenantId, param(c, "id"));
  if (!row) {
    return c.json(apiError("NOT_FOUND", "Không tìm thấy chi nhánh."), 404);
  }
  const parsed = branchSchema.partial().safeParse(await readBody(c));
  if (!parsed.success) {
    return c.json(apiError("VALIDATION_ERROR", formatZodError(parsed.error)), 400);
  }
  const d = parsed.data;
  const now = nowIso();
  await c.env.DB.batch([
    c.env.DB.prepare(
      `UPDATE branches SET name = ?, address = ?, phone = ?, status = ?, updated_at = ? WHERE id = ?`,
    ).bind(
      d.name ?? row.name,
      d.address !== undefined ? d.address : row.address,
      d.phone !== undefined ? d.phone : row.phone,
      d.status ?? row.status,
      now,
      row.id,
    ),
    auditInsertStatement(c.env.DB, {
      tenantId,
      userId: c.get("session").userId,
      action: "branch.update",
      entityType: "branch",
      entityId: row.id,
      branchId: row.id,
    }),
  ]);
  return c.json({ data: await loadBranch(c, tenantId, row.id) });
});

// ---------- DELETE /branches/:id (Owner only; chỉ vô hiệu hoá) ----------
branchesRoutes.delete("/branches/:id", authMiddleware, requirePermission("branch.manage"), async (c) => {
  const ownerErr = requireOwner(c);
  if (ownerErr) return ownerErr;
  const tenantId = tenantIdOf(c);
  if (!tenantId) {
    return c.json(apiError("FORBIDDEN", "Phiên không gắn với tenant nào."), 403);
  }
  const row = await loadBranch(c, tenantId, param(c, "id"));
  if (!row) {
    return c.json(apiError("NOT_FOUND", "Không tìm thấy chi nhánh."), 404);
  }
  // Không hard delete: còn booking/invoice/nhân viên tham chiếu -> 422.
  const refs = await Promise.all([
    c.env.DB.prepare(`SELECT COUNT(*) AS n FROM bookings WHERE branch_id = ? AND tenant_id = ?`).bind(row.id, tenantId).first<{ n: number }>(),
    c.env.DB.prepare(`SELECT COUNT(*) AS n FROM invoices WHERE branch_id = ? AND tenant_id = ?`).bind(row.id, tenantId).first<{ n: number }>(),
    c.env.DB.prepare(`SELECT COUNT(*) AS n FROM employees WHERE branch_id = ? AND tenant_id = ? AND deleted_at IS NULL`).bind(row.id, tenantId).first<{ n: number }>(),
  ]);
  const totalRefs = refs.reduce((sum, r) => sum + (r?.n ?? 0), 0);
  if (totalRefs > 0) {
    return c.json(
      apiError("UNPROCESSABLE", "Chi nhánh còn lịch hẹn, hóa đơn hoặc nhân viên tham chiếu nên không thể vô hiệu hoá."),
      422,
    );
  }
  const now = nowIso();
  await c.env.DB.batch([
    c.env.DB.prepare(`UPDATE branches SET status = 'inactive', updated_at = ? WHERE id = ?`).bind(now, row.id),
    auditInsertStatement(c.env.DB, {
      tenantId,
      userId: c.get("session").userId,
      action: "branch.deactivate",
      entityType: "branch",
      entityId: row.id,
      branchId: row.id,
    }),
  ]);
  return c.json({ data: await loadBranch(c, tenantId, row.id) });
});
