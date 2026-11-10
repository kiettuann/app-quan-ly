// Users & roles — Phase 4 (MVP part 1). Nguồn: CONTRACTS.md §3, PERMISSIONS.md §2.
// Role hệ thống dùng id cố định trong roles.ts (SYSTEM_ROLE_IDS); role tùy chỉnh
// thuộc tenant (tenant_id = session tenant, is_system = 0).
import { Hono, type Context } from "hono";
import { z } from "zod";
import {
  apiError,
  PERMISSION_KEYS,
  type PermissionKey,
  type SessionContext,
} from "@quanly/shared";
import type { Env } from "../index.js";
import { authMiddleware } from "../auth.js";
import { requirePermission } from "../rbac.js";
import { hashPassword, randomToken } from "../crypto.js";
import { newId, nowIso, pageMeta, pagination } from "../db.js";
import { ROLE_PERMISSIONS, SYSTEM_ROLE_IDS } from "../roles.js";
import { inviteUserSchema, roleSchema } from "../validation.js";
import { auditInsertStatement } from "../audit.js";
import type { z as zodType } from "zod";

export const usersRoutes = new Hono<{ Bindings: Env; Variables: { session: SessionContext } }>();

type AppCtx = Context<{ Bindings: Env; Variables: { session: SessionContext } }>;

/** Route param (luôn có khi route khớp); fallback '' để qua strict null check. */
function param(c: AppCtx, name: string): string {
  return c.req.param(name) ?? "";
}

interface UserListRow {
  id: string;
  email: string;
  fullName: string;
  phone: string | null;
  status: string;
  roleId: string | null;
  roleName: string | null;
  branchIdsCsv: string | null;
  createdAt: string;
}

interface RoleRow {
  id: string;
  tenantId: string | null;
  name: string;
  description: string | null;
  isSystem: number;
  permissionKeysCsv: string | null;
}

const updateUserSchema = z.object({
  fullName: z.string().trim().min(2).max(100),
  phone: z.string().trim().regex(/^0\d{9}$/, "Số điện thoại phải có 10 số, bắt đầu bằng 0").nullable(),
  status: z.enum(["active", "invited", "disabled"]),
  role: z.string().trim().min(1).max(100),
  branchIds: z.array(z.string().uuid()).min(1, "Chọn ít nhất 1 chi nhánh."),
});

function formatZodError(error: zodType.ZodError): string {
  return error.issues.map((i) => `${i.path.join(".") || "body"}: ${i.message}`).join("; ");
}

async function readBody(c: AppCtx): Promise<unknown> {
  try {
    return (await c.req.json()) as unknown;
  } catch {
    return null;
  }
}

function tenantOr403(c: AppCtx): string | null {
  return c.get("session").tenantId;
}

function publicUser(row: UserListRow) {
  return {
    id: row.id,
    email: row.email,
    fullName: row.fullName,
    phone: row.phone,
    status: row.status,
    roleId: row.roleId,
    role: row.roleName,
    branchIds: row.branchIdsCsv ? row.branchIdsCsv.split(",").filter(Boolean) : [],
    createdAt: row.createdAt,
  };
}

async function loadUserRow(db: D1Database, tenantId: string, userId: string): Promise<UserListRow | null> {
  return db
    .prepare(
      `SELECT u.id, u.email, u.full_name AS fullName, u.phone, u.status,
              r.id AS roleId, r.name AS roleName,
              GROUP_CONCAT(DISTINCT uba.branch_id) AS branchIdsCsv,
              u.created_at AS createdAt
       FROM users u
       LEFT JOIN user_tenants ut ON ut.user_id = u.id AND ut.tenant_id = u.tenant_id
       LEFT JOIN roles r ON r.id = ut.role_id
       LEFT JOIN user_branch_access uba ON uba.user_id = u.id
       WHERE u.id = ? AND u.tenant_id = ? GROUP BY u.id LIMIT 1`,
    )
    .bind(userId, tenantId)
    .first<UserListRow>();
}

/** Kiểm tra các branchId đều thuộc tenant; trả branch ngoài tenant (nếu có). */
async function findForeignBranches(db: D1Database, tenantId: string, branchIds: string[]): Promise<string[]> {
  if (branchIds.length === 0) return [];
  const rows = await db
    .prepare(`SELECT id FROM branches WHERE tenant_id = ? AND id IN (${branchIds.map(() => "?").join(",")})`)
    .bind(tenantId, ...branchIds)
    .all<{ id: string }>();
  const found = new Set((rows.results ?? []).map((r) => r.id));
  return branchIds.filter((id) => !found.has(id));
}

/** Seed role_permissions cho một system role (INSERT OR IGNORE, chạy lại an toàn). */
function seedRolePermissionStatements(db: D1Database, roleId: string, keys: readonly PermissionKey[]): D1PreparedStatement[] {
  return keys.map((key) =>
    db.prepare(`INSERT OR IGNORE INTO role_permissions (role_id, permission_id) VALUES (?, ?)`).bind(roleId, `perm_${key}`),
  );
}

// ---------- GET /users ----------
usersRoutes.get("/users", authMiddleware, requirePermission("user.invite"), async (c) => {
  const session = c.get("session");
  const tenantId = tenantOr403(c);
  if (!tenantId) {
    return c.json(apiError("FORBIDDEN", "Phiên không gắn với tenant nào."), 403);
  }
  const { page, limit, offset } = pagination(c);
  const isOwner = session.role === "tenant_owner";
  // Branch Manager chỉ thấy user có chung ít nhất 1 chi nhánh với mình.
  const scopeSql = isOwner
    ? ""
    : ` AND u.id IN (SELECT user_id FROM user_branch_access WHERE branch_id IN (${session.branchIds.map(() => "?").join(",") || "''"}))`;
  const scopeParams: string[] = isOwner ? [] : [...session.branchIds];
  const totalRow = await c.env.DB.prepare(
    `SELECT COUNT(DISTINCT u.id) AS total FROM users u WHERE u.tenant_id = ?${scopeSql}`,
  )
    .bind(tenantId, ...scopeParams)
    .first<{ total: number }>();
  const rows = await c.env.DB.prepare(
    `SELECT u.id, u.email, u.full_name AS fullName, u.phone, u.status,
            r.id AS roleId, r.name AS roleName,
            GROUP_CONCAT(DISTINCT uba.branch_id) AS branchIdsCsv,
            u.created_at AS createdAt
     FROM users u
     LEFT JOIN user_tenants ut ON ut.user_id = u.id AND ut.tenant_id = u.tenant_id
     LEFT JOIN roles r ON r.id = ut.role_id
     LEFT JOIN user_branch_access uba ON uba.user_id = u.id
     WHERE u.tenant_id = ?${scopeSql}
     GROUP BY u.id ORDER BY u.created_at DESC LIMIT ? OFFSET ?`,
  )
    .bind(tenantId, ...scopeParams, limit, offset)
    .all<UserListRow>();
  return c.json({
    data: (rows.results ?? []).map(publicUser),
    meta: pageMeta(page, limit, totalRow?.total ?? 0),
  });
});

// ---------- POST /users (invite) ----------
usersRoutes.post("/users", authMiddleware, requirePermission("user.invite"), async (c) => {
  const session = c.get("session");
  const tenantId = tenantOr403(c);
  if (!tenantId) {
    return c.json(apiError("FORBIDDEN", "Phiên không gắn với tenant nào."), 403);
  }
  const parsed = inviteUserSchema.safeParse(await readBody(c));
  if (!parsed.success) {
    return c.json(apiError("VALIDATION_ERROR", formatZodError(parsed.error)), 400);
  }
  const email = parsed.data.email.trim().toLowerCase();
  const existing = await c.env.DB.prepare(`SELECT id FROM users WHERE email = ? LIMIT 1`)
    .bind(email)
    .first<{ id: string }>();
  if (existing) {
    return c.json(apiError("CONFLICT", "Email này đã được đăng ký."), 409);
  }
  const foreign = await findForeignBranches(c.env.DB, tenantId, parsed.data.branchIds);
  if (foreign.length > 0) {
    return c.json(apiError("NOT_FOUND", "Một hoặc nhiều chi nhánh không tồn tại trong tiệm."), 404);
  }
  if (session.role !== "tenant_owner") {
    const outside = parsed.data.branchIds.filter((id) => !session.branchIds.includes(id));
    if (outside.length > 0) {
      return c.json(apiError("FORBIDDEN", "Chỉ được mời user vào chi nhánh trong phạm vi của bạn."), 403);
    }
  }
  const roleId = SYSTEM_ROLE_IDS[parsed.data.role];
  const userId = newId();
  const now = nowIso();
  // Mật khẩu ngẫu nhiên không dùng được — user đặt mật khẩu thật qua reset flow.
  const unusableHash = await hashPassword(randomToken(32));
  const statements: D1PreparedStatement[] = [
    c.env.DB.prepare(
      `INSERT INTO users (id, tenant_id, email, password_hash, full_name, phone, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, 'invited', ?, ?)`,
    ).bind(userId, tenantId, email, unusableHash, parsed.data.fullName, parsed.data.phone ?? null, now, now),
    c.env.DB.prepare(`INSERT INTO user_tenants (user_id, tenant_id, role_id) VALUES (?, ?, ?)`).bind(userId, tenantId, roleId),
    ...parsed.data.branchIds.map((branchId) =>
      c.env.DB.prepare(`INSERT INTO user_branch_access (user_id, branch_id, tenant_id) VALUES (?, ?, ?)`).bind(userId, branchId, tenantId),
    ),
    ...seedRolePermissionStatements(c.env.DB, roleId, ROLE_PERMISSIONS[parsed.data.role]),
    auditInsertStatement(c.env.DB, {
      tenantId,
      userId: session.userId,
      action: "user.invite",
      entityType: "user",
      entityId: userId,
      metadata: { email, role: parsed.data.role },
    }),
  ];
  await c.env.DB.batch(statements);
  const row = await loadUserRow(c.env.DB, tenantId, userId);
  if (!row) {
    return c.json(apiError("INTERNAL_ERROR", "Đã có lỗi xảy ra. Vui lòng thử lại sau."), 500);
  }
  return c.json({ data: publicUser(row) }, 201);
});

// ---------- GET /users/:id ----------
usersRoutes.get("/users/:id", authMiddleware, requirePermission("user.invite"), async (c) => {
  const session = c.get("session");
  const tenantId = tenantOr403(c);
  if (!tenantId) {
    return c.json(apiError("FORBIDDEN", "Phiên không gắn với tenant nào."), 403);
  }
  const row = await loadUserRow(c.env.DB, tenantId, param(c, "id"));
  if (!row) {
    return c.json(apiError("NOT_FOUND", "Không tìm thấy người dùng."), 404);
  }
  if (session.role !== "tenant_owner") {
    const branches = row.branchIdsCsv ? row.branchIdsCsv.split(",") : [];
    if (!branches.some((b) => session.branchIds.includes(b))) {
      return c.json(apiError("FORBIDDEN", "Người dùng ngoài phạm vi chi nhánh của bạn."), 403);
    }
  }
  return c.json({ data: publicUser(row) });
});

// ---------- PATCH /users/:id (Owner only) ----------
usersRoutes.patch("/users/:id", authMiddleware, requirePermission("user.invite"), async (c) => {
  const session = c.get("session");
  const tenantId = tenantOr403(c);
  if (!tenantId) {
    return c.json(apiError("FORBIDDEN", "Phiên không gắn với tenant nào."), 403);
  }
  if (session.role !== "tenant_owner") {
    return c.json(apiError("FORBIDDEN", "Chỉ chủ tiệm mới được sửa người dùng."), 403);
  }
  const targetId = param(c, "id");
  const row = await loadUserRow(c.env.DB, tenantId, targetId);
  if (!row) {
    return c.json(apiError("NOT_FOUND", "Không tìm thấy người dùng."), 404);
  }
  const parsed = updateUserSchema.partial().safeParse(await readBody(c));
  if (!parsed.success) {
    return c.json(apiError("VALIDATION_ERROR", formatZodError(parsed.error)), 400);
  }
  const d = parsed.data;
  if (targetId === session.userId && d.role !== undefined) {
    return c.json(apiError("UNPROCESSABLE", "Không thể tự đổi role của chính mình."), 422);
  }
  if (targetId === session.userId && d.status === "disabled") {
    return c.json(apiError("UNPROCESSABLE", "Không thể tự vô hiệu hoá tài khoản của chính mình."), 422);
  }
  let newRoleId: string | null = null;
  if (d.role !== undefined) {
    if (d.role in SYSTEM_ROLE_IDS) {
      newRoleId = SYSTEM_ROLE_IDS[d.role as keyof typeof SYSTEM_ROLE_IDS];
      if (d.role === "tenant_owner") {
        return c.json(apiError("UNPROCESSABLE", "Không thể gán role chủ tiệm qua thao tác này."), 422);
      }
    } else {
      const custom = await c.env.DB.prepare(
        `SELECT id FROM roles WHERE id = ? AND tenant_id = ? AND is_system = 0 LIMIT 1`,
      )
        .bind(d.role, tenantId)
        .first<{ id: string }>();
      if (!custom) {
        return c.json(apiError("VALIDATION_ERROR", "Role không tồn tại."), 400);
      }
      newRoleId = custom.id;
    }
  }
  if (d.branchIds !== undefined) {
    const foreign = await findForeignBranches(c.env.DB, tenantId, d.branchIds);
    if (foreign.length > 0) {
      return c.json(apiError("NOT_FOUND", "Một hoặc nhiều chi nhánh không tồn tại trong tiệm."), 404);
    }
  }
  const now = nowIso();
  const statements: D1PreparedStatement[] = [
    c.env.DB.prepare(`UPDATE users SET full_name = ?, phone = ?, status = ?, updated_at = ? WHERE id = ?`).bind(
      d.fullName ?? row.fullName,
      d.phone !== undefined ? d.phone : row.phone,
      d.status ?? row.status,
      now,
      targetId,
    ),
  ];
  if (newRoleId) {
    statements.push(
      c.env.DB.prepare(
        `INSERT INTO user_tenants (user_id, tenant_id, role_id) VALUES (?, ?, ?)
         ON CONFLICT(user_id, tenant_id) DO UPDATE SET role_id = excluded.role_id`,
      ).bind(targetId, tenantId, newRoleId),
    );
  }
  if (d.branchIds !== undefined) {
    statements.push(
      c.env.DB.prepare(`DELETE FROM user_branch_access WHERE user_id = ? AND tenant_id = ?`).bind(targetId, tenantId),
      ...d.branchIds.map((branchId) =>
        c.env.DB.prepare(`INSERT INTO user_branch_access (user_id, branch_id, tenant_id) VALUES (?, ?, ?)`).bind(targetId, branchId, tenantId),
      ),
    );
  }
  statements.push(
    auditInsertStatement(c.env.DB, {
      tenantId,
      userId: session.userId,
      action: "user.update",
      entityType: "user",
      entityId: targetId,
    }),
  );
  await c.env.DB.batch(statements);
  const updated = await loadUserRow(c.env.DB, tenantId, targetId);
  return c.json({ data: updated ? publicUser(updated) : null });
});

// ---------- GET /roles ----------
usersRoutes.get("/roles", authMiddleware, async (c) => {
  const tenantId = tenantOr403(c);
  if (!tenantId) {
    return c.json(apiError("FORBIDDEN", "Phiên không gắn với tenant nào."), 403);
  }
  const { page, limit, offset } = pagination(c);
  const totalRow = await c.env.DB.prepare(
    `SELECT COUNT(*) AS total FROM roles WHERE tenant_id IS NULL OR tenant_id = ?`,
  )
    .bind(tenantId)
    .first<{ total: number }>();
  const rows = await c.env.DB.prepare(
    `SELECT r.id, r.tenant_id AS tenantId, r.name, r.description,
            r.is_system AS isSystem,
            GROUP_CONCAT(DISTINCT p.key) AS permissionKeysCsv
     FROM roles r
     LEFT JOIN role_permissions rp ON rp.role_id = r.id
     LEFT JOIN permissions p ON p.id = rp.permission_id
     WHERE r.tenant_id IS NULL OR r.tenant_id = ?
     GROUP BY r.id ORDER BY r.is_system DESC, r.created_at ASC LIMIT ? OFFSET ?`,
  )
    .bind(tenantId, limit, offset)
    .all<RoleRow>();
  return c.json({
    data: (rows.results ?? []).map((r) => ({
      id: r.id,
      tenantId: r.tenantId,
      name: r.name,
      description: r.description,
      isSystem: r.isSystem === 1,
      permissions: r.permissionKeysCsv ? r.permissionKeysCsv.split(",").filter(Boolean) : [],
    })),
    meta: pageMeta(page, limit, totalRow?.total ?? 0),
  });
});

// ---------- POST /roles (Owner only) ----------
usersRoutes.post("/roles", authMiddleware, requirePermission("role.manage"), async (c) => {
  const session = c.get("session");
  const tenantId = tenantOr403(c);
  if (!tenantId) {
    return c.json(apiError("FORBIDDEN", "Phiên không gắn với tenant nào."), 403);
  }
  if (session.role !== "tenant_owner") {
    return c.json(apiError("FORBIDDEN", "Chỉ chủ tiệm mới được tạo role."), 403);
  }
  const parsed = roleSchema.safeParse(await readBody(c));
  if (!parsed.success) {
    return c.json(apiError("VALIDATION_ERROR", formatZodError(parsed.error)), 400);
  }
  const unknownKeys = parsed.data.permissions.filter((k) => !(PERMISSION_KEYS as readonly string[]).includes(k));
  if (unknownKeys.length > 0) {
    return c.json(apiError("VALIDATION_ERROR", `Quyền không hợp lệ: ${unknownKeys.join(", ")}`), 400);
  }
  const clash = await c.env.DB.prepare(`SELECT id FROM roles WHERE tenant_id = ? AND name = ? LIMIT 1`)
    .bind(tenantId, parsed.data.name)
    .first<{ id: string }>();
  if (clash) {
    return c.json(apiError("CONFLICT", "Tên role đã tồn tại trong tiệm."), 409);
  }
  const roleId = newId();
  const now = nowIso();
  const statements: D1PreparedStatement[] = [
    c.env.DB.prepare(
      `INSERT INTO roles (id, tenant_id, name, description, is_system, created_at, updated_at)
       VALUES (?, ?, ?, ?, 0, ?, ?)`,
    ).bind(roleId, tenantId, parsed.data.name, parsed.data.description ?? null, now, now),
    ...parsed.data.permissions.map((key) =>
      c.env.DB.prepare(`INSERT INTO role_permissions (role_id, permission_id) VALUES (?, ?)`).bind(roleId, `perm_${key}`),
    ),
    auditInsertStatement(c.env.DB, {
      tenantId,
      userId: session.userId,
      action: "role.create",
      entityType: "role",
      entityId: roleId,
    }),
  ];
  await c.env.DB.batch(statements);
  return c.json(
    {
      data: {
        id: roleId,
        tenantId,
        name: parsed.data.name,
        description: parsed.data.description ?? null,
        isSystem: false,
        permissions: parsed.data.permissions,
      },
    },
    201,
  );
});

// ---------- PATCH /roles/:id (Owner only; role hệ thống không sửa được) ----------
usersRoutes.patch("/roles/:id", authMiddleware, requirePermission("role.manage"), async (c) => {
  const session = c.get("session");
  const tenantId = tenantOr403(c);
  if (!tenantId) {
    return c.json(apiError("FORBIDDEN", "Phiên không gắn với tenant nào."), 403);
  }
  if (session.role !== "tenant_owner") {
    return c.json(apiError("FORBIDDEN", "Chỉ chủ tiệm mới được sửa role."), 403);
  }
  const roleId = param(c, "id");
  const existing = await c.env.DB.prepare(`SELECT id, tenant_id AS tenantId, name, is_system AS isSystem FROM roles WHERE id = ? LIMIT 1`)
    .bind(roleId)
    .first<{ id: string; tenantId: string | null; name: string; isSystem: number }>();
  if (!existing) {
    return c.json(apiError("NOT_FOUND", "Không tìm thấy role."), 404);
  }
  if (existing.isSystem === 1 || existing.tenantId === null) {
    return c.json(apiError("UNPROCESSABLE", "Không thể sửa role hệ thống."), 422);
  }
  if (existing.tenantId !== tenantId) {
    return c.json(apiError("NOT_FOUND", "Không tìm thấy role."), 404);
  }
  const parsed = roleSchema.partial().safeParse(await readBody(c));
  if (!parsed.success) {
    return c.json(apiError("VALIDATION_ERROR", formatZodError(parsed.error)), 400);
  }
  const d = parsed.data;
  if (d.permissions !== undefined) {
    const unknownKeys = d.permissions.filter((k) => !(PERMISSION_KEYS as readonly string[]).includes(k));
    if (unknownKeys.length > 0) {
      return c.json(apiError("VALIDATION_ERROR", `Quyền không hợp lệ: ${unknownKeys.join(", ")}`), 400);
    }
  }
  if (d.name !== undefined && d.name !== existing.name) {
    const clash = await c.env.DB.prepare(`SELECT id FROM roles WHERE tenant_id = ? AND name = ? AND id != ? LIMIT 1`)
      .bind(tenantId, d.name, roleId)
      .first<{ id: string }>();
    if (clash) {
      return c.json(apiError("CONFLICT", "Tên role đã tồn tại trong tiệm."), 409);
    }
  }
  const now = nowIso();
  const statements: D1PreparedStatement[] = [
    c.env.DB.prepare(`UPDATE roles SET name = ?, description = ?, updated_at = ? WHERE id = ?`).bind(
      d.name ?? existing.name,
      d.description !== undefined ? d.description : null,
      now,
      roleId,
    ),
  ];
  if (d.permissions !== undefined) {
    statements.push(c.env.DB.prepare(`DELETE FROM role_permissions WHERE role_id = ?`).bind(roleId));
    for (const key of d.permissions) {
      statements.push(
        c.env.DB.prepare(`INSERT INTO role_permissions (role_id, permission_id) VALUES (?, ?)`).bind(roleId, `perm_${key}`),
      );
    }
  }
  statements.push(
    auditInsertStatement(c.env.DB, {
      tenantId,
      userId: session.userId,
      action: "role.update",
      entityType: "role",
      entityId: roleId,
    }),
  );
  await c.env.DB.batch(statements);
  const perms = await c.env.DB.prepare(
    `SELECT p.key AS key FROM role_permissions rp JOIN permissions p ON p.id = rp.permission_id WHERE rp.role_id = ?`,
  )
    .bind(roleId)
    .all<{ key: string }>();
  const updated = await c.env.DB.prepare(`SELECT id, tenant_id AS tenantId, name, description, is_system AS isSystem FROM roles WHERE id = ? LIMIT 1`)
    .bind(roleId)
    .first<{ id: string; tenantId: string | null; name: string; description: string | null; isSystem: number }>();
  return c.json({
    data: {
      id: updated?.id,
      tenantId: updated?.tenantId,
      name: updated?.name,
      description: updated?.description,
      isSystem: updated?.isSystem === 1,
      permissions: (perms.results ?? []).map((p) => p.key),
    },
  });
});

// ---------- GET /permissions ----------
usersRoutes.get("/permissions", authMiddleware, async (c) => {
  const rows = await c.env.DB.prepare(
    `SELECT id, key, module, description FROM permissions ORDER BY module ASC, key ASC`,
  ).all<{ id: string; key: string; module: string; description: string | null }>();
  return c.json({ data: rows.results ?? [] });
});
