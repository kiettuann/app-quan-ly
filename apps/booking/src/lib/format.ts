// Định dạng hiển thị — múi giờ Asia/Ho_Chi_Minh, tiền integer VND.
import { formatVnd } from "@quanly/shared";

export { formatVnd };

export function formatDateTime(iso: string): string {
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

export function formatDate(isoDate: string): string {
  // isoDate "YYYY-MM-DD" — hiển thị DD/MM/YYYY, không qua Date để tránh lệch múi giờ.
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(isoDate);
  return m ? `${m[2]}/${m[3]}/${m[1]}` : isoDate;
}

export function todayIso(): string {
  const now = new Date(new Date().toLocaleString("en-US", { timeZone: "Asia/Ho_Chi_Minh" }));
  const y = now.getFullYear();
  const mo = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${mo}-${d}`;
}

export const BOOKING_STATUS_LABEL: Record<string, string> = {
  pending: "Chờ xác nhận",
  confirmed: "Đã xác nhận",
  awaiting_deposit: "Chờ đặt cọc",
  in_service: "Đang phục vụ",
  completed: "Hoàn thành",
  cancelled: "Đã hủy",
  no_show: "Không đến",
};
