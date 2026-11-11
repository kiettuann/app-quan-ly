// Bảng lương — kỳ lương + tạo kỳ, chi tiết kỳ (từng nhân viên: lương cơ
// bản + hoa hồng + thưởng/phụ cấp − khấu trừ − tạm ứng = thực nhận), điều
// chỉnh thưởng/phụ cấp/khấu trừ/tạm ứng, tính/chốt/đánh dấu đã trả (có xác
// nhận), và "Lương của tôi" (GET /payroll/me).
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiPage, formatDate, formatVnd, get, patch, post, todayHcm } from "../lib/api.js";
import { PAYROLL_PERIOD_STATUS_LABEL, idOf, n, s } from "../lib/types.js";
import type { Row } from "../lib/types.js";
import {
  Badge, badgeToneForStatus, btnPrimary, btnSecondary, Card, Empty, ErrorBox, Field,
  Loading, Notice, errMsg, inputCls,
} from "../lib/ui.js";

export default function PayrollPage() {
  const qc = useQueryClient();
  const [branchId, setBranchId] = useState("");
  const [periodStart, setPeriodStart] = useState(todayHcm().slice(0, 8) + "01");
  const [periodEnd, setPeriodEnd] = useState(todayHcm());
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ kind: "success" | "error"; text: string } | null>(null);
  const [adjust, setAdjust] = useState<{ payrollId: string; bonusVnd: string; allowanceVnd: string; deductionVnd: string; advanceVnd: string } | null>(null);

  const branchesQ = useQuery({
    queryKey: ["branches"],
    queryFn: () => apiPage<Row>("/api/v1/branches?limit=100").then((r) => r.items),
  });
  const periodsQ = useQuery({
    queryKey: ["payroll-periods"],
    queryFn: () => apiPage<Row>("/api/v1/payroll/periods?limit=50").then((r) => r.items),
  });
  const detailQ = useQuery({
    queryKey: ["payroll-period", selectedId],
    queryFn: () => get<Row>(`/api/v1/payroll/periods/${selectedId ?? ""}`),
    enabled: selectedId !== null,
  });
  const meQ = useQuery({
    queryKey: ["payroll", "me"],
    queryFn: () => get<Row>("/api/v1/payroll/me"),
  });

  const createMut = useMutation({
    mutationFn: () => post<Row>("/api/v1/payroll/periods", { branchId: branchId || undefined, periodStart, periodEnd }),
    onSuccess: (data) => {
      setNotice({ kind: "success", text: "Đã tạo kỳ lương." });
      setSelectedId(idOf(data));
      void qc.invalidateQueries({ queryKey: ["payroll-periods"] });
    },
    onError: (err) => setNotice({ kind: "error", text: errMsg(err) }),
  });
  const actionMut = useMutation({
    mutationFn: ({ action }: { action: "calculate" | "confirm" | "mark-paid" }) =>
      post<Row>(`/api/v1/payroll/periods/${selectedId ?? ""}/${action}`, {}),
    onSuccess: (_, { action }) => {
      setNotice({ kind: "success", text: action === "calculate" ? "Đã tính lương kỳ này." : action === "confirm" ? "Đã chốt kỳ lương." : "Đã đánh dấu kỳ lương đã trả." });
      void qc.invalidateQueries({ queryKey: ["payroll-periods"] });
      void qc.invalidateQueries({ queryKey: ["payroll-period", selectedId] });
    },
    onError: (err) => setNotice({ kind: "error", text: errMsg(err) }),
  });
  const adjustMut = useMutation({
    mutationFn: () => patch<Row>(`/api/v1/payroll/periods/${selectedId ?? ""}/payrolls/${adjust?.payrollId ?? ""}`, {
      bonusVnd: adjust?.bonusVnd ? Number(adjust.bonusVnd) : 0,
      allowanceVnd: adjust?.allowanceVnd ? Number(adjust.allowanceVnd) : 0,
      deductionVnd: adjust?.deductionVnd ? Number(adjust.deductionVnd) : 0,
      advanceVnd: adjust?.advanceVnd ? Number(adjust.advanceVnd) : 0,
    }),
    onSuccess: () => {
      setNotice({ kind: "success", text: "Đã lưu điều chỉnh lương." });
      setAdjust(null);
      void qc.invalidateQueries({ queryKey: ["payroll-period", selectedId] });
    },
    onError: (err) => setNotice({ kind: "error", text: errMsg(err) }),
  });

  const periods = periodsQ.data ?? [];
  const detail = detailQ.data ?? periods.find((p) => idOf(p) === selectedId) ?? null;
  const payrolls: Row[] = detail ? (Array.isArray(detail.payrolls) ? (detail.payrolls as Row[]) : []) : [];
  const periodStatus = detail ? s(detail, "status") : "";
  const isPaid = periodStatus === "paid";

  return (
    <main className="space-y-4 p-4">
      <h1 className="text-xl font-bold">Bảng lương</h1>
      {notice ? <Notice kind={notice.kind} text={notice.text} onClose={() => setNotice(null)} /> : null}

      <Card title="Lương của tôi">
        {meQ.isLoading ? <Loading /> : meQ.isError ? (
          <ErrorBox message={errMsg(meQ.error)} onRetry={() => void meQ.refetch()} />
        ) : (
          <dl className="space-y-2 text-sm">
            <div className="flex justify-between gap-2"><dt className="shrink-0 text-[#748294]">Kỳ gần nhất</dt><dd className="text-right">{s(meQ.data, "periodStart", "period_start") ? `${formatDate(s(meQ.data, "periodStart", "period_start"))} – ${formatDate(s(meQ.data, "periodEnd", "period_end"))}` : "Chưa có kỳ lương nào."}</dd></div>
            <div className="flex justify-between gap-2"><dt className="shrink-0 text-[#748294]">Thực nhận</dt><dd className="text-right font-semibold tabular-nums">{formatVnd(n(meQ.data, "netVnd", "net_vnd", "netSalaryVnd"))}</dd></div>
            <div className="flex justify-between gap-2"><dt className="shrink-0 text-[#748294]">Trạng thái</dt><dd className="text-right">{meQ.data && s(meQ.data, "status") ? PAYROLL_PERIOD_STATUS_LABEL[s(meQ.data, "status")] ?? s(meQ.data, "status") : "—"}</dd></div>
          </dl>
        )}
      </Card>

      <Card title="Tạo kỳ lương">
        <div className="space-y-4">
          <Field label="Chi nhánh (không bắt buộc — để trống là toàn tiệm)">
            <select value={branchId} onChange={(e) => setBranchId(e.target.value)} className={inputCls}>
              <option value="">Tất cả chi nhánh</option>
              {(branchesQ.data ?? []).map((b) => (
                <option key={idOf(b)} value={idOf(b)}>{s(b, "name")}</option>
              ))}
            </select>
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Từ ngày">
              <input type="date" value={periodStart} onChange={(e) => setPeriodStart(e.target.value)} className={inputCls} />
            </Field>
            <Field label="Đến ngày">
              <input type="date" value={periodEnd} onChange={(e) => setPeriodEnd(e.target.value)} className={inputCls} />
            </Field>
          </div>
          <button
            type="button"
            disabled={createMut.isPending || !periodStart || !periodEnd || periodEnd < periodStart}
            onClick={() => createMut.mutate()}
            className={`${btnPrimary} w-full`}
          >
            {createMut.isPending ? "Đang xử lý..." : "Tạo kỳ lương"}
          </button>
        </div>
      </Card>

      {periodsQ.isLoading ? (
        <Loading />
      ) : periodsQ.isError ? (
        <ErrorBox message={errMsg(periodsQ.error)} onRetry={() => void periodsQ.refetch()} />
      ) : periods.length === 0 ? (
        <Empty text="Chưa có kỳ lương nào." />
      ) : (
        <Card title={`${periods.length} kỳ lương`}>
          <ul className="space-y-3">
            {periods.map((p) => (
              <li key={idOf(p)}>
                <button type="button" onClick={() => setSelectedId(idOf(p))} className="block w-full rounded-lg border border-[#E5E9ED] p-3 text-left">
                  <span className="flex items-center justify-between gap-2">
                    <span className="min-w-0 flex-1 truncate text-sm font-medium">
                      {formatDate(s(p, "periodStart", "period_start"))} – {formatDate(s(p, "periodEnd", "period_end"))}
                    </span>
                    <span className="shrink-0">
                      <Badge tone={badgeToneForStatus(s(p, "status"))}>{PAYROLL_PERIOD_STATUS_LABEL[s(p, "status")] ?? s(p, "status")}</Badge>
                    </span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </Card>
      )}

      {selectedId && detail ? (
        <Card title={`Kỳ ${formatDate(s(detail, "periodStart", "period_start"))} – ${formatDate(s(detail, "periodEnd", "period_end"))}`}>
          {detailQ.isLoading ? (
            <Loading />
          ) : (
            <>
              <p className="text-sm text-[#748294]">
                Trạng thái: {PAYROLL_PERIOD_STATUS_LABEL[periodStatus] ?? periodStatus}
                {isPaid ? " — kỳ đã trả không thể sửa." : ""}
              </p>
              {payrolls.length === 0 ? (
                <p className="mt-3 text-sm text-[#748294]">Chưa có bảng lương nhân viên trong kỳ này. Bấm "Tính lương" để tổng hợp.</p>
              ) : (
                <ul className="mt-3 space-y-3">
                  {payrolls.map((pr) => (
                    <li key={idOf(pr)} className="rounded-lg border border-[#E5E9ED] p-3 text-sm">
                      <p className="font-medium">{s(pr, "employeeName", "employee_name") || "Nhân viên"}</p>
                      <dl className="mt-2 space-y-1 text-[#203247]">
                        <div className="flex justify-between gap-2"><dt className="shrink-0 text-[#748294]">Lương cơ bản</dt><dd className="text-right tabular-nums">{formatVnd(n(pr, "baseSalaryVnd", "base_salary_vnd"))}</dd></div>
                        <div className="flex justify-between gap-2"><dt className="shrink-0 text-[#748294]">Hoa hồng</dt><dd className="text-right tabular-nums">{formatVnd(n(pr, "commissionVnd", "commission_vnd"))}</dd></div>
                        <div className="flex justify-between gap-2"><dt className="shrink-0 text-[#748294]">Thưởng</dt><dd className="text-right tabular-nums">{formatVnd(n(pr, "bonusVnd", "bonus_vnd"))}</dd></div>
                        <div className="flex justify-between gap-2"><dt className="shrink-0 text-[#748294]">Phụ cấp</dt><dd className="text-right tabular-nums">{formatVnd(n(pr, "allowanceVnd", "allowance_vnd"))}</dd></div>
                        <div className="flex justify-between gap-2"><dt className="shrink-0 text-[#748294]">Khấu trừ</dt><dd className="text-right tabular-nums">−{formatVnd(n(pr, "deductionVnd", "deduction_vnd"))}</dd></div>
                        <div className="flex justify-between gap-2"><dt className="shrink-0 text-[#748294]">Tạm ứng</dt><dd className="text-right tabular-nums">−{formatVnd(n(pr, "advanceVnd", "advance_vnd"))}</dd></div>
                        <div className="flex justify-between gap-2 font-semibold text-[#244B70]"><dt className="shrink-0">Thực nhận</dt><dd className="text-right tabular-nums">{formatVnd(n(pr, "netVnd", "net_vnd"))}</dd></div>
                      </dl>
                      {!isPaid ? (
                        <button
                          type="button"
                          onClick={() => setAdjust({
                            payrollId: idOf(pr),
                            bonusVnd: String(n(pr, "bonusVnd", "bonus_vnd") || ""),
                            allowanceVnd: String(n(pr, "allowanceVnd", "allowance_vnd") || ""),
                            deductionVnd: String(n(pr, "deductionVnd", "deduction_vnd") || ""),
                            advanceVnd: String(n(pr, "advanceVnd", "advance_vnd") || ""),
                          })}
                          className={`${btnSecondary} mt-2`}
                        >
                          Điều chỉnh thưởng / khấu trừ
                        </button>
                      ) : null}
                    </li>
                  ))}
                </ul>
              )}

              {adjust ? (
                <div className="mt-4 space-y-4 border-t border-[#E5E9ED] pt-4">
                  <p className="text-sm font-medium">Điều chỉnh lương nhân viên</p>
                  <div className="grid grid-cols-2 gap-3">
                    <Field label="Thưởng (VND)">
                      <input type="number" inputMode="numeric" min={0} value={adjust.bonusVnd} onChange={(e) => setAdjust((a) => (a ? { ...a, bonusVnd: e.target.value } : a))} className={inputCls} />
                    </Field>
                    <Field label="Phụ cấp (VND)">
                      <input type="number" inputMode="numeric" min={0} value={adjust.allowanceVnd} onChange={(e) => setAdjust((a) => (a ? { ...a, allowanceVnd: e.target.value } : a))} className={inputCls} />
                    </Field>
                    <Field label="Khấu trừ (VND)">
                      <input type="number" inputMode="numeric" min={0} value={adjust.deductionVnd} onChange={(e) => setAdjust((a) => (a ? { ...a, deductionVnd: e.target.value } : a))} className={inputCls} />
                    </Field>
                    <Field label="Tạm ứng (VND)">
                      <input type="number" inputMode="numeric" min={0} value={adjust.advanceVnd} onChange={(e) => setAdjust((a) => (a ? { ...a, advanceVnd: e.target.value } : a))} className={inputCls} />
                    </Field>
                  </div>
                  <div className="flex gap-2">
                    <button type="button" disabled={adjustMut.isPending} onClick={() => adjustMut.mutate()} className={`${btnPrimary} flex-1`}>Lưu điều chỉnh</button>
                    <button type="button" onClick={() => setAdjust(null)} className={`${btnSecondary} flex-1`}>Hủy</button>
                  </div>
                </div>
              ) : null}

              {!isPaid ? (
                <div className="mt-4 flex flex-wrap gap-2 border-t border-[#E5E9ED] pt-4">
                  <button type="button" disabled={actionMut.isPending} onClick={() => actionMut.mutate({ action: "calculate" })} className={`${btnSecondary} flex-1`}>Tính lương</button>
                  <button
                    type="button"
                    disabled={actionMut.isPending}
                    onClick={() => { if (window.confirm("Chốt kỳ lương này? Sau khi chốt chỉ còn đánh dấu đã trả.")) actionMut.mutate({ action: "confirm" }); }}
                    className={`${btnPrimary} flex-1`}
                  >
                    Chốt kỳ
                  </button>
                  <button
                    type="button"
                    disabled={actionMut.isPending || periodStatus !== "confirmed"}
                    onClick={() => { if (window.confirm("Đánh dấu kỳ lương này đã trả?")) actionMut.mutate({ action: "mark-paid" }); }}
                    className={`${btnPrimary} flex-1`}
                  >
                    Đánh dấu đã trả
                  </button>
                </div>
              ) : null}
              <button type="button" onClick={() => setSelectedId(null)} className={`${btnSecondary} mt-4 w-full sm:w-auto`}>Đóng chi tiết</button>
            </>
          )}
        </Card>
      ) : null}
    </main>
  );
}
