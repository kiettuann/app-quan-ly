// Hàng API trả về: backend dùng alias camelCase (CONTRACTS.md §2), nhưng để
// chắc chắn khi field còn dạng snake_case, mọi truy cập đều qua helper này.
export type Row = Record<string, unknown>;

export function s(row: Row | null | undefined, ...keys: string[]): string {
  if (!row) return "";
  for (const k of keys) {
    const v = row[k];
    if (typeof v === "string" && v !== "") return v;
    if (typeof v === "number") return String(v);
  }
  return "";
}

export function n(row: Row | null | undefined, ...keys: string[]): number {
  if (!row) return 0;
  for (const k of keys) {
    const v = row[k];
    if (typeof v === "number" && Number.isFinite(v)) return v;
    if (typeof v === "string" && v.trim() !== "" && !Number.isNaN(Number(v))) return Number(v);
  }
  return 0;
}

export function b(row: Row | null | undefined, ...keys: string[]): boolean {
  if (!row) return false;
  for (const k of keys) {
    const v = row[k];
    if (typeof v === "boolean") return v;
    if (v === 1) return true;
    if (v === 0) return false;
  }
  return false;
}

export function arr(row: Row | null | undefined, ...keys: string[]): Row[] {
  if (!row) return [];
  for (const k of keys) {
    const v = row[k];
    if (Array.isArray(v)) return v as Row[];
  }
  return [];
}

export function idOf(row: Row | null | undefined): string {
  return s(row, "id");
}

export const BOOKING_STATUS_LABEL: Record<string, string> = {
  pending: "Chờ xác nhận",
  awaiting_deposit: "Chờ đặt cọc",
  confirmed: "Đã xác nhận",
  checked_in: "Đã đến",
  in_service: "Đang phục vụ",
  completed: "Hoàn thành",
  cancelled: "Đã hủy",
  no_show: "Không đến",
};

export const INVOICE_STATUS_LABEL: Record<string, string> = {
  draft: "Nháp",
  unpaid: "Chưa thanh toán",
  partially_paid: "Thanh toán một phần",
  paid: "Đã thanh toán",
  partially_refunded: "Hoàn một phần",
  refunded: "Đã hoàn tiền",
  cancelled: "Đã hủy",
  void: "Đã hủy",
};

export const PAYROLL_PERIOD_STATUS_LABEL: Record<string, string> = {
  draft: "Nháp",
  calculating: "Đang tính",
  confirmed: "Đã chốt",
  paid: "Đã trả",
};

export const COMMISSION_CALC_STATUS_LABEL: Record<string, string> = {
  pending: "Chờ duyệt",
  confirmed: "Đã duyệt",
  paid: "Đã trả",
  reversed: "Đã đảo ngược",
};

export const PO_STATUS_LABEL: Record<string, string> = {
  draft: "Nháp",
  ordered: "Đã đặt",
  received: "Đã nhận",
  cancelled: "Đã hủy",
};

export const GENDER_LABEL: Record<string, string> = {
  male: "Nam",
  female: "Nữ",
  other: "Khác",
};

export function statusLabel(map: Record<string, string>, status: string): string {
  return map[status] ?? status;
}
