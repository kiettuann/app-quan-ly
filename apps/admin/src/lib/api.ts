// API client cho Platform Admin — giống apps/web: token trong localStorage
// (key `ql_admin_token`), 401 → xóa token, chuyển về /dang-nhap.
// Envelope: thành công { data, meta? }, lỗi { error: { code, message } }.
// API Phase 4 trả camelCase (CONTRACTS.md §2); các hàm chuẩn hoá chấp nhận
// cả snake_case để client không vỡ nếu server trả tên cột SQL.
const API_URL = import.meta.env.VITE_API_URL ?? "http://localhost:8787";
export const ADMIN_TOKEN_KEY = "ql_admin_token";

export function getAdminToken(): string | null {
  try {
    return localStorage.getItem(ADMIN_TOKEN_KEY);
  } catch {
    return null;
  }
}

export class ApiError extends Error {
  code: string;
  status: number;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export interface PageMeta {
  page: number;
  limit: number;
  total: number;
  total_pages: number;
}

export interface ListResult<T> {
  items: T[];
  meta: PageMeta | null;
}

type Raw = Record<string, unknown>;

function asRaw(v: unknown): Raw {
  return typeof v === "object" && v !== null ? (v as Raw) : {};
}
function str(v: unknown): string {
  return typeof v === "string" ? v : v == null ? "" : String(v);
}
function optStr(v: unknown): string | null {
  const s = str(v);
  return s === "" ? null : s;
}
function num(v: unknown, fallback = 0): number {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : fallback;
}
function optNum(v: unknown): number | null {
  if (v === undefined || v === null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}
function pick(raw: Raw, ...keys: unknown[]): unknown {
  for (const k of keys) {
    if (typeof k !== "string" || k === "") continue;
    if (raw[k] !== undefined && raw[k] !== null) return raw[k];
  }
  return undefined;
}
function asArray(data: unknown): Raw[] {
  if (Array.isArray(data)) return data.filter((x): x is Raw => typeof x === "object" && x !== null);
  const raw = asRaw(data);
  for (const k of ["items", "tenants", "plans", "subscriptions", "logs", "results"]) {
    if (Array.isArray(raw[k])) return asArray(raw[k]);
  }
  return [];
}
function asMeta(data: unknown): PageMeta | null {
  const raw = asRaw(data);
  const meta = asRaw(raw.meta);
  if (typeof meta.total !== "number") return null;
  return {
    page: num(meta.page, 1),
    limit: num(meta.limit, 20),
    total: num(meta.total, 0),
    total_pages: num(pick(meta, "total_pages", "totalPages"), 1),
  };
}

export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const token = getAdminToken();
  let res: Response;
  try {
    res = await fetch(`${API_URL}/api/v1${path}`, {
      ...init,
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(init?.headers ?? {}),
      },
    });
  } catch {
    throw new ApiError(0, "NETWORK_ERROR", `Không kết nối được tới máy chủ (${API_URL}). Kiểm tra API đang chạy rồi thử lại.`);
  }
  if (res.status === 401) {
    try {
      localStorage.removeItem(ADMIN_TOKEN_KEY);
    } catch {
      // bỏ qua
    }
    window.location.href = "/dang-nhap";
    throw new ApiError(401, "UNAUTHORIZED", "Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.");
  }
  const body = (await res.json().catch(() => null)) as { data?: unknown; error?: { code?: string; message?: string } } | null;
  if (!res.ok) {
    throw new ApiError(res.status, body?.error?.code ?? "REQUEST_FAILED", body?.error?.message ?? `Yêu cầu thất bại (HTTP ${res.status}).`);
  }
  return body?.data as T;
}

async function apiList<T>(path: string, normalize: (raw: Raw) => T): Promise<ListResult<T>> {
  const res = await fetch(`${API_URL}/api/v1${path}`, {
    headers: { "Content-Type": "application/json", ...(getAdminToken() ? { Authorization: `Bearer ${getAdminToken()}` } : {}) },
  }).catch(() => {
    throw new ApiError(0, "NETWORK_ERROR", `Không kết nối được tới máy chủ (${API_URL}). Kiểm tra API đang chạy rồi thử lại.`);
  });
  if (res.status === 401) {
    try {
      localStorage.removeItem(ADMIN_TOKEN_KEY);
    } catch {
      // bỏ qua
    }
    window.location.href = "/dang-nhap";
    throw new ApiError(401, "UNAUTHORIZED", "Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.");
  }
  const body = (await res.json().catch(() => null)) as { data?: unknown; meta?: unknown; error?: { code?: string; message?: string } } | null;
  if (!res.ok) {
    throw new ApiError(res.status, body?.error?.code ?? "REQUEST_FAILED", body?.error?.message ?? `Yêu cầu thất bại (HTTP ${res.status}).`);
  }
  const data = body?.data;
  return { items: asArray(data).map(normalize), meta: asMeta(body) ?? asMeta(data) };
}

// --- Kiểu dữ liệu admin ---

export interface Tenant {
  id: string;
  name: string;
  slug: string;
  phone: string | null;
  email: string | null;
  status: string;
  planId: string | null;
  planName: string | null;
  createdAt: string | null;
}

export interface Plan {
  id: string;
  name: string;
  priceMonthlyVnd: number;
  maxBranches: number;
  maxUsers: number;
  maxBookingsMonth: number;
  features: string[];
  status: string;
}

export interface Subscription {
  id: string;
  tenantId: string;
  tenantName: string | null;
  planId: string;
  planName: string | null;
  status: string;
  startedAt: string | null;
  endsAt: string | null;
}

export interface AuditLog {
  id: string;
  tenantId: string | null;
  userId: string | null;
  action: string;
  entityType: string | null;
  entityId: string | null;
  createdAt: string | null;
}

export interface TenantSummary {
  id: string;
  name: string;
  slug: string;
  status: string;
  planName: string | null;
  email: string | null;
  phone: string | null;
  createdAt: string | null;
}

function normalizeTenant(raw: Raw): Tenant {
  const plan = asRaw(pick(raw, "plan"));
  return {
    id: str(pick(raw, "id")),
    name: str(pick(raw, "name")),
    slug: str(pick(raw, "slug")),
    phone: optStr(pick(raw, "phone")),
    email: optStr(pick(raw, "email")),
    status: str(pick(raw, "status")) || "active",
    planId: optStr(pick(raw, "planId", "plan_id")),
    planName: optStr(pick(raw, "planName", "plan_name", plan.name)),
    createdAt: optStr(pick(raw, "createdAt", "created_at")),
  };
}

function normalizePlan(raw: Raw): Plan {
  const featuresRaw = pick(raw, "features");
  let features: string[] = [];
  if (Array.isArray(featuresRaw)) features = featuresRaw.map((f) => str(f)).filter(Boolean);
  else if (typeof featuresRaw === "string") {
    try {
      const parsed: unknown = JSON.parse(featuresRaw);
      if (Array.isArray(parsed)) features = parsed.map((f) => str(f)).filter(Boolean);
      else features = featuresRaw.split(",").map((s) => s.trim()).filter(Boolean);
    } catch {
      features = featuresRaw.split(",").map((s) => s.trim()).filter(Boolean);
    }
  }
  return {
    id: str(pick(raw, "id")),
    name: str(pick(raw, "name")),
    priceMonthlyVnd: num(pick(raw, "priceMonthlyVnd", "price_monthly_vnd"), 0),
    maxBranches: num(pick(raw, "maxBranches", "max_branches"), 0),
    maxUsers: num(pick(raw, "maxUsers", "max_users"), 0),
    maxBookingsMonth: num(pick(raw, "maxBookingsMonth", "max_bookings_month"), 0),
    features,
    status: str(pick(raw, "status")) || "active",
  };
}

function normalizeSubscription(raw: Raw): Subscription {
  const tenant = asRaw(pick(raw, "tenant"));
  const plan = asRaw(pick(raw, "plan"));
  return {
    id: str(pick(raw, "id")),
    tenantId: str(pick(raw, "tenantId", "tenant_id")),
    tenantName: optStr(pick(raw, "tenantName", "tenant_name", tenant.name)),
    planId: str(pick(raw, "planId", "plan_id")),
    planName: optStr(pick(raw, "planName", "plan_name", plan.name)),
    status: str(pick(raw, "status")) || "",
    startedAt: optStr(pick(raw, "startedAt", "started_at")),
    endsAt: optStr(pick(raw, "endsAt", "ends_at")),
  };
}

function normalizeAuditLog(raw: Raw): AuditLog {
  return {
    id: str(pick(raw, "id")),
    tenantId: optStr(pick(raw, "tenantId", "tenant_id")),
    userId: optStr(pick(raw, "userId", "user_id")),
    action: str(pick(raw, "action")),
    entityType: optStr(pick(raw, "entityType", "entity_type")),
    entityId: optStr(pick(raw, "entityId", "entity_id")),
    createdAt: optStr(pick(raw, "createdAt", "created_at")),
  };
}

function normalizeTenantSummary(data: unknown): TenantSummary {
  const raw = asRaw(data);
  const tenant = asRaw(pick(raw, "tenant"));
  const base = Object.keys(tenant).length > 0 ? tenant : raw;
  const t = normalizeTenant(base);
  return {
    id: t.id,
    name: t.name,
    slug: t.slug,
    status: t.status,
    planName: t.planName,
    email: t.email,
    phone: t.phone,
    createdAt: t.createdAt,
  };
}

// --- Endpoint admin ---

export async function loginAdmin(email: string, password: string): Promise<{ token: string; user: { email: string; role: string | null } }> {
  const data = await api<Raw>("/auth/login", { method: "POST", body: JSON.stringify({ email, password }) });
  const token = str(pick(data, "token", "sessionToken", "accessToken"));
  if (!token) throw new ApiError(401, "UNAUTHORIZED", "Đăng nhập thất bại: máy chủ không trả token.");
  const user = asRaw(pick(data, "user"));
  return { token, user: { email: str(pick(user, "email")) || email, role: optStr(pick(user, "role", "roleName", "role_name")) } };
}

export async function getTenants(page = 1, limit = 20): Promise<ListResult<Tenant>> {
  return apiList<Tenant>(`/admin/tenants?page=${page}&limit=${limit}`, normalizeTenant);
}

export async function getTenant(id: string): Promise<Tenant> {
  const data = await api<unknown>(`/admin/tenants/${encodeURIComponent(id)}`);
  return normalizeTenant(asRaw(data));
}

export async function setTenantStatus(id: string, status: "active" | "suspended"): Promise<Tenant> {
  const data = await api<unknown>(`/admin/tenants/${encodeURIComponent(id)}`, {
    method: "PATCH",
    body: JSON.stringify({ status }),
  });
  return normalizeTenant(asRaw(data));
}

export async function getPlans(page = 1, limit = 20): Promise<ListResult<Plan>> {
  return apiList<Plan>(`/admin/plans?page=${page}&limit=${limit}`, normalizePlan);
}

export interface PlanInput {
  name: string;
  priceMonthlyVnd: number;
  maxBranches: number;
  maxUsers: number;
  maxBookingsMonth: number;
  features: string[];
  status: string;
}

export async function createPlan(input: PlanInput): Promise<Plan> {
  const data = await api<unknown>("/admin/plans", {
    method: "POST",
    body: JSON.stringify({
      name: input.name,
      priceMonthlyVnd: input.priceMonthlyVnd,
      maxBranches: input.maxBranches,
      maxUsers: input.maxUsers,
      maxBookingsMonth: input.maxBookingsMonth,
      features: input.features,
      status: input.status,
    }),
  });
  return normalizePlan(asRaw(data));
}

export async function updatePlan(id: string, input: PlanInput): Promise<Plan> {
  const data = await api<unknown>(`/admin/plans/${encodeURIComponent(id)}`, {
    method: "PATCH",
    body: JSON.stringify({
      name: input.name,
      priceMonthlyVnd: input.priceMonthlyVnd,
      maxBranches: input.maxBranches,
      maxUsers: input.maxUsers,
      maxBookingsMonth: input.maxBookingsMonth,
      features: input.features,
      status: input.status,
    }),
  });
  return normalizePlan(asRaw(data));
}

export async function getSubscriptions(page = 1, limit = 20, status?: string): Promise<ListResult<Subscription>> {
  const q = new URLSearchParams({ page: String(page), limit: String(limit) });
  if (status) q.set("status", status);
  return apiList<Subscription>(`/admin/subscriptions?${q.toString()}`, normalizeSubscription);
}

export async function getAuditLogs(params: { page?: number; limit?: number; tenantId?: string; action?: string }): Promise<ListResult<AuditLog>> {
  const q = new URLSearchParams({ page: String(params.page ?? 1), limit: String(params.limit ?? 20) });
  if (params.tenantId) q.set("tenant_id", params.tenantId);
  if (params.action) q.set("action", params.action);
  return apiList<AuditLog>(`/admin/audit-logs?${q.toString()}`, normalizeAuditLog);
}

export async function requestSupportAccess(tenantId: string, reason: string): Promise<TenantSummary> {
  const data = await api<unknown>("/admin/support-access", {
    method: "POST",
    body: JSON.stringify({ tenantId, reason }),
  });
  return normalizeTenantSummary(data);
}

export { optNum };
