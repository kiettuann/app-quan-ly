// Chi nhánh — CRUD chi nhánh (tên, địa chỉ, SĐT, trạng thái).
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiPage, del, patch, post } from "../lib/api.js";
import { idOf, s } from "../lib/types.js";
import type { Row } from "../lib/types.js";
import {
  Badge, badgeToneForStatus, btnDanger, btnPrimary, btnSecondary, Card, Empty, ErrorBox,
  Field, Loading, Notice, errMsg, inputCls,
} from "../lib/ui.js";

export default function BranchesPage() {
  const qc = useQueryClient();
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<Row | null>(null);
  const [form, setForm] = useState({ name: "", address: "", phone: "", status: "active" });
  const [formError, setFormError] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ kind: "success" | "error"; text: string } | null>(null);

  const branchesQ = useQuery({
    queryKey: ["branches"],
    queryFn: () => apiPage<Row>("/api/v1/branches?limit=100").then((r) => r.items),
  });

  const saveMut = useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      editing ? patch<Row>(`/api/v1/branches/${idOf(editing)}`, body) : post<Row>("/api/v1/branches", body),
    onSuccess: () => {
      setNotice({ kind: "success", text: editing ? "Đã cập nhật chi nhánh." : "Đã thêm chi nhánh." });
      setShowForm(false); setEditing(null);
      setForm({ name: "", address: "", phone: "", status: "active" });
      void qc.invalidateQueries({ queryKey: ["branches"] });
    },
    onError: (err) => setNotice({ kind: "error", text: errMsg(err) }),
  });
  const deleteMut = useMutation({
    mutationFn: (id: string) => del(`/api/v1/branches/${id}`),
    onSuccess: () => { setNotice({ kind: "success", text: "Đã xóa chi nhánh." }); void qc.invalidateQueries({ queryKey: ["branches"] }); },
    onError: (err) => setNotice({ kind: "error", text: errMsg(err) }),
  });

  function startEdit(b: Row) {
    setEditing(b);
    setForm({ name: s(b, "name"), address: s(b, "address"), phone: s(b, "phone"), status: s(b, "status") || "active" });
    setShowForm(true);
    setFormError(null);
  }

  function submit() {
    setFormError(null);
    if (!form.name.trim() || form.name.trim().length < 2) return setFormError("Tên chi nhánh phải có ít nhất 2 ký tự.");
    saveMut.mutate({
      name: form.name.trim(),
      address: form.address.trim() || undefined,
      phone: form.phone.trim() || undefined,
      status: form.status,
    });
  }

  const branches = branchesQ.data ?? [];
  return (
    <main className="space-y-4 p-4">
      <div className="flex items-center justify-between gap-2">
        <h1 className="text-xl font-bold">Chi nhánh</h1>
        <button
          type="button"
          onClick={() => { setEditing(null); setForm({ name: "", address: "", phone: "", status: "active" }); setShowForm((v) => !v); }}
          className={btnPrimary}
        >
          {showForm ? "Đóng form" : "Thêm chi nhánh"}
        </button>
      </div>
      {notice ? <Notice kind={notice.kind} text={notice.text} onClose={() => setNotice(null)} /> : null}

      {showForm ? (
        <Card title={editing ? "Sửa chi nhánh" : "Thêm chi nhánh"}>
          <div className="space-y-4">
            <Field label="Tên chi nhánh">
              <input value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} placeholder="vd: Chi nhánh Quận 1" className={inputCls} />
            </Field>
            <Field label="Địa chỉ">
              <input value={form.address} onChange={(e) => setForm((f) => ({ ...f, address: e.target.value }))} placeholder="vd: 123 Nguyễn Huệ, Quận 1" className={inputCls} />
            </Field>
            <Field label="Số điện thoại">
              <input type="tel" inputMode="tel" value={form.phone} onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))} placeholder="vd: 0901234567" className={inputCls} />
            </Field>
            <Field label="Trạng thái">
              <select value={form.status} onChange={(e) => setForm((f) => ({ ...f, status: e.target.value }))} className={inputCls}>
                <option value="active">Đang hoạt động</option>
                <option value="inactive">Ngừng hoạt động</option>
              </select>
            </Field>
            {formError ? <p role="alert" className="text-sm text-[#C0392B]">{formError}</p> : null}
            <button type="button" onClick={submit} disabled={saveMut.isPending} className={btnPrimary}>
              {saveMut.isPending ? "Đang xử lý..." : editing ? "Lưu thay đổi" : "Thêm chi nhánh"}
            </button>
          </div>
        </Card>
      ) : null}

      {branchesQ.isLoading ? (
        <Loading />
      ) : branchesQ.isError ? (
        <ErrorBox message={errMsg(branchesQ.error)} onRetry={() => void branchesQ.refetch()} />
      ) : branches.length === 0 ? (
        <Empty text="Chưa có chi nhánh nào." action={<button type="button" onClick={() => setShowForm(true)} className={btnPrimary}>Thêm chi nhánh</button>} />
      ) : (
        <Card title={`${branches.length} chi nhánh`}>
          <ul className="space-y-3">
            {branches.map((b) => (
              <li key={idOf(b)} className="rounded-lg border border-[#E5E9ED] p-3">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-sm font-medium">{s(b, "name")}</p>
                  <Badge tone={badgeToneForStatus(s(b, "status"))}>{s(b, "status") === "active" ? "Đang hoạt động" : "Ngừng hoạt động"}</Badge>
                </div>
                <p className="mt-1 text-sm text-[#748294]">
                  {s(b, "address") || "Chưa có địa chỉ"}{s(b, "phone") ? ` · ${s(b, "phone")}` : ""}
                </p>
                <div className="mt-2 flex gap-2">
                  <button type="button" onClick={() => startEdit(b)} className={btnSecondary}>Sửa</button>
                  <button type="button" onClick={() => { if (window.confirm(`Xóa chi nhánh "${s(b, "name")}"?`)) deleteMut.mutate(idOf(b)); }} className={btnDanger}>Xóa</button>
                </div>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </main>
  );
}
