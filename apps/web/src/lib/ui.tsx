// Component dùng chung theo DESIGN_SYSTEM.md: nút tối thiểu 44px, card trắng
// viền #E5E9ED bo 8px, badge trạng thái có chữ + màu nền nhạt, các state
// loading / empty / error bắt buộc trên mọi màn hình.
// Tokens: Navy #244B70, Blue #3979A8, nền #F7F7F5, chữ #203247 / phụ #748294.
// Chỉ dùng tint xanh dịu (tint-50/100/200) và nền trạng thái nhạt — không màu
// trang trí khác, không gradient, không shadow nặng.
import { useEffect, useState } from "react";
import type { ButtonHTMLAttributes, ReactNode } from "react";

/* ---------- Form ---------- */

export const inputCls =
  "mt-1 h-11 w-full rounded-lg border border-border bg-white px-3 text-sm text-ink placeholder:text-muted hover:border-tint-300 focus:border-blue focus:outline-none focus:ring-2 focus:ring-blue/20 disabled:cursor-not-allowed disabled:bg-tint-50 disabled:opacity-60";
export const selectCls = `${inputCls} appearance-none pr-8`;
export const textareaCls =
  "mt-1 w-full rounded-lg border border-border bg-white px-3 py-2 text-sm text-ink placeholder:text-muted hover:border-tint-300 focus:border-blue focus:outline-none focus:ring-2 focus:ring-blue/20 disabled:cursor-not-allowed disabled:bg-tint-50 disabled:opacity-60";
export const labelCls = "text-sm font-medium text-ink";

/* ---------- Button ---------- */

const btnBase =
  "inline-flex min-h-[44px] items-center justify-center gap-2 rounded-lg px-4 text-sm font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-50";
export const btnPrimary = `${btnBase} bg-navy text-white hover:bg-navy-600 active:bg-navy-700`;
export const btnSecondary = `${btnBase} border border-border bg-white text-navy hover:bg-tint-50 active:bg-tint-100`;
export const btnDanger = `${btnBase} bg-error text-white hover:opacity-90 active:opacity-80`;
export const btnGhost = `${btnBase} px-3 text-blue hover:bg-tint-50 active:bg-tint-100`;

type ButtonVariant = "primary" | "secondary" | "danger" | "ghost";
const btnVariantCls: Record<ButtonVariant, string> = {
  primary: btnPrimary,
  secondary: btnSecondary,
  danger: btnDanger,
  ghost: btnGhost,
};

export function Button({
  variant = "primary",
  loading = false,
  disabled,
  children,
  className = "",
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant; loading?: boolean }) {
  const busy = loading || disabled;
  return (
    <button type="button" disabled={busy} className={`${btnVariantCls[variant]} ${className}`} {...rest}>
      {loading ? (
        <span aria-hidden="true" className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
      ) : null}
      {loading ? "Đang xử lý..." : children}
    </button>
  );
}

/* ---------- States ---------- */

export function Loading({ text = "Đang tải..." }: { text?: string }) {
  return (
    <div role="status" className="flex items-center gap-3 rounded-lg border border-border bg-white p-4 shadow-soft">
      <span aria-hidden="true" className="h-5 w-5 shrink-0 animate-spin rounded-full border-2 border-tint-200 border-t-navy" />
      <p className="text-sm text-muted">{text}</p>
    </div>
  );
}

export function Empty({ text, action }: { text: string; action?: ReactNode }) {
  return (
    <div className="rounded-lg border border-border bg-white p-4 text-center shadow-soft">
      <p className="text-sm text-ink">{text}</p>
      {action ? <div className="mt-3 flex justify-center">{action}</div> : null}
    </div>
  );
}

export function ErrorBox({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div role="alert" className="rounded-lg border border-[#EFC9C4] bg-soft-error p-4 shadow-soft">
      <p className="text-sm font-medium text-error">{message}</p>
      {onRetry ? (
        <button type="button" onClick={onRetry} className={`${btnSecondary} mt-3`}>
          Thử lại
        </button>
      ) : null}
    </div>
  );
}

export function Notice({ kind, text, onClose }: { kind: "success" | "error" | "info"; text: string; onClose?: () => void }) {
  const cls =
    kind === "success"
      ? "border-[#C9DFD2] bg-soft-success text-success"
      : kind === "error"
        ? "border-[#EFC9C4] bg-soft-error text-error"
        : "border-border bg-tint-50 text-ink";
  return (
    <div role="status" className={`flex items-start justify-between gap-2 rounded-lg border p-3 text-sm ${cls}`}>
      <span>{text}</span>
      {onClose ? (
        <button
          type="button"
          onClick={onClose}
          aria-label="Đóng thông báo"
          className="flex min-h-[32px] min-w-[32px] shrink-0 items-center justify-center rounded-md font-semibold hover:bg-black/5"
        >
          ✕
        </button>
      ) : null}
    </div>
  );
}

/* ---------- Badge ---------- */

type BadgeTone = "green" | "amber" | "red" | "blue" | "gray";
const badgeCls: Record<BadgeTone, string> = {
  green: "bg-soft-success text-success",
  amber: "bg-soft-warning text-warning",
  red: "bg-soft-error text-error",
  blue: "bg-tint-100 text-blue",
  gray: "bg-tint-50 text-muted",
};

export function Badge({ tone, children }: { tone: BadgeTone; children: ReactNode }) {
  return (
    <span className={`inline-block whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium ${badgeCls[tone]}`}>{children}</span>
  );
}

export function badgeToneForStatus(status: string): BadgeTone {
  if (["paid", "completed", "confirmed", "active", "received"].includes(status)) return "green";
  if (["cancelled", "no_show", "refunded", "void", "inactive", "reversed"].includes(status)) return "red";
  if (["pending", "awaiting_deposit", "partially_paid", "partially_refunded", "draft", "calculating"].includes(status))
    return "amber";
  if (["checked_in", "in_service"].includes(status)) return "blue";
  return "gray";
}

/* ---------- Field / Card / Typography ---------- */

export function Field({ label, error, children }: { label: string; error?: string; children: ReactNode }) {
  return (
    <div>
      <label className={labelCls}>{label}</label>
      {children}
      {error ? <p className="mt-1 text-xs text-error">{error}</p> : null}
    </div>
  );
}

/** Tiêu đề màn hình: 20px / bold — DESIGN_SYSTEM.md §3. */
export function PageTitle({ title, note, action }: { title: string; note?: string; action?: ReactNode }) {
  return (
    <div className="mb-4 flex items-start justify-between gap-3">
      <div>
        <h1 className="text-xl font-bold leading-snug text-ink">{title}</h1>
        {note ? <p className="mt-1 text-xs text-muted">{note}</p> : null}
      </div>
      {action}
    </div>
  );
}

export function Card({ title, children, action }: { title?: string; children: ReactNode; action?: ReactNode }) {
  return (
    <section className="rounded-lg border border-border bg-white p-4 shadow-soft">
      {title ? (
        <div className="mb-3 flex items-center justify-between gap-2">
          <h2 className="text-base font-semibold text-ink">{title}</h2>
          {action}
        </div>
      ) : null}
      {children}
    </section>
  );
}

/* ---------- Table (desktop) / List (mobile) ---------- */

/**
 * Bảng dùng chung: tiêu đề cột nhỏ, chữ phụ; hàng phân cách bằng viền nhạt.
 * Trên mobile bọc trong cuộn ngang thay vì vỡ layout.
 */
export function Table({ children }: { children: ReactNode }) {
  return (
    <div className="overflow-x-auto rounded-lg border border-border bg-white shadow-soft">
      <table className="w-full min-w-[560px] border-collapse text-sm text-ink [&_td]:px-3 [&_td]:py-2.5 [&_td]:align-middle [&_th]:bg-tint-50 [&_th]:px-3 [&_th]:py-2.5 [&_th]:text-left [&_th]:text-xs [&_th]:font-semibold [&_th]:text-muted [&_tbody_tr]:border-t [&_tbody_tr]:border-border">
        {children}
      </table>
    </div>
  );
}

/* ---------- Hooks / helpers ---------- */

export function useDebounce<T>(value: T, delayMs = 400): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = window.setTimeout(() => setDebounced(value), delayMs);
    return () => window.clearTimeout(t);
  }, [value, delayMs]);
  return debounced;
}

/** Lấy thông điệp lỗi hiển thị cho người dùng từ Error không rõ kiểu. */
export function errMsg(err: unknown): string {
  if (err instanceof Error) return err.message;
  return "Đã có lỗi xảy ra. Vui lòng thử lại.";
}
