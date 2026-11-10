// Public API client — KHÔNG cần đăng nhập (endpoint /public/*).
// Base: import.meta.env.VITE_API_URL ?? "http://localhost:8787".
// Envelope: thành công { data }, lỗi { error: { code, message } }.
// API Phase 4 trả camelCase (CONTRACTS.md §2); các hàm chuẩn hoá dưới đây
// chấp nhận cả snake_case để client không vỡ nếu server trả tên cột SQL.
const API_URL = import.meta.env.VITE_API_URL ?? "http://localhost:8787";

export class ApiError extends Error {
  code: string;
  status: number;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
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
function pick(raw: Raw, ...keys: string[]): unknown {
  for (const k of keys) {
    if (raw[k] !== undefined && raw[k] !== null) return raw[k];
  }
  return undefined;
}
function asArray(data: unknown): Raw[] {
  if (Array.isArray(data)) return data.filter((x): x is Raw => typeof x === "object" && x !== null);
  const raw = asRaw(data);
  for (const k of ["items", "branches", "services", "bookings", "slots", "results"]) {
    if (Array.isArray(raw[k])) return asArray(raw[k]);
  }
  return [];
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${API_URL}/api/v1${path}`, {
      ...init,
      headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
    });
  } catch {
    throw new ApiError(0, "NETWORK_ERROR", `Không kết nối được tới máy chủ (${API_URL}). Kiểm tra API đang chạy rồi thử lại.`);
  }
  const body = (await res.json().catch(() => null)) as { data?: unknown; error?: { code?: string; message?: string } } | null;
  if (!res.ok) {
    throw new ApiError(res.status, body?.error?.code ?? "REQUEST_FAILED", body?.error?.message ?? `Yêu cầu thất bại (HTTP ${res.status}).`);
  }
  return body?.data as T;
}

// --- Kiểu dữ liệu public ---

export interface Branch {
  id: string;
  name: string;
  address: string;
  phone: string | null;
  openTime: string | null;
  closeTime: string | null;
}

export interface ServiceItem {
  id: string;
  name: string;
  priceVnd: number;
  durationMinutes: number;
  categoryName: string | null;
}

export interface Technician {
  id: string;
  name: string;
}

export interface Availability {
  slots: string[]; // giờ bắt đầu "HH:MM", chỉ slot thật còn trống
  technicians: Technician[];
}

export interface CreatedBooking {
  id: string;
  code: string | null;
  status: string;
  startAt: string | null;
  totalPriceVnd: number | null;
  branchName: string | null;
}

export interface MyBooking {
  id: string;
  branchName: string;
  serviceNames: string;
  startAt: string;
  status: string;
  totalPriceVnd: number | null;
}

function normalizeBranch(raw: Raw): Branch {
  return {
    id: str(pick(raw, "id")),
    name: str(pick(raw, "name")),
    address: str(pick(raw, "address")),
    phone: optStr(pick(raw, "phone")),
    openTime: optStr(pick(raw, "openTime", "open_time")),
    closeTime: optStr(pick(raw, "closeTime", "close_time")),
  };
}

function normalizeService(raw: Raw): ServiceItem {
  return {
    id: str(pick(raw, "id")),
    name: str(pick(raw, "name")),
    priceVnd: num(pick(raw, "priceVnd", "price_vnd", "price"), 0),
    durationMinutes: num(pick(raw, "durationMinutes", "duration_minutes", "duration"), 0),
    categoryName: optStr(pick(raw, "categoryName", "category_name", "category")),
  };
}

function normalizeTechnician(raw: Raw): Technician {
  return { id: str(pick(raw, "id")), name: str(pick(raw, "name", "fullName", "full_name")) };
}

function normalizeSlot(item: unknown): string | null {
  if (typeof item === "string") return item;
  const raw = asRaw(item);
  const available = pick(raw, "available", "isAvailable", "is_available");
  if (available === false) return null;
  const start = str(pick(raw, "startTime", "start_time", "start", "time"));
  return start === "" ? null : start;
}

function normalizeAvailability(data: unknown): Availability {
  const raw = asRaw(data);
  const slotSource = Array.isArray(data) ? data : (pick(raw, "slots", "availableSlots", "available_slots", "times") ?? []);
  const slots = (Array.isArray(slotSource) ? slotSource : [])
    .map(normalizeSlot)
    .filter((s): s is string => s !== null);
  const techSource = pick(raw, "technicians", "employees", "staff") ?? [];
  const technicians = (Array.isArray(techSource) ? techSource : []).map((t) => normalizeTechnician(asRaw(t)));
  return { slots, technicians };
}

function normalizeCreatedBooking(data: unknown): CreatedBooking {
  // Backend trả { booking: {...}, customer, items } — bóc booking ra trước.
  const top = asRaw(data);
  const raw = asRaw(pick(top, "booking") ?? top);
  return {
    id: str(pick(raw, "id")),
    code: optStr(pick(raw, "code", "bookingCode", "booking_code")),
    status: str(pick(raw, "status")) || "pending",
    startAt: optStr(pick(raw, "startAt", "start_at")),
    totalPriceVnd: pick(raw, "totalPriceVnd", "total_price_vnd", "total") == null
      ? null
      : num(pick(raw, "totalPriceVnd", "total_price_vnd", "total")),
    branchName: optStr(pick(raw, "branchName", "branch_name")),
  };
}

function normalizeMyBooking(raw: Raw): MyBooking {
  const items = pick(raw, "items", "services");
  const serviceNames = Array.isArray(items)
    ? items.map((i) => (typeof i === "string" ? i : str(pick(asRaw(i), "name", "serviceName", "service_name")))).filter(Boolean).join(", ")
    : str(pick(raw, "serviceNames", "service_names", "services"));
  return {
    id: str(pick(raw, "id")),
    branchName: str(pick(raw, "branchName", "branch_name", "branch")) || "—",
    serviceNames,
    startAt: str(pick(raw, "startAt", "start_at", "date")) || "",
    status: str(pick(raw, "status")) || "pending",
    totalPriceVnd: pick(raw, "totalPriceVnd", "total_price_vnd", "total") == null
      ? null
      : num(pick(raw, "totalPriceVnd", "total_price_vnd", "total")),
  };
}

// --- Endpoint ---

export async function getBranches(tenantSlug: string): Promise<Branch[]> {
  const data = await request<unknown>(`/public/branches?tenant=${encodeURIComponent(tenantSlug)}`);
  return asArray(data).map(normalizeBranch);
}

export async function getServices(branchId: string): Promise<ServiceItem[]> {
  const data = await request<unknown>(`/public/services?branch_id=${encodeURIComponent(branchId)}`);
  return asArray(data).map(normalizeService);
}

/** Lấy slot trống thật + (nếu server trả) danh sách kỹ thuật viên của chi nhánh. */
export async function getAvailability(params: {
  branchId: string;
  date: string;
  technicianId?: string | null;
  serviceIds?: string[];
}): Promise<Availability> {
  const q = new URLSearchParams({ branch_id: params.branchId, date: params.date });
  if (params.technicianId) q.set("technician_id", params.technicianId);
  // Backend nhận service_ids dạng chuỗi nối dấu phẩy (xem public.ts).
  if (params.serviceIds?.length) q.set("service_ids", params.serviceIds.join(","));
  const data = await request<unknown>(`/public/availability?${q.toString()}`);
  return normalizeAvailability(data);
}

export interface CreateBookingInput {
  tenantSlug: string;
  branchId: string;
  serviceIds: string[];
  technicianId: string | null; // null = hệ thống tự chọn
  date: string; // YYYY-MM-DD
  startTime: string; // HH:MM
  customerName: string;
  customerPhone: string;
}

export async function createBooking(input: CreateBookingInput): Promise<CreatedBooking> {
  // Backend nhận camelCase theo publicBookingSchema (CONTRACTS.md):
  // startAt là ISO UTC — date + startTime người dùng chọn là giờ Việt Nam (UTC+7).
  const startAt = new Date(`${input.date}T${input.startTime}:00+07:00`).toISOString();
  const data = await request<unknown>("/public/bookings", {
    method: "POST",
    body: JSON.stringify({
      branchId: input.branchId,
      serviceIds: input.serviceIds,
      technicianId: input.technicianId,
      startAt,
      fullName: input.customerName,
      phone: input.customerPhone,
    }),
  });
  return normalizeCreatedBooking(data);
}

export async function getMyBookings(phone: string, branchId?: string | null): Promise<MyBooking[]> {
  const q = new URLSearchParams({ phone });
  if (branchId) q.set("branch_id", branchId);
  const data = await request<unknown>(`/public/my-bookings?${q.toString()}`);
  return asArray(data).map((r) => normalizeMyBooking(r));
}

export async function cancelMyBooking(id: string, phone: string): Promise<void> {
  await request<unknown>(`/public/my-bookings/${encodeURIComponent(id)}/cancel`, {
    method: "POST",
    body: JSON.stringify({ phone }),
  });
}
