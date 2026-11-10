// API client — CONTRACTS.md §5. Token từ localStorage ("ql_token"), base URL từ
// VITE_API_URL (mặc định http://localhost:8787). Mọi response bọc { data, meta? }
// hoặc { error: { code, message } }.
import { formatVnd } from "@quanly/shared";

export { formatVnd };

export const API_URL = import.meta.env.VITE_API_URL ?? "http://localhost:8787";

export class ApiError extends Error {
  code?: string;
  status?: number;
  constructor(message: string, code?: string, status?: number) {
    super(message);
    this.name = "ApiError";
    this.code = code;
    this.status = status;
  }
}

export interface PageMeta {
  page: number;
  limit: number;
  total: number;
  total_pages: number;
}

interface Envelope<T> {
  data?: T;
  meta?: PageMeta;
  error?: { code?: string; message?: string };
}

export interface ApiOptions {
  method?: string;
  body?: unknown;
  token?: string | null;
}

/** Gọi API, trả về phần `data` của envelope. Lỗi 401: xóa token, bắn sự kiện
 *  "ql:unauthorized" để AuthProvider đăng xuất và điều hướng về /dang-nhap. */
export async function api<T>(path: string, opts: ApiOptions = {}): Promise<T> {
  const token = opts.token ?? localStorage.getItem("ql_token");
  let res: Response;
  try {
    res = await fetch(`${API_URL}${path}`, {
      method: opts.method ?? "GET",
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
    });
  } catch {
    throw new ApiError("Không kết nối được tới máy chủ. Kiểm tra API đang chạy rồi thử lại.", "NETWORK_ERROR");
  }
  let body: Envelope<T> | null = null;
  try {
    body = (await res.json()) as Envelope<T>;
  } catch {
    body = null;
  }
  if (res.status === 401) {
    localStorage.removeItem("ql_token");
    localStorage.removeItem("ql_user");
    window.dispatchEvent(new Event("ql:unauthorized"));
    const err = new ApiError("Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.", "UNAUTHORIZED", 401);
    throw err;
  }
  if (!res.ok) {
    const message = body?.error?.message ?? `Yêu cầu thất bại (mã ${res.status}).`;
    throw new ApiError(message, body?.error?.code, res.status);
  }
  if (body && typeof body === "object" && "data" in body) return body.data as T;
  return body as unknown as T;
}

export const get = <T,>(path: string): Promise<T> => api<T>(path);
export const post = <T,>(path: string, body?: unknown): Promise<T> => api<T>(path, { method: "POST", body });
export const patch = <T,>(path: string, body?: unknown): Promise<T> => api<T>(path, { method: "PATCH", body });
export const del = <T,>(path: string): Promise<T> => api<T>(path, { method: "DELETE" });

/** Gọi API và trả cả data lẫn meta phân trang (cho các endpoint list). */
export async function apiPage<T>(path: string): Promise<{ items: T[]; meta?: PageMeta }> {
  const token = localStorage.getItem("ql_token");
  let res: Response;
  try {
    res = await fetch(`${API_URL}${path}`, {
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
    });
  } catch {
    throw new ApiError("Không kết nối được tới máy chủ. Kiểm tra API đang chạy rồi thử lại.", "NETWORK_ERROR");
  }
  let body: Envelope<unknown> | null = null;
  try {
    body = (await res.json()) as Envelope<unknown>;
  } catch {
    body = null;
  }
  if (res.status === 401) {
    localStorage.removeItem("ql_token");
    localStorage.removeItem("ql_user");
    window.dispatchEvent(new Event("ql:unauthorized"));
    throw new ApiError("Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.", "UNAUTHORIZED", 401);
  }
  if (!res.ok) {
    throw new ApiError(body?.error?.message ?? `Yêu cầu thất bại (mã ${res.status}).`, body?.error?.code, res.status);
  }
  const data = body?.data;
  const items = unwrapList<T>(data);
  return { items, meta: body?.meta };
}

/** List endpoint có thể trả mảng trực tiếp hoặc { items: [] } / { rows: [] }. */
export function unwrapList<T>(data: unknown): T[] {
  if (Array.isArray(data)) return data as T[];
  if (data && typeof data === "object") {
    const obj = data as Record<string, unknown>;
    if (Array.isArray(obj.items)) return obj.items as T[];
    if (Array.isArray(obj.rows)) return obj.rows as T[];
    if (Array.isArray(obj.data)) return obj.data as T[];
  }
  return [];
}

/** Định dạng ngày/giờ ISO (UTC) sang Asia/Ho_Chi_Minh: dd/MM/yyyy HH:mm. */
export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return new Intl.DateTimeFormat("vi-VN", {
    timeZone: "Asia/Ho_Chi_Minh",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(d);
}

export function formatDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso.length <= 10 ? `${iso}T00:00:00` : iso);
  if (Number.isNaN(d.getTime())) return iso;
  return new Intl.DateTimeFormat("vi-VN", {
    timeZone: "Asia/Ho_Chi_Minh",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(d);
}

/** Ngày hôm nay theo Asia/Ho_Chi_Minh, dạng yyyy-MM-dd (cho input[type=date]). */
export function todayHcm(): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Ho_Chi_Minh",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
  return parts;
}
