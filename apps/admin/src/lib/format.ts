import { formatVnd } from "@quanly/shared";

export { formatVnd };

export function formatDateTime(iso: string | null): string {
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

export function formatDate(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return new Intl.DateTimeFormat("vi-VN", {
    timeZone: "Asia/Ho_Chi_Minh",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(d);
}

export const TENANT_STATUS_LABEL: Record<string, string> = {
  active: "Đang hoạt động",
  suspended: "Đã tạm khóa",
  trial: "Dùng thử",
};

export const SUBSCRIPTION_STATUS_LABEL: Record<string, string> = {
  trial: "Dùng thử",
  active: "Đang hoạt động",
  past_due: "Quá hạn thanh toán",
  cancelled: "Đã hủy",
};
