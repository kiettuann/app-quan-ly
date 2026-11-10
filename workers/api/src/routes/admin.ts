// Platform Admin routes — toàn bộ yêu cầu authMiddleware + requirePlatformAdmin.
// Platform Admin KHÔNG đọc dữ liệu nghiệp vụ tenant (booking/invoice/lương...).
// Điểm hỗ trợ duy nhất: POST /admin/support-access — chỉ ghi audit log + trả
// tóm tắt tenant, không bao giờ trả business records (PERMISSIONS.md §4).
import { Hono } from "hono";
import { z } from "zod";
import { apiError, vndInt, type SessionContext } from "@quanly/shared";
import type { Env } from "../index.js";
import { authMiddleware, requirePlatformAdmin } from "../auth.js";
import { requirePermission } from "../rbac.js";
import { auditInsertStatement, insertAudit } from "../audit.js";
import { newId, nowIso, pageMeta, pagination } from "../db.js";

export const adminRoutes = new Hono<{ Bindings: Env; Variables: { session: SessionContext } }>();

adminRoutes.use("/admin", authMiddleware, requirePlatformAdmin);
adminRoutes.use("/admin/*", authMiddleware, requirePlatformAdmin);

function validationMessage(issues: Array<{ path: Array<string | number>; message: string }>): string {
  return `Dữ liệu không hợp lệ: ${issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}`;
}

async function readBody(c: {
  req: { json: () => Promise<unknown> };
}): Promise<Record<string, unknown> | null> {
  try {
    const body = await c.req.json();
    if (body === null || typeof body !== "object" || Array.isArray(body)) return null;
    return body as Record<string, unknown>;
  } catch {
    return null;
  }
}

const planSchema = z.object({
  name: z.string().trim().min(1).max(100),
  priceMonthlyVnd: vndInt,
  maxBranches: z.number().int().min(1),
  maxUsers: z.number().int().min(1),
  maxBookingsMonth: z.number().int().min(0),
  features: z.array(z.string().trim().max(100)).optional(),
  status: z.enum(["active", "inactive"]).optional(),
});

const supportAccessSchema = z.object({
  tenantId: z.string().uuid(),
  reason: z.string().trim().min(1).max(500),
});

interface TenantSummaryRow {
  id: string;
  name: string;
  slug: string;
  phone: string | null;
  email: string | null;
  status: string;
  planId: string | null;
  planName: string | null;
  subscriptionStatus: string | null;
  branchCount: number;
  userCount: number;
  createdAt: string;
  updatedAt: string;
}

const TENANT_SELECT = `t.id, t.name, t.slug, t.phone, t.email, t.status,
  t.plan_id AS planId, p.name AS planName,
  (SELECT s.status FROM subscriptions s WHERE s.tenant_id = t.id ORDER BY s.created_at DESC LIMIT 1) AS subscriptionStatus,
  (SELECT COUNT(*) FROM branches b WHERE b.tenant_id = t.id) AS branchCount,
  (SELECT COUNT(*) FROM users u WHERE u.tenant_id = t.id) AS userCount,
  t.created_at AS createdAt, t.updated_at AS updatedAt
  FROM tenants t LEFT JOIN plans p ON p.id = t.plan_id`;

function parseFeatures(featuresJson: string | null): string[] {
  if (!featuresJson) return [];
  try {
    const parsed: unknown = JSON.parse(featuresJson);
    if (Array.isArray(parsed)) return parsed.filter((f): f is string => typeof f === "string");
    return [];
  } catch {
    return [];
  }
}

// ---------- Tenants ----------
adminRoutes.get("/admin/tenants", async (c) => {
  const { page, limit, offset } = pagination(c);
  const status = c.req.query("status");
  const search = c.req.query("search")?.trim();
  const where = [`1 = 1`];
  const params: unknown[] = [];
  if (status) {
    where.push(`t.status = ?`);
    params.push(status);
  }
  if (search) {
    where.push(`(t.name LIKE ? OR t.slug LIKE ? OR t.email LIKE ?)`);
    params.push(`%${search}%`, `%${search}%`, `%${search}%`);
  }
  const whereSql = where.join(" AND ");
  const totalRow = await c.env.DB.prepare(
    `SELECT COUNT(*) AS total FROM tenants t WHERE ${whereSql}`,
  )
    .bind(...params)
    .first<{ total: number }>();
  const rows = await c.env.DB.prepare(
    `SELECT ${TENANT_SELECT} WHERE ${whereSql} ORDER BY t.created_at DESC LIMIT ? OFFSET ?`,
  )
    .bind(...params, limit, offset)
    .all<TenantSummaryRow>();
  return c.json({ data: rows.results ?? [], meta: pageMeta(page, limit, totalRow?.total ?? 0) });
});

adminRoutes.get("/admin/tenants/:id", async (c) => {
  const tenant = await c.env.DB.prepare(`SELECT ${TENANT_SELECT} WHERE t.id = ?`)
    .bind(c.req.param("id"))
    .first<TenantSummaryRow>();
  if (!tenant) return c.json(apiError("NOT_FOUND", "Không tìm thấy tenant."), 404);
  const subscription = await c.env.DB.prepare(
    `SELECT s.id, s.tenant_id AS tenantId, s.plan_id AS planId, p.name AS planName,
      s.status, s.started_at AS startedAt, s.ends_at AS endsAt,
      s.created_at AS createdAt, s.updated_at AS updatedAt
     FROM subscriptions s LEFT JOIN plans p ON p.id = s.plan_id
     WHERE s.tenant_id = ? ORDER BY s.created_at DESC LIMIT 1`,
  )
    .bind(tenant.id)
    .first();
  // Chỉ trả thông tin tenant + gói + số lượng — KHÔNG trả dữ liệu nghiệp vụ.
  return c.json({ data: { ...tenant, subscription: subscription ?? null } });
});

// PATCH /admin/tenants/:id {status} — app admin dùng để đổi trạng thái tenant
// (tương đương suspend/activate). Chỉ đổi được status, không đổi trường khác.
adminRoutes.patch("/admin/tenants/:id", async (c) => {
  const session = c.get("session");
  const id = c.req.param("id");
  const body = await readBody(c);
  const status = body?.status;
  if (status !== "active" && status !== "suspended") {
    return c.json(apiError("VALIDATION_ERROR", "status phải là active hoặc suspended."), 400);
  }
  const tenant = await c.env.DB.prepare(`SELECT id, status FROM tenants WHERE id = ?`)
    .bind(id)
    .first<{ id: string; status: string }>();
  if (!tenant) return c.json(apiError("NOT_FOUND", "Không tìm thấy tenant."), 404);
  const now = nowIso();
  await c.env.DB.batch([
    c.env.DB.prepare(`UPDATE tenants SET status = ?, updated_at = ? WHERE id = ?`).bind(status, now, id),
    auditInsertStatement(c.env.DB, {
      tenantId: id,
      userId: session.userId,
      action: status === "suspended" ? "admin.tenant_suspend" : "admin.tenant_activate",
      entityType: "tenant",
      entityId: id,
      metadata: { fromStatus: tenant.status, toStatus: status },
    }),
  ]);
  const updated = await c.env.DB.prepare(`SELECT ${TENANT_SELECT} WHERE t.id = ?`)
    .bind(id)
    .first<TenantSummaryRow>();
  return c.json({ data: updated });
});

adminRoutes.post("/admin/tenants/:id/suspend", async (c) => {
  const session = c.get("session");
  const id = c.req.param("id");
  const tenant = await c.env.DB.prepare(`SELECT id, status FROM tenants WHERE id = ?`)
    .bind(id)
    .first<{ id: string; status: string }>();
  if (!tenant) return c.json(apiError("NOT_FOUND", "Không tìm thấy tenant."), 404);
  const now = nowIso();
  await c.env.DB.batch([
    c.env.DB.prepare(`UPDATE tenants SET status = 'suspended', updated_at = ? WHERE id = ?`).bind(now, id),
    auditInsertStatement(c.env.DB, {
      tenantId: id,
      userId: session.userId,
      action: "admin.tenant_suspend",
      entityType: "tenant",
      entityId: id,
      metadata: { fromStatus: tenant.status, toStatus: "suspended" },
    }),
  ]);
  const updated = await c.env.DB.prepare(`SELECT ${TENANT_SELECT} WHERE t.id = ?`)
    .bind(id)
    .first<TenantSummaryRow>();
  return c.json({ data: updated });
});

adminRoutes.post("/admin/tenants/:id/activate", async (c) => {
  const session = c.get("session");
  const id = c.req.param("id");
  const tenant = await c.env.DB.prepare(`SELECT id, status FROM tenants WHERE id = ?`)
    .bind(id)
    .first<{ id: string; status: string }>();
  if (!tenant) return c.json(apiError("NOT_FOUND", "Không tìm thấy tenant."), 404);
  const now = nowIso();
  await c.env.DB.batch([
    c.env.DB.prepare(`UPDATE tenants SET status = 'active', updated_at = ? WHERE id = ?`).bind(now, id),
    auditInsertStatement(c.env.DB, {
      tenantId: id,
      userId: session.userId,
      action: "admin.tenant_activate",
      entityType: "tenant",
      entityId: id,
      metadata: { fromStatus: tenant.status, toStatus: "active" },
    }),
  ]);
  const updated = await c.env.DB.prepare(`SELECT ${TENANT_SELECT} WHERE t.id = ?`)
    .bind(id)
    .first<TenantSummaryRow>();
  return c.json({ data: updated });
});

// ---------- Plans ----------
adminRoutes.get("/admin/plans", async (c) => {
  const { page, limit, offset } = pagination(c);
  const totalRow = await c.env.DB.prepare(`SELECT COUNT(*) AS total FROM plans`).first<{ total: number }>();
  const rows = await c.env.DB.prepare(
    `SELECT id, name, price_monthly_vnd AS priceMonthlyVnd, max_branches AS maxBranches,
      max_users AS maxUsers, max_bookings_month AS maxBookingsMonth,
      features_json AS featuresJson, status, created_at AS createdAt, updated_at AS updatedAt
     FROM plans ORDER BY price_monthly_vnd ASC LIMIT ? OFFSET ?`,
  )
    .bind(limit, offset)
    .all<{
      id: string;
      name: string;
      priceMonthlyVnd: number;
      maxBranches: number;
      maxUsers: number;
      maxBookingsMonth: number;
      featuresJson: string | null;
      status: string;
      createdAt: string;
      updatedAt: string;
    }>();
  const data = (rows.results ?? []).map((r) => {
    const { featuresJson, ...rest } = r;
    return { ...rest, features: parseFeatures(featuresJson) };
  });
  return c.json({ data, meta: pageMeta(page, limit, totalRow?.total ?? 0) });
});

adminRoutes.post("/admin/plans", requirePermission("admin.plans"), async (c) => {
  const session = c.get("session");
  const body = await readBody(c);
  if (!body) return c.json(apiError("VALIDATION_ERROR", "Thiếu nội dung yêu cầu (JSON)."), 400);
  const parsed = planSchema.safeParse(body);
  if (!parsed.success) {
    return c.json(apiError("VALIDATION_ERROR", validationMessage(parsed.error.issues)), 400);
  }
  const d = parsed.data;
  const id = newId();
  const now = nowIso();
  const featuresJson = JSON.stringify(d.features ?? []);
  await c.env.DB.batch([
    c.env.DB.prepare(
      `INSERT INTO plans (id, name, price_monthly_vnd, max_branches, max_users,
        max_bookings_month, features_json, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(
      id,
      d.name,
      d.priceMonthlyVnd,
      d.maxBranches,
      d.maxUsers,
      d.maxBookingsMonth,
      featuresJson,
      d.status ?? "active",
      now,
      now,
    ),
    auditInsertStatement(c.env.DB, {
      tenantId: null,
      userId: session.userId,
      action: "admin.plan_create",
      entityType: "plan",
      entityId: id,
      metadata: { name: d.name, priceMonthlyVnd: d.priceMonthlyVnd },
    }),
  ]);
  return c.json(
    {
      data: {
        id,
        name: d.name,
        priceMonthlyVnd: d.priceMonthlyVnd,
        maxBranches: d.maxBranches,
        maxUsers: d.maxUsers,
        maxBookingsMonth: d.maxBookingsMonth,
        features: d.features ?? [],
        status: d.status ?? "active",
        createdAt: now,
        updatedAt: now,
      },
    },
    201,
  );
});

adminRoutes.patch("/admin/plans/:id", requirePermission("admin.plans"), async (c) => {
  const session = c.get("session");
  const body = await readBody(c);
  if (!body) return c.json(apiError("VALIDATION_ERROR", "Thiếu nội dung yêu cầu (JSON)."), 400);
  const parsed = planSchema.partial().safeParse(body);
  if (!parsed.success) {
    return c.json(apiError("VALIDATION_ERROR", validationMessage(parsed.error.issues)), 400);
  }
  const id = c.req.param("id");
  const existing = await c.env.DB.prepare(`SELECT id FROM plans WHERE id = ?`)
    .bind(id)
    .first<{ id: string }>();
  if (!existing) return c.json(apiError("NOT_FOUND", "Không tìm thấy gói dịch vụ."), 404);
  const d = parsed.data;
  const sets: string[] = [];
  const values: unknown[] = [];
  const setField = (sql: string, value: unknown): void => {
    sets.push(sql);
    values.push(value);
  };
  if (d.name !== undefined) setField("name = ?", d.name);
  if (d.priceMonthlyVnd !== undefined) setField("price_monthly_vnd = ?", d.priceMonthlyVnd);
  if (d.maxBranches !== undefined) setField("max_branches = ?", d.maxBranches);
  if (d.maxUsers !== undefined) setField("max_users = ?", d.maxUsers);
  if (d.maxBookingsMonth !== undefined) setField("max_bookings_month = ?", d.maxBookingsMonth);
  if (d.features !== undefined) setField("features_json = ?", JSON.stringify(d.features));
  if (d.status !== undefined) setField("status = ?", d.status);
  if (sets.length === 0) {
    return c.json(apiError("VALIDATION_ERROR", "Không có trường nào để cập nhật."), 400);
  }
  sets.push("updated_at = ?");
  values.push(nowIso());
  await c.env.DB.batch([
    c.env.DB.prepare(`UPDATE plans SET ${sets.join(", ")} WHERE id = ?`).bind(...values, id),
    auditInsertStatement(c.env.DB, {
      tenantId: null,
      userId: session.userId,
      action: "admin.plan_update",
      entityType: "plan",
      entityId: id,
      metadata: { updatedFields: Object.keys(d) },
    }),
  ]);
  const updated = await c.env.DB.prepare(
    `SELECT id, name, price_monthly_vnd AS priceMonthlyVnd, max_branches AS maxBranches,
      max_users AS maxUsers, max_bookings_month AS maxBookingsMonth,
      features_json AS featuresJson, status, created_at AS createdAt, updated_at AS updatedAt
     FROM plans WHERE id = ?`,
  )
    .bind(id)
    .first<{
      id: string;
      name: string;
      priceMonthlyVnd: number;
      maxBranches: number;
      maxUsers: number;
      maxBookingsMonth: number;
      featuresJson: string | null;
      status: string;
      createdAt: string;
      updatedAt: string;
    }>();
  if (!updated) return c.json(apiError("NOT_FOUND", "Không tìm thấy gói dịch vụ."), 404);
  const { featuresJson, ...rest } = updated;
  return c.json({ data: { ...rest, features: parseFeatures(featuresJson) } });
});

// ---------- Subscriptions ----------
adminRoutes.get("/admin/subscriptions", async (c) => {
  const { page, limit, offset } = pagination(c);
  const status = c.req.query("status");
  const tenantId = c.req.query("tenant_id");
  const where = [`1 = 1`];
  const params: unknown[] = [];
  if (status) {
    where.push(`s.status = ?`);
    params.push(status);
  }
  if (tenantId) {
    where.push(`s.tenant_id = ?`);
    params.push(tenantId);
  }
  const whereSql = where.join(" AND ");
  const totalRow = await c.env.DB.prepare(
    `SELECT COUNT(*) AS total FROM subscriptions s WHERE ${whereSql}`,
  )
    .bind(...params)
    .first<{ total: number }>();
  const rows = await c.env.DB.prepare(
    `SELECT s.id, s.tenant_id AS tenantId, t.name AS tenantName,
      s.plan_id AS planId, p.name AS planName, s.status,
      s.started_at AS startedAt, s.ends_at AS endsAt,
      s.created_at AS createdAt, s.updated_at AS updatedAt
     FROM subscriptions s
     LEFT JOIN tenants t ON t.id = s.tenant_id
     LEFT JOIN plans p ON p.id = s.plan_id
     WHERE ${whereSql} ORDER BY s.created_at DESC LIMIT ? OFFSET ?`,
  )
    .bind(...params, limit, offset)
    .all();
  return c.json({ data: rows.results ?? [], meta: pageMeta(page, limit, totalRow?.total ?? 0) });
});

// ---------- Audit logs (platform-wide) ----------
adminRoutes.get("/admin/audit-logs", async (c) => {
  const { page, limit, offset } = pagination(c);
  const tenantId = c.req.query("tenant_id");
  const action = c.req.query("action");
  const from = c.req.query("from");
  const to = c.req.query("to");
  const where = [`1 = 1`];
  const params: unknown[] = [];
  if (tenantId) {
    where.push(`tenant_id = ?`);
    params.push(tenantId);
  }
  if (action) {
    where.push(`action = ?`);
    params.push(action);
  }
  if (from) {
    where.push(`substr(created_at, 1, 10) >= ?`);
    params.push(from);
  }
  if (to) {
    where.push(`substr(created_at, 1, 10) <= ?`);
    params.push(to);
  }
  const whereSql = where.join(" AND ");
  const totalRow = await c.env.DB.prepare(
    `SELECT COUNT(*) AS total FROM audit_logs WHERE ${whereSql}`,
  )
    .bind(...params)
    .first<{ total: number }>();
  const rows = await c.env.DB.prepare(
    `SELECT id, tenant_id AS tenantId, user_id AS userId, action, entity_type AS entityType,
      entity_id AS entityId, branch_id AS branchId, metadata_json AS metadataJson,
      ip, created_at AS createdAt
     FROM audit_logs WHERE ${whereSql} ORDER BY created_at DESC LIMIT ? OFFSET ?`,
  )
    .bind(...params, limit, offset)
    .all<{
      id: string;
      tenantId: string | null;
      userId: string | null;
      action: string;
      entityType: string;
      entityId: string | null;
      branchId: string | null;
      metadataJson: string;
      ip: string | null;
      createdAt: string;
    }>();
  const data = (rows.results ?? []).map((r) => {
    let metadata: Record<string, unknown> = {};
    try {
      const parsed: unknown = JSON.parse(r.metadataJson);
      if (parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)) {
        metadata = parsed as Record<string, unknown>;
      }
    } catch {
      metadata = {};
    }
    return {
      id: r.id,
      tenantId: r.tenantId,
      userId: r.userId,
      action: r.action,
      entityType: r.entityType,
      entityId: r.entityId,
      branchId: r.branchId,
      ip: r.ip,
      createdAt: r.createdAt,
      metadata,
    };
  });
  return c.json({ data, meta: pageMeta(page, limit, totalRow?.total ?? 0) });
});

// ---------- Support access (only support entry point) ----------
adminRoutes.post("/admin/support-access", async (c) => {
  const session = c.get("session");
  const body = await readBody(c);
  if (!body) return c.json(apiError("VALIDATION_ERROR", "Thiếu nội dung yêu cầu (JSON)."), 400);
  const parsed = supportAccessSchema.safeParse(body);
  if (!parsed.success) {
    return c.json(apiError("VALIDATION_ERROR", validationMessage(parsed.error.issues)), 400);
  }
  const tenant = await c.env.DB.prepare(`SELECT ${TENANT_SELECT} WHERE t.id = ?`)
    .bind(parsed.data.tenantId)
    .first<TenantSummaryRow>();
  if (!tenant) return c.json(apiError("NOT_FOUND", "Không tìm thấy tenant."), 404);
  await insertAudit(c.env.DB, {
    tenantId: tenant.id,
    userId: session.userId,
    action: "admin.support_access",
    entityType: "tenant",
    entityId: tenant.id,
    metadata: { reason: parsed.data.reason },
  });
  // Chỉ tóm tắt tenant — KHÔNG trả dữ liệu nghiệp vụ.
  return c.json({
    data: {
      id: tenant.id,
      name: tenant.name,
      slug: tenant.slug,
      status: tenant.status,
      plan: tenant.planName,
      branchesCount: tenant.branchCount,
      usersCount: tenant.userCount,
    },
  });
});
