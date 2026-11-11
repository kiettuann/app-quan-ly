// Khách hàng — tìm theo tên/SĐT (debounce), danh sách kèm tổng chi tiêu/
// số lần đến, tạo/sửa, chi tiết với lịch sử booking + hóa đơn (lấy qua
// list endpoints lọc theo customer_id).
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiPage, formatDate, formatDateTime, formatVnd, get, patch, post } from "../lib/api.js";
import { BOOKING_STATUS_LABEL, GENDER_LABEL, INVOICE_STATUS_LABEL, idOf, n, s } from "../lib/types.js";
import type { Row } from "../lib/types.js";
import {
  Badge, badgeToneForStatus, btnPrimary, btnSecondary, Card, Empty, ErrorBox, Field,
  Loading, Notice, errMsg, inputCls, useDebounce,
} from "../lib/ui.js";

export default function CustomersPage() {
  const qc = useQueryClient();
  const [search, setSearch] = useState("");
  const debounced = useDebounce(search, 400);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<Row | null>(null);
  const [form, setForm] = useState({ fullName: "", phone: "", email: "", dob: "", gender: "", notes: "" });
  const [formError, setFormError] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ kind: "success" | "error"; text: string } | null>(null);

  const params = new URLSearchParams({ limit: "50" });
  if (debounced.trim()) params.set("search", debounced.trim());
  const customersQ = useQuery({
    queryKey: ["customers", debounced],
    queryFn: () => apiPage<Row>(`/api/v1/customers?${params.toString()}`).then((r) => r.items),
  });
  const detailQ = useQuery({
    queryKey: ["customer", selectedId],
    queryFn: () => get<Row>(`/api/v1/customers/${selectedId ?? ""}`),
    enabled: selectedId !== null,
  });
  const historyBookingsQ = useQuery({
    queryKey: ["customer-bookings", selectedId],
    queryFn: () => apiPage<Row>(`/api/v1/bookings?customer_id=${selectedId ?? ""}&limit=20`).then((r) => r.items),
    enabled: selectedId !== null,
  });
  const historyInvoicesQ = useQuery({
    queryKey: ["customer-invoices", selectedId],
    queryFn: () => apiPage<Row>(`/api/v1/invoices?customer_id=${selectedId ?? ""}&limit=20`).then((r) => r.items),
    enabled: selectedId !== null,
  });

  const saveMut = useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      editing ? patch<Row>(`/api/v1/customers/${idOf(editing)}`, body) : post<Row>("/api/v1/customers", body),
    onSuccess: () => {
      setNotice({ kind: "success", text: editing ? "Đã cập nhật khách hàng." : "Đã thêm khách hàng." });
      setShowForm(false); setEditing(null);
      setForm({ fullName: "", phone: "", email: "", dob: "", gender: "", notes: "" });
      void qc.invalidateQueries({ queryKey: ["customers"] });
    },
    onError: (err) => setNotice({ kind: "error", text: errMsg(err) }),
  });

  function startEdit(c: Row) {
    setEditing(c);
    setForm({
      fullName: s(c, "fullName", "full_name"),
      phone: s(c, "phone"),
      email: s(c, "email"),
      dob: s(c, "dob").slice(0, 10),
      gender: s(c, "gender"),
      notes: s(c, "notes"),
    });
    setShowForm(true);
    setFormError(null);
  }

  function submit() {
    setFormError(null);
    if (!form.fullName.trim()) return setFormError("Vui lòng nhập họ tên.");
    if (!form.phone.trim()) return setFormError("Vui lòng nhập số điện thoại.");
    saveMut.mutate({
      fullName: form.fullName.trim(),
      phone: form.phone.trim(),
      email: form.email.trim() || undefined,
      dob: form.dob || undefined,
      gender: form.gender || undefined,
      notes: form.notes.trim() || undefined,
    });
  }

  const customers = customersQ.data ?? [];
  const selected = detailQ.data ?? customers.find((c) => idOf(c) === selectedId) ?? null;

  return (
    <main className="space-y-4 p-4">
      <div className="flex items-center justify-between gap-2">
        <h1 className="text-xl font-bold">Khách hàng</h1>
        <button
          type="button"
          onClick={() => { setEditing(null); setForm({ fullName: "", phone: "", email: "", dob: "", gender: "", notes: "" }); setShowForm((v) => !v); }}
          className={btnPrimary}
        >
          {showForm ? "Đóng form" : "Thêm khách"}
        </button>
      </div>
      {notice ? <Notice kind={notice.kind} text={notice.text} onClose={() => setNotice(null)} /> : null}

      <Field label="Tìm khách theo tên / số điện thoại">
        <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="vd: Lan, 0901234567" className={inputCls} />
      </Field>

      {showForm ? (
        <Card title={editing ? "Sửa khách hàng" : "Thêm khách hàng"}>
          <div className="space-y-4">
            <Field label="Họ tên">
              <input value={form.fullName} onChange={(e) => setForm((f) => ({ ...f, fullName: e.target.value }))} placeholder="vd: Nguyễn Thị Lan" className={inputCls} />
            </Field>
            <Field label="Số điện thoại">
              <input type="tel" inputMode="tel" value={form.phone} onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))} placeholder="vd: 0901234567" className={inputCls} />
            </Field>
            <Field label="Email (không bắt buộc)">
              <input type="email" value={form.email} onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))} className={inputCls} />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Ngày sinh (không bắt buộc)">
                <input type="date" value={form.dob} onChange={(e) => setForm((f) => ({ ...f, dob: e.target.value }))} className={inputCls} />
              </Field>
              <Field label="Giới tính">
                <select value={form.gender} onChange={(e) => setForm((f) => ({ ...f, gender: e.target.value }))} className={inputCls}>
                  <option value="">—</option>
                  <option value="female">Nữ</option>
                  <option value="male">Nam</option>
                  <option value="other">Khác</option>
                </select>
              </Field>
            </div>
            <Field label="Ghi chú (không bắt buộc)">
              <textarea value={form.notes} onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))} rows={2} className="mt-1 w-full rounded-lg border border-[#E5E9ED] bg-white px-3 py-2 text-sm" />
            </Field>
            {formError ? <p role="alert" className="text-sm text-[#C0392B]">{formError}</p> : null}
            <button type="button" onClick={submit} disabled={saveMut.isPending} className={`${btnPrimary} w-full`}>
              {saveMut.isPending ? "Đang xử lý..." : editing ? "Lưu thay đổi" : "Thêm khách hàng"}
            </button>
          </div>
        </Card>
      ) : null}

      {customersQ.isLoading ? (
        <Loading />
      ) : customersQ.isError ? (
        <ErrorBox message={errMsg(customersQ.error)} onRetry={() => void customersQ.refetch()} />
      ) : customers.length === 0 ? (
        <Empty text={debounced ? "Không tìm thấy khách hàng nào." : "Chưa có khách hàng nào."} action={<button type="button" onClick={() => setShowForm(true)} className={btnPrimary}>Thêm khách hàng</button>} />
      ) : (
        <Card title={`${customers.length} khách hàng`}>
          <ul className="space-y-3">
            {customers.map((c) => (
              <li key={idOf(c)}>
                <button type="button" onClick={() => setSelectedId(idOf(c))} className="block w-full rounded-lg border border-[#E5E9ED] p-3 text-left">
                  <span className="block truncate text-sm font-medium">{s(c, "fullName", "full_name")}</span>
                  <span className="mt-1 block truncate text-xs text-[#748294]">{s(c, "phone")}{s(c, "email") ? ` · ${s(c, "email")}` : ""}</span>
                  <span className="mt-1 block text-sm tabular-nums">
                    Tổng chi tiêu: {formatVnd(n(c, "totalSpent", "total_spent"))} · {n(c, "totalVisits", "total_visits")} lần đến
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </Card>
      )}

      {selectedId && selected ? (
        <Card title="Chi tiết khách hàng">
          {detailQ.isLoading ? (
            <Loading />
          ) : (
            <>
              <dl className="space-y-2 text-sm">
                <div className="flex justify-between gap-2"><dt className="shrink-0 text-[#748294]">Họ tên</dt><dd className="min-w-0 break-words text-right font-medium">{s(selected, "fullName", "full_name")}</dd></div>
                <div className="flex justify-between gap-2"><dt className="shrink-0 text-[#748294]">SĐT</dt><dd className="text-right">{s(selected, "phone")}</dd></div>
                {s(selected, "email") ? <div className="flex justify-between gap-2"><dt className="shrink-0 text-[#748294]">Email</dt><dd className="min-w-0 break-all text-right">{s(selected, "email")}</dd></div> : null}
                {s(selected, "dob") ? <div className="flex justify-between gap-2"><dt className="shrink-0 text-[#748294]">Ngày sinh</dt><dd className="text-right">{formatDate(s(selected, "dob"))}</dd></div> : null}
                {s(selected, "gender") ? <div className="flex justify-between gap-2"><dt className="shrink-0 text-[#748294]">Giới tính</dt><dd className="text-right">{GENDER_LABEL[s(selected, "gender")] ?? s(selected, "gender")}</dd></div> : null}
                <div className="flex justify-between gap-2"><dt className="shrink-0 text-[#748294]">Tổng chi tiêu</dt><dd className="text-right tabular-nums">{formatVnd(n(selected, "totalSpent", "total_spent"))}</dd></div>
                <div className="flex justify-between gap-2"><dt className="shrink-0 text-[#748294]">Số lần đến</dt><dd className="text-right tabular-nums">{n(selected, "totalVisits", "total_visits")}</dd></div>
                {s(selected, "notes") ? <div className="flex justify-between gap-2"><dt className="shrink-0 text-[#748294]">Ghi chú</dt><dd className="min-w-0 break-words text-right">{s(selected, "notes")}</dd></div> : null}
              </dl>
              <div className="mt-3">
                <button type="button" onClick={() => startEdit(selected)} className={btnSecondary}>Sửa thông tin</button>
              </div>
              <div className="mt-4">
                <p className="text-sm font-medium">Lịch sử đặt lịch</p>
                {historyBookingsQ.isLoading ? <Loading /> : (historyBookingsQ.data ?? []).length === 0 ? (
                  <p className="mt-1 text-sm text-[#748294]">Chưa có lịch hẹn nào.</p>
                ) : (
                  <ul className="mt-1 space-y-1 text-sm">
                    {(historyBookingsQ.data ?? []).map((bk) => (
                      <li key={idOf(bk)} className="flex justify-between gap-2">
                        <span className="min-w-0 flex-1">{formatDateTime(s(bk, "startAt", "start_at"))}</span>
                        <span className="shrink-0"><Badge tone={badgeToneForStatus(s(bk, "status"))}>{BOOKING_STATUS_LABEL[s(bk, "status")] ?? s(bk, "status")}</Badge></span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
              <div className="mt-4">
                <p className="text-sm font-medium">Lịch sử hóa đơn</p>
                {historyInvoicesQ.isLoading ? <Loading /> : (historyInvoicesQ.data ?? []).length === 0 ? (
                  <p className="mt-1 text-sm text-[#748294]">Chưa có hóa đơn nào.</p>
                ) : (
                  <ul className="mt-1 space-y-1 text-sm">
                    {(historyInvoicesQ.data ?? []).map((inv) => (
                      <li key={idOf(inv)} className="flex justify-between gap-2">
                        <span className="min-w-0 flex-1">{formatDateTime(s(inv, "createdAt", "created_at"))}</span>
                        <span className="shrink-0 text-right tabular-nums">{formatVnd(n(inv, "totalVnd", "total_vnd"))} · {INVOICE_STATUS_LABEL[s(inv, "status")] ?? s(inv, "status")}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
              <button type="button" onClick={() => setSelectedId(null)} className={`${btnSecondary} mt-4 w-full sm:w-auto`}>Đóng chi tiết</button>
            </>
          )}
        </Card>
      ) : null}
    </main>
  );
}
