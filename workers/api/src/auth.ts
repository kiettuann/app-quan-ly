// Auth / session middleware — Hono. Nguồn: ARCHITECTURE.md §4, API_SPEC.md §2.
// Tenant context lấy từ phiên đã xác minh, KHÔNG tin tenant_id client gửi.
// Foundation: session token hash tra trong bảng sessions (D1). Chưa có đăng ký
// thật / hash mật khẩu ở đây — endpoint login trả 501 cho tới Phase 4 (ghi rõ).
import type { Context, Next } from "hono";
import { apiError } from "@quanly/shared";
import type { SessionContext } from "@quanly/shared";
import type { Env } from "./index.js";

export type AppContext = Context<{ Bindings: Env; Variables: { session: SessionContext } }>;

export async function hashToken(token: string): Promise<string> {
  const data = new TextEncoder().encode(`quanly-store-session:${token}`);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Middleware xác thực: đọc Bearer token, tra sessions (chỉ hash), kiểm tra
 * hết hạn / revoke, nạp SessionContext vào c.get("session").
 * Thiếu token hoặc session không hợp lệ -> 401. Không log token.
 */
export async function authMiddleware(c: AppContext, next: Next): Promise<Response | void> {
  const header = c.req.header("Authorization");
  const token = header?.startsWith("Bearer ") ? header.slice("Bearer ".length) : null;
  if (!token) {
    return c.json(apiError("UNAUTHORIZED", "Chưa đăng nhập. Vui lòng đăng nhập lại."), 401);
  }
  const tokenHash = await hashToken(token);
  // Tra session + user + role + branch access trong 1 lần (D1).
  // Lưu ý: đây là skeleton Foundation — query chi tiết hoàn thiện ở Phase 4
  // khi có dữ liệu user/role thật; hiện tại session chưa tồn tại -> 401.
  const row = await c.env.DB.prepare(
    `SELECT s.user_id AS userId, s.expires_at AS expiresAt, s.revoked_at AS revokedAt,
            u.tenant_id AS tenantId
     FROM sessions s JOIN users u ON u.id = s.user_id
     WHERE s.token_hash = ? LIMIT 1`,
  )
    .bind(tokenHash)
    .first<{ userId: string; expiresAt: string; revokedAt: string | null; tenantId: string | null }>();
  if (!row || row.revokedAt || new Date(row.expiresAt) <= new Date()) {
    return c.json(apiError("UNAUTHORIZED", "Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại."), 401);
  }
  const branches = await c.env.DB.prepare(
    `SELECT branch_id AS branchId FROM user_branch_access WHERE user_id = ?`,
  )
    .bind(row.userId)
    .all<{ branchId: string }>();
  const session: SessionContext = {
    userId: row.userId,
    tenantId: row.tenantId,
    role: "unknown",
    branchIds: (branches.results ?? []).map((b) => b.branchId),
    isPlatformAdmin: row.tenantId === null,
    permissions: [],
  };
  c.set("session", session);
  await next();
}

/** Log an toàn: không bao giờ log token, OTP, mật khẩu. */
export function safeLog(message: string, meta?: Record<string, string>): void {
  console.warn(JSON.stringify({ level: "info", message, ...meta }));
}
