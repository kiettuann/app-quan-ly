// Chi phí — nhóm chi phí + chi phí CRUD, lọc theo chi nhánh / nhóm / khoảng ngày.
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiPage, del, formatDate, formatVnd, patch, post, todayHcm } from "../lib/api.js";
import { idOf, n, s } from "../lib/types.js";
import type { Row } from "../lib/types.js";
import {
  btnDanger, btnPrimary, btnSecondary, Card, Empty, ErrorBox, Field, Loading, Notice,
  errMsg, inputCls,
} from "../lib/ui.js";

const EXPENSE_TYPES = [
  { value: "rent", label: "Thuê mặt bằng" },
  { value: "salary", label: "Lương" },
  { value: "supplies", label: "Vật tư" },
  { value: "utilities", label: "Điện nước" },
  { value: "marketing", label: "Marketing" },
  { value: "other", label: "Khác" },
];

export default function ExpensesPage() {
  const qc = useQueryClient();
  const [branchId, setBranchId] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<Row | null>(null);
  const [form, setForm] = useState({ branchId: "", categoryId: "", amountVnd: "", expenseDate: todayHcm(), description: "" });
  const [formError, setFormError] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ kind: "success" | "error"; text: string } | null>(null);
  const [catName, setCatName] = useState("");
  const [catType, setCatType] = useState("other");

  const branchesQ = useQuery({
    queryKey: ["branches"],
    queryFn: () => apiPage<Row>("/api/v1/branches?limit=100").then((r) => r.items),
  });
  const catsQ = useQuery({
    queryKey: ["expense-categories"],
    queryFn: () => apiPage<Row>("/api/v1/expense-categories?limit=100").then((r) => r.items),
  });
  const params = new URLSearchParams({ limit: "100" });
  if (branchId) params.set("branch_id", branchId);
  if (categoryId) params.set("category_id", categoryId);
  if (from) params.set("from", from);
  if (to) params.set("to", to);
  const expensesQ = useQuery({
    queryKey: ["expenses", branchId, categoryId, from, to],
    queryFn: () => apiPage<Row>(`/api/v1/expenses?${params.toString()}`).then((r) => r.items),
  });

  const saveMut = useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      editing ? patch<Row>(`/api/v1/expenses/${idOf(editing)}`, body) : post<Row>("/api/v1/expenses", body),
    onSuccess: () => {
      setNotice({ kind: "success", text: editing ? "Đã cập nhật chi phí." : "Đã thêm chi phí." });
      setShowForm(false); setEditing(null);
      void qc.invalidateQueries({ queryKey: ["expenses"] });
    },
    onError: (err) => setNotice({ kind: "error", text: errMsg(err) }),
  });
  const catMut = useMutation({
    mutationFn: () => post<Row>("/api/v1/expense-categories", { name: catName.trim(), type: catType }),
    onSuccess: () => { setCatName(""); setNotice({ kind: "success", text: "Đã thêm nhóm chi phí." }); void qc.invalidateQueries({ queryKey: ["expense-categories"] }); },
    onError: (err) => setNotice({ kind: "error", text: errMsg(err) }),
  });
  const deleteMut = useMutation({
    mutationFn: (id: string) => del(`/api/v1/expenses/${id}`),
    onSuccess: () => { setNotice({ kind: "success", text: "Đã xóa chi phí." }); void qc.invalidateQueries({ queryKey: ["expenses"] }); },
    onError: (err) => setNotice({ kind: "error", text: errMsg(err) }),
  });

  function startEdit(e: Row) {
    setEditing(e);
    setForm({
      branchId: s(e, "branchId", "branch_id"),
      categoryId: s(e, "categoryId", "category_id"),
      amountVnd: String(n(e, "amountVnd", "amount_vnd")),
      expenseDate: s(e, "expenseDate", "expense_date").slice(0, 10) || todayHcm(),
      description: s(e, "description"),
    });
    setShowForm(true);
    setFormError(null);
  }

  function submit() {
    setFormError(null);
    if (!form.branchId) return setFormError("Vui lòng chọn chi nhánh.");
    if (!form.amountVnd || Number(form.amountVnd) <= 0) return setFormError("Số tiền phải lớn hơn 0.");
    if (!form.description.trim()) return setFormError("Vui lòng nhập nội dung chi phí.");
    if (!form.expenseDate) return setFormError("Vui lòng chọn ngày chi.");
    saveMut.mutate({
      branchId: form.branchId,
      categoryId: form.categoryId || undefined,
      amountVnd: Number(form.amountVnd),
      expenseDate: form.expenseDate,
      description: form.description.trim(),
    });
  }

  const expenses = expensesQ.data ?? [];
  const total = expenses.reduce((sum, e) => sum + n(e, "amountVnd", "amount_vnd"), 0);

  return (
    <main className="space-y-4 p-4">
      <div className="flex items-center justify-between gap-2">
        <h1 className="text-xl font-bold">Chi phí</h1>
        <button
          type="button"
          onClick={() => { setEditing(null); setForm({ branchId: "", categoryId: "", amountVnd: "", expenseDate: todayHcm(), description: "" }); setShowForm((v) => !v); }}
          className={btnPrimary}
        >
          {showForm ? "Đóng form" : "Thêm chi phí"}
        </button>
      </div>
      {notice ? <Notice kind={notice.kind} text={notice.text} onClose={() => setNotice(null)} /> : null}

      <Card title="Nhóm chi phí">
        <div className="flex gap-2">
          <input value={catName} onChange={(e) => setCatName(e.target.value)} placeholder="Tên nhóm mới" aria-label="Tên nhóm chi phí mới" className={inputCls} />
          <select value={catType} onChange={(e) => setCatType(e.target.value)} aria-label="Loại nhóm chi phí" className={inputCls}>
            {EXPENSE_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
          </select>
          <button type="button" disabled={catMut.isPending || !catName.trim()} onClick={() => catMut.mutate()} className={btnSecondary}>Thêm nhóm</button>
        </div>
      </Card>

      {showForm ? (
        <Card title={editing ? "Sửa chi phí" : "Thêm chi phí"}>
          <div className="space-y-4">
            <Field label="Chi nhánh">
              <select value={form.branchId} onChange={(e) => setForm((f) => ({ ...f, branchId: e.target.value }))} className={inputCls}>
                <option value="">— Chọn chi nhánh —</option>
                {(branchesQ.data ?? []).map((b) => (
                  <option key={idOf(b)} value={idOf(b)}>{s(b, "name")}</option>
                ))}
              </select>
            </Field>
            <Field label="Nhóm chi phí">
              <select value={form.categoryId} onChange={(e) => setForm((f) => ({ ...f, categoryId: e.target.value }))} className={inputCls}>
                <option value="">— Không chọn nhóm —</option>
                {(catsQ.data ?? []).map((c) => (
                  <option key={idOf(c)} value={idOf(c)}>{s(c, "name")}</option>
                ))}
              </select>
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Số tiền (VND)">
                <input type="number" inputMode="numeric" min={1} value={form.amountVnd} onChange={(e) => setForm((f) => ({ ...f, amountVnd: e.target.value }))} className={inputCls} />
              </Field>
              <Field label="Ngày chi">
                <input type="date" value={form.expenseDate} onChange={(e) => setForm((f) => ({ ...f, expenseDate: e.target.value }))} className={inputCls} />
              </Field>
            </div>
            <Field label="Nội dung">
              <input value={form.description} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} placeholder="vd: Tiền thuê mặt bằng tháng 11" className={inputCls} />
            </Field>
            {formError ? <p role="alert" className="text-sm text-[#C0392B]">{formError}</p> : null}
            <button type="button" onClick={submit} disabled={saveMut.isPending} className={btnPrimary}>
              {saveMut.isPending ? "Đang xử lý..." : editing ? "Lưu thay đổi" : "Thêm chi phí"}
            </button>
          </div>
        </Card>
      ) : null}

      <Card title="Lọc chi phí">
        <div className="grid grid-cols-2 gap-3">
          <Field label="Chi nhánh">
            <select value={branchId} onChange={(e) => setBranchId(e.target.value)} className={inputCls}>
              <option value="">Tất cả</option>
              {(branchesQ.data ?? []).map((b) => (
                <option key={idOf(b)} value={idOf(b)}>{s(b, "name")}</option>
              ))}
            </select>
          </Field>
          <Field label="Nhóm">
            <select value={categoryId} onChange={(e) => setCategoryId(e.target.value)} className={inputCls}>
              <option value="">Tất cả</option>
              {(catsQ.data ?? []).map((c) => (
                <option key={idOf(c)} value={idOf(c)}>{s(c, "name")}</option>
              ))}
            </select>
          </Field>
          <Field label="Từ ngày">
            <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className={inputCls} />
          </Field>
          <Field label="Đến ngày">
            <input type="date" value={to} onChange={(e) => setTo(e.target.value)} className={inputCls} />
          </Field>
        </div>
      </Card>

      {expensesQ.isLoading ? (
        <Loading />
      ) : expensesQ.isError ? (
        <ErrorBox message={errMsg(expensesQ.error)} onRetry={() => void expensesQ.refetch()} />
      ) : expenses.length === 0 ? (
        <Empty text="Chưa có chi phí nào khớp bộ lọc." action={<button type="button" onClick={() => setShowForm(true)} className={btnPrimary}>Thêm chi phí</button>} />
      ) : (
        <Card title={`${expenses.length} khoản chi · Tổng ${formatVnd(total)}`}>
          <ul className="space-y-3">
            {expenses.map((e) => (
              <li key={idOf(e)} className="rounded-lg border border-[#E5E9ED] p-3">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-sm font-medium">{s(e, "description")}</p>
                  <p className="text-sm font-semibold text-[#244B70]">{formatVnd(n(e, "amountVnd", "amount_vnd"))}</p>
                </div>
                <p className="mt-1 text-xs text-[#748294]">
                  {formatDate(s(e, "expenseDate", "expense_date"))}
                  {s(e, "categoryName", "category_name") ? ` · ${s(e, "categoryName", "category_name")}` : ""}
                </p>
                <div className="mt-2 flex gap-2">
                  <button type="button" onClick={() => startEdit(e)} className={btnSecondary}>Sửa</button>
                  <button type="button" onClick={() => { if (window.confirm("Xóa khoản chi này?")) deleteMut.mutate(idOf(e)); }} className={btnDanger}>Xóa</button>
                </div>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </main>
  );
}
