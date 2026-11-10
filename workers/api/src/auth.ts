// Auth / session middleware + session helpers — Hono.
// Nguồn: ARCHITECTURE.md §4, API_SPEC.md §2.
// Tenant context lấy từ phiên đã xác minh, KHÔNG tin tenant_id client gửi.
// Session: token ngẫu nhiên, DB chỉ lưu SHA-256 hash, hết hạn 7 ngày, revoke được.
import type { Context, Next } from "hono";
import { apiError } from "@quanly/shared";
import type { SessionContext } from "@quanly/shared";
import type { Env } from "./index.js";
import { randomToken, sha256Hex } from "./crypto.js";
import { newId, nowIso } from "./db.js";

export type AppContext = Context<{ Bindings: Env; Variables: { session: SessionContext } }>;

export async function hashToken(token: string): Promise<string> {
  return sha256Hex(`quanly-store-session:${token}`);
}

export const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/** Tạo session mới, trả token thật (chỉ trả 1 lần cho client). */
export async function createSession(
  db: D1Database,
  userId: string,
): Promise<{ token: string; expiresAt: string }> {
  const token = randomToken(32);
  const tokenHash = await hashToken(token);
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS).toISOString();
  await db
    .prepare(`INSERT INTO sessions (id, user_id, token_hash, expires_at, revoked_at, created_at) VALUES (?, ?, ?, ?, NULL, ?)`)
    .bind(newId(), userId, tokenHash, expiresAt, nowIso())
    .run();
  return { token, expiresAt };
}

export async function revokeSession(db: D1Database, token: string): Promise<void> {
  const tokenHash = await hashToken(token);
  await db
    .prepare(`UPDATE sessions SET revoked_at = ? WHERE token_hash = ?`)
    .bind(nowIso(), tokenHash)
    .run();
}

interface SessionRow {
  userId: string;
  expiresAt: string;
  revokedAt: string | null;
  tenantId: string | null;
  roleName: string | null;
  userStatus: string;
}

/**
 * Middleware xác thực: đọc Bearer token -> tra sessions (chỉ hash) -> kiểm tra
 * hết hạn / revoke / user bị disable -> nạp SessionContext (role + permissions +
 * branchIds) vào c.get("session"). Thiếu token hoặc session không hợp lệ -> 401.
 * Platform Admin: user có tenant_id null + role platform_admin.
 */
export async function authMiddleware(c: AppContext, next: Next): Promise<Response | void> {
  const header = c.req.header("Authorization");
  const token = header?.startsWith("Bearer ") ? header.slice("Bearer ".length) : null;
  if (!token) {
    return c.json(apiError("UNAUTHORIZED", "Chưa đăng nhập. Vui lòng đăng nhập lại."), 401);
  }
  const tokenHash = await hashToken(token);
  const row = await c.env.DB.prepare(
    `SELECT s.user_id AS userId, s.expires_at AS expiresAt, s.revoked_at AS revokedAt,
            u.tenant_id AS tenantId, u.status AS userStatus,
            r.name AS roleName
     FROM sessions s
     JOIN users u ON u.id = s.user_id
     LEFT JOIN user_tenants ut ON ut.user_id = u.id AND ut.tenant_id = u.tenant_id
     LEFT JOIN roles r ON r.id = ut.role_id
     WHERE s.token_hash = ? LIMIT 1`,
  )
    .bind(tokenHash)
    .first<SessionRow>();
  if (!row || row.revokedAt || new Date(row.expiresAt) <= new Date() || row.userStatus === "disabled") {
    return c.json(apiError("UNAUTHORIZED", "Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại."), 401);
  }
  // User có tenant_id NULL là Platform Admin theo thiết kế: user_tenants yêu cầu
  // tenant_id nên role platform_admin không thể lưu qua bảng đó; mọi user không
  // thuộc tenant nào đều là quản trị nền tảng (chỉ tạo được bằng seed/admin script).
  // (Sửa 2026-11-10: trước đây JOIN user_tenants trả roleName null cho user này
  // nên isPlatformAdmin luôn false và mọi request admin đều 403.)
  const roleName = row.tenantId === null ? "platform_admin" : (row.roleName ?? "unknown");
  const isPlatformAdmin = row.tenantId === null && roleName === "platform_admin";
  // Branch access: Owner thấy mọi chi nhánh của tenant; người khác chỉ thấy user_branch_access.
  let branchIds: string[] = [];
  if (isPlatformAdmin) {
    branchIds = [];
  } else if (roleName === "tenant_owner" && row.tenantId) {
    const branches = await c.env.DB.prepare(`SELECT id AS branchId FROM branches WHERE tenant_id = ?`)
      .bind(row.tenantId)
      .all<{ branchId: string }>();
    branchIds = (branches.results ?? []).map((b) => b.branchId);
  } else {
    const branches = await c.env.DB.prepare(
      `SELECT branch_id AS branchId FROM user_branch_access WHERE user_id = ?`,
    )
      .bind(row.userId)
      .all<{ branchId: string }>();
    branchIds = (branches.results ?? []).map((b) => b.branchId);
  }
  // Permissions: từ role của user trong tenant (hoặc role platform_admin).
  let permissions: string[] = [];
  if (isPlatformAdmin) {
    permissions = ["admin.tenants", "admin.plans", "admin.audit"];
  } else if (roleName !== "unknown") {
    const permRows = await c.env.DB.prepare(
      `SELECT p.key AS key FROM role_permissions rp
       JOIN permissions p ON p.id = rp.permission_id
       JOIN roles r ON r.id = rp.role_id
       WHERE r.name = ? AND (r.tenant_id = ? OR r.tenant_id IS NULL)`,
    )
      .bind(roleName, row.tenantId)
      .all<{ key: string }>();
    permissions = (permRows.results ?? []).map((p) => p.key);
  }
  const session: SessionContext = {
    userId: row.userId,
    tenantId: row.tenantId,
    role: roleName,
    branchIds,
    isPlatformAdmin,
    permissions,
  };
  c.set("session", session);
  await next();
}

/** Chỉ Platform Admin mới qua được. */
export async function requirePlatformAdmin(c: AppContext, next: Next): Promise<Response | void> {
  const session = c.get("session");
  if (!session.isPlatformAdmin) {
    return c.json(apiError("FORBIDDEN", "Chỉ quản trị nền tảng mới được truy cập khu vực này."), 403);
  }
  await next();
}

/** Log an toàn: không bao giờ log token, OTP, mật khẩu. */
export function safeLog(message: string, meta?: Record<string, string>): void {
  console.warn(JSON.stringify({ level: "info", message, ...meta }));
}
