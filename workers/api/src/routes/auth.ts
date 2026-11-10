// Auth + tenant registration — Phase 4 (MVP part 1).
// Nguồn: CONTRACTS.md §3, API_SPEC.md §2, DATABASE_SCHEMA.md §2.
// Env trong index.ts chưa khai báo RESEND_API_KEY / EMAIL_FROM (chỉ có trong
// wrangler secret / vars) nên đọc qua cast — KHÔNG sửa index.ts (ngoài phạm vi).
import { Hono, type Context } from "hono";
import {
  apiError,
  EmailOtpSender,
  generateOtpCode,
  hashOtp,
  OTP_MAX_ATTEMPTS,
  OTP_MAX_SENDS_PER_HOUR,
  OTP_RESEND_COOLDOWN_MS,
  OTP_TTL_MS,
  type SessionContext,
} from "@quanly/shared";
import type { Env } from "../index.js";
import { authMiddleware, createSession, revokeSession } from "../auth.js";
import { hashPassword, randomToken, sha256Hex, verifyPassword } from "../crypto.js";
import { newId, nowIso } from "../db.js";
import { checkRateLimit } from "../rate-limit.js";
import { ROLE_PERMISSIONS, SYSTEM_ROLE_IDS } from "../roles.js";
import {
  forgotPasswordSchema,
  loginSchema,
  otpSendSchema,
  otpVerifySchema,
  registerTenantSchema,
  resetPasswordSchema,
} from "../validation.js";
import { auditInsertStatement } from "../audit.js";
import type { z } from "zod";

export const authRoutes = new Hono<{ Bindings: Env; Variables: { session: SessionContext } }>();

type AppCtx = Context<{ Bindings: Env; Variables: { session: SessionContext } }>;
type ExtraEnv = Env & { RESEND_API_KEY?: string; EMAIL_FROM?: string };

interface UserRow {
  id: string;
  tenantId: string | null;
  email: string;
  passwordHash: string;
  fullName: string;
  phone: string | null;
  status: string;
}

interface OtpRow {
  id: string;
  email: string;
  otpHash: string;
  purpose: string;
  expiresAt: string;
  attempts: number;
  maxAttempts: number;
  resendAfter: string;
  createdAt: string;
}

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

function isDevMode(c: AppCtx): boolean {
  return c.env.OTP_DEV_MODE === "true";
}

function resendKey(c: AppCtx): string | null {
  return (c.env as ExtraEnv).RESEND_API_KEY ?? null;
}

function emailFrom(c: AppCtx): string {
  return (c.env as ExtraEnv).EMAIL_FROM ?? "quanly.store <no-reply@quanly.store>";
}

function bearerToken(c: AppCtx): string | null {
  const header = c.req.header("Authorization");
  return header?.startsWith("Bearer ") ? header.slice("Bearer ".length) : null;
}

async function loadBranchIds(db: D1Database, userId: string, tenantId: string | null, roleName: string): Promise<string[]> {
  if (!tenantId) return [];
  if (roleName === "tenant_owner") {
    const rows = await db
      .prepare(`SELECT id AS branchId FROM branches WHERE tenant_id = ?`)
      .bind(tenantId)
      .all<{ branchId: string }>();
    return (rows.results ?? []).map((b) => b.branchId);
  }
  const rows = await db
    .prepare(`SELECT branch_id AS branchId FROM user_branch_access WHERE user_id = ?`)
    .bind(userId)
    .all<{ branchId: string }>();
  return (rows.results ?? []).map((b) => b.branchId);
}

async function loadRoleName(db: D1Database, userId: string, tenantId: string | null): Promise<string> {
  if (!tenantId) return "platform_admin";
  const row = await db
    .prepare(
      `SELECT r.name AS roleName FROM user_tenants ut
       JOIN roles r ON r.id = ut.role_id
       WHERE ut.user_id = ? AND ut.tenant_id = ? LIMIT 1`,
    )
    .bind(userId, tenantId)
    .first<{ roleName: string }>();
  return row?.roleName ?? "unknown";
}

async function loadPermissions(db: D1Database, tenantId: string | null, roleName: string): Promise<string[]> {
  if (!tenantId) return roleName === "platform_admin" ? ["admin.tenants", "admin.plans", "admin.audit"] : [];
  const rows = await db
    .prepare(
      `SELECT p.key AS key FROM role_permissions rp
       JOIN permissions p ON p.id = rp.permission_id
       JOIN roles r ON r.id = rp.role_id
       WHERE r.name = ? AND (r.tenant_id = ? OR r.tenant_id IS NULL)`,
    )
    .bind(roleName, tenantId)
    .all<{ key: string }>();
  return (rows.results ?? []).map((p) => p.key);
}

function publicUser(user: UserRow, roleName: string, branchIds: string[]) {
  return {
    id: user.id,
    email: user.email,
    fullName: user.fullName,
    phone: user.phone,
    status: user.status,
    tenantId: user.tenantId,
    role: roleName,
    branchIds,
  };
}

// ---------- POST /auth/login ----------
authRoutes.post("/auth/login", async (c) => {
  const parsed = loginSchema.safeParse(await readBody(c));
  if (!parsed.success) {
    return c.json(apiError("VALIDATION_ERROR", formatZodError(parsed.error)), 400);
  }
  const email = parsed.data.email.trim().toLowerCase();
  if (!checkRateLimit(`login:${email}`, 5, 60_000)) {
    return c.json(apiError("RATE_LIMITED", "Đăng nhập quá nhiều lần. Vui lòng thử lại sau 1 phút."), 429);
  }
  const user = await c.env.DB.prepare(
    `SELECT id, tenant_id AS tenantId, email, password_hash AS passwordHash,
            full_name AS fullName, phone, status
     FROM users WHERE email = ? LIMIT 1`,
  )
    .bind(email)
    .first<UserRow>();
  // Thông báo chung cho mọi trường hợp sai — không lộ email có tồn tại hay không.
  const generic = "Email hoặc mật khẩu không đúng.";
  if (!user || user.status === "disabled") {
    return c.json(apiError("UNAUTHORIZED", generic), 401);
  }
  if (!(await verifyPassword(parsed.data.password, user.passwordHash))) {
    return c.json(apiError("UNAUTHORIZED", generic), 401);
  }
  const roleName = await loadRoleName(c.env.DB, user.id, user.tenantId);
  const branchIds = await loadBranchIds(c.env.DB, user.id, user.tenantId, roleName);
  const session = await createSession(c.env.DB, user.id);
  return c.json({ data: { token: session.token, expiresAt: session.expiresAt, user: publicUser(user, roleName, branchIds) } });
});

// ---------- POST /auth/logout ----------
authRoutes.post("/auth/logout", authMiddleware, async (c) => {
  const token = bearerToken(c);
  if (token) await revokeSession(c.env.DB, token);
  return c.json({ data: { revoked: true } });
});

// ---------- POST /auth/forgot-password ----------
authRoutes.post("/auth/forgot-password", async (c) => {
  const parsed = forgotPasswordSchema.safeParse(await readBody(c));
  if (!parsed.success) {
    return c.json(apiError("VALIDATION_ERROR", formatZodError(parsed.error)), 400);
  }
  const email = parsed.data.email.trim().toLowerCase();
  if (!checkRateLimit(`forgot:${email}`, 5, 60_000)) {
    return c.json(apiError("RATE_LIMITED", "Yêu cầu quá nhiều lần. Vui lòng thử lại sau 1 phút."), 429);
  }
  const dev = isDevMode(c);
  const apiKey = resendKey(c);
  // Chưa cấu hình email và không phải dev -> 422 trung thực, áp dụng cho mọi
  // email như nhau nên không lộ email có tồn tại hay không.
  if (!dev && !apiKey) {
    return c.json(apiError("UNPROCESSABLE", "Chưa cấu hình email (thiếu RESEND_API_KEY). Không thể gửi email đặt lại mật khẩu."), 422);
  }
  const user = await c.env.DB.prepare(`SELECT id FROM users WHERE email = ? LIMIT 1`)
    .bind(email)
    .first<{ id: string }>();
  let devResetToken: string | undefined;
  if (user) {
    const token = randomToken(32);
    const tokenHash = await sha256Hex(token);
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    await c.env.DB.prepare(
      `INSERT INTO password_resets (id, user_id, token_hash, expires_at, used_at, created_at)
       VALUES (?, ?, ?, ?, NULL, ?)`,
    )
      .bind(newId(), user.id, tokenHash, expiresAt, nowIso())
      .run();
    if (dev) {
      devResetToken = token;
    } else if (apiKey) {
      // Mailer riêng cho reset: link đặt lại mật khẩu, hết hạn 1 giờ, dùng 1 lần.
      // APP_URL lấy từ Origin của request (app web) nếu có, mặc định quanly.store.
      const origin = c.req.header("Origin") ?? "https://quanly.store";
      const sender = new EmailOtpSender(apiKey, emailFrom(c));
      await sender.sendPasswordReset(
        email,
        `${origin.replace(/\/$/, "")}/dat-lai-mat-khau?token=${token}`,
      );
    }
  }
  // KHÔNG bao giờ lộ email có tồn tại hay không.
  const data: { sent: boolean; devResetToken?: string } = { sent: true };
  if (devResetToken) data.devResetToken = devResetToken;
  return c.json({ data });
});

// ---------- POST /auth/reset-password ----------
authRoutes.post("/auth/reset-password", async (c) => {
  const parsed = resetPasswordSchema.safeParse(await readBody(c));
  if (!parsed.success) {
    return c.json(apiError("VALIDATION_ERROR", formatZodError(parsed.error)), 400);
  }
  const tokenHash = await sha256Hex(parsed.data.token);
  const row = await c.env.DB.prepare(
    `SELECT id, user_id AS userId, expires_at AS expiresAt, used_at AS usedAt
     FROM password_resets WHERE token_hash = ? LIMIT 1`,
  )
    .bind(tokenHash)
    .first<{ id: string; userId: string; expiresAt: string; usedAt: string | null }>();
  if (!row || row.usedAt || new Date(row.expiresAt) <= new Date()) {
    return c.json(apiError("VALIDATION_ERROR", "Token đặt lại mật khẩu không hợp lệ hoặc đã hết hạn."), 400);
  }
  const passwordHash = await hashPassword(parsed.data.password);
  const now = nowIso();
  await c.env.DB.batch([
    c.env.DB.prepare(`UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?`).bind(passwordHash, now, row.userId),
    c.env.DB.prepare(`UPDATE password_resets SET used_at = ? WHERE id = ?`).bind(now, row.id),
    c.env.DB.prepare(`UPDATE sessions SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL`).bind(now, row.userId),
  ]);
  return c.json({ data: { reset: true } });
});

// ---------- GET /auth/me ----------
authRoutes.get("/auth/me", authMiddleware, async (c) => {
  const session = c.get("session");
  const user = await c.env.DB.prepare(
    `SELECT id, tenant_id AS tenantId, email, password_hash AS passwordHash,
            full_name AS fullName, phone, status
     FROM users WHERE id = ? LIMIT 1`,
  )
    .bind(session.userId)
    .first<UserRow>();
  if (!user) {
    return c.json(apiError("NOT_FOUND", "Không tìm thấy tài khoản."), 404);
  }
  const tenant = session.tenantId
    ? await c.env.DB.prepare(
        `SELECT id, name, slug, phone, email, status, plan_id AS planId, created_at AS createdAt
         FROM tenants WHERE id = ? LIMIT 1`,
      )
        .bind(session.tenantId)
        .first<Record<string, unknown>>()
    : null;
  const permissions = await loadPermissions(c.env.DB, session.tenantId, session.role);
  return c.json({
    data: {
      user: publicUser(user, session.role, [...session.branchIds]),
      tenant,
      role: session.role,
      branchIds: [...session.branchIds],
      permissions,
    },
  });
});

// ---------- POST /auth/otp/send ----------
authRoutes.post("/auth/otp/send", async (c) => {
  const parsed = otpSendSchema.safeParse(await readBody(c));
  if (!parsed.success) {
    return c.json(apiError("VALIDATION_ERROR", formatZodError(parsed.error)), 400);
  }
  const email = parsed.data.email.trim().toLowerCase();
  const user = await c.env.DB.prepare(
    `SELECT id, status FROM users WHERE email = ? AND tenant_id IS NOT NULL LIMIT 1`,
  )
    .bind(email)
    .first<{ id: string; status: string }>();
  if (!user || user.status === "disabled") {
    return c.json(apiError("NOT_FOUND", "Không tìm thấy tài khoản nhân viên với email này."), 404);
  }
  const dev = isDevMode(c);
  const apiKey = resendKey(c);
  if (!dev && !apiKey) {
    return c.json(apiError("UNPROCESSABLE", "Chưa cấu hình email (thiếu RESEND_API_KEY). Không thể gửi mã OTP."), 422);
  }
  const now = new Date();
  const nowIsoStr = now.toISOString();
  const latest = await c.env.DB.prepare(
    `SELECT id, email, otp_hash AS otpHash, purpose, expires_at AS expiresAt,
            attempts, max_attempts AS maxAttempts, resend_after AS resendAfter, created_at AS createdAt
     FROM email_otp_challenges WHERE email = ? ORDER BY created_at DESC LIMIT 1`,
  )
    .bind(email)
    .first<OtpRow>();
  if (latest && new Date(latest.resendAfter) > now) {
    return c.json(apiError("RATE_LIMITED", "Vui lòng đợi 60 giây trước khi gửi lại mã."), 429);
  }
  const hourAgo = new Date(now.getTime() - 60 * 60 * 1000).toISOString();
  const countRow = await c.env.DB.prepare(
    `SELECT COUNT(*) AS count FROM email_otp_challenges WHERE email = ? AND created_at >= ?`,
  )
    .bind(email, hourAgo)
    .first<{ count: number }>();
  if ((countRow?.count ?? 0) >= OTP_MAX_SENDS_PER_HOUR) {
    return c.json(apiError("RATE_LIMITED", "Đã gửi tối đa 5 mã trong 1 giờ. Vui lòng thử lại sau."), 429);
  }
  const code = generateOtpCode();
  const otpHash = await hashOtp(code);
  const expiresAt = new Date(now.getTime() + OTP_TTL_MS).toISOString();
  const resendAfter = new Date(now.getTime() + OTP_RESEND_COOLDOWN_MS).toISOString();
  await c.env.DB.prepare(
    `INSERT INTO email_otp_challenges (id, email, otp_hash, purpose, expires_at, attempts, max_attempts, resend_after, created_at)
     VALUES (?, ?, ?, 'login', ?, 0, ?, ?, ?)`,
  )
    .bind(newId(), email, otpHash, expiresAt, OTP_MAX_ATTEMPTS, resendAfter, nowIsoStr)
    .run();
  if (dev) {
    return c.json({ data: { sent: true, devCode: code } });
  }
  // apiKey đã kiểm tra ở trên nên không null tại đây.
  const sender = new EmailOtpSender(apiKey, emailFrom(c));
  await sender.send({ channel: "email", to: email, code });
  return c.json({ data: { sent: true } });
});

// ---------- POST /auth/otp/verify ----------
authRoutes.post("/auth/otp/verify", async (c) => {
  const parsed = otpVerifySchema.safeParse(await readBody(c));
  if (!parsed.success) {
    return c.json(apiError("VALIDATION_ERROR", formatZodError(parsed.error)), 400);
  }
  const email = parsed.data.email.trim().toLowerCase();
  const challenge = await c.env.DB.prepare(
    `SELECT id, email, otp_hash AS otpHash, purpose, expires_at AS expiresAt,
            attempts, max_attempts AS maxAttempts, resend_after AS resendAfter, created_at AS createdAt
     FROM email_otp_challenges WHERE email = ? AND purpose = 'login' ORDER BY created_at DESC LIMIT 1`,
  )
    .bind(email)
    .first<OtpRow>();
  if (!challenge) {
    return c.json(apiError("UNAUTHORIZED", "Mã OTP không đúng hoặc đã hết hạn."), 401);
  }
  if (new Date(challenge.expiresAt) <= new Date()) {
    return c.json(apiError("UNPROCESSABLE", "Mã OTP đã hết hạn. Vui lòng gửi mã mới."), 422);
  }
  if (challenge.attempts >= challenge.maxAttempts) {
    return c.json(apiError("RATE_LIMITED", "Nhập sai quá 5 lần. Vui lòng gửi mã mới."), 429);
  }
  const codeHash = await hashOtp(parsed.data.code);
  if (codeHash !== challenge.otpHash) {
    await c.env.DB.prepare(`UPDATE email_otp_challenges SET attempts = attempts + 1 WHERE id = ?`)
      .bind(challenge.id)
      .run();
    return c.json(apiError("UNAUTHORIZED", "Mã OTP không đúng."), 401);
  }
  const user = await c.env.DB.prepare(
    `SELECT id, tenant_id AS tenantId, email, password_hash AS passwordHash,
            full_name AS fullName, phone, status
     FROM users WHERE email = ? AND tenant_id IS NOT NULL LIMIT 1`,
  )
    .bind(email)
    .first<UserRow>();
  if (!user || user.status === "disabled") {
    return c.json(apiError("UNAUTHORIZED", "Tài khoản không còn khả dụng."), 401);
  }
  await c.env.DB.prepare(`DELETE FROM email_otp_challenges WHERE id = ?`).bind(challenge.id).run();
  const roleName = await loadRoleName(c.env.DB, user.id, user.tenantId);
  const branchIds = await loadBranchIds(c.env.DB, user.id, user.tenantId, roleName);
  const session = await createSession(c.env.DB, user.id);
  return c.json({ data: { token: session.token, expiresAt: session.expiresAt, user: publicUser(user, roleName, branchIds) } });
});

// ---------- POST /tenants (public registration) ----------
function slugifyTenantName(name: string): string {
  const base = name
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 50);
  return `${base || "tiem"}-${randomToken(3)}`;
}

authRoutes.post("/tenants", async (c) => {
  const parsed = registerTenantSchema.safeParse(await readBody(c));
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
  // Slug duy nhất: tên chuẩn hoá + hậu tố ngẫu nhiên, thử lại nếu trùng.
  let slug = slugifyTenantName(parsed.data.tenantName);
  for (let attempt = 0; attempt < 5; attempt++) {
    const clash = await c.env.DB.prepare(`SELECT id FROM tenants WHERE slug = ? LIMIT 1`)
      .bind(slug)
      .first<{ id: string }>();
    if (!clash) break;
    slug = slugifyTenantName(parsed.data.tenantName);
  }
  const now = nowIso();
  const tenantId = newId();
  const userId = newId();
  const branchId = newId();
  const subscriptionId = newId();
  const trialEndsAt = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString();
  const passwordHash = await hashPassword(parsed.data.password);
  const statements: D1PreparedStatement[] = [
    c.env.DB.prepare(
      `INSERT INTO tenants (id, name, slug, phone, email, status, plan_id, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 'trial', 'plan_basic', ?, ?)`,
    ).bind(tenantId, parsed.data.tenantName, slug, parsed.data.phone, email, now, now),
    c.env.DB.prepare(
      `INSERT INTO users (id, tenant_id, email, password_hash, full_name, phone, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, 'active', ?, ?)`,
    ).bind(userId, tenantId, email, passwordHash, parsed.data.tenantName, parsed.data.phone, now, now),
    c.env.DB.prepare(
      `INSERT INTO branches (id, tenant_id, name, address, phone, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 'active', ?, ?)`,
    ).bind(branchId, tenantId, parsed.data.branchName, parsed.data.branchAddress ?? null, parsed.data.phone, now, now),
    c.env.DB.prepare(
      `INSERT INTO user_tenants (user_id, tenant_id, role_id) VALUES (?, ?, ?)`,
    ).bind(userId, tenantId, SYSTEM_ROLE_IDS.tenant_owner),
    c.env.DB.prepare(
      `INSERT INTO user_branch_access (user_id, branch_id, tenant_id) VALUES (?, ?, ?)`,
    ).bind(userId, branchId, tenantId),
    c.env.DB.prepare(
      `INSERT INTO subscriptions (id, tenant_id, plan_id, status, started_at, ends_at, created_at, updated_at)
       VALUES (?, ?, 'plan_basic', 'trial', ?, ?, ?, ?)`,
    ).bind(subscriptionId, tenantId, now, trialEndsAt, now, now),
    auditInsertStatement(c.env.DB, {
      tenantId,
      userId,
      action: "tenant.register",
      entityType: "tenant",
      entityId: tenantId,
    }),
  ];
  // Seed quyền cho role tenant_owner (migration chỉ seed bảng permissions/roles,
  // chưa seed role_permissions) — INSERT OR IGNORE để chạy lại an toàn.
  for (const key of ROLE_PERMISSIONS.tenant_owner) {
    statements.push(
      c.env.DB.prepare(`INSERT OR IGNORE INTO role_permissions (role_id, permission_id) VALUES (?, ?)`).bind(
        SYSTEM_ROLE_IDS.tenant_owner,
        `perm_${key}`,
      ),
    );
  }
  await c.env.DB.batch(statements);
  const session = await createSession(c.env.DB, userId);
  const branchIds = [branchId];
  return c.json(
    {
      data: {
        tenant: {
          id: tenantId,
          name: parsed.data.tenantName,
          slug,
          phone: parsed.data.phone,
          email,
          status: "trial",
          planId: "plan_basic",
        },
        branch: { id: branchId, tenantId, name: parsed.data.branchName, address: parsed.data.branchAddress ?? null, phone: parsed.data.phone, status: "active" },
        user: { id: userId, email, fullName: parsed.data.tenantName, phone: parsed.data.phone, status: "active", tenantId, role: "tenant_owner", branchIds },
        token: session.token,
        expiresAt: session.expiresAt,
      },
    },
    201,
  );
});

// ---------- GET /tenants/me ----------
authRoutes.get("/tenants/me", authMiddleware, async (c) => {
  const session = c.get("session");
  if (!session.tenantId) {
    return c.json(apiError("NOT_FOUND", "Phiên không gắn với tenant nào."), 404);
  }
  const tenant = await c.env.DB.prepare(
    `SELECT id, name, slug, phone, email, status, plan_id AS planId, created_at AS createdAt, updated_at AS updatedAt
     FROM tenants WHERE id = ? LIMIT 1`,
  )
    .bind(session.tenantId)
    .first<Record<string, unknown>>();
  if (!tenant) {
    return c.json(apiError("NOT_FOUND", "Không tìm thấy tenant."), 404);
  }
  const subscription = await c.env.DB.prepare(
    `SELECT s.id, s.plan_id AS planId, p.name AS planName, s.status, s.started_at AS startedAt,
            s.ends_at AS endsAt
     FROM subscriptions s LEFT JOIN plans p ON p.id = s.plan_id
     WHERE s.tenant_id = ? ORDER BY s.created_at DESC LIMIT 1`,
  )
    .bind(session.tenantId)
    .first<Record<string, unknown>>();
  const branches = await c.env.DB.prepare(
    `SELECT id, tenant_id AS tenantId, name, address, phone, status, created_at AS createdAt
     FROM branches WHERE tenant_id = ? ORDER BY created_at ASC`,
  )
    .bind(session.tenantId)
    .all<Record<string, unknown>>();
  return c.json({ data: { tenant, subscription: subscription ?? null, branches: branches.results ?? [] } });
});
