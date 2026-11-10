// Hằng số dùng chung — không chứa secret. Nguồn: DESIGN_SYSTEM.md, API_SPEC.md.
export const CURRENCY = "VND" as const;
export const TIMEZONE = "Asia/Ho_Chi_Minh" as const;
export const DEFAULT_LOCALE = "vi-VN" as const;

export const COLORS = {
  navy: "#244B70",
  blue: "#3979A8",
  background: "#F7F7F5",
  surface: "#FFFFFF",
  border: "#E5E9ED",
  textPrimary: "#203247",
  textSecondary: "#748294",
  success: "#2E7D5B",
  warning: "#B7791F",
  error: "#C0392B",
} as const;

/** Định dạng tiền VND: 150000 -> "150.000đ". Integer VND, không float. */
export function formatVnd(amountVnd: number): string {
  if (!Number.isInteger(amountVnd)) {
    throw new Error("Số tiền phải là số nguyên VND");
  }
  return `${amountVnd.toLocaleString("vi-VN")}đ`;
}
