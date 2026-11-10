// Services & service categories — Phase 4 (MVP part 1).
// Nguồn: CONTRACTS.md §3–§4, DATABASE_SCHEMA.md §4.
// Không có permission service.view riêng nên các GET chỉ cần đăng nhập + tenant;
// mọi mutation cần service.manage.
import { Hono, type Context } from "hono";
import { apiError, type SessionContext } from "@quanly/shared";
import type { Env } from "../index.js";
import { authMiddleware } from "../auth.js";
import { requirePermission } from "../rbac.js";
import { newId, nowIso, pageMeta, pagination } from "../db.js";
import { serviceBranchSettingSchema, serviceCategorySchema, serviceSchema } from "../validation.js";
import { auditInsertStatement } from "../audit.js";
import type { z } from "zod";

export const servicesRoutes = new Hono<{ Bindings: Env; Variables: { session: SessionContext } }>();

type AppCtx = Context<{ Bindings: Env; Variables: { session: SessionContext } }>;

/** Route param (luôn có khi route khớp); fallback '' để qua strict null check. */
function param(c: AppCtx, name: string): string {
  return c.req.param(name) ?? "";
}

interface CategoryRow {
  id: string;
  tenantId: string;
  name: string;
  sortOrder: number;
  status: string;
  createdAt: string;
}

interface ServiceRow {
  id: string;
  tenantId: string;
  categoryId: string | null;
  categoryName: string | null;
  name: string;
  description: string | null;
  priceVnd: number;
  durationMinutes: number;
  status: string;
  branchPriceVnd: number | null;
  branchAvailable: number | null;
  createdAt: string;
  updatedAt: string;
}

interface BranchSettingRow {
  serviceId: string;
  branchId: string;
  branchName: string;
  priceVnd: number | null;
  isAvailable: number;
}

const SERVICE_SELECT = `s.id, s.tenant_id AS tenantId, s.category_id AS categoryId,
  sc.name AS categoryName, s.name, s.description, s.price_vnd AS priceVnd,
  s.duration_minutes AS durationMinutes, s.status,
  s.created_at AS createdAt, s.updated_at AS updatedAt`;

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

async function loadService(c: AppCtx, tenantId: string, id: string): Promise<ServiceRow | null> {
  return c.env.DB.prepare(
    `SELECT ${SERVICE_SELECT}, NULL AS branchPriceVnd, NULL AS branchAvailable
     FROM services s LEFT JOIN service_categories sc ON sc.id = s.category_id
     WHERE s.id = ? AND s.tenant_id = ? AND s.deleted_at IS NULL LIMIT 1`,
  )
    .bind(id, tenantId)
    .first<ServiceRow>();
}

async function loadBranchSettings(c: AppCtx, tenantId: string, serviceId: string): Promise<BranchSettingRow[]> {
  const rows = await c.env.DB.prepare(
    `SELECT sbs.service_id AS serviceId, sbs.branch_id AS branchId, b.name AS branchName,
            sbs.price_vnd AS priceVnd, sbs.is_available AS isAvailable
     FROM service_branch_settings sbs
     JOIN branches b ON b.id = sbs.branch_id
     WHERE sbs.service_id = ? AND sbs.tenant_id = ? ORDER BY b.created_at ASC`,
  )
    .bind(serviceId, tenantId)
    .all<BranchSettingRow>();
  return rows.results ?? [];
}

function settingOut(r: BranchSettingRow) {
  return {
    serviceId: r.serviceId,
    branchId: r.branchId,
    branchName: r.branchName,
    priceVnd: r.priceVnd,
    isAvailable: r.isAvailable === 1,
  };
}

function serviceOut(r: ServiceRow, branchSettings?: BranchSettingRow[]) {
  const effective =
    r.branchPriceVnd !== null && r.branchPriceVnd !== undefined ? r.branchPriceVnd : r.priceVnd;
  return {
    id: r.id,
    tenantId: r.tenantId,
    categoryId: r.categoryId,
    categoryName: r.categoryName,
    name: r.name,
    description: r.description,
    priceVnd: r.priceVnd,
    durationMinutes: r.durationMinutes,
    status: r.status,
    branchPriceVnd: r.branchPriceVnd ?? null,
    branchAvailable: r.branchAvailable === null || r.branchAvailable === undefined ? null : r.branchAvailable === 1,
    effectivePriceVnd: effective,
    branchSettings: branchSettings ? branchSettings.map(settingOut) : undefined,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
  };
}

// ---------- GET /service-categories ----------
servicesRoutes.get("/service-categories", authMiddleware, async (c) => {
  const tenantId = tenantOrNull(c);
  if (!tenantId) {
    return c.json(apiError("FORBIDDEN", "Phiên không gắn với tenant nào."), 403);
  }
  const { page, limit, offset } = pagination(c);
  const totalRow = await c.env.DB.prepare(`SELECT COUNT(*) AS total FROM service_categories WHERE tenant_id = ?`)
    .bind(tenantId)
    .first<{ total: number }>();
  const rows = await c.env.DB.prepare(
    `SELECT id, tenant_id AS tenantId, name, sort_order AS sortOrder, status, created_at AS createdAt
     FROM service_categories WHERE tenant_id = ? ORDER BY sort_order ASC, created_at ASC LIMIT ? OFFSET ?`,
  )
    .bind(tenantId, limit, offset)
    .all<CategoryRow>();
  return c.json({ data: rows.results ?? [], meta: pageMeta(page, limit, totalRow?.total ?? 0) });
});

// ---------- POST /service-categories ----------
servicesRoutes.post("/service-categories", authMiddleware, requirePermission("service.manage"), async (c) => {
  const tenantId = tenantOrNull(c);
  if (!tenantId) {
    return c.json(apiError("FORBIDDEN", "Phiên không gắn với tenant nào."), 403);
  }
  const parsed = serviceCategorySchema.safeParse(await readBody(c));
  if (!parsed.success) {
    return c.json(apiError("VALIDATION_ERROR", formatZodError(parsed.error)), 400);
  }
  const clash = await c.env.DB.prepare(`SELECT id FROM service_categories WHERE tenant_id = ? AND name = ? LIMIT 1`)
    .bind(tenantId, parsed.data.name)
    .first<{ id: string }>();
  if (clash) {
    return c.json(apiError("CONFLICT", "Tên danh mục đã tồn tại."), 409);
  }
  const id = newId();
  const now = nowIso();
  await c.env.DB.batch([
    c.env.DB.prepare(
      `INSERT INTO service_categories (id, tenant_id, name, sort_order, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, 'active', ?, ?)`,
    ).bind(id, tenantId, parsed.data.name, parsed.data.sortOrder ?? 0, now, now),
    auditInsertStatement(c.env.DB, {
      tenantId,
      userId: c.get("session").userId,
      action: "service_category.create",
      entityType: "service_category",
      entityId: id,
    }),
  ]);
  return c.json(
    { data: { id, tenantId, name: parsed.data.name, sortOrder: parsed.data.sortOrder ?? 0, status: "active", createdAt: now } },
    201,
  );
});

// ---------- GET /services ----------
servicesRoutes.get("/services", authMiddleware, async (c) => {
  const tenantId = tenantOrNull(c);
  if (!tenantId) {
    return c.json(apiError("FORBIDDEN", "Phiên không gắn với tenant nào."), 403);
  }
  const branchId = c.req.query("branch_id");
  if (branchId && !branchInScope(c, branchId)) {
    return c.json(apiError("FORBIDDEN", "Chi nhánh ngoài phạm vi được phân quyền."), 403);
  }
  const status = c.req.query("status");
  const categoryId = c.req.query("category_id");
  const search = c.req.query("search")?.trim();
  const { page, limit, offset } = pagination(c);
  const where: string[] = [`s.tenant_id = ?`, `s.deleted_at IS NULL`];
  const params: unknown[] = [tenantId];
  if (status) {
    where.push(`s.status = ?`);
    params.push(status);
  }
  if (categoryId) {
    where.push(`s.category_id = ?`);
    params.push(categoryId);
  }
  if (search) {
    where.push(`s.name LIKE ?`);
    params.push(`%${search}%`);
  }
  const whereSql = where.join(" AND ");
  const totalRow = await c.env.DB.prepare(`SELECT COUNT(*) AS total FROM services s WHERE ${whereSql}`)
    .bind(...(params as string[]))
    .first<{ total: number }>();
  const join = branchId
    ? `LEFT JOIN service_branch_settings sbs ON sbs.service_id = s.id AND sbs.branch_id = ?`
    : `LEFT JOIN service_branch_settings sbs ON 1 = 0`;
  const queryParams: unknown[] = branchId ? [branchId, ...params] : [...params];
  const rows = await c.env.DB.prepare(
    `SELECT ${SERVICE_SELECT}, sbs.price_vnd AS branchPriceVnd, sbs.is_available AS branchAvailable
     FROM services s
     LEFT JOIN service_categories sc ON sc.id = s.category_id
     ${join}
     WHERE ${whereSql} ORDER BY s.created_at DESC LIMIT ? OFFSET ?`,
  )
    .bind(...(queryParams as (string | number)[]), limit, offset)
    .all<ServiceRow>();
  return c.json({
    data: (rows.results ?? []).map((r) => serviceOut(r)),
    meta: pageMeta(page, limit, totalRow?.total ?? 0),
  });
});

// ---------- POST /services ----------
servicesRoutes.post("/services", authMiddleware, requirePermission("service.manage"), async (c) => {
  const tenantId = tenantOrNull(c);
  if (!tenantId) {
    return c.json(apiError("FORBIDDEN", "Phiên không gắn với tenant nào."), 403);
  }
  const parsed = serviceSchema.safeParse(await readBody(c));
  if (!parsed.success) {
    return c.json(apiError("VALIDATION_ERROR", formatZodError(parsed.error)), 400);
  }
  if (parsed.data.categoryId) {
    const cat = await c.env.DB.prepare(`SELECT id FROM service_categories WHERE id = ? AND tenant_id = ? LIMIT 1`)
      .bind(parsed.data.categoryId, tenantId)
      .first<{ id: string }>();
    if (!cat) {
      return c.json(apiError("VALIDATION_ERROR", "Danh mục dịch vụ không tồn tại."), 400);
    }
  }
  const id = newId();
  const now = nowIso();
  await c.env.DB.batch([
    c.env.DB.prepare(
      `INSERT INTO services (id, tenant_id, category_id, name, description, price_vnd, duration_minutes, status, deleted_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?)`,
    ).bind(
      id,
      tenantId,
      parsed.data.categoryId ?? null,
      parsed.data.name,
      parsed.data.description ?? null,
      parsed.data.priceVnd,
      parsed.data.durationMinutes,
      parsed.data.status ?? "active",
      now,
      now,
    ),
    auditInsertStatement(c.env.DB, {
      tenantId,
      userId: c.get("session").userId,
      action: "service.create",
      entityType: "service",
      entityId: id,
    }),
  ]);
  const row = await loadService(c, tenantId, id);
  return c.json({ data: row ? serviceOut(row) : null }, 201);
});

// ---------- GET /services/:id ----------
servicesRoutes.get("/services/:id", authMiddleware, async (c) => {
  const tenantId = tenantOrNull(c);
  if (!tenantId) {
    return c.json(apiError("FORBIDDEN", "Phiên không gắn với tenant nào."), 403);
  }
  const row = await loadService(c, tenantId, param(c, "id"));
  if (!row) {
    return c.json(apiError("NOT_FOUND", "Không tìm thấy dịch vụ."), 404);
  }
  const settings = await loadBranchSettings(c, tenantId, row.id);
  return c.json({ data: serviceOut(row, settings) });
});

// ---------- PATCH /services/:id ----------
servicesRoutes.patch("/services/:id", authMiddleware, requirePermission("service.manage"), async (c) => {
  const tenantId = tenantOrNull(c);
  if (!tenantId) {
    return c.json(apiError("FORBIDDEN", "Phiên không gắn với tenant nào."), 403);
  }
  const row = await loadService(c, tenantId, param(c, "id"));
  if (!row) {
    return c.json(apiError("NOT_FOUND", "Không tìm thấy dịch vụ."), 404);
  }
  const parsed = serviceSchema.partial().safeParse(await readBody(c));
  if (!parsed.success) {
    return c.json(apiError("VALIDATION_ERROR", formatZodError(parsed.error)), 400);
  }
  const d = parsed.data;
  if (d.categoryId) {
    const cat = await c.env.DB.prepare(`SELECT id FROM service_categories WHERE id = ? AND tenant_id = ? LIMIT 1`)
      .bind(d.categoryId, tenantId)
      .first<{ id: string }>();
    if (!cat) {
      return c.json(apiError("VALIDATION_ERROR", "Danh mục dịch vụ không tồn tại."), 400);
    }
  }
  const now = nowIso();
  await c.env.DB.batch([
    c.env.DB.prepare(
      `UPDATE services SET category_id = ?, name = ?, description = ?, price_vnd = ?, duration_minutes = ?, status = ?, updated_at = ? WHERE id = ?`,
    ).bind(
      d.categoryId !== undefined ? d.categoryId : row.categoryId,
      d.name ?? row.name,
      d.description !== undefined ? d.description : row.description,
      d.priceVnd ?? row.priceVnd,
      d.durationMinutes ?? row.durationMinutes,
      d.status ?? row.status,
      now,
      row.id,
    ),
    auditInsertStatement(c.env.DB, {
      tenantId,
      userId: c.get("session").userId,
      action: "service.update",
      entityType: "service",
      entityId: row.id,
    }),
  ]);
  const updated = await loadService(c, tenantId, row.id);
  return c.json({ data: updated ? serviceOut(updated) : null });
});

// ---------- DELETE /services/:id (soft delete) ----------
servicesRoutes.delete("/services/:id", authMiddleware, requirePermission("service.manage"), async (c) => {
  const tenantId = tenantOrNull(c);
  if (!tenantId) {
    return c.json(apiError("FORBIDDEN", "Phiên không gắn với tenant nào."), 403);
  }
  const row = await loadService(c, tenantId, param(c, "id"));
  if (!row) {
    return c.json(apiError("NOT_FOUND", "Không tìm thấy dịch vụ."), 404);
  }
  const now = nowIso();
  await c.env.DB.batch([
    c.env.DB.prepare(`UPDATE services SET deleted_at = ?, updated_at = ? WHERE id = ?`).bind(now, now, row.id),
    auditInsertStatement(c.env.DB, {
      tenantId,
      userId: c.get("session").userId,
      action: "service.delete",
      entityType: "service",
      entityId: row.id,
    }),
  ]);
  return c.json({ data: { id: row.id, deleted: true } });
});

// ---------- GET /services/:id/branch-settings ----------
servicesRoutes.get("/services/:id/branch-settings", authMiddleware, async (c) => {
  const tenantId = tenantOrNull(c);
  if (!tenantId) {
    return c.json(apiError("FORBIDDEN", "Phiên không gắn với tenant nào."), 403);
  }
  const row = await loadService(c, tenantId, param(c, "id"));
  if (!row) {
    return c.json(apiError("NOT_FOUND", "Không tìm thấy dịch vụ."), 404);
  }
  const settings = await loadBranchSettings(c, tenantId, row.id);
  return c.json({ data: settings.map(settingOut) });
});

// ---------- PUT /services/:id/branch-settings/:branchId (upsert) ----------
servicesRoutes.put(
  "/services/:id/branch-settings/:branchId",
  authMiddleware,
  requirePermission("service.manage"),
  async (c) => {
    const tenantId = tenantOrNull(c);
    if (!tenantId) {
      return c.json(apiError("FORBIDDEN", "Phiên không gắn với tenant nào."), 403);
    }
    const branchId = param(c, "branchId");
    const branch = await c.env.DB.prepare(`SELECT id FROM branches WHERE id = ? AND tenant_id = ? LIMIT 1`)
      .bind(branchId, tenantId)
      .first<{ id: string }>();
    if (!branch) {
      return c.json(apiError("NOT_FOUND", "Không tìm thấy chi nhánh."), 404);
    }
    if (!branchInScope(c, branchId)) {
      return c.json(apiError("FORBIDDEN", "Chi nhánh ngoài phạm vi được phân quyền."), 403);
    }
    const row = await loadService(c, tenantId, param(c, "id"));
    if (!row) {
      return c.json(apiError("NOT_FOUND", "Không tìm thấy dịch vụ."), 404);
    }
    const parsed = serviceBranchSettingSchema.safeParse(await readBody(c));
    if (!parsed.success) {
      return c.json(apiError("VALIDATION_ERROR", formatZodError(parsed.error)), 400);
    }
    const priceVnd = parsed.data.priceVnd ?? null;
    const isAvailable = parsed.data.isAvailable ?? true;
    await c.env.DB.batch([
      c.env.DB.prepare(
        `INSERT INTO service_branch_settings (service_id, branch_id, tenant_id, price_vnd, is_available, technician_ids_json)
         VALUES (?, ?, ?, ?, ?, NULL)
         ON CONFLICT(service_id, branch_id) DO UPDATE SET price_vnd = excluded.price_vnd, is_available = excluded.is_available`,
      ).bind(row.id, branchId, tenantId, priceVnd, isAvailable ? 1 : 0),
      auditInsertStatement(c.env.DB, {
        tenantId,
        userId: c.get("session").userId,
        action: "service.branch_setting_upsert",
        entityType: "service",
        entityId: row.id,
        branchId,
      }),
    ]);
    const settings = await loadBranchSettings(c, tenantId, row.id);
    const mine = settings.find((s) => s.branchId === branchId);
    return c.json({ data: mine ? settingOut(mine) : null });
  },
);
