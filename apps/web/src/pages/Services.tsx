// Dịch vụ — nhóm dịch vụ + dịch vụ CRUD (tên, giá, thời lượng, trạng thái)
// và giá riêng theo chi nhánh (service branch settings).
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiPage, del, formatVnd, patch, post } from "../lib/api.js";
import { idOf, n, s } from "../lib/types.js";
import type { Row } from "../lib/types.js";
import {
  Badge, badgeToneForStatus, btnDanger, btnPrimary, btnSecondary, Card, Empty, ErrorBox,
  Field, Loading, Notice, errMsg, inputCls,
} from "../lib/ui.js";

export default function ServicesPage() {
  const qc = useQueryClient();
  const [categoryId, setCategoryId] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<Row | null>(null);
  const [form, setForm] = useState({ name: "", priceVnd: "", durationMinutes: "60", status: "active", description: "" });
  const [formError, setFormError] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ kind: "success" | "error"; text: string } | null>(null);
  const [catName, setCatName] = useState("");
  const [override, setOverride] = useState<{ serviceId: string; branchId: string; priceVnd: string; isAvailable: boolean } | null>(null);

  const catsQ = useQuery({
    queryKey: ["service-categories"],
    queryFn: () => apiPage<Row>("/api/v1/service-categories?limit=100").then((r) => r.items),
  });
  const params = new URLSearchParams({ limit: "100" });
  if (categoryId) params.set("category_id", categoryId);
  const servicesQ = useQuery({
    queryKey: ["services", categoryId],
    queryFn: () => apiPage<Row>(`/api/v1/services?${params.toString()}`).then((r) => r.items),
  });
  const branchesQ = useQuery({
    queryKey: ["branches"],
    queryFn: () => apiPage<Row>("/api/v1/branches?limit=100").then((r) => r.items),
  });

  const saveMut = useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      editing ? patch<Row>(`/api/v1/services/${idOf(editing)}`, body) : post<Row>("/api/v1/services", body),
    onSuccess: () => {
      setNotice({ kind: "success", text: editing ? "Đã cập nhật dịch vụ." : "Đã thêm dịch vụ." });
      setShowForm(false); setEditing(null);
      setForm({ name: "", priceVnd: "", durationMinutes: "60", status: "active", description: "" });
      void qc.invalidateQueries({ queryKey: ["services"] });
    },
    onError: (err) => setNotice({ kind: "error", text: errMsg(err) }),
  });
  const catMut = useMutation({
    mutationFn: (name: string) => post<Row>("/api/v1/service-categories", { name }),
    onSuccess: () => { setCatName(""); setNotice({ kind: "success", text: "Đã thêm nhóm dịch vụ." }); void qc.invalidateQueries({ queryKey: ["service-categories"] }); },
    onError: (err) => setNotice({ kind: "error", text: errMsg(err) }),
  });
  const deleteMut = useMutation({
    mutationFn: (id: string) => del(`/api/v1/services/${id}`),
    onSuccess: () => { setNotice({ kind: "success", text: "Đã xóa dịch vụ." }); void qc.invalidateQueries({ queryKey: ["services"] }); },
    onError: (err) => setNotice({ kind: "error", text: errMsg(err) }),
  });
  const overrideMut = useMutation({
    mutationFn: () =>
      patch<Row>(`/api/v1/services/${override?.serviceId ?? ""}/branch-settings`, {
        branchId: override?.branchId,
        priceVnd: override?.priceVnd ? Number(override.priceVnd) : null,
        isAvailable: override?.isAvailable,
      }),
    onSuccess: () => { setNotice({ kind: "success", text: "Đã lưu giá theo chi nhánh." }); setOverride(null); void qc.invalidateQueries({ queryKey: ["services"] }); },
    onError: (err) => setNotice({ kind: "error", text: errMsg(err) }),
  });

  function startEdit(sv: Row) {
    setEditing(sv);
    setForm({
      name: s(sv, "name"),
      priceVnd: String(n(sv, "priceVnd", "price_vnd")),
      durationMinutes: String(n(sv, "durationMinutes", "duration_minutes") || 60),
      status: s(sv, "status") || "active",
      description: s(sv, "description"),
    });
    setShowForm(true);
    setFormError(null);
  }

  function submit() {
    setFormError(null);
    if (!form.name.trim()) return setFormError("Vui lòng nhập tên dịch vụ.");
    if (!form.priceVnd || Number(form.priceVnd) < 0) return setFormError("Giá phải là số >= 0.");
    const dur = Number(form.durationMinutes);
    if (!Number.isInteger(dur) || dur < 5 || dur > 480) return setFormError("Thời lượng phải từ 5 đến 480 phút.");
    saveMut.mutate({
      categoryId: categoryId || undefined,
      name: form.name.trim(),
      description: form.description.trim() || undefined,
      priceVnd: Number(form.priceVnd),
      durationMinutes: dur,
      status: form.status,
    });
  }

  const services = servicesQ.data ?? [];
  return (
    <main className="space-y-4 p-4">
      <div className="flex items-center justify-between gap-2">
        <h1 className="text-xl font-bold">Dịch vụ</h1>
        <button
          type="button"
          onClick={() => { setEditing(null); setForm({ name: "", priceVnd: "", durationMinutes: "60", status: "active", description: "" }); setShowForm((v) => !v); }}
          className={btnPrimary}
        >
          {showForm ? "Đóng form" : "Thêm dịch vụ"}
        </button>
      </div>
      {notice ? <Notice kind={notice.kind} text={notice.text} onClose={() => setNotice(null)} /> : null}

      <Card title="Nhóm dịch vụ">
        <div className="flex gap-2">
          <input value={catName} onChange={(e) => setCatName(e.target.value)} placeholder="Tên nhóm mới, vd: Làm móng" aria-label="Tên nhóm dịch vụ mới" className={inputCls} />
          <button type="button" disabled={catMut.isPending || !catName.trim()} onClick={() => catMut.mutate(catName.trim())} className={btnSecondary}>
            Thêm nhóm
          </button>
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          <button type="button" onClick={() => setCategoryId("")} className={categoryId === "" ? btnPrimary : btnSecondary}>Tất cả</button>
          {(catsQ.data ?? []).map((c) => (
            <button key={idOf(c)} type="button" onClick={() => setCategoryId(idOf(c))} className={categoryId === idOf(c) ? btnPrimary : btnSecondary}>
              {s(c, "name")}
            </button>
          ))}
        </div>
        {catsQ.isError ? <p className="mt-2 text-sm text-[#C0392B]">Không tải được nhóm dịch vụ: {errMsg(catsQ.error)}</p> : null}
      </Card>

      {showForm ? (
        <Card title={editing ? "Sửa dịch vụ" : "Thêm dịch vụ"}>
          <div className="space-y-4">
            <Field label="Tên dịch vụ">
              <input value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} placeholder="vd: Sơn gel" className={inputCls} />
            </Field>
            <Field label="Mô tả (không bắt buộc)">
              <input value={form.description} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} className={inputCls} />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Giá (VND)">
                <input type="number" inputMode="numeric" min={0} value={form.priceVnd} onChange={(e) => setForm((f) => ({ ...f, priceVnd: e.target.value }))} className={inputCls} />
              </Field>
              <Field label="Thời lượng (phút)">
                <input type="number" inputMode="numeric" min={5} max={480} value={form.durationMinutes} onChange={(e) => setForm((f) => ({ ...f, durationMinutes: e.target.value }))} className={inputCls} />
              </Field>
            </div>
            <Field label="Trạng thái">
              <select value={form.status} onChange={(e) => setForm((f) => ({ ...f, status: e.target.value }))} className={inputCls}>
                <option value="active">Đang bán</option>
                <option value="inactive">Ngừng bán</option>
              </select>
            </Field>
            {formError ? <p role="alert" className="text-sm text-[#C0392B]">{formError}</p> : null}
            <button type="button" onClick={submit} disabled={saveMut.isPending} className={btnPrimary}>
              {saveMut.isPending ? "Đang xử lý..." : editing ? "Lưu thay đổi" : "Thêm dịch vụ"}
            </button>
          </div>
        </Card>
      ) : null}

      {servicesQ.isLoading ? (
        <Loading />
      ) : servicesQ.isError ? (
        <ErrorBox message={errMsg(servicesQ.error)} onRetry={() => void servicesQ.refetch()} />
      ) : services.length === 0 ? (
        <Empty text="Chưa có dịch vụ nào." action={<button type="button" onClick={() => setShowForm(true)} className={btnPrimary}>Thêm dịch vụ</button>} />
      ) : (
        <Card title={`${services.length} dịch vụ`}>
          <ul className="space-y-3">
            {services.map((sv) => (
              <li key={idOf(sv)} className="rounded-lg border border-[#E5E9ED] p-3">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-sm font-medium">{s(sv, "name")}</p>
                  <Badge tone={badgeToneForStatus(s(sv, "status"))}>{s(sv, "status") === "active" ? "Đang bán" : "Ngừng bán"}</Badge>
                </div>
                <p className="mt-1 text-sm text-[#748294]">
                  {formatVnd(n(sv, "priceVnd", "price_vnd"))} · {n(sv, "durationMinutes", "duration_minutes")} phút
                </p>
                <div className="mt-2 flex flex-wrap gap-2">
                  <button type="button" onClick={() => startEdit(sv)} className={btnSecondary}>Sửa</button>
                  <button
                    type="button"
                    onClick={() => setOverride({ serviceId: idOf(sv), branchId: "", priceVnd: "", isAvailable: true })}
                    className={btnSecondary}
                  >
                    Giá theo chi nhánh
                  </button>
                  <button
                    type="button"
                    onClick={() => { if (window.confirm(`Xóa dịch vụ "${s(sv, "name")}"?`)) deleteMut.mutate(idOf(sv)); }}
                    className={btnDanger}
                  >
                    Xóa
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </Card>
      )}

      {override ? (
        <Card title="Giá riêng theo chi nhánh">
          <div className="space-y-4">
            <Field label="Chi nhánh">
              <select value={override.branchId} onChange={(e) => setOverride((o) => (o ? { ...o, branchId: e.target.value } : o))} className={inputCls}>
                <option value="">— Chọn chi nhánh —</option>
                {(branchesQ.data ?? []).map((b) => (
                  <option key={idOf(b)} value={idOf(b)}>{s(b, "name")}</option>
                ))}
              </select>
            </Field>
            <Field label="Giá tại chi nhánh (VND) — để trống để dùng giá chung">
              <input type="number" inputMode="numeric" min={0} value={override.priceVnd} onChange={(e) => setOverride((o) => (o ? { ...o, priceVnd: e.target.value } : o))} className={inputCls} />
            </Field>
            <label className="flex min-h-[44px] items-center gap-2 text-sm">
              <input type="checkbox" checked={override.isAvailable} onChange={(e) => setOverride((o) => (o ? { ...o, isAvailable: e.target.checked } : o))} />
              Có bán tại chi nhánh này
            </label>
            <div className="flex gap-2">
              <button type="button" disabled={overrideMut.isPending || !override.branchId} onClick={() => overrideMut.mutate()} className={btnPrimary}>
                {overrideMut.isPending ? "Đang xử lý..." : "Lưu giá"}
              </button>
              <button type="button" onClick={() => setOverride(null)} className={btnSecondary}>Đóng</button>
            </div>
          </div>
        </Card>
      ) : null}
    </main>
  );
}
