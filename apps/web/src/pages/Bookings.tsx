// Lịch hẹn — UX_FLOWS.md §2.2/§4: Calendar/List toggle, lọc ngày/chi nhánh/
// trạng thái/tìm kiếm, chi tiết + đổi trạng thái (chỉ chuyển đổi API cho phép,
// BOOKING_TRANSITIONS trong @quanly/shared), tạo lịch hẹn (tìm/tạo khách theo
// SĐT, nhiều dịch vụ, KTV hoặc "Hệ thống tự chọn"). Trùng lịch -> 409, hiện
// đúng thông báo server trả về. Calendar: xem theo ngày, nhóm theo giờ.
import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { BOOKING_TRANSITIONS } from "@quanly/shared";
import type { BookingStatus } from "@quanly/shared";
import { apiPage, formatDateTime, formatVnd, get, post, todayHcm } from "../lib/api.js";
import { BOOKING_STATUS_LABEL, arr, idOf, n, s } from "../lib/types.js";
import type { Row } from "../lib/types.js";
import {
  Badge, badgeToneForStatus, btnGhost, btnPrimary, btnSecondary, Card, Empty, ErrorBox,
  Field, Loading, Notice, btnDanger, errMsg, inputCls,
} from "../lib/ui.js";

const HOURS = [7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21];

function hourOf(iso: string): number {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return -1;
  return Number(new Intl.DateTimeFormat("vi-VN", { timeZone: "Asia/Ho_Chi_Minh", hour: "numeric", hour12: false }).format(d));
}

export default function BookingsPage() {
  const qc = useQueryClient();
  const [view, setView] = useState<"list" | "calendar">("list");
  const [date, setDate] = useState(todayHcm());
  const [branchId, setBranchId] = useState("");
  const [status, setStatus] = useState("");
  const [search, setSearch] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [notice, setNotice] = useState<{ kind: "success" | "error"; text: string } | null>(null);

  const branchesQ = useQuery({
    queryKey: ["branches"],
    queryFn: () => apiPage<Row>("/api/v1/branches?limit=100").then((r) => r.items),
  });
  const params = new URLSearchParams({ date, limit: "100" });
  if (branchId) params.set("branch_id", branchId);
  if (status) params.set("status", status);
  if (search.trim()) params.set("search", search.trim());
  const bookingsQ = useQuery({
    queryKey: ["bookings", date, branchId, status, search],
    queryFn: () => apiPage<Row>(`/api/v1/bookings?${params.toString()}`).then((r) => r.items),
  });
  const detailQ = useQuery({
    queryKey: ["booking", selectedId],
    queryFn: () => get<Row>(`/api/v1/bookings/${selectedId ?? ""}`),
    enabled: selectedId !== null,
  });

  const statusMut = useMutation({
    mutationFn: (toStatus: string) =>
      post<Row>(`/api/v1/bookings/${selectedId ?? ""}/status`, { toStatus, reason: null }),
    onSuccess: () => {
      setNotice({ kind: "success", text: "Đã cập nhật trạng thái lịch hẹn." });
      void qc.invalidateQueries({ queryKey: ["bookings"] });
      void qc.invalidateQueries({ queryKey: ["booking", selectedId] });
    },
    onError: (err) => setNotice({ kind: "error", text: errMsg(err) }),
  });

  const bookings = bookingsQ.data ?? [];
  const byHour = useMemo(() => {
    const map = new Map<number, Row[]>();
    for (const bk of bookings) {
      const h = hourOf(s(bk, "startAt", "start_at"));
      if (h < 0) continue;
      const list = map.get(h) ?? [];
      list.push(bk);
      map.set(h, list);
    }
    return map;
  }, [bookings]);

  const selected = detailQ.data ?? bookings.find((b) => idOf(b) === selectedId) ?? null;
  const currentStatus = s(selected, "status") as BookingStatus;
  const allowed = currentStatus && (BOOKING_TRANSITIONS as Record<string, readonly string[]>)[currentStatus]
    ? ((BOOKING_TRANSITIONS as Record<string, readonly string[]>)[currentStatus] as readonly string[])
    : [];

  return (
    <main className="space-y-4 p-4">
      <div className="flex items-center justify-between gap-2">
        <h1 className="text-xl font-bold">Lịch hẹn</h1>
        <button type="button" onClick={() => setShowCreate((v) => !v)} className={btnPrimary}>
          {showCreate ? "Đóng form" : "Tạo lịch hẹn"}
        </button>
      </div>
      {notice ? <Notice kind={notice.kind} text={notice.text} onClose={() => setNotice(null)} /> : null}
      {showCreate ? (
        <CreateBookingForm
          branches={branchesQ.data ?? []}
          onDone={(msg) => {
            setNotice({ kind: "success", text: msg });
            setShowCreate(false);
            void qc.invalidateQueries({ queryKey: ["bookings"] });
          }}
          onError={(msg) => setNotice({ kind: "error", text: msg })}
        />
      ) : null}

      <div className="flex gap-2">
        <button type="button" onClick={() => setView("list")} className={view === "list" ? btnPrimary : btnSecondary}>Danh sách</button>
        <button type="button" onClick={() => setView("calendar")} className={view === "calendar" ? btnPrimary : btnSecondary}>Lịch ngày</button>
      </div>

      <Card>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Ngày">
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className={inputCls} />
          </Field>
          <Field label="Chi nhánh">
            <select value={branchId} onChange={(e) => setBranchId(e.target.value)} className={inputCls}>
              <option value="">Tất cả chi nhánh</option>
              {(branchesQ.data ?? []).map((b) => (
                <option key={idOf(b)} value={idOf(b)}>{s(b, "name")}</option>
              ))}
            </select>
          </Field>
          <Field label="Trạng thái">
            <select value={status} onChange={(e) => setStatus(e.target.value)} className={inputCls}>
              <option value="">Tất cả trạng thái</option>
              {Object.entries(BOOKING_STATUS_LABEL).map(([v, l]) => (
                <option key={v} value={v}>{l}</option>
              ))}
            </select>
          </Field>
          <Field label="Tìm kiếm (tên / SĐT)">
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="vd: Lan, 090..." className={inputCls} />
          </Field>
        </div>
      </Card>

      {bookingsQ.isLoading ? (
        <Loading />
      ) : bookingsQ.isError ? (
        <ErrorBox message={errMsg(bookingsQ.error)} onRetry={() => void bookingsQ.refetch()} />
      ) : view === "calendar" ? (
        <Card title={`Lịch ngày ${date}`}>
          {bookings.length === 0 ? (
            <Empty text="Chưa có lịch hẹn trong ngày này." />
          ) : (
            <ul className="space-y-2">
              {HOURS.map((h) => {
                const items = byHour.get(h) ?? [];
                if (items.length === 0) return null;
                return (
                  <li key={h}>
                    <p className="text-xs font-semibold text-[#748294]">{h}:00</p>
                    {items.map((bk) => (
                      <button key={idOf(bk)} type="button" onClick={() => setSelectedId(idOf(bk))} className="mt-1 block w-full rounded-lg border border-[#E5E9ED] bg-white p-3 text-left">
                        <span className="text-sm font-medium">{s(bk, "customerName", "customer_name") || "Khách hàng"}</span>{" "}
                        <Badge tone={badgeToneForStatus(s(bk, "status"))}>{BOOKING_STATUS_LABEL[s(bk, "status")] ?? s(bk, "status")}</Badge>
                        <span className="block text-xs text-[#748294]">{formatDateTime(s(bk, "startAt", "start_at"))}</span>
                      </button>
                    ))}
                  </li>
                );
              })}
            </ul>
          )}
        </Card>
      ) : bookings.length === 0 ? (
        <Empty
          text="Chưa có lịch hẹn nào khớp bộ lọc."
          action={<button type="button" onClick={() => setShowCreate(true)} className={btnPrimary}>Tạo lịch hẹn</button>}
        />
      ) : (
        <Card title={`${bookings.length} lịch hẹn`}>
          <ul className="space-y-3">
            {bookings.map((bk) => (
              <li key={idOf(bk)}>
                <button type="button" onClick={() => setSelectedId(idOf(bk))} className="block w-full rounded-lg border border-[#E5E9ED] p-3 text-left">
                  <span className="flex items-center justify-between gap-2">
                    <span className="text-sm font-medium">{s(bk, "customerName", "customer_name") || "Khách hàng"}</span>
                    <Badge tone={badgeToneForStatus(s(bk, "status"))}>{BOOKING_STATUS_LABEL[s(bk, "status")] ?? s(bk, "status")}</Badge>
                  </span>
                  <span className="mt-1 block text-xs text-[#748294]">
                    {formatDateTime(s(bk, "startAt", "start_at"))}
                    {s(bk, "technicianName", "technician_name") ? ` · KTV: ${s(bk, "technicianName", "technician_name")}` : ""}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </Card>
      )}

      {selectedId && selected ? (
        <Card title="Chi tiết lịch hẹn">
          {detailQ.isLoading ? (
            <Loading />
          ) : (
            <>
              <dl className="space-y-2 text-sm">
                <div className="flex justify-between gap-2"><dt className="text-[#748294]">Khách hàng</dt><dd className="font-medium">{s(selected, "customerName", "customer_name") || "—"}</dd></div>
                <div className="flex justify-between gap-2"><dt className="text-[#748294]">SĐT</dt><dd>{s(selected, "customerPhone", "customer_phone") || "—"}</dd></div>
                <div className="flex justify-between gap-2"><dt className="text-[#748294]">Bắt đầu</dt><dd>{formatDateTime(s(selected, "startAt", "start_at"))}</dd></div>
                <div className="flex justify-between gap-2"><dt className="text-[#748294]">Kết thúc</dt><dd>{formatDateTime(s(selected, "endAt", "end_at"))}</dd></div>
                <div className="flex justify-between gap-2"><dt className="text-[#748294]">Kỹ thuật viên</dt><dd>{s(selected, "technicianName", "technician_name") || "Hệ thống tự chọn"}</dd></div>
                <div className="flex justify-between gap-2"><dt className="text-[#748294]">Trạng thái</dt><dd><Badge tone={badgeToneForStatus(currentStatus)}>{BOOKING_STATUS_LABEL[currentStatus] ?? currentStatus}</Badge></dd></div>
                {s(selected, "notes") ? (
                  <div className="flex justify-between gap-2"><dt className="text-[#748294]">Ghi chú</dt><dd>{s(selected, "notes")}</dd></div>
                ) : null}
              </dl>
              <div className="mt-3">
                <p className="text-sm font-medium">Dịch vụ</p>
                {arr(selected, "items", "services").length === 0 ? (
                  <p className="mt-1 text-sm text-[#748294]">Chưa có thông tin dịch vụ.</p>
                ) : (
                  <ul className="mt-1 space-y-1 text-sm">
                    {arr(selected, "items", "services").map((it, i) => (
                      <li key={i} className="flex justify-between gap-2">
                        <span>{s(it, "serviceName", "name")}</span>
                        <span>{n(it, "priceVnd", "price_vnd") > 0 ? formatVnd(n(it, "priceVnd", "price_vnd")) : ""}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
              {allowed.length > 0 ? (
                <div className="mt-4 flex flex-wrap gap-2">
                  {allowed.map((to) => (
                    <button
                      key={to}
                      type="button"
                      disabled={statusMut.isPending}
                      onClick={() => {
                        if (to === "cancelled" && !window.confirm("Hủy lịch hẹn này?")) return;
                        statusMut.mutate(to);
                      }}
                      className={to === "cancelled" ? btnDanger : btnSecondary}
                    >
                      {to === "cancelled" ? "Hủy lịch" : `Chuyển: ${BOOKING_STATUS_LABEL[to] ?? to}`}
                    </button>
                  ))}
                </div>
              ) : (
                <p className="mt-4 text-xs text-[#748294]">Lịch hẹn ở trạng thái cuối, không còn chuyển đổi được.</p>
              )}
              <button type="button" onClick={() => setSelectedId(null)} className={`${btnGhost} mt-2`}>Đóng chi tiết</button>
            </>
          )}
        </Card>
      ) : null}
    </main>
  );
}

function CreateBookingForm({
  branches, onDone, onError,
}: {
  branches: Row[];
  onDone: (msg: string) => void;
  onError: (msg: string) => void;
}) {
  const [branchId, setBranchId] = useState("");
  const [phone, setPhone] = useState("");
  const [fullName, setFullName] = useState("");
  const [serviceIds, setServiceIds] = useState<string[]>([]);
  const [technicianId, setTechnicianId] = useState("");
  const [date, setDate] = useState(todayHcm());
  const [time, setTime] = useState("09:00");
  const [notes, setNotes] = useState("");
  const [formError, setFormError] = useState<string | null>(null);
  const [foundCustomer, setFoundCustomer] = useState<Row | null>(null);

  const servicesQ = useQuery({
    queryKey: ["services", "active"],
    queryFn: () => apiPage<Row>("/api/v1/services?status=active&limit=100").then((r) => r.items),
  });
  const staffQ = useQuery({
    queryKey: ["employees", branchId],
    queryFn: () => apiPage<Row>(`/api/v1/employees?branch_id=${branchId}&limit=100`).then((r) => r.items),
    enabled: branchId !== "",
  });
  const createMut = useMutation({
    mutationFn: (body: Record<string, unknown>) => post<Row>("/api/v1/bookings", body),
    onSuccess: () => onDone("Đã tạo lịch hẹn."),
    onError: (err) => onError(errMsg(err)),
  });

  async function lookupCustomer() {
    if (!phone.trim()) return;
    try {
      const res = await apiPage<Row>(`/api/v1/customers?search=${encodeURIComponent(phone.trim())}&limit=5`);
      const match = res.items.find((c) => s(c, "phone") === phone.trim()) ?? res.items[0];
      if (match) {
        setFoundCustomer(match);
        setFullName(s(match, "fullName", "full_name"));
      } else {
        setFoundCustomer(null);
      }
    } catch (err) {
      onError(errMsg(err));
    }
  }

  function submit() {
    setFormError(null);
    if (!branchId) return setFormError("Vui lòng chọn chi nhánh.");
    if (!phone.trim()) return setFormError("Vui lòng nhập số điện thoại khách.");
    if (!foundCustomer && !fullName.trim()) return setFormError("Khách mới: vui lòng nhập họ tên.");
    if (serviceIds.length === 0) return setFormError("Vui lòng chọn ít nhất 1 dịch vụ.");
    if (!date || !time) return setFormError("Vui lòng chọn ngày và giờ.");
    const startAt = new Date(`${date}T${time}:00`).toISOString();
    createMut.mutate({
      branchId,
      customerId: foundCustomer ? idOf(foundCustomer) : undefined,
      customerNew: foundCustomer ? undefined : { fullName: fullName.trim(), phone: phone.trim() },
      serviceIds,
      technicianId: technicianId || null,
      startAt,
      notes: notes.trim() || undefined,
      source: "internal",
    });
  }

  const services = servicesQ.data ?? [];
  return (
    <Card title="Tạo lịch hẹn mới">
      <div className="space-y-4">
        <Field label="Chi nhánh" error={!branchId && formError ? "Chọn chi nhánh." : undefined}>
          <select value={branchId} onChange={(e) => setBranchId(e.target.value)} className={inputCls}>
            <option value="">— Chọn chi nhánh —</option>
            {branches.map((b) => (
              <option key={idOf(b)} value={idOf(b)}>{s(b, "name")}</option>
            ))}
          </select>
        </Field>
        <div className="grid grid-cols-[1fr_auto] items-end gap-2">
          <Field label="Số điện thoại khách">
            <input type="tel" inputMode="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="vd: 0901234567" className={inputCls} />
          </Field>
          <button type="button" onClick={() => void lookupCustomer()} className={btnSecondary}>Tìm khách</button>
        </div>
        {foundCustomer ? (
          <p className="text-sm text-[#2E7D5B]">Đã tìm thấy khách: {s(foundCustomer, "fullName", "full_name")}.</p>
        ) : (
          <Field label="Họ tên khách (khách mới)">
            <input value={fullName} onChange={(e) => setFullName(e.target.value)} placeholder="vd: Nguyễn Thị Lan" className={inputCls} />
          </Field>
        )}
        <Field label="Dịch vụ (chọn nhiều)">
          {servicesQ.isLoading ? <Loading /> : services.length === 0 ? (
            <p className="text-sm text-[#748294]">Chưa có dịch vụ nào. Tạo dịch vụ ở mục Dịch vụ trước.</p>
          ) : (
            <ul className="space-y-2">
              {services.map((sv) => (
                <li key={idOf(sv)}>
                  <label className="flex min-h-[44px] items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={serviceIds.includes(idOf(sv))}
                      onChange={(e) =>
                        setServiceIds((prev) => (e.target.checked ? [...prev, idOf(sv)] : prev.filter((x) => x !== idOf(sv))))
                      }
                    />
                    <span className="flex-1">{s(sv, "name")}</span>
                    <span className="text-[#748294]">{formatVnd(n(sv, "priceVnd", "price_vnd"))} · {n(sv, "durationMinutes", "duration_minutes")} phút</span>
                  </label>
                </li>
              ))}
            </ul>
          )}
        </Field>
        <Field label="Kỹ thuật viên">
          <select value={technicianId} onChange={(e) => setTechnicianId(e.target.value)} className={inputCls} disabled={!branchId}>
            <option value="">Hệ thống tự chọn</option>
            {(staffQ.data ?? []).map((e) => (
              <option key={idOf(e)} value={idOf(e)}>{s(e, "fullName", "full_name")}{s(e, "position") ? ` — ${s(e, "position")}` : ""}</option>
            ))}
          </select>
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Ngày">
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className={inputCls} />
          </Field>
          <Field label="Giờ">
            <input type="time" value={time} onChange={(e) => setTime(e.target.value)} className={inputCls} />
          </Field>
        </div>
        <Field label="Ghi chú (không bắt buộc)">
          <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} className="mt-1 w-full rounded-lg border border-[#E5E9ED] bg-white px-3 py-2 text-sm" />
        </Field>
        {formError ? <p role="alert" className="text-sm text-[#C0392B]">{formError}</p> : null}
        <button type="button" onClick={submit} disabled={createMut.isPending} className={btnPrimary}>
          {createMut.isPending ? "Đang xử lý..." : "Xác nhận tạo lịch hẹn"}
        </button>
      </div>
    </Card>
  );
}
