// Bán hàng / POS — UX_FLOWS.md §2.3/§5: POS tại quầy (chọn dịch vụ, bill,
// chiết khấu, thu tiền ngay), rồi danh sách hóa đơn, chi tiết hóa đơn
// (thu tiền / hoàn tiền), tạo hóa đơn từ lịch hoàn thành.
// Tổng tiền CHỈ lấy từ server trả về: giá mỗi dòng sửa trên bill chỉ là
// tạm tính, máy chủ tính lại theo giá niêm yết khi tạo hóa đơn.
// Nút "Thu tiền cọc" chỉ hiện "Sắp ra mắt", không làm gì khác.
import { useMemo, useState } from "react";
import type { ComponentType } from "react";
import {
  Banknote, Brush, Check, ChevronDown, Droplets, Eraser, Eye, Footprints, Gem, Hand,
  Landmark, Layers, LayoutGrid, Paintbrush, Palette, Percent, Plus, Receipt, RefreshCw,
  Scissors, Search, ShoppingBag, Smile, Sparkles, Sticker, StickyNote, Trash2,
  UserRound, Users, Waves, X,
} from "lucide-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiPage, formatDateTime, formatVnd, get, post } from "../lib/api.js";
import { INVOICE_STATUS_LABEL, arr, idOf, n, s } from "../lib/types.js";
import type { Row } from "../lib/types.js";
import {
  Badge, badgeToneForStatus, btnDanger, btnPrimary, btnSecondary, Card, Empty, ErrorBox,
  Field, Loading, Notice, errMsg, inputCls, useDebounce,
} from "../lib/ui.js";

/** Bỏ dấu tiếng Việt để tìm kiếm không phân biệt dấu. */
function norm(str: string): string {
  return str
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/g, "d")
    .replace(/Đ/g, "D")
    .toLowerCase();
}

/** Màu nhạt theo nhóm dịch vụ: Nail xanh, Gội hồng, Mi đào (chỉ tint nhẹ). */
function tintFor(categoryName: string): string {
  const c = norm(categoryName);
  if (c.includes("goi")) return "border-[#EFC9D8] bg-[#FDF0F5] text-[#8A4B63]";
  if (c.includes("mi")) return "border-[#F0DCC3] bg-[#FDF3E7] text-[#8A5A2B]";
  return "border-[#C9DCEC] bg-[#EBF3FA] text-[#2C5A86]";
}

type IconComponent = ComponentType<{ className?: string }>;

/** Icon theo nhóm dịch vụ: Nail = Sparkles, Gội = Droplets, Mi = Eye. */
function iconForCategory(categoryName: string): IconComponent {
  const c = norm(categoryName);
  if (c.includes("goi")) return Droplets;
  if (c.includes("mi")) return Eye;
  if (c.includes("nail")) return Sparkles;
  return LayoutGrid;
}

/** Icon theo tên dịch vụ — đoán theo từ khóa, nhỏ gọn, chỉ để nhận biết nhanh. */
function iconForService(name: string, categoryName: string): IconComponent {
  const c = norm(categoryName);
  if (c.includes("mi")) return Eye;
  if (c.includes("goi")) return Droplets;
  const n = norm(name);
  if (n.includes("uon mi")) return Eye;
  if (n.includes("cat")) return Scissors;
  if (n.includes("ve")) return Brush;
  if (n.includes("son")) return Paintbrush;
  if (n.includes("ombre")) return Palette;
  if (n.includes("sticker")) return Sticker;
  if (n.includes("loang") || n.includes("van")) return Waves;
  if (n.includes("charm") || n.includes("xa cu") || n.includes("/ da") || n.endsWith("da")) return Gem;
  if (n.includes("trang guong") || n.includes("guong")) return Sparkles;
  if (n.includes("thao") || n.includes("tay")) return Eraser;
  if (n.includes("noi") || n.includes("dap") || n.includes("up base")) return Layers;
  if (n.includes("refill")) return RefreshCw;
  if (n.includes("goi")) return Droplets;
  if (n.includes("mat na")) return Smile;
  if (n.includes("cha") || n.includes("got")) return Footprints;
  if (n.includes("mat xa") || n.includes("massage")) return Hand;
  return Sparkles;
}

interface PosLine {
  refId: string;
  name: string;
  /** Giá sửa trên bill — chỉ là tạm tính, máy chủ tính lại theo giá niêm yết. */
  unitPriceVnd: number;
  quantity: number;
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

      <PosTerminal
        onInvoiceCreated={(inv) => {
          setSelectedId(idOf(inv));
          void qc.invalidateQueries({ queryKey: ["invoices"] });
        }}
      />

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

function PosTerminal({ onInvoiceCreated }: { onInvoiceCreated: (inv: Row) => void }) {
  const qc = useQueryClient();
  const [catId, setCatId] = useState("");
  const [search, setSearch] = useState("");
  const [showAdd, setShowAdd] = useState(false);
  const [addForm, setAddForm] = useState({ name: "", categoryId: "", priceVnd: "", durationMinutes: "30" });
  const [addError, setAddError] = useState<string | null>(null);

  const [lines, setLines] = useState<PosLine[]>([]);
  const [customerName, setCustomerName] = useState("");
  const [pickedCustomer, setPickedCustomer] = useState<{ id: string; name: string } | null>(null);
  const [showCustomerSearch, setShowCustomerSearch] = useState(false);
  const [customerSearch, setCustomerSearch] = useState("");
  const debouncedCustomerSearch = useDebounce(customerSearch, 400);
  const [technicianId, setTechnicianId] = useState("");
  const [note, setNote] = useState("");
  const [branchId, setBranchId] = useState("");
  const [discountOn, setDiscountOn] = useState(false);
  const [discountPct, setDiscountPct] = useState(5);
  const [method, setMethod] = useState<"cash" | "bank_transfer">("bank_transfer");
  const [posNotice, setPosNotice] = useState<{ kind: "success" | "error"; text: string } | null>(null);
  const [confirming, setConfirming] = useState(false);

  const branchesQ = useQuery({
    queryKey: ["branches"],
    queryFn: () => apiPage<Row>("/api/v1/branches?limit=100").then((r) => r.items),
  });
  const catsQ = useQuery({
    queryKey: ["service-categories"],
    queryFn: () => apiPage<Row>("/api/v1/service-categories?limit=100").then((r) => r.items),
  });
  const servicesQ = useQuery({
    queryKey: ["services", "pos"],
    queryFn: () => apiPage<Row>("/api/v1/services?status=active&limit=100").then((r) => r.items),
  });
  const employeesQ = useQuery({
    queryKey: ["employees", "all"],
    queryFn: () => apiPage<Row>("/api/v1/employees?limit=100").then((r) => r.items),
  });
  const customersQ = useQuery({
    queryKey: ["customers", "pos-search", debouncedCustomerSearch],
    queryFn: () =>
      apiPage<Row>(`/api/v1/customers?search=${encodeURIComponent(debouncedCustomerSearch)}&limit=20`).then((r) => r.items),
    enabled: showCustomerSearch && debouncedCustomerSearch.trim().length >= 1,
  });

  const branches = branchesQ.data ?? [];
  const categories = catsQ.data ?? [];
  const services = servicesQ.data ?? [];
  const employees = employeesQ.data ?? [];
  // Chỉ 1 chi nhánh thì dùng luôn, khỏi bắt chọn.
  const resolvedBranchId = branches.length === 1 ? idOf(branches[0]) : branchId;

  const filteredServices = useMemo(() => {
    const q = norm(search.trim());
    return services.filter((sv) => {
      if (catId) {
        const cat = categories.find((c) => idOf(c) === catId);
        const svCatId = s(sv, "categoryId", "category_id");
        const svCatName = s(sv, "categoryName", "category_name");
        if (svCatId) {
          if (svCatId !== catId) return false;
        } else if (cat && svCatName !== s(cat, "name")) {
          return false;
        }
      }
      if (q && !norm(s(sv, "name")).includes(q)) return false;
      return true;
    });
  }, [services, catId, categories, search]);

  const addServiceMut = useMutation({
    mutationFn: (body: Record<string, unknown>) => post<Row>("/api/v1/services", body),
    onSuccess: () => {
      setPosNotice({ kind: "success", text: "Đã thêm dịch vụ." });
      setShowAdd(false);
      setAddForm({ name: "", categoryId: "", priceVnd: "", durationMinutes: "30" });
      setAddError(null);
      void qc.invalidateQueries({ queryKey: ["services"] });
    },
    onError: (err) => setAddError(errMsg(err)),
  });

  function addToBill(sv: Row) {
    const refId = idOf(sv);
    setLines((prev) => {
      const i = prev.findIndex((l) => l.refId === refId);
      if (i >= 0) {
        const cur = prev[i];
        if (!cur) return prev;
        const next = [...prev];
        next[i] = { ...cur, quantity: cur.quantity + 1 };
        return next;
      }
      return [...prev, { refId, name: s(sv, "name"), unitPriceVnd: n(sv, "priceVnd", "price_vnd"), quantity: 1 }];
    });
  }

  function clearBill() {
    setLines([]);
    setCustomerName("");
    setPickedCustomer(null);
    setShowCustomerSearch(false);
    setCustomerSearch("");
    setTechnicianId("");
    setNote("");
    setDiscountOn(false);
    setDiscountPct(5);
  }

  const subtotal = lines.reduce((sum, l) => sum + l.unitPriceVnd * l.quantity, 0);
  const discountVnd = discountOn ? Math.round((subtotal * discountPct) / 100) : 0;
  const total = Math.max(0, subtotal - discountVnd);

  function submitAddService() {
    setAddError(null);
    if (!addForm.name.trim()) return setAddError("Vui lòng nhập tên dịch vụ.");
    if (addForm.priceVnd === "" || Number(addForm.priceVnd) < 0) return setAddError("Giá phải là số >= 0.");
    const dur = Number(addForm.durationMinutes);
    if (!Number.isInteger(dur) || dur < 5 || dur > 480) return setAddError("Thời lượng phải từ 5 đến 480 phút.");
    addServiceMut.mutate({
      categoryId: addForm.categoryId || undefined,
      name: addForm.name.trim(),
      priceVnd: Number(addForm.priceVnd),
      durationMinutes: dur,
      status: "active",
    });
  }

  async function confirmBill() {
    setPosNotice(null);
    if (lines.length === 0) return setPosNotice({ kind: "error", text: "Bill chưa có dịch vụ nào. Chạm vào một dịch vụ để thêm." });
    if (branches.length === 0) return setPosNotice({ kind: "error", text: "Chưa có chi nhánh nào — hãy tạo chi nhánh trước." });
    if (branches.length > 1 && !branchId) return setPosNotice({ kind: "error", text: "Vui lòng chọn chi nhánh." });
    setConfirming(true);
    try {
      // Khách hàng: ưu tiên khách quen đã chọn; nếu không, dùng khách lẻ
      // (tên đúng "Khách lẻ") — tên gõ tay mà không chọn thì không dùng được
      // vì API cần customer id.
      let customerId: string;
      let typedNameNote = "";
      if (pickedCustomer) {
        customerId = pickedCustomer.id;
      } else {
        const walkIn = await apiPage<Row>("/api/v1/customers?search=Kh%C3%A1ch%20l%E1%BA%BB&limit=20")
          .then((r) => r.items)
          .then((list) => list.find((c) => s(c, "fullName", "full_name") === "Khách lẻ"));
        if (!walkIn) {
          setPosNotice({ kind: "error", text: "Chưa có khách lẻ — hãy tạo khách hàng tên 'Khách lẻ' trong mục Khách hàng." });
          return;
        }
        customerId = idOf(walkIn);
        if (customerName.trim()) {
          typedNameNote = ` Tên đã nhập "${customerName.trim()}" chưa được chọn từ danh sách khách quen nên bill được tính cho Khách lẻ.`;
        }
      }
      const inv = await post<Row>("/api/v1/invoices", {
        branchId: resolvedBranchId,
        customerId,
        items: lines.map((l) => ({
          itemType: "service",
          refId: l.refId,
          name: l.name,
          quantity: l.quantity,
          technicianId: technicianId || undefined,
        })),
        discountVnd,
        surchargeVnd: 0,
      });
      const invoiceNo = s(inv, "invoiceNumber", "invoice_number", "code") || idOf(inv).slice(0, 8);
      const serverTotal = n(inv, "totalVnd", "total_vnd");
      if (serverTotal > 0) {
        try {
          await post<Row>(`/api/v1/invoices/${idOf(inv)}/payments`, {
            amountVnd: serverTotal,
            method,
            note: note.trim() || undefined,
          });
        } catch (payErr) {
          // Hóa đơn đã tạo xong, chỉ thu tiền thất bại: giữ nguyên bill để
          // thu lại từ chi tiết hóa đơn, không xóa bill.
          onInvoiceCreated(inv);
          setPosNotice({
            kind: "error",
            text: `Đã tạo hóa đơn ${invoiceNo} nhưng chưa ghi nhận được thanh toán (${errMsg(payErr)}). Hóa đơn đang ở trạng thái chưa thanh toán — mở chi tiết hóa đơn để thu tiền lại.`,
          });
          return;
        }
      }
      clearBill();
      onInvoiceCreated(inv);
      setPosNotice({
        kind: "success",
        text:
          serverTotal > 0
            ? `Đã tạo hóa đơn ${invoiceNo}. Tổng tiền theo máy chủ: ${formatVnd(serverTotal)} — đã thu đủ (${method === "bank_transfer" ? "chuyển khoản" : "tiền mặt"}).${typedNameNote}`
            : `Đã tạo hóa đơn ${invoiceNo} với tổng tiền 0đ (các dòng chưa có giá) nên chưa ghi nhận thanh toán.${typedNameNote}`,
      });
    } catch (err) {
      setPosNotice({ kind: "error", text: errMsg(err) });
    } finally {
      setConfirming(false);
    }
  }

  // POS vừa đúng 1 màn hình, không cuộn trang: section cao đúng bằng
  // viewport trừ tiêu đề trang + BottomNav (h-[calc(100dvh-11rem)]), bên
  // trong chia 2 vùng cuộn riêng (lưới dịch vụ / dòng bill), còn tiêu đề,
  // tổng tiền và nút Xác nhận luôn nhìn thấy. Trang Bán hàng được nới rộng
  // gần hết màn hình nhờ App.tsx bỏ max-w-3xl ở route /ban-hang.
  const posInputCls =
    "h-9 w-full rounded-lg border border-border bg-white px-2.5 text-sm text-ink placeholder:text-muted hover:border-tint-300 focus:border-blue focus:outline-none focus:ring-2 focus:ring-blue/20 disabled:cursor-not-allowed disabled:bg-tint-50 disabled:opacity-60";

  return (
    <section className="flex h-[calc(100dvh-11rem)] flex-col overflow-hidden rounded-lg border border-border bg-white p-2 shadow-soft sm:p-3">
      <div className="mb-2 flex items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 text-base font-semibold text-ink">
          <ShoppingBag className="h-5 w-5 shrink-0 text-navy" aria-hidden="true" />
          Bán hàng tại quầy
        </h2>
        {servicesQ.isLoading ? <span className="text-xs text-[#748294]">Đang tải dịch vụ...</span> : null}
      </div>
      {posNotice ? <div className="mb-2"><Notice kind={posNotice.kind} text={posNotice.text} onClose={() => setPosNotice(null)} /></div> : null}
      <div className="grid min-h-0 flex-1 grid-rows-[minmax(0,40%)_minmax(0,1fr)] gap-2 lg:grid-cols-[minmax(0,1fr)_minmax(360px,420px)] lg:grid-rows-1">
        {/* Trái: chọn dịch vụ — lưới tự cuộn bên trong */}
        <div className="flex min-h-0 flex-col">
          <div className="flex flex-wrap gap-1.5" role="group" aria-label="Lọc theo nhóm dịch vụ">
            <button
              type="button"
              onClick={() => setCatId("")}
              className={`inline-flex min-h-[34px] items-center gap-1.5 rounded-lg px-2.5 text-xs font-semibold transition-colors ${catId === "" ? "bg-navy text-white" : "border border-border bg-white text-navy hover:bg-tint-50"}`}
            >
              <LayoutGrid className="h-3.5 w-3.5" aria-hidden="true" />
              Tất cả
            </button>
            {categories.map((c) => {
              const CatIcon = iconForCategory(s(c, "name"));
              const active = catId === idOf(c);
              return (
                <button
                  key={idOf(c)}
                  type="button"
                  onClick={() => setCatId(idOf(c))}
                  className={`inline-flex min-h-[34px] items-center gap-1.5 rounded-lg px-2.5 text-xs font-semibold transition-colors ${active ? "bg-navy text-white" : "border border-border bg-white text-navy hover:bg-tint-50"}`}
                >
                  <CatIcon className="h-3.5 w-3.5" aria-hidden="true" />
                  {s(c, "name")}
                </button>
              );
            })}
          </div>
          {catsQ.isError ? <p className="mt-2 text-sm text-[#C0392B]">Không tải được nhóm dịch vụ: {errMsg(catsQ.error)}</p> : null}
          <div className="mt-2 flex gap-2">
            <div className="relative min-w-0 flex-1">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" aria-hidden="true" />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Tìm dịch vụ"
                aria-label="Tìm dịch vụ"
                className={`${posInputCls} pl-8`}
              />
            </div>
            <button
              type="button"
              onClick={() => { setShowAdd((v) => !v); setAddError(null); }}
              aria-label="Thêm dịch vụ mới"
              className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-border bg-white text-navy hover:bg-tint-50 active:bg-tint-100"
            >
              <Plus className="h-5 w-5" aria-hidden="true" />
            </button>
          </div>
          {showAdd ? (
            <div className="mt-2 max-h-56 space-y-2 overflow-y-auto rounded-lg border border-[#E5E9ED] bg-[#F2F6F9] p-2">
              <p className="text-sm font-medium">Thêm dịch vụ mới</p>
              <Field label="Tên dịch vụ">
                <input value={addForm.name} onChange={(e) => setAddForm((f) => ({ ...f, name: e.target.value }))} placeholder="vd: Sơn gel" className={inputCls} />
              </Field>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Nhóm dịch vụ">
                  <select value={addForm.categoryId} onChange={(e) => setAddForm((f) => ({ ...f, categoryId: e.target.value }))} className={inputCls}>
                    <option value="">— Không nhóm —</option>
                    {categories.map((c) => (
                      <option key={idOf(c)} value={idOf(c)}>{s(c, "name")}</option>
                    ))}
                  </select>
                </Field>
                <Field label="Thời lượng (phút)">
                  <input type="number" inputMode="numeric" min={5} max={480} value={addForm.durationMinutes} onChange={(e) => setAddForm((f) => ({ ...f, durationMinutes: e.target.value }))} className={inputCls} />
                </Field>
              </div>
              <Field label="Giá (VND)">
                <input type="number" inputMode="numeric" min={0} value={addForm.priceVnd} onChange={(e) => setAddForm((f) => ({ ...f, priceVnd: e.target.value }))} placeholder="0" className={inputCls} />
              </Field>
              {addError ? <p role="alert" className="text-sm text-[#C0392B]">{addError}</p> : null}
              <button type="button" onClick={submitAddService} disabled={addServiceMut.isPending} className={`${btnPrimary} w-full`}>
                {addServiceMut.isPending ? "Đang xử lý..." : "Thêm dịch vụ"}
              </button>
            </div>
          ) : null}
          {servicesQ.isLoading ? (
            <div className="mt-2"><Loading /></div>
          ) : servicesQ.isError ? (
            <div className="mt-2"><ErrorBox message={errMsg(servicesQ.error)} onRetry={() => void servicesQ.refetch()} /></div>
          ) : filteredServices.length === 0 ? (
            <p className="mt-2 text-sm text-[#748294]">Không tìm thấy dịch vụ nào.</p>
          ) : (
            <div className="mt-2 grid min-h-0 flex-1 grid-cols-3 gap-1.5 overflow-y-auto pr-0.5 [scrollbar-width:thin] sm:grid-cols-4 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6">
              {filteredServices.map((sv) => {
                const price = n(sv, "priceVnd", "price_vnd");
                const catName = s(sv, "categoryName", "category_name");
                const SvcIcon = iconForService(s(sv, "name"), catName);
                return (
                  <button
                    key={idOf(sv)}
                    type="button"
                    onClick={() => addToBill(sv)}
                    className={`flex min-h-[48px] items-center gap-1.5 rounded-lg border px-1.5 py-1 text-left transition-colors hover:opacity-80 active:opacity-60 ${tintFor(catName)}`}
                  >
                    <SvcIcon className="h-4 w-4 shrink-0 opacity-80" aria-hidden="true" />
                    <span className="min-w-0 flex-1">
                      <span className="block text-xs font-semibold leading-tight line-clamp-2">{s(sv, "name")}</span>
                      {price > 0 ? (
                        <span className="block text-[11px] tabular-nums opacity-80">{formatVnd(price)}</span>
                      ) : (
                        <span className="block text-[11px] text-[#748294]">Chưa có giá</span>
                      )}
                    </span>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* Phải: bill của khách — hàng bill gọn, dòng bill tự cuộn, tổng tiền + nút xác nhận luôn thấy ở cuối */}
        <div className="flex min-h-0 flex-col rounded-lg border border-[#E5E9ED] bg-[#F7F7F5] p-2">
          <div className="flex items-center justify-between gap-2">
            <h3 className="flex items-center gap-1.5 text-sm font-semibold text-ink">
              <Receipt className="h-4 w-4 shrink-0 text-navy" aria-hidden="true" />
              Bill của khách
            </h3>
            <button type="button" onClick={clearBill} className="inline-flex min-h-[32px] items-center gap-1 px-2 text-xs font-semibold text-[#C0392B] hover:opacity-70">
              <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
              Xoá hết
            </button>
          </div>
          {branches.length > 1 ? (
            <div className="mt-2">
              <Field label="Chi nhánh">
                <select value={branchId} onChange={(e) => setBranchId(e.target.value)} className={posInputCls}>
                  <option value="">— Chọn chi nhánh —</option>
                  {branches.map((b) => (
                    <option key={idOf(b)} value={idOf(b)}>{s(b, "name")}</option>
                  ))}
                </select>
              </Field>
            </div>
          ) : null}
          <div className="mt-2 flex gap-2">
            <div className="relative min-w-0 flex-1">
              <UserRound className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" aria-hidden="true" />
              <input
                value={customerName}
                onChange={(e) => { setCustomerName(e.target.value); setPickedCustomer(null); }}
                placeholder="Tên khách (không bắt buộc)"
                aria-label="Tên khách"
                className={`${posInputCls} pl-8`}
              />
            </div>
            <button type="button" onClick={() => setShowCustomerSearch((v) => !v)} className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-lg border border-border bg-white px-2.5 text-xs font-semibold text-navy hover:bg-tint-50 active:bg-tint-100">
              <Users className="h-4 w-4" aria-hidden="true" />
              Khách quen
            </button>
          </div>
          <div className="relative mt-2">
            <UserRound className="pointer-events-none absolute left-2.5 top-1/2 z-10 h-4 w-4 -translate-y-1/2 text-muted" aria-hidden="true" />
            <select value={technicianId} onChange={(e) => setTechnicianId(e.target.value)} aria-label="Tên thợ" className={`${posInputCls} appearance-none pl-8 pr-7`}>
              <option value="">— Chọn thợ —</option>
              {employees.map((em) => (
                <option key={idOf(em)} value={idOf(em)}>{s(em, "fullName", "full_name")}</option>
              ))}
            </select>
            <ChevronDown className="pointer-events-none absolute right-2 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" aria-hidden="true" />
          </div>
          {pickedCustomer ? (
            <p className="mt-1.5 text-xs">
              Đã chọn khách quen: <span className="font-medium">{pickedCustomer.name}</span>{" "}
              <button type="button" onClick={() => { setPickedCustomer(null); setCustomerName(""); }} className="font-semibold text-[#C0392B]">Bỏ chọn</button>
            </p>
          ) : null}
          {showCustomerSearch ? (
            <div className="mt-2 space-y-2 rounded-lg border border-[#E5E9ED] bg-white p-2">
              <input
                value={customerSearch}
                onChange={(e) => setCustomerSearch(e.target.value)}
                placeholder="Tìm khách quen theo tên / SĐT"
                aria-label="Tìm khách quen"
                className={posInputCls}
              />
              {customersQ.isLoading ? (
                <p className="text-xs text-[#748294]">Đang tìm...</p>
              ) : (customersQ.data ?? []).length === 0 ? (
                <p className="text-xs text-[#748294]">{debouncedCustomerSearch.trim() ? "Không tìm thấy khách nào." : "Nhập tên hoặc SĐT để tìm khách quen."}</p>
              ) : (
                <ul className="max-h-32 space-y-1 overflow-y-auto">
                  {(customersQ.data ?? []).map((c) => (
                    <li key={idOf(c)}>
                      <button
                        type="button"
                        onClick={() => {
                          setPickedCustomer({ id: idOf(c), name: s(c, "fullName", "full_name") });
                          setCustomerName(s(c, "fullName", "full_name"));
                          setShowCustomerSearch(false);
                          setCustomerSearch("");
                        }}
                        className="block w-full rounded-lg border border-[#E5E9ED] p-2 text-left text-xs hover:bg-[#F2F6F9]"
                      >
                        {s(c, "fullName", "full_name")} · {s(c, "phone")}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ) : null}
          <div className="relative mt-2">
            <StickyNote className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" aria-hidden="true" />
            <input
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Ghi chú cho bill (không bắt buộc)"
              aria-label="Ghi chú"
              className={`${posInputCls} pl-8`}
            />
          </div>

          {lines.length === 0 ? (
            <p className="mt-2 flex-1 text-xs text-[#748294]">Chạm vào một dịch vụ để thêm vào bill.</p>
          ) : (
            <ul className="mt-2 min-h-0 flex-1 space-y-1 overflow-y-auto pr-0.5 [scrollbar-width:thin]">
              {lines.map((l, i) => (
                <li key={l.refId} className="flex items-center gap-1.5 border-b border-[#E5E9ED] pb-1 text-xs">
                  <span className="min-w-0 flex-1 truncate font-medium leading-tight">{l.name}</span>
                  <input
                    type="number"
                    inputMode="numeric"
                    min={0}
                    value={l.unitPriceVnd}
                    aria-label={`Giá ${l.name} (VND)`}
                    onChange={(e) => {
                      const v = Math.max(0, Number(e.target.value) || 0);
                      setLines((prev) => prev.map((x, j) => (j === i ? { ...x, unitPriceVnd: v } : x)));
                    }}
                    className="h-7 w-[68px] shrink-0 rounded-md border border-[#E5E9ED] bg-white px-1.5 text-right text-xs tabular-nums focus:border-blue focus:outline-none"
                  />
                  <span className="flex shrink-0 items-center gap-0.5">
                    <button type="button" aria-label={`Giảm số lượng ${l.name}`} onClick={() => setLines((prev) => prev.map((x, j) => (j === i ? { ...x, quantity: Math.max(1, x.quantity - 1) } : x)))} className="flex h-7 w-7 items-center justify-center rounded-md border border-[#E5E9ED] bg-white text-sm font-bold leading-none">−</button>
                    <span className="w-5 text-center tabular-nums">{l.quantity}</span>
                    <button type="button" aria-label={`Tăng số lượng ${l.name}`} onClick={() => setLines((prev) => prev.map((x, j) => (j === i ? { ...x, quantity: x.quantity + 1 } : x)))} className="flex h-7 w-7 items-center justify-center rounded-md border border-[#E5E9ED] bg-white text-sm font-bold leading-none">+</button>
                  </span>
                  <span className="w-16 shrink-0 text-right font-semibold tabular-nums text-[#244B70]">{formatVnd(l.unitPriceVnd * l.quantity)}</span>
                  <button type="button" aria-label={`Xóa ${l.name} khỏi bill`} onClick={() => setLines((prev) => prev.filter((_, j) => j !== i))} className="flex h-7 w-6 shrink-0 items-center justify-center text-[#C0392B] hover:opacity-70">
                    <X className="h-3.5 w-3.5" aria-hidden="true" />
                  </button>
                </li>
              ))}
            </ul>
          )}

          <div className={`mt-2 flex h-9 shrink-0 items-center justify-between gap-2 rounded-lg border border-[#E5E9ED] bg-soft-warning px-2 ${discountOn ? "" : "opacity-40"}`}>
            <label className="flex cursor-pointer items-center gap-1.5 text-xs font-medium">
              <input
                type="checkbox"
                checked={discountOn}
                onChange={(e) => setDiscountOn(e.target.checked)}
                className="h-4 w-4 accent-[#244B70]"
              />
              <Percent className="h-3.5 w-3.5" aria-hidden="true" />
              Chiết khấu
            </label>
            <span className="flex items-center gap-1.5">
              <select
                value={discountPct}
                disabled={!discountOn}
                onChange={(e) => setDiscountPct(Number(e.target.value))}
                aria-label="Tỉ lệ chiết khấu"
                className="h-7 rounded-md border border-[#E5E9ED] bg-white px-1.5 text-xs"
              >
                {[0, 5, 10, 15, 20].map((p) => (
                  <option key={p} value={p}>{p}%</option>
                ))}
              </select>
              <span className="text-xs font-semibold tabular-nums text-[#B7791F]">− {formatVnd(discountVnd)}</span>
            </span>
          </div>

          <fieldset className="mt-2 shrink-0 rounded-lg border border-[#E5E9ED] bg-tint-50 px-2 py-1.5">
            <legend className="sr-only">Phương thức thanh toán</legend>
            <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs">
              <label className="flex cursor-pointer items-center gap-1.5">
                <input type="radio" name="pos-method" checked={method === "bank_transfer"} onChange={() => setMethod("bank_transfer")} className="h-4 w-4 accent-[#244B70]" />
                <Landmark className="h-4 w-4 text-navy" aria-hidden="true" />
                Chuyển khoản
              </label>
              <label className="flex cursor-pointer items-center gap-1.5">
                <input type="radio" name="pos-method" checked={method === "cash"} onChange={() => setMethod("cash")} className="h-4 w-4 accent-[#244B70]" />
                <Banknote className="h-4 w-4 text-navy" aria-hidden="true" />
                Tiền mặt
              </label>
            </div>
          </fieldset>

          <dl className="mt-2 shrink-0 space-y-0.5 text-xs tabular-nums">
            <div className="flex items-center justify-between gap-2">
              <dt className="text-[#748294]">Tạm tính</dt>
              <dd className="font-semibold">{formatVnd(subtotal)}</dd>
            </div>
            <div className="flex items-center justify-between gap-2">
              <dt className="font-medium">Khách thanh toán</dt>
              <dd className="text-lg font-bold leading-tight text-[#244B70]">{formatVnd(total)}</dd>
            </div>
          </dl>
          <p className="mt-0.5 shrink-0 text-[11px] leading-tight text-[#748294]">Giá mỗi dòng chỉ là tạm tính — tổng cuối theo giá niêm yết trên máy chủ.</p>
          <button type="button" onClick={() => void confirmBill()} disabled={confirming || lines.length === 0} className={`${btnPrimary} mt-2 min-h-[48px] w-full shrink-0 text-base`}>
            <Check className="h-5 w-5" aria-hidden="true" />
            {confirming ? "Đang xử lý..." : "Xác nhận bill"}
          </button>
        </div>
      </div>
    </section>
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
  completedBookings, completedLoading, onFromBooking, fromBookingPending,
}: {
  completedBookings: Row[];
  completedLoading: boolean;
  onFromBooking: (id: string) => void;
  fromBookingPending: boolean;
}) {
  return (
    <Card title="Tạo hóa đơn từ lịch hẹn">
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
        <p className="text-xs text-[#748294]">Muốn tạo hóa đơn thủ công, dùng POS ở trên: chọn dịch vụ, bấm “Xác nhận bill”.</p>
      </div>
    </Card>
  );
}
