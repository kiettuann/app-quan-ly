// Component dùng chung theo DESIGN_SYSTEM.md: nút tối thiểu 44px, card trắng
// viền #E5E9ED bo 8px, badge trạng thái có chữ + màu nền nhạt, các state
// loading / empty / error bắt buộc trên mọi màn hình.
import { useEffect, useState } from "react";
import type { ReactNode } from "react";

export const inputCls =
  "mt-1 h-11 w-full rounded-lg border border-[#E5E9ED] bg-white px-3 text-sm text-[#203247] disabled:opacity-50";
export const textareaCls =
  "mt-1 w-full rounded-lg border border-[#E5E9ED] bg-white px-3 py-2 text-sm text-[#203247]";
export const labelCls = "text-sm font-medium text-[#203247]";

const btnBase =
  "inline-flex min-h-[44px] items-center justify-center gap-2 rounded-lg px-4 text-sm font-semibold disabled:opacity-50";
export const btnPrimary = `${btnBase} bg-[#244B70] text-white`;
export const btnSecondary = `${btnBase} border border-[#E5E9ED] bg-white text-[#244B70]`;
export const btnDanger = `${btnBase} bg-[#C0392B] text-white`;
export const btnGhost = "inline-flex min-h-[44px] items-center justify-center px-3 text-sm font-semibold text-[#3979A8] disabled:opacity-50";

export function Loading({ text = "Đang tải..." }: { text?: string }) {
  return (
    <p role="status" className="rounded-lg border border-[#E5E9ED] bg-white p-4 text-sm text-[#748294]">
      {text}
    </p>
  );
}

export function Empty({ text, action }: { text: string; action?: ReactNode }) {
  return (
    <div className="rounded-lg border border-[#E5E9ED] bg-white p-4">
      <p className="text-sm text-[#203247]">{text}</p>
      {action ? <div className="mt-3">{action}</div> : null}
    </div>
  );
}

export function ErrorBox({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div role="alert" className="rounded-lg border border-[#E5E9ED] bg-red-50 p-4">
      <p className="text-sm text-[#C0392B]">{message}</p>
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
      ? "bg-green-50 text-[#2E7D5B]"
      : kind === "error"
        ? "bg-red-50 text-[#C0392B]"
        : "bg-white text-[#748294]";
  return (
    <div role="status" className={`flex items-start justify-between gap-2 rounded-lg border border-[#E5E9ED] p-3 text-sm ${cls}`}>
      <span>{text}</span>
      {onClose ? (
        <button type="button" onClick={onClose} aria-label="Đóng thông báo" className="shrink-0 font-semibold">
          ✕
        </button>
      ) : null}
    </div>
  );
}

type BadgeTone = "green" | "amber" | "red" | "blue" | "gray";
const badgeCls: Record<BadgeTone, string> = {
  green: "bg-green-50 text-[#2E7D5B]",
  amber: "bg-amber-50 text-[#B7791F]",
  red: "bg-red-50 text-[#C0392B]",
  blue: "bg-blue-50 text-[#3979A8]",
  gray: "bg-gray-100 text-[#748294]",
};

export function Badge({ tone, children }: { tone: BadgeTone; children: ReactNode }) {
  return (
    <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${badgeCls[tone]}`}>{children}</span>
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

export function Field({ label, error, children }: { label: string; error?: string; children: ReactNode }) {
  return (
    <div>
      <label className={labelCls}>{label}</label>
      {children}
      {error ? <p className="mt-1 text-xs text-[#C0392B]">{error}</p> : null}
    </div>
  );
}

export function Card({ title, children, action }: { title?: string; children: ReactNode; action?: ReactNode }) {
  return (
    <section className="rounded-lg border border-[#E5E9ED] bg-white p-4">
      {title ? (
        <div className="mb-3 flex items-center justify-between gap-2">
          <h2 className="text-base font-semibold text-[#203247]">{title}</h2>
          {action}
        </div>
      ) : null}
      {children}
    </section>
  );
}

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
