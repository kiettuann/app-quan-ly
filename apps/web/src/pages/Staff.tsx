// Nhân sự — danh sách nhân viên + tạo/sửa (chi nhánh, họ tên, SĐT, chức vụ,
// lương cơ bản), liên kết tới Chấm công.
import { useState } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiPage, formatDate, formatVnd, patch, post } from "../lib/api.js";
import { idOf, n, s } from "../lib/types.js";
import type { Row } from "../lib/types.js";
import {
  btnPrimary, btnSecondary, Card, Empty, ErrorBox, Field, Loading, Notice, errMsg, inputCls,
} from "../lib/ui.js";

interface StaffForm {
  branchId: string;
  fullName: string;
  phone: string;
  position: string;
  baseSalaryVnd: string;
}

const EMPTY_FORM: StaffForm = { branchId: "", fullName: "", phone: "", position: "", baseSalaryVnd: "" };

export default function StaffPage() {
  const qc = useQueryClient();
  const [branchId, setBranchId] = useState("");
  const [editing, setEditing] = useState<Row | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState<StaffForm>(EMPTY_FORM);
  const [formError, setFormError] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ kind: "success" | "error"; text: string } | null>(null);

  const branchesQ = useQuery({
    queryKey: ["branches"],
    queryFn: () => apiPage<Row>("/api/v1/branches?limit=100").then((r) => r.items),
  });
  const params = new URLSearchParams({ limit: "100" });
  if (branchId) params.set("branch_id", branchId);
  const staffQ = useQuery({
    queryKey: ["employees", branchId],
    queryFn: () => apiPage<Row>(`/api/v1/employees?${params.toString()}`).then((r) => r.items),
  });

  const saveMut = useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      editing ? patch<Row>(`/api/v1/employees/${idOf(editing)}`, body) : post<Row>("/api/v1/employees", body),
    onSuccess: () => {
      setNotice({ kind: "success", text: editing ? "Đã cập nhật nhân viên." : "Đã thêm nhân viên." });
      setShowForm(false);
      setEditing(null);
      setForm(EMPTY_FORM);
      void qc.invalidateQueries({ queryKey: ["employees"] });
    },
    onError: (err) => setNotice({ kind: "error", text: errMsg(err) }),
  });

  function startEdit(e: Row) {
    setEditing(e);
    setForm({
      branchId: s(e, "branchId", "branch_id"),
      fullName: s(e, "fullName", "full_name"),
      phone: s(e, "phone"),
      position: s(e, "position"),
      baseSalaryVnd: String(n(e, "baseSalaryVnd", "base_salary_vnd")),
    });
    setShowForm(true);
    setFormError(null);
  }

  function submit() {
    setFormError(null);
    if (!form.branchId) return setFormError("Vui lòng chọn chi nhánh.");
    if (!form.fullName.trim()) return setFormError("Vui lòng nhập họ tên.");
    if (!form.baseSalaryVnd || Number(form.baseSalaryVnd) < 0) return setFormError("Lương cơ bản phải là số >= 0.");
    saveMut.mutate({
      branchId: form.branchId,
      fullName: form.fullName.trim(),
      phone: form.phone.trim() || undefined,
      position: form.position.trim() || undefined,
      baseSalaryVnd: Number(form.baseSalaryVnd),
    });
  }

  const staff = staffQ.data ?? [];
  return (
    <main className="space-y-4 p-4">
      <div className="flex items-center justify-between gap-2">
        <h1 className="text-xl font-bold">Nhân sự</h1>
        <button
          type="button"
          onClick={() => { setEditing(null); setForm(EMPTY_FORM); setShowForm((v) => !v); }}
          className={btnPrimary}
        >
          {showForm ? "Đóng form" : "Thêm nhân viên"}
        </button>
      </div>
      {notice ? <Notice kind={notice.kind} text={notice.text} onClose={() => setNotice(null)} /> : null}
      <Link to="/cham-cong" className="inline-flex min-h-[44px] items-center rounded-lg border border-[#E5E9ED] bg-white px-4 text-sm font-semibold text-[#3979A8]">
        Chấm công →
      </Link>

      {showForm ? (
        <Card title={editing ? "Sửa nhân viên" : "Thêm nhân viên"}>
          <div className="space-y-4">
            <Field label="Chi nhánh">
              <select value={form.branchId} onChange={(e) => setForm((f) => ({ ...f, branchId: e.target.value }))} className={inputCls}>
                <option value="">— Chọn chi nhánh —</option>
                {(branchesQ.data ?? []).map((b) => (
                  <option key={idOf(b)} value={idOf(b)}>{s(b, "name")}</option>
                ))}
              </select>
            </Field>
            <Field label="Họ tên">
              <input value={form.fullName} onChange={(e) => setForm((f) => ({ ...f, fullName: e.target.value }))} placeholder="vd: Nguyễn Thị Lan" className={inputCls} />
            </Field>
            <Field label="Số điện thoại">
              <input type="tel" inputMode="tel" value={form.phone} onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))} placeholder="vd: 0901234567" className={inputCls} />
            </Field>
            <Field label="Chức vụ">
              <input value={form.position} onChange={(e) => setForm((f) => ({ ...f, position: e.target.value }))} placeholder="vd: Kỹ thuật viên" className={inputCls} />
            </Field>
            <Field label="Lương cơ bản (VND)">
              <input type="number" inputMode="numeric" min={0} value={form.baseSalaryVnd} onChange={(e) => setForm((f) => ({ ...f, baseSalaryVnd: e.target.value }))} className={inputCls} />
            </Field>
            {formError ? <p role="alert" className="text-sm text-[#C0392B]">{formError}</p> : null}
            <button type="button" onClick={submit} disabled={saveMut.isPending} className={btnPrimary}>
              {saveMut.isPending ? "Đang xử lý..." : editing ? "Lưu thay đổi" : "Thêm nhân viên"}
            </button>
          </div>
        </Card>
      ) : null}

      <Field label="Lọc theo chi nhánh">
        <select value={branchId} onChange={(e) => setBranchId(e.target.value)} className={inputCls}>
          <option value="">Tất cả chi nhánh</option>
          {(branchesQ.data ?? []).map((b) => (
            <option key={idOf(b)} value={idOf(b)}>{s(b, "name")}</option>
          ))}
        </select>
      </Field>

      {staffQ.isLoading ? (
        <Loading />
      ) : staffQ.isError ? (
        <ErrorBox message={errMsg(staffQ.error)} onRetry={() => void staffQ.refetch()} />
      ) : staff.length === 0 ? (
        <Empty text="Chưa có nhân viên nào." action={<button type="button" onClick={() => setShowForm(true)} className={btnPrimary}>Thêm nhân viên</button>} />
      ) : (
        <Card title={`${staff.length} nhân viên`}>
          <ul className="space-y-3">
            {staff.map((e) => (
              <li key={idOf(e)} className="flex items-center justify-between gap-2 rounded-lg border border-[#E5E9ED] p-3">
                <div>
                  <p className="text-sm font-medium">{s(e, "fullName", "full_name")}</p>
                  <p className="text-xs text-[#748294]">
                    {s(e, "position") || "Chưa có chức vụ"} · {s(e, "phone") || "Chưa có SĐT"}
                  </p>
                  <p className="text-xs text-[#748294]">
                    Lương cơ bản: {formatVnd(n(e, "baseSalaryVnd", "base_salary_vnd"))}
                    {s(e, "hireDate", "hire_date") ? ` · Vào làm: ${formatDate(s(e, "hireDate", "hire_date"))}` : ""}
                  </p>
                </div>
                <button type="button" onClick={() => startEdit(e)} className={btnSecondary}>Sửa</button>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </main>
  );
}
