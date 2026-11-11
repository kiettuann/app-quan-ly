// Hoa hồng — danh sách rule + tạo/sửa + tạo version mới, simulator
// (POST /commission/simulate, chỉ tính thử, không ghi dữ liệu), danh sách
// tính hoa hồng + duyệt, và "Hoa hồng của tôi" (GET /commission/me).
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiPage, formatDate, formatVnd, get, patch, post, todayHcm } from "../lib/api.js";
import { COMMISSION_CALC_STATUS_LABEL, idOf, n, s } from "../lib/types.js";
import type { Row } from "../lib/types.js";
import {
  Badge, badgeToneForStatus, btnPrimary, btnSecondary, Card, Empty, ErrorBox, Field,
  Loading, Notice, errMsg, inputCls,
} from "../lib/ui.js";

const SCOPE_TYPES = [
  { value: "service", label: "Dịch vụ" },
  { value: "product", label: "Sản phẩm" },
  { value: "employee", label: "Nhân viên" },
  { value: "role", label: "Vai trò" },
  { value: "branch", label: "Chi nhánh" },
  { value: "sales_tier", label: "Mức doanh số" },
];

interface RuleForm {
  name: string;
  scopeType: string;
  scopeRefId: string;
  rateType: string;
  rateValue: string;
  minSalesVnd: string;
  maxAmountVnd: string;
  priority: string;
  validFrom: string;
  validTo: string;
  status: string;
}

const EMPTY_RULE: RuleForm = {
  name: "", scopeType: "service", scopeRefId: "", rateType: "percent", rateValue: "10",
  minSalesVnd: "", maxAmountVnd: "", priority: "10", validFrom: todayHcm(), validTo: "", status: "active",
};

export default function CommissionPage() {
  const qc = useQueryClient();
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<Row | null>(null);
  const [versionOf, setVersionOf] = useState<Row | null>(null);
  const [form, setForm] = useState<RuleForm>(EMPTY_RULE);
  const [formError, setFormError] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ kind: "success" | "error"; text: string } | null>(null);
  const [sim, setSim] = useState({ employeeId: "", itemType: "service", refId: "", amountVnd: "" });
  const [simResult, setSimResult] = useState<Row | null>(null);

  const rulesQ = useQuery({
    queryKey: ["commission-rules"],
    queryFn: () => apiPage<Row>("/api/v1/commission/rules?limit=100").then((r) => r.items),
  });
  const calcsQ = useQuery({
    queryKey: ["commission-calculations"],
    queryFn: () => apiPage<Row>("/api/v1/commission/calculations?limit=50").then((r) => r.items),
  });
  const meQ = useQuery({
    queryKey: ["commission", "me"],
    queryFn: () => get<Row>("/api/v1/commission/me"),
  });
  const staffQ = useQuery({
    queryKey: ["employees", "all"],
    queryFn: () => apiPage<Row>("/api/v1/employees?limit=100").then((r) => r.items),
  });

  const saveMut = useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      editing ? patch<Row>(`/api/v1/commission/rules/${idOf(editing)}`, body) : post<Row>("/api/v1/commission/rules", body),
    onSuccess: () => {
      setNotice({ kind: "success", text: editing ? "Đã cập nhật rule hoa hồng." : "Đã tạo rule hoa hồng." });
      setShowForm(false); setEditing(null); setForm(EMPTY_RULE);
      void qc.invalidateQueries({ queryKey: ["commission-rules"] });
    },
    onError: (err) => setNotice({ kind: "error", text: errMsg(err) }),
  });
  const versionMut = useMutation({
    mutationFn: (body: Record<string, unknown>) => post<Row>(`/api/v1/commission/rules/${idOf(versionOf as Row)}/versions`, body),
    onSuccess: () => {
      setNotice({ kind: "success", text: "Đã tạo version mới cho rule. Các tính toán cũ không bị tính lại." });
      setVersionOf(null); setShowForm(false); setForm(EMPTY_RULE);
      void qc.invalidateQueries({ queryKey: ["commission-rules"] });
    },
    onError: (err) => setNotice({ kind: "error", text: errMsg(err) }),
  });
  const simMut = useMutation({
    mutationFn: () => post<Row>("/api/v1/commission/simulate", {
      items: [{
        employeeId: sim.employeeId || undefined,
        itemType: sim.itemType,
        refId: sim.refId || undefined,
        amountVnd: Number(sim.amountVnd),
      }],
    }),
    onSuccess: (data) => setSimResult(data),
    onError: (err) => setNotice({ kind: "error", text: errMsg(err) }),
  });
  const confirmMut = useMutation({
    mutationFn: (id: string) => post<Row>(`/api/v1/commission/calculations/${id}/confirm`, {}),
    onSuccess: () => {
      setNotice({ kind: "success", text: "Đã duyệt tính hoa hồng." });
      void qc.invalidateQueries({ queryKey: ["commission-calculations"] });
    },
    onError: (err) => setNotice({ kind: "error", text: errMsg(err) }),
  });

  function ruleBody(f: RuleForm): Record<string, unknown> {
    return {
      name: f.name.trim(),
      scopeType: f.scopeType,
      scopeRefId: f.scopeRefId.trim() || null,
      rateType: f.rateType,
      rateValue: Number(f.rateValue),
      minSalesVnd: f.minSalesVnd ? Number(f.minSalesVnd) : null,
      maxAmountVnd: f.maxAmountVnd ? Number(f.maxAmountVnd) : null,
      priority: Number(f.priority),
      validFrom: f.validFrom,
      validTo: f.validTo || null,
      status: f.status,
    };
  }

  function startEdit(r: Row) {
    setEditing(r);
    setVersionOf(null);
    setForm({
      name: s(r, "name"),
      scopeType: s(r, "scopeType", "scope_type") || "service",
      scopeRefId: s(r, "scopeRefId", "scope_ref_id"),
      rateType: s(r, "rateType", "rate_type") || "percent",
      rateValue: String(n(r, "rateValue", "rate_value")),
      minSalesVnd: n(r, "minSalesVnd", "min_sales_vnd") ? String(n(r, "minSalesVnd", "min_sales_vnd")) : "",
      maxAmountVnd: n(r, "maxAmountVnd", "max_amount_vnd") ? String(n(r, "maxAmountVnd", "max_amount_vnd")) : "",
      priority: String(n(r, "priority") || 10),
      validFrom: s(r, "validFrom", "valid_from").slice(0, 10) || todayHcm(),
      validTo: s(r, "validTo", "valid_to").slice(0, 10),
      status: s(r, "status") || "active",
    });
    setShowForm(true);
    setFormError(null);
  }

  function submit() {
    setFormError(null);
    if (!form.name.trim()) return setFormError("Vui lòng nhập tên rule.");
    if (Number(form.rateValue) < 0) return setFormError("Mức hoa hồng phải >= 0.");
    if (!form.validFrom) return setFormError("Vui lòng chọn ngày bắt đầu hiệu lực.");
    const body = ruleBody(form);
    if (versionOf) versionMut.mutate(body);
    else saveMut.mutate(body);
  }

  const rules = rulesQ.data ?? [];
  const calcs = calcsQ.data ?? [];
  const simBreakdown = simResult ? (Array.isArray(simResult.breakdown) ? (simResult.breakdown as Row[]) : []) : [];

  return (
    <main className="space-y-4 p-4">
      <div className="flex items-center justify-between gap-2">
        <h1 className="text-xl font-bold">Hoa hồng</h1>
        <button
          type="button"
          onClick={() => { setEditing(null); setVersionOf(null); setForm(EMPTY_RULE); setShowForm((v) => !v); }}
          className={btnPrimary}
        >
          {showForm ? "Đóng form" : "Tạo rule"}
        </button>
      </div>
      {notice ? <Notice kind={notice.kind} text={notice.text} onClose={() => setNotice(null)} /> : null}

      <Card title="Hoa hồng của tôi">
        {meQ.isLoading ? <Loading /> : meQ.isError ? (
          <ErrorBox message={errMsg(meQ.error)} onRetry={() => void meQ.refetch()} />
        ) : (
          <dl className="space-y-2 text-sm">
            <div className="flex justify-between gap-2"><dt className="shrink-0 text-[#748294]">Tổng hoa hồng</dt><dd className="text-right font-semibold tabular-nums">{formatVnd(n(meQ.data, "totalVnd", "total_vnd", "totalCommissionVnd"))}</dd></div>
            <div className="flex justify-between gap-2"><dt className="shrink-0 text-[#748294]">Chờ duyệt</dt><dd className="text-right tabular-nums">{formatVnd(n(meQ.data, "pendingVnd", "pending_vnd"))}</dd></div>
            <div className="flex justify-between gap-2"><dt className="shrink-0 text-[#748294]">Đã duyệt</dt><dd className="text-right tabular-nums">{formatVnd(n(meQ.data, "confirmedVnd", "confirmed_vnd"))}</dd></div>
            {Array.isArray(meQ.data?.items) && (meQ.data.items as Row[]).length > 0 ? (
              <ul className="space-y-1 pt-2">
                {(meQ.data.items as Row[]).map((it, i) => (
                  <li key={i} className="flex justify-between gap-2">
                    <span className="min-w-0 flex-1 truncate">{s(it, "ruleName", "rule_name") || "Hoa hồng"}</span>
                    <span className="shrink-0 tabular-nums">{formatVnd(n(it, "amountVnd", "amount_vnd"))}</span>
                  </li>
                ))}
              </ul>
            ) : null}
          </dl>
        )}
      </Card>

      {showForm ? (
        <Card title={versionOf ? `Tạo version mới: ${s(versionOf, "name")}` : editing ? "Sửa rule hoa hồng" : "Tạo rule hoa hồng"}>
          <div className="space-y-4">
            <Field label="Tên rule">
              <input value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} placeholder="vd: Hoa hồng sơn gel 10%" className={inputCls} />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Phạm vi áp dụng">
                <select value={form.scopeType} onChange={(e) => setForm((f) => ({ ...f, scopeType: e.target.value }))} className={inputCls}>
                  {SCOPE_TYPES.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
              </Field>
              <Field label="Mã đối tượng (không bắt buộc)">
                <input value={form.scopeRefId} onChange={(e) => setForm((f) => ({ ...f, scopeRefId: e.target.value }))} placeholder="vd: ID dịch vụ" className={inputCls} />
              </Field>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Loại mức">
                <select value={form.rateType} onChange={(e) => setForm((f) => ({ ...f, rateType: e.target.value }))} className={inputCls}>
                  <option value="percent">Phần trăm (%)</option>
                  <option value="fixed">Số tiền cố định (VND)</option>
                </select>
              </Field>
              <Field label={form.rateType === "percent" ? "Mức (%)" : "Mức (VND)"}>
                <input type="number" inputMode="numeric" min={0} value={form.rateValue} onChange={(e) => setForm((f) => ({ ...f, rateValue: e.target.value }))} className={inputCls} />
              </Field>
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <Field label="Doanh số tối thiểu">
                <input type="number" inputMode="numeric" min={0} value={form.minSalesVnd} onChange={(e) => setForm((f) => ({ ...f, minSalesVnd: e.target.value }))} placeholder="0" className={inputCls} />
              </Field>
              <Field label="Trần hoa hồng">
                <input type="number" inputMode="numeric" min={0} value={form.maxAmountVnd} onChange={(e) => setForm((f) => ({ ...f, maxAmountVnd: e.target.value }))} placeholder="Không trần" className={inputCls} />
              </Field>
              <Field label="Ưu tiên">
                <input type="number" inputMode="numeric" min={1} max={100} value={form.priority} onChange={(e) => setForm((f) => ({ ...f, priority: e.target.value }))} className={inputCls} />
              </Field>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Hiệu lực từ">
                <input type="date" value={form.validFrom} onChange={(e) => setForm((f) => ({ ...f, validFrom: e.target.value }))} className={inputCls} />
              </Field>
              <Field label="Hiệu lực đến (không bắt buộc)">
                <input type="date" value={form.validTo} onChange={(e) => setForm((f) => ({ ...f, validTo: e.target.value }))} className={inputCls} />
              </Field>
            </div>
            <Field label="Trạng thái">
              <select value={form.status} onChange={(e) => setForm((f) => ({ ...f, status: e.target.value }))} className={inputCls}>
                <option value="active">Đang áp dụng</option>
                <option value="inactive">Ngừng</option>
                <option value="draft">Nháp</option>
              </select>
            </Field>
            {formError ? <p role="alert" className="text-sm text-[#C0392B]">{formError}</p> : null}
            <button type="button" onClick={submit} disabled={saveMut.isPending || versionMut.isPending} className={`${btnPrimary} w-full`}>
              {versionOf ? "Tạo version mới" : editing ? "Lưu thay đổi" : "Tạo rule"}
            </button>
          </div>
        </Card>
      ) : null}

      {rulesQ.isLoading ? (
        <Loading />
      ) : rulesQ.isError ? (
        <ErrorBox message={errMsg(rulesQ.error)} onRetry={() => void rulesQ.refetch()} />
      ) : rules.length === 0 ? (
        <Empty text="Chưa có rule hoa hồng nào." action={<button type="button" onClick={() => setShowForm(true)} className={btnPrimary}>Tạo rule</button>} />
      ) : (
        <Card title={`${rules.length} rule hoa hồng`}>
          <ul className="space-y-3">
            {rules.map((r) => (
              <li key={idOf(r)} className="rounded-lg border border-[#E5E9ED] p-3">
                <div className="flex items-center justify-between gap-2">
                  <p className="min-w-0 flex-1 truncate text-sm font-medium">{s(r, "name")}</p>
                  <span className="shrink-0">
                    <Badge tone={badgeToneForStatus(s(r, "status"))}>{s(r, "status") === "active" ? "Đang áp dụng" : s(r, "status")}</Badge>
                  </span>
                </div>
                <p className="mt-1 break-words text-sm tabular-nums text-[#748294]">
                  {s(r, "rateType", "rate_type") === "fixed"
                    ? `${formatVnd(n(r, "rateValue", "rate_value"))} / dòng`
                    : `${n(r, "rateValue", "rate_value")}%`}
                  {" · "}Ưu tiên {n(r, "priority")} · Version {n(r, "version") || 1}
                  {" · "}Từ {formatDate(s(r, "validFrom", "valid_from"))}
                  {s(r, "validTo", "valid_to") ? ` đến ${formatDate(s(r, "validTo", "valid_to"))}` : ""}
                </p>
                <div className="mt-2 flex flex-wrap gap-2">
                  <button type="button" onClick={() => startEdit(r)} className={btnSecondary}>Sửa</button>
                  <button
                    type="button"
                    onClick={() => { setVersionOf(r); setEditing(null); startEdit(r); setVersionOf(r); }}
                    className={btnSecondary}
                  >
                    Tạo version mới
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </Card>
      )}

      <Card title="Mô phỏng hoa hồng (tính thử, không ghi dữ liệu)">
        <div className="space-y-4">
          <Field label="Nhân viên">
            <select value={sim.employeeId} onChange={(e) => setSim((x) => ({ ...x, employeeId: e.target.value }))} className={inputCls}>
              <option value="">— Chọn nhân viên —</option>
              {(staffQ.data ?? []).map((e) => (
                <option key={idOf(e)} value={idOf(e)}>{s(e, "fullName", "full_name")}</option>
              ))}
            </select>
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Loại dòng">
              <select value={sim.itemType} onChange={(e) => setSim((x) => ({ ...x, itemType: e.target.value }))} className={inputCls}>
                <option value="service">Dịch vụ</option>
                <option value="product">Sản phẩm</option>
              </select>
            </Field>
            <Field label="Mã dịch vụ / sản phẩm (không bắt buộc)">
              <input value={sim.refId} onChange={(e) => setSim((x) => ({ ...x, refId: e.target.value }))} placeholder="ID đối tượng" className={inputCls} />
            </Field>
          </div>
          <Field label="Số tiền dòng (VND)">
            <input type="number" inputMode="numeric" min={0} value={sim.amountVnd} onChange={(e) => setSim((x) => ({ ...x, amountVnd: e.target.value }))} placeholder="vd: 300000" className={inputCls} />
          </Field>
          <button type="button" disabled={simMut.isPending || !sim.amountVnd} onClick={() => simMut.mutate()} className={`${btnPrimary} w-full`}>
            {simMut.isPending ? "Đang xử lý..." : "Tính thử"}
          </button>
          {simResult ? (
            <div>
              <p className="text-sm font-medium">Kết quả mô phỏng</p>
              {simBreakdown.length === 0 ? (
                <p className="mt-1 text-sm text-[#748294]">Không có rule nào áp dụng cho dòng này.</p>
              ) : (
                <table className="mt-2 w-full text-sm">
                  <thead>
                    <tr className="text-left text-[#748294]">
                      <th className="py-1">Rule</th>
                      <th className="py-1 text-right">Hoa hồng</th>
                    </tr>
                  </thead>
                  <tbody>
                    {simBreakdown.map((b, i) => (
                      <tr key={i} className="border-t border-[#E5E9ED]">
                        <td className="break-words py-2">{s(b, "ruleName", "rule_name") || s(b, "ruleId", "rule_id")}</td>
                        <td className="whitespace-nowrap py-2 text-right tabular-nums">{formatVnd(n(b, "amountVnd", "amount_vnd"))}</td>
                      </tr>
                    ))}
                    <tr className="border-t border-[#E5E9ED] font-semibold">
                      <td className="py-2">Tổng</td>
                      <td className="whitespace-nowrap py-2 text-right tabular-nums">{formatVnd(n(simResult, "totalVnd", "total_vnd", "totalCommissionVnd"))}</td>
                    </tr>
                  </tbody>
                </table>
              )}
            </div>
          ) : null}
        </div>
      </Card>

      <Card title="Lịch sử tính hoa hồng">
        {calcsQ.isLoading ? (
          <Loading />
        ) : calcsQ.isError ? (
          <ErrorBox message={errMsg(calcsQ.error)} onRetry={() => void calcsQ.refetch()} />
        ) : calcs.length === 0 ? (
          <p className="text-sm text-[#748294]">Chưa có tính hoa hồng nào.</p>
        ) : (
          <ul className="space-y-2">
            {calcs.map((c) => (
              <li key={idOf(c)} className="flex items-center justify-between gap-2 rounded-lg border border-[#E5E9ED] p-3 text-sm">
                <span className="min-w-0 flex-1 break-words tabular-nums">
                  {s(c, "employeeName", "employee_name") || "Nhân viên"} · {formatVnd(n(c, "amountVnd", "amount_vnd"))}
                  {" "}<Badge tone={badgeToneForStatus(s(c, "status"))}>{COMMISSION_CALC_STATUS_LABEL[s(c, "status")] ?? s(c, "status")}</Badge>
                </span>
                {s(c, "status") === "pending" ? (
                  <button type="button" disabled={confirmMut.isPending} onClick={() => confirmMut.mutate(idOf(c))} className={`${btnSecondary} shrink-0`}>Duyệt</button>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </Card>
    </main>
  );
}
