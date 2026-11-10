import type { ReactNode } from "react";

export function Spinner() {
  return (
    <span
      aria-label="Đang tải"
      className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-[#E5E9ED] border-t-[#244B70]"
    />
  );
}

export function LoadingBox({ text = "Đang tải..." }: { text?: string }) {
  return (
    <div className="flex items-center gap-2 rounded-lg border border-[#E5E9ED] bg-white p-4 text-sm text-[#748294]">
      <Spinner />
      {text}
    </div>
  );
}

export function ErrorBox({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div role="alert" className="rounded-lg border border-[#C0392B]/30 bg-red-50 p-4 text-sm text-[#C0392B]">
      <p>{message}</p>
      {onRetry && (
        <button type="button" onClick={onRetry} className="mt-2 h-11 rounded-lg bg-white px-4 font-semibold text-[#244B70] ring-1 ring-[#E5E9ED]">
          Thử lại
        </button>
      )}
    </div>
  );
}

export function EmptyBox({ message, action }: { message: string; action?: ReactNode }) {
  return (
    <div className="rounded-lg border border-[#E5E9ED] bg-white p-4 text-sm text-[#748294]">
      <p>{message}</p>
      {action && <div className="mt-3">{action}</div>}
    </div>
  );
}

export function PageHeader({ title, subtitle, action }: { title: string; subtitle?: string; action?: ReactNode }) {
  return (
    <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
      <div>
        <h1 className="text-xl font-bold text-[#244B70]">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-[#748294]">{subtitle}</p>}
      </div>
      {action}
    </div>
  );
}

export function Badge({ tone, children }: { tone: "green" | "yellow" | "red" | "gray" | "blue"; children: ReactNode }) {
  const cls =
    tone === "green"
      ? "bg-green-50 text-[#2E7D5B]"
      : tone === "yellow"
        ? "bg-yellow-50 text-[#B7791F]"
        : tone === "red"
          ? "bg-red-50 text-[#C0392B]"
          : tone === "blue"
            ? "bg-blue-50 text-[#3979A8]"
            : "bg-gray-100 text-[#748294]";
  return <span className={`inline-block shrink-0 rounded-full px-2 py-1 text-xs font-semibold ${cls}`}>{children}</span>;
}

export function Pagination({
  page,
  totalPages,
  total,
  onPage,
}: {
  page: number;
  totalPages: number;
  total: number;
  onPage: (page: number) => void;
}) {
  return (
    <div className="mt-4 flex items-center justify-between gap-2 text-sm">
      <span className="text-[#748294]">Tổng {total} mục — trang {page}/{Math.max(totalPages, 1)}</span>
      <span className="flex gap-2">
        <button
          type="button"
          disabled={page <= 1}
          onClick={() => onPage(page - 1)}
          className="h-11 rounded-lg bg-white px-4 font-semibold text-[#244B70] ring-1 ring-[#E5E9ED] disabled:opacity-50"
        >
          Trước
        </button>
        <button
          type="button"
          disabled={page >= totalPages}
          onClick={() => onPage(page + 1)}
          className="h-11 rounded-lg bg-white px-4 font-semibold text-[#244B70] ring-1 ring-[#E5E9ED] disabled:opacity-50"
        >
          Sau
        </button>
      </span>
    </div>
  );
}

export const inputCls = "mt-1 h-11 w-full rounded-lg border border-[#E5E9ED] bg-white px-3 text-sm";
export const labelCls = "text-sm font-medium";
export const primaryBtnCls = "h-11 rounded-lg bg-[#244B70] px-4 text-sm font-semibold text-white disabled:opacity-50";
export const secondaryBtnCls = "h-11 rounded-lg bg-white px-4 text-sm font-semibold text-[#244B70] ring-1 ring-[#E5E9ED] disabled:opacity-50";
export const dangerBtnCls = "h-11 rounded-lg bg-white px-4 text-sm font-semibold text-[#C0392B] ring-1 ring-[#E5E9ED] disabled:opacity-50";
