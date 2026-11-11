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
        <button
          type="button"
          onClick={onRetry}
          className="mt-3 h-11 rounded-lg bg-white px-4 font-semibold text-[#244B70] ring-1 ring-[#E5E9ED] transition-colors hover:bg-[#F7F7F5] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#3979A8]"
        >
          Thử lại
        </button>
      )}
    </div>
  );
}

export function EmptyBox({ message, action }: { message: string; action?: ReactNode }) {
  return (
    <div className="rounded-lg border border-[#E5E9ED] bg-white px-4 py-6 text-center text-sm text-[#748294]">
      <p>{message}</p>
      {action && <div className="mt-4 flex justify-center">{action}</div>}
    </div>
  );
}

export function PrimaryButton({
  children,
  disabled,
  onClick,
  type = "button",
}: {
  children: ReactNode;
  disabled?: boolean;
  onClick?: () => void;
  type?: "button" | "submit";
}) {
  return (
    <button
      type={type}
      disabled={disabled}
      onClick={onClick}
      className="h-11 w-full rounded-lg bg-[#244B70] px-4 text-sm font-semibold text-white transition-colors hover:bg-[#1D3D5C] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#3979A8] active:bg-[#1A354F] disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-[#244B70]"
    >
      {children}
    </button>
  );
}

export function SecondaryButton({
  children,
  disabled,
  onClick,
}: {
  children: ReactNode;
  disabled?: boolean;
  onClick?: () => void;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className="h-11 rounded-lg bg-white px-4 text-sm font-semibold text-[#244B70] ring-1 ring-[#E5E9ED] transition-colors hover:bg-[#F7F7F5] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#3979A8] disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-white"
    >
      {children}
    </button>
  );
}

export function FieldError({ message }: { message?: string }) {
  if (!message) return null;
  return <p className="mt-1 text-xs text-[#C0392B]">{message}</p>;
}

export function StepHeader({ step, total, title, subtitle }: { step: number; total: number; title: string; subtitle?: string }) {
  const pct = Math.min(100, Math.max(0, (step / total) * 100));
  return (
    <div className="mb-5">
      <p className="text-xs font-semibold text-[#3979A8]">
        Bước {step}/{total}
      </p>
      <h2 className="mt-1 text-xl font-bold text-[#244B70]">{title}</h2>
      {subtitle && <p className="mt-1 text-sm leading-relaxed text-[#748294]">{subtitle}</p>}
      <div
        className="mt-3 h-1.5 overflow-hidden rounded-full bg-[#E5E9ED]"
        role="progressbar"
        aria-valuenow={step}
        aria-valuemin={1}
        aria-valuemax={total}
        aria-label={`Bước ${step} trên ${total}`}
      >
        <div className="h-full rounded-full bg-[#244B70] transition-[width]" style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

export function SummaryRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-start justify-between gap-4 border-b border-[#E5E9ED] py-2.5 text-sm last:border-0">
      <span className="shrink-0 text-[#748294]">{label}</span>
      <span className="min-w-0 break-words text-right font-medium">{value}</span>
    </div>
  );
}
