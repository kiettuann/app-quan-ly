// Bán hàng / POS — UX_FLOWS.md §2.3/§5: danh sách hóa đơn, tạo hóa đơn
// (khách + dòng dịch vụ/sản phẩm + giảm giá/phụ phí), tổng tiền CHỈ lấy từ
// server trả về, thu tiền, hoàn tiền, tạo hóa đơn từ lịch hoàn thành.
// Nút "Thu tiền cọc" chỉ hiện "Sắp ra mắt", không làm gì khác.
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiPage, formatDateTime, formatVnd, get, post } from "../lib/api.js";
import { INVOICE_STATUS_LABEL, arr, idOf, n, s } from "../lib/types.js";
import type { Row } from "../lib/types.js";
import {
  Badge, badgeToneForStatus, btnDanger, btnPrimary, btnSecondary, Card, Empty, ErrorBox,
  Field, Loading, Notice, errMsg, inputCls,
} from "../lib/ui.js";

interface Line {
  itemType: "service" | "product";
  refId: string;
  name: string;
  quantity: number;
  technicianId: string;
}

export default function SalesPage() {
  const qc = useQueryClient();
  const [status, setStatus] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [notice, setNotice] = useState<{ kind: "success" | "error" | "info"; text: string } | null>(null);

  const params = new URLSearchParams({ limit: "50" });
  if (status) params.set("status", status);
  const invoicesQ = useQuery({
    queryKey: ["invoices", status],
    queryFn: () => apiPage<Row>(`/api/v1/invoices?${params.toString()}`).then((r) => r.items),
  });
  const detailQ = useQuery({
    queryKey: ["invoice", selectedId],
    queryFn: () => get<Row>(`/api/v1/invoices/${selectedId ?? ""}`),
    enabled: selectedId !== null,
  });
  const completedQ = useQuery({
    queryKey: ["bookings", "completed-no-invoice"],
    queryFn: () => apiPage<Row>("/api/v1/bookings?status=completed&limit=50").then((r) => r.items),
    enabled: showCreate,
  });
  const fromBookingMut = useMutation({
    mutationFn: (bookingId: string) => post<Row>(`/api/v1/bookings/${bookingId}/create-invoice`, {}),
    onSuccess: (data) => {
      setNotice({ kind: "success", text: "Đã tạo hóa đơn từ lịch hẹn." });
      setSelectedId(idOf(data as Row));
      void qc.invalidateQueries({ queryKey: ["invoices"] });
    },
    onError: (err) => setNotice({ kind: "error", text: errMsg(err) }),
  });

  const invoices = invoicesQ.data ?? [];
  const selected = detailQ.data ?? invoices.find((i) => idOf(i) === selectedId) ?? null;

  return (
    <main className="space-y-4 p-4">
      <div className="flex items-center justify-between gap-2">
        <h1 className="text-xl font-bold">Bán hàng</h1>
        <button type="button" onClick={() => setShowCreate((v) => !v)} className={btnPrimary}>
          {showCreate ? "Đóng form" : "Tạo hóa đơn"}
        </button>
      </div>
      {notice ? <Notice kind={notice.kind} text={notice.text} onClose={() => setNotice(null)} /> : null}

      <button
        type="button"
        onClick={() => setNotice({ kind: "info", text: "Tính năng đặt cọc / thanh toán online sắp ra mắt." })}
        className={`${btnSecondary} w-full sm:w-auto`}
      >
        Thu tiền cọc
      </button>

      {showCreate ? (
        <CreateInvoiceForm
          completedBookings={completedQ.data ?? []}
          completedLoading={completedQ.isLoading}
          onFromBooking={(id) => fromBookingMut.mutate(id)}
          fromBookingPending={fromBookingMut.isPending}
          onDone={(inv) => {
            setNotice({ kind: "success", text: `Đã tạo hóa đơn. Tổng tiền: ${formatVnd(n(inv, "totalVnd", "total_vnd"))} (theo máy chủ).` });
            setSelectedId(idOf(inv));
            setShowCreate(false);
            void qc.invalidateQueries({ queryKey: ["invoices"] });
          }}
          onError={(msg) => setNotice({ kind: "error", text: msg })}
        />
      ) : null}

      <Field label="Lọc theo trạng thái">
        <select value={status} onChange={(e) => setStatus(e.target.value)} className={inputCls}>
          <option value="">Tất cả trạng thái</option>
          {Object.entries(INVOICE_STATUS_LABEL).map(([v, l]) => (
            <option key={v} value={v}>{l}</option>
          ))}
        </select>
      </Field>

      {invoicesQ.isLoading ? (
        <Loading />
      ) : invoicesQ.isError ? (
        <ErrorBox message={errMsg(invoicesQ.error)} onRetry={() => void invoicesQ.refetch()} />
      ) : invoices.length === 0 ? (
        <Empty text="Chưa có hóa đơn nào." action={<button type="button" onClick={() => setShowCreate(true)} className={btnPrimary}>Tạo hóa đơn</button>} />
      ) : (
        <Card title={`${invoices.length} hóa đơn`}>
          <ul className="space-y-3">
            {invoices.map((inv) => (
              <li key={idOf(inv)}>
                <button type="button" onClick={() => setSelectedId(idOf(inv))} className="block w-full rounded-lg border border-[#E5E9ED] p-3 text-left">
                  <span className="flex items-center justify-between gap-2">
                    <span className="min-w-0 flex-1 truncate text-sm font-medium">{s(inv, "invoiceNumber", "invoice_number", "code") || `Hóa đơn ${idOf(inv).slice(0, 8)}`}</span>
                    <span className="shrink-0">
                      <Badge tone={badgeToneForStatus(s(inv, "status"))}>{INVOICE_STATUS_LABEL[s(inv, "status")] ?? s(inv, "status")}</Badge>
                    </span>
                  </span>
                  <span className="mt-1 block text-xs text-[#748294]">
                    {formatDateTime(s(inv, "createdAt", "created_at"))} · {s(inv, "customerName", "customer_name") || "Khách lẻ"}
                  </span>
                  <span className="mt-1 block text-sm font-semibold tabular-nums text-[#244B70]">
                    {formatVnd(n(inv, "totalVnd", "total_vnd"))} · Đã thu {formatVnd(n(inv, "paidVnd", "paid_vnd"))}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </Card>
      )}

      {selectedId && selected ? (
        <InvoiceDetail
          invoice={selected}
          loading={detailQ.isLoading}
          onClose={() => setSelectedId(null)}
          onChanged={(msg, kind) => {
            setNotice({ kind, text: msg });
            void qc.invalidateQueries({ queryKey: ["invoices"] });
            void qc.invalidateQueries({ queryKey: ["invoice", selectedId] });
          }}
        />
      ) : null}
    </main>
  );
}

function InvoiceDetail({
  invoice, loading, onClose, onChanged,
}: {
  invoice: Row;
  loading: boolean;
  onClose: () => void;
  onChanged: (msg: string, kind: "success" | "error") => void;
}) {
  const [payAmount, setPayAmount] = useState("");
  const [payMethod, setPayMethod] = useState<"cash" | "bank_transfer">("cash");
  const [refundAmount, setRefundAmount] = useState("");
  const [refundReason, setRefundReason] = useState("");
  const [payError, setPayError] = useState<string | null>(null);
  const [refundError, setRefundError] = useState<string | null>(null);

  const payMut = useMutation({
    mutationFn: () => post<Row>(`/api/v1/invoices/${idOf(invoice)}/payments`, { amountVnd: Number(payAmount), method: payMethod }),
    onSuccess: () => { onChanged("Đã ghi nhận thanh toán.", "success"); setPayAmount(""); },
    onError: (err) => setPayError(errMsg(err)),
  });
  const refundMut = useMutation({
    mutationFn: () => post<Row>(`/api/v1/invoices/${idOf(invoice)}/refunds`, { amountVnd: Number(refundAmount), reason: refundReason.trim() }),
    onSuccess: () => { onChanged("Đã ghi nhận hoàn tiền.", "success"); setRefundAmount(""); setRefundReason(""); },
    onError: (err) => setRefundError(errMsg(err)),
  });

  if (loading) return <Card title="Chi tiết hóa đơn"><Loading /></Card>;
  const items = arr(invoice, "items");
  const payments = arr(invoice, "payments");
  const total = n(invoice, "totalVnd", "total_vnd");
  const paid = n(invoice, "paidVnd", "paid_vnd");
  const refunded = n(invoice, "refundedVnd", "refunded_vnd");
  const remaining = total - paid;
  const isPaid = s(invoice, "status") === "paid";

  return (
    <Card title={`Hóa đơn ${s(invoice, "invoiceNumber", "invoice_number", "code") || idOf(invoice).slice(0, 8)}`}>
      <dl className="space-y-2 text-sm">
        <div className="flex justify-between gap-2"><dt className="shrink-0 text-[#748294]">Khách hàng</dt><dd className="min-w-0 break-words text-right font-medium">{s(invoice, "customerName", "customer_name") || "Khách lẻ"}</dd></div>
        <div className="flex justify-between gap-2"><dt className="shrink-0 text-[#748294]">Ngày tạo</dt><dd className="text-right">{formatDateTime(s(invoice, "createdAt", "created_at"))}</dd></div>
        <div className="flex justify-between gap-2"><dt className="shrink-0 text-[#748294]">Trạng thái</dt><dd className="shrink-0"><Badge tone={badgeToneForStatus(s(invoice, "status"))}>{INVOICE_STATUS_LABEL[s(invoice, "status")] ?? s(invoice, "status")}</Badge></dd></div>
      </dl>
      <p className="mt-3 text-sm font-medium">Dòng hóa đơn</p>
      {items.length === 0 ? (
        <p className="mt-1 text-sm text-[#748294]">Chưa có dòng nào.</p>
      ) : (
        <ul className="mt-1 space-y-1 text-sm">
          {items.map((it, i) => (
            <li key={i} className="flex justify-between gap-2">
              <span className="min-w-0 flex-1 truncate">{s(it, "name")} × {n(it, "quantity")}</span>
              <span className="shrink-0 tabular-nums">{formatVnd(n(it, "unitPriceVnd", "unit_price_vnd") * n(it, "quantity"))}</span>
            </li>
          ))}
        </ul>
      )}
      <dl className="mt-3 space-y-1 border-t border-[#E5E9ED] pt-3 text-sm tabular-nums">
        <div className="flex justify-between gap-2"><dt className="shrink-0 text-[#748294]">Tạm tính</dt><dd className="text-right">{formatVnd(n(invoice, "subtotalVnd", "subtotal_vnd"))}</dd></div>
        <div className="flex justify-between gap-2"><dt className="shrink-0 text-[#748294]">Giảm giá</dt><dd className="text-right">−{formatVnd(n(invoice, "discountVnd", "discount_vnd"))}</dd></div>
        <div className="flex justify-between gap-2"><dt className="shrink-0 text-[#748294]">Phụ phí</dt><dd className="text-right">+{formatVnd(n(invoice, "surchargeVnd", "surcharge_vnd"))}</dd></div>
        <div className="flex justify-between gap-2 font-semibold"><dt className="shrink-0">Tổng tiền (theo máy chủ)</dt><dd className="text-right">{formatVnd(total)}</dd></div>
        <div className="flex justify-between gap-2"><dt className="shrink-0 text-[#748294]">Đã thu</dt><dd className="text-right">{formatVnd(paid)}</dd></div>
        {refunded > 0 ? <div className="flex justify-between gap-2"><dt className="shrink-0 text-[#748294]">Đã hoàn</dt><dd className="text-right">{formatVnd(refunded)}</dd></div> : null}
        <div className="flex justify-between gap-2 font-semibold text-[#244B70]"><dt className="shrink-0">Còn lại</dt><dd className="text-right">{formatVnd(Math.max(0, remaining))}</dd></div>
      </dl>
      {payments.length > 0 ? (
        <>
          <p className="mt-3 text-sm font-medium">Lịch sử thanh toán</p>
          <ul className="mt-1 space-y-1 text-sm text-[#748294]">
            {payments.map((p, i) => (
              <li key={i} className="flex justify-between gap-2">
                <span className="min-w-0 flex-1">{formatDateTime(s(p, "createdAt", "created_at"))} · {s(p, "method") === "bank_transfer" ? "Chuyển khoản" : "Tiền mặt"}</span>
                <span className="shrink-0 tabular-nums">{formatVnd(n(p, "amountVnd", "amount_vnd"))}</span>
              </li>
            ))}
          </ul>
        </>
      ) : null}

      {!isPaid && remaining > 0 ? (
        <div className="mt-4 space-y-3 border-t border-[#E5E9ED] pt-4">
          <p className="text-sm font-medium">Thu tiền</p>
          <Field label="Số tiền (VND)" error={payError ?? undefined}>
            <input type="number" inputMode="numeric" min={1} value={payAmount} onChange={(e) => setPayAmount(e.target.value)} placeholder={`Tối đa ${remaining}`} className={inputCls} />
          </Field>
          <Field label="Phương thức">
            <select value={payMethod} onChange={(e) => setPayMethod(e.target.value as "cash" | "bank_transfer")} className={inputCls}>
              <option value="cash">Tiền mặt</option>
              <option value="bank_transfer">Chuyển khoản</option>
            </select>
          </Field>
          <button
            type="button"
            disabled={payMut.isPending || !payAmount || Number(payAmount) <= 0}
            onClick={() => { setPayError(null); payMut.mutate(); }}
            className={`${btnPrimary} w-full`}
          >
            {payMut.isPending ? "Đang xử lý..." : "Thu tiền"}
          </button>
        </div>
      ) : null}

      {paid > 0 ? (
        <div className="mt-4 space-y-3 border-t border-[#E5E9ED] pt-4">
          <p className="text-sm font-medium">Hoàn tiền</p>
          <Field label="Số tiền hoàn (VND)" error={refundError ?? undefined}>
            <input type="number" inputMode="numeric" min={1} value={refundAmount} onChange={(e) => setRefundAmount(e.target.value)} placeholder={`Tối đa ${paid - refunded}`} className={inputCls} />
          </Field>
          <Field label="Lý do hoàn tiền">
            <input value={refundReason} onChange={(e) => setRefundReason(e.target.value)} placeholder="vd: Khách không hài lòng với dịch vụ" className={inputCls} />
          </Field>
          <button
            type="button"
            disabled={refundMut.isPending || !refundAmount || Number(refundAmount) <= 0 || !refundReason.trim()}
            onClick={() => {
              if (!window.confirm("Xác nhận hoàn tiền cho hóa đơn này?")) return;
              setRefundError(null);
              refundMut.mutate();
            }}
            className={`${btnDanger} w-full`}
          >
            {refundMut.isPending ? "Đang xử lý..." : "Hoàn tiền"}
          </button>
        </div>
      ) : null}
      <button type="button" onClick={onClose} className={`${btnSecondary} mt-4 w-full sm:w-auto`}>Đóng chi tiết</button>
    </Card>
  );
}

function CreateInvoiceForm({
  completedBookings, completedLoading, onFromBooking, fromBookingPending, onDone, onError,
}: {
  completedBookings: Row[];
  completedLoading: boolean;
  onFromBooking: (id: string) => void;
  fromBookingPending: boolean;
  onDone: (inv: Row) => void;
  onError: (msg: string) => void;
}) {
  const [branchId, setBranchId] = useState("");
  const [customerId, setCustomerId] = useState("");
  const [search, setSearch] = useState("");
  const [lines, setLines] = useState<Line[]>([]);
  const [discount, setDiscount] = useState("");
  const [surcharge, setSurcharge] = useState("");
  const [formError, setFormError] = useState<string | null>(null);
  const [pickType, setPickType] = useState<"service" | "product">("service");
  const [pickId, setPickId] = useState("");
  const [pickQty, setPickQty] = useState("1");

  const branchesQ = useQuery({
    queryKey: ["branches"],
    queryFn: () => apiPage<Row>("/api/v1/branches?limit=100").then((r) => r.items),
  });
  const customersQ = useQuery({
    queryKey: ["customers", "pos", search],
    queryFn: () => apiPage<Row>(`/api/v1/customers?search=${encodeURIComponent(search)}&limit=20`).then((r) => r.items),
    enabled: search.trim().length >= 2,
  });
  const servicesQ = useQuery({
    queryKey: ["services", "pos"],
    queryFn: () => apiPage<Row>("/api/v1/services?status=active&limit=100").then((r) => r.items),
  });
  const productsQ = useQuery({
    queryKey: ["products", "pos"],
    queryFn: () => apiPage<Row>("/api/v1/products?status=active&limit=100").then((r) => r.items),
  });
  const createMut = useMutation({
    mutationFn: (body: Record<string, unknown>) => post<Row>("/api/v1/invoices", body),
    onSuccess: (data) => onDone(data),
    onError: (err) => onError(errMsg(err)),
  });

  function addLine() {
    const source = pickType === "service" ? (servicesQ.data ?? []) : (productsQ.data ?? []);
    const item = source.find((x) => idOf(x) === pickId);
    if (!item) return setFormError("Vui lòng chọn dịch vụ hoặc sản phẩm.");
    const qty = Number(pickQty);
    if (!Number.isInteger(qty) || qty < 1) return setFormError("Số lượng phải là số nguyên từ 1 trở lên.");
    setLines((prev) => [...prev, { itemType: pickType, refId: idOf(item), name: s(item, "name"), quantity: qty, technicianId: "" }]);
    setPickId("");
    setFormError(null);
  }

  function submit() {
    setFormError(null);
    if (!branchId) return setFormError("Vui lòng chọn chi nhánh.");
    if (lines.length === 0) return setFormError("Hóa đơn phải có ít nhất 1 dòng.");
    createMut.mutate({
      branchId,
      customerId: customerId || undefined,
      items: lines.map((l) => ({
        itemType: l.itemType,
        refId: l.refId,
        name: l.name,
        quantity: l.quantity,
        technicianId: l.technicianId || undefined,
      })),
      discountVnd: discount ? Number(discount) : 0,
      surchargeVnd: surcharge ? Number(surcharge) : 0,
    });
  }

  return (
    <Card title="Tạo hóa đơn">
      <div className="space-y-4">
        <div>
          <p className="text-sm font-medium">Tạo hóa đơn từ lịch hoàn thành</p>
          {completedLoading ? (
            <Loading />
          ) : completedBookings.length === 0 ? (
            <p className="mt-1 text-sm text-[#748294]">Chưa có lịch hẹn nào hoàn thành chờ tạo hóa đơn.</p>
          ) : (
            <ul className="mt-2 space-y-2">
              {completedBookings.map((bk) => (
                <li key={idOf(bk)} className="flex items-center justify-between gap-2 rounded-lg border border-[#E5E9ED] p-3">
                  <span className="min-w-0 flex-1 truncate text-sm">
                    {s(bk, "customerName", "customer_name") || "Khách hàng"} · {formatDateTime(s(bk, "startAt", "start_at"))}
                  </span>
                  <button type="button" disabled={fromBookingPending} onClick={() => onFromBooking(idOf(bk))} className={`${btnSecondary} shrink-0`}>
                    Tạo hóa đơn
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
        <Field label="Chi nhánh">
          <select value={branchId} onChange={(e) => setBranchId(e.target.value)} className={inputCls}>
            <option value="">— Chọn chi nhánh —</option>
            {(branchesQ.data ?? []).map((b) => (
              <option key={idOf(b)} value={idOf(b)}>{s(b, "name")}</option>
            ))}
          </select>
        </Field>
        <Field label="Khách hàng (tìm theo tên / SĐT, không bắt buộc)">
          <input value={search} onChange={(e) => { setSearch(e.target.value); setCustomerId(""); }} placeholder="Nhập ít nhất 2 ký tự để tìm" className={inputCls} />
          {customersQ.data && customersQ.data.length > 0 ? (
            <select value={customerId} onChange={(e) => setCustomerId(e.target.value)} className={inputCls}>
              <option value="">— Khách lẻ —</option>
              {customersQ.data.map((c) => (
                <option key={idOf(c)} value={idOf(c)}>{s(c, "fullName", "full_name")} · {s(c, "phone")}</option>
              ))}
            </select>
          ) : null}
        </Field>
        <div>
          <p className="text-sm font-medium">Thêm dòng</p>
          <div className="mt-1 grid grid-cols-2 gap-2">
            <select value={pickType} onChange={(e) => { setPickType(e.target.value as "service" | "product"); setPickId(""); }} className={`${inputCls} min-w-0`}>
              <option value="service">Dịch vụ</option>
              <option value="product">Sản phẩm</option>
            </select>
            <select value={pickId} onChange={(e) => setPickId(e.target.value)} className={`${inputCls} min-w-0`}>
              <option value="">— Chọn —</option>
              {(pickType === "service" ? (servicesQ.data ?? []) : (productsQ.data ?? [])).map((x) => (
                <option key={idOf(x)} value={idOf(x)}>
                  {s(x, "name")} · {formatVnd(n(x, pickType === "service" ? "priceVnd" : "sellPriceVnd", pickType === "service" ? "price_vnd" : "sell_price_vnd"))}
                </option>
              ))}
            </select>
          </div>
          <div className="mt-2 flex gap-2">
            <input type="number" inputMode="numeric" min={1} value={pickQty} onChange={(e) => setPickQty(e.target.value)} aria-label="Số lượng" className={`${inputCls} min-w-0 flex-1`} />
            <button type="button" onClick={addLine} className={`${btnSecondary} shrink-0`}>Thêm dòng</button>
          </div>
        </div>
        {lines.length === 0 ? (
          <p className="text-sm text-[#748294]">Chưa có dòng nào. Giá mỗi dòng lấy từ giá niêm yết; tổng tiền do máy chủ tính.</p>
        ) : (
          <ul className="space-y-2">
            {lines.map((l, i) => (
              <li key={i} className="flex items-center justify-between gap-2 rounded-lg border border-[#E5E9ED] p-3 text-sm">
                <span className="min-w-0 flex-1 truncate">{l.itemType === "service" ? "Dịch vụ" : "Sản phẩm"}: {l.name} × {l.quantity}</span>
                <button type="button" onClick={() => setLines((prev) => prev.filter((_, j) => j !== i))} className="min-h-[44px] shrink-0 px-2 text-[#C0392B]">Xóa</button>
              </li>
            ))}
          </ul>
        )}
        <div className="grid grid-cols-2 gap-3">
          <Field label="Giảm giá (VND)">
            <input type="number" inputMode="numeric" min={0} value={discount} onChange={(e) => setDiscount(e.target.value)} placeholder="0" className={inputCls} />
          </Field>
          <Field label="Phụ phí (VND)">
            <input type="number" inputMode="numeric" min={0} value={surcharge} onChange={(e) => setSurcharge(e.target.value)} placeholder="0" className={inputCls} />
          </Field>
        </div>
        <p className="text-xs text-[#748294]">Tổng tiền sẽ do máy chủ tính sau khi tạo (tạm tính − giảm giá + phụ phí).</p>
        {formError ? <p role="alert" className="text-sm text-[#C0392B]">{formError}</p> : null}
        <button type="button" onClick={submit} disabled={createMut.isPending} className={`${btnPrimary} w-full`}>
          {createMut.isPending ? "Đang xử lý..." : "Tạo hóa đơn"}
        </button>
      </div>
    </Card>
  );
}
