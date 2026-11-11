// Bán hàng / POS — UX_FLOWS.md §2.3/§5: POS tại quầy (chọn dịch vụ, bill,
// chiết khấu, thu tiền ngay), rồi chi tiết hóa đơn (thu tiền / hoàn tiền).
// Tổng tiền CHỈ lấy từ server trả về: giá mỗi dòng sửa trên bill chỉ là
// tạm tính, máy chủ tính lại theo giá niêm yết khi tạo hóa đơn.
import { useEffect, useMemo, useRef, useState } from "react";
import type { ComponentType, PointerEvent as ReactPointerEvent } from "react";
import {
  Banknote, Check, ChevronDown, Droplets, Eye, Landmark, LayoutGrid, Percent,
  Plus, Receipt, Scissors, Search, Sparkles, StickyNote, Trash2, UserRound,
  Users, X,
} from "lucide-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiPage, formatDateTime, formatVnd, get, post } from "../lib/api.js";
import { INVOICE_STATUS_LABEL, arr, idOf, n, s } from "../lib/types.js";
import type { Row } from "../lib/types.js";
import {
  Badge, badgeToneForStatus, btnDanger, btnPrimary, btnSecondary, Card, ErrorBox,
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

/**
 * Màu theo nhóm dịch vụ — mỗi nhóm giữ màu riêng cả khi chưa chọn lẫn khi
 * đã chọn (Nail xanh, Gội hồng, Mi đào, Chăm sóc xanh lá, Nghệ thuật tím).
 * Ô đã chọn KHÔNG đổi sang Navy đồng loạt: viền + số lượng dùng màu đậm
 * của chính nhóm đó, nền là tint sáng hơn của nhóm.
 */
interface GroupStyle {
  border: string;
  bg: string;
  text: string;
  strong: string;
  selBg: string;
}
function groupStyle(categoryName: string): GroupStyle {
  const c = norm(categoryName);
  if (c.includes("goi")) return { border: "#E5B7CC", bg: "#FDF0F5", text: "#8A4B63", strong: "#C97A9E", selBg: "#FADCE9" };
  if (c.includes("mi")) return { border: "#EACFA9", bg: "#FDF3E7", text: "#8A5A2B", strong: "#C99A4B", selBg: "#F7E8CF" };
  if (c.includes("cham soc")) return { border: "#B5DCC0", bg: "#F1F8F1", text: "#3F7A4C", strong: "#5FA96E", selBg: "#DFF0E4" };
  if (c.includes("nghe thuat")) return { border: "#CDB8E8", bg: "#F5F0FD", text: "#6B4A8A", strong: "#9A76C4", selBg: "#E9DCF6" };
  return { border: "#C9DCEC", bg: "#EBF3FA", text: "#2C5A86", strong: "#3979A8", selBg: "#D7E8F5" };
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

interface PosLine {
  refId: string;
  name: string;
  /** Giá sửa trên bill — chỉ là tạm tính, máy chủ tính lại theo giá niêm yết. */
  unitPriceVnd: number;
  quantity: number;
}

export default function SalesPage() {
  const qc = useQueryClient();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ kind: "success" | "error" | "info"; text: string } | null>(null);

  const detailQ = useQuery({
    queryKey: ["invoice", selectedId],
    queryFn: () => get<Row>(`/api/v1/invoices/${selectedId ?? ""}`),
    enabled: selectedId !== null,
  });

  const selected = detailQ.data ?? null;

  return (
    <main className="space-y-4 p-4">
      {notice ? <Notice kind={notice.kind} text={notice.text} onClose={() => setNotice(null)} /> : null}

      <PosTerminal
        onInvoiceCreated={(inv) => {
          setSelectedId(idOf(inv));
        }}
      />

      {selectedId && selected ? (
        <InvoiceDetail
          invoice={selected}
          loading={detailQ.isLoading}
          onClose={() => setSelectedId(null)}
          onChanged={(msg, kind) => {
            setNotice({ kind, text: msg });
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
  const [addForm, setAddForm] = useState({ name: "", categoryId: "", newGroupName: "", priceVnd: "", durationMinutes: "30" });
  // Mobile: ô tìm kiếm thu gọn thành icon kính lúp; bấm mới mở ô nhập.
  const [showMobileSearch, setShowMobileSearch] = useState(false);
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
  const [showNote, setShowNote] = useState(false);
  // Thanh kéo giữa 2 panel: split = % chiều cao (mobile, xếp dọc) hoặc %
  // chiều rộng (desktop, xếp ngang) dành cho panel dịch vụ; phần còn lại
  // cho panel bill. Kéo bằng pointer events, kẹp trong khoảng an toàn để
  // không panel nào bị ép về 0.
  const posRef = useRef<HTMLDivElement>(null);
  const dragPointerId = useRef<number | null>(null);
  const [split, setSplit] = useState<number>(() =>
    typeof window !== "undefined" && window.innerWidth >= 1024 ? 62 : 40,
  );

  function clampSplit(pct: number, horizontal: boolean): number {
    const lo = horizontal ? 30 : 25;
    const hi = horizontal ? 75 : 50;
    return Math.min(hi, Math.max(lo, Math.round(pct)));
  }

  function onDividerPointerDown(e: ReactPointerEvent<HTMLDivElement>) {
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    dragPointerId.current = e.pointerId;
  }

  function onDividerPointerMove(e: ReactPointerEvent<HTMLDivElement>) {
    if (dragPointerId.current === null || !posRef.current) return;
    const rect = posRef.current.getBoundingClientRect();
    const horizontal = window.innerWidth >= 1024;
    const pct = horizontal
      ? ((e.clientX - rect.left) / rect.width) * 100
      : ((e.clientY - rect.top) / rect.height) * 100;
    setSplit(clampSplit(pct, horizontal));
  }

  function onDividerPointerUp() {
    dragPointerId.current = null;
  }

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
  // Thợ mặc định: luôn là thợ đầu tiên trong danh sách — tự chọn sẵn khi
  // mở trang và khi xóa bill, thay cho ô trống "— Chọn thợ —".
  const defaultTechnicianId = employees.length > 0 && employees[0] ? idOf(employees[0]) : "";
  useEffect(() => {
    if (!technicianId && defaultTechnicianId) setTechnicianId(defaultTechnicianId);
  }, [technicianId, defaultTechnicianId]);
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

  // Chip nhóm: bản gọn cho mobile (chữ nhỏ, không wrap — kéo ngang trong
  // 1 hàng) và bản thường cho desktop.
  function renderChips(compact: boolean) {
    const chipCls = (active: boolean) =>
      `inline-flex shrink-0 items-center gap-1 rounded-lg font-semibold transition-colors ${
        compact ? "min-h-[30px] px-2 text-[11px]" : "min-h-[34px] px-2.5 text-xs"
      } ${active ? "bg-navy text-white" : "border border-border bg-white text-navy hover:bg-tint-50"}`;
    const iconCls = compact ? "h-3 w-3" : "h-3.5 w-3.5";
    return (
      <>
        <button type="button" onClick={() => setCatId("")} className={chipCls(catId === "")}>
          <LayoutGrid className={iconCls} aria-hidden="true" />
          Tất cả
        </button>
        {categories.map((c) => {
          const CatIcon = iconForCategory(s(c, "name"));
          const active = catId === idOf(c);
          return (
            <button key={idOf(c)} type="button" onClick={() => setCatId(idOf(c))} className={chipCls(active)}>
              <CatIcon className={iconCls} aria-hidden="true" />
              {s(c, "name")}
            </button>
          );
        })}
      </>
    );
  }

  const addServiceMut = useMutation({
    mutationFn: (body: Record<string, unknown>) => post<Row>("/api/v1/services", body),
    onSuccess: () => {
      setPosNotice({ kind: "success", text: "Đã thêm dịch vụ." });
      setShowAdd(false);
      setAddForm({ name: "", categoryId: "", newGroupName: "", priceVnd: "", durationMinutes: "30" });
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
    setTechnicianId(defaultTechnicianId);
    setNote("");
    setShowNote(false);
    setDiscountOn(false);
    setDiscountPct(5);
  }

  const subtotal = lines.reduce((sum, l) => sum + l.unitPriceVnd * l.quantity, 0);
  const discountVnd = discountOn ? Math.round((subtotal * discountPct) / 100) : 0;
  const total = Math.max(0, subtotal - discountVnd);

  async function submitAddService() {
    setAddError(null);
    if (!addForm.name.trim()) return setAddError("Vui lòng nhập tên dịch vụ.");
    if (addForm.priceVnd === "" || Number(addForm.priceVnd) < 0) return setAddError("Giá phải là số >= 0.");
    const dur = Number(addForm.durationMinutes);
    if (!Number.isInteger(dur) || dur < 5 || dur > 480) return setAddError("Thời lượng phải từ 5 đến 480 phút.");
    // Thêm nhóm mới: tạo nhóm qua API trước rồi mới dùng id của nhóm đó
    // cho dịch vụ (POST /api/v1/service-categories).
    let categoryId = addForm.categoryId;
    if (categoryId === "__new__") {
      const groupName = addForm.newGroupName.trim();
      if (!groupName) return setAddError("Vui lòng nhập tên nhóm mới.");
      try {
        const created = await post<Row>("/api/v1/service-categories", { name: groupName });
        categoryId = idOf(created);
        void qc.invalidateQueries({ queryKey: ["service-categories"] });
      } catch (err) {
        return setAddError(errMsg(err));
      }
    }
    addServiceMut.mutate({
      categoryId: categoryId || undefined,
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
            : `Đã tạo hóa đơn ${invoiceNo} với tổng tiền 0 (các dòng chưa có giá) nên chưa ghi nhận thanh toán.${typedNameNote}`,
      });
    } catch (err) {
      setPosNotice({ kind: "error", text: errMsg(err) });
    } finally {
      setConfirming(false);
    }
  }

  // POS vừa đúng 1 màn hình, không cuộn trang: section cao đúng bằng
  // viewport trừ TopNav (3.5rem + safe-area trên) + padding trang
  // (h-[calc(100dvh-5.5rem-env(safe-area-inset-top))]), bên trong chia 2 vùng
  // cuộn riêng (lưới dịch vụ / dòng bill), còn tổng tiền và nút Xác nhận
  // luôn nhìn thấy. Trang Bán hàng được nới rộng gần hết màn hình nhờ
  // App.tsx bỏ max-w-3xl ở route /ban-hang.
  // BUG đã sửa (2026-11-11): trên mobile, panel bill bị các hàng cố định ăn
  // hết chiều cao nên danh sách dòng bill bị ép về 0px — bấm dịch vụ thấy
  // badge ×N nhưng không thấy dòng trong bill. Nay danh sách dòng có chiều
  // cao tối thiểu (min-h-16), ô ghi chú mặc định thu gọn, và có thanh kéo
  // giữa 2 panel để kéo thêm chỗ khi cần.
  const posInputCls =
    "h-9 w-full rounded-lg border border-border bg-white px-2.5 text-sm text-ink placeholder:text-muted hover:border-tint-300 focus:border-blue focus:outline-none focus:ring-2 focus:ring-blue/20 disabled:cursor-not-allowed disabled:bg-tint-50 disabled:opacity-60";

  return (
    <section className="flex h-[calc(100dvh-5.5rem-env(safe-area-inset-top))] flex-col overflow-hidden rounded-lg border border-border bg-white p-2 shadow-soft sm:p-3">
      {posNotice ? <div className="mb-2"><Notice kind={posNotice.kind} text={posNotice.text} onClose={() => setPosNotice(null)} /></div> : null}
      <div ref={posRef} className="flex min-h-0 flex-1 flex-col lg:flex-row">
        {/* Trên/trái: chọn dịch vụ — lưới tự cuộn bên trong */}
        <div className="flex min-h-0 min-w-0 flex-col" style={{ flex: `0 0 ${split}%` }}>
          {/* Mobile: 3 hàng (chip / chip / tìm kiếm) gom thành 1 hàng duy
              nhất — chip chữ nhỏ, kéo ngang; tìm kiếm và thêm chỉ còn icon. */}
          <div className="flex items-center gap-1.5 lg:hidden" role="group" aria-label="Lọc và tìm dịch vụ">
            <div className="flex min-w-0 flex-1 items-center gap-1.5 overflow-x-auto whitespace-nowrap [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
              {renderChips(true)}
            </div>
            <button
              type="button"
              onClick={() => setShowMobileSearch((v) => !v)}
              aria-label="Tìm dịch vụ"
              aria-expanded={showMobileSearch}
              className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-border bg-white text-navy hover:bg-tint-50 active:bg-tint-100"
            >
              <Search className="h-5 w-5" aria-hidden="true" />
            </button>
            <button
              type="button"
              onClick={() => { setShowAdd((v) => !v); setAddError(null); }}
              aria-label="Thêm dịch vụ mới"
              className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-border bg-white text-navy hover:bg-tint-50 active:bg-tint-100"
            >
              <Plus className="h-5 w-5" aria-hidden="true" />
            </button>
          </div>
          {showMobileSearch ? (
            <div className="relative mt-1.5 lg:hidden">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" aria-hidden="true" />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Tìm dịch vụ"
                aria-label="Tìm dịch vụ"
                autoFocus
                className={`${posInputCls} pl-8 pr-8`}
              />
              <button
                type="button"
                onClick={() => { setSearch(""); setShowMobileSearch(false); }}
                aria-label="Đóng tìm kiếm"
                className="absolute right-1.5 top-1/2 flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded-full text-muted hover:bg-tint-50"
              >
                <X className="h-4 w-4" aria-hidden="true" />
              </button>
            </div>
          ) : null}
          {/* Desktop: giữ hàng chip + tìm kiếm + thêm như cũ. */}
          <div className="hidden flex-wrap items-center gap-1.5 lg:flex" role="group" aria-label="Lọc và tìm dịch vụ">
            {renderChips(false)}
            <div className="relative min-w-[140px] flex-1">
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
          {catsQ.isError ? <p className="mt-2 text-sm text-[#C0392B]">Không tải được nhóm dịch vụ: {errMsg(catsQ.error)}</p> : null}
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
                    <option value="__new__">＋ Thêm nhóm mới</option>
                  </select>
                </Field>
                <Field label="Thời lượng (phút)">
                  <input type="number" inputMode="numeric" min={5} max={480} value={addForm.durationMinutes} onChange={(e) => setAddForm((f) => ({ ...f, durationMinutes: e.target.value }))} className={inputCls} />
                </Field>
              </div>
              {addForm.categoryId === "__new__" ? (
                <Field label="Tên nhóm mới">
                  <input value={addForm.newGroupName} onChange={(e) => setAddForm((f) => ({ ...f, newGroupName: e.target.value }))} placeholder="vd: Dưỡng da" className={inputCls} />
                </Field>
              ) : null}
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
            <div className="mt-2 grid min-h-0 flex-1 grid-cols-5 gap-1.5 overflow-y-auto pr-0.5 [scrollbar-width:thin]">
              {filteredServices.map((sv) => {
                const catName = s(sv, "categoryName", "category_name");
                // Ô đã chọn GIỮ MÀU NHÓM của nó (không đổi sang Navy đồng
                // loạt): viền đậm + nền sáng hơn của chính nhóm đó; số lượng
                // là hình chữ nhật nhỏ nằm gọn TRONG góc phải-trên của ô,
                // số to, cùng màu với viền, không nền, không tiền tố "×".
                const qty = lines.find((l) => l.refId === idOf(sv))?.quantity ?? 0;
                const selected = qty > 0;
                const gs = groupStyle(catName);
                return (
                  <button
                    key={idOf(sv)}
                    type="button"
                    onClick={() => addToBill(sv)}
                    aria-pressed={selected}
                    style={{
                      borderColor: selected ? gs.strong : gs.border,
                      backgroundColor: selected ? gs.selBg : gs.bg,
                      color: gs.text,
                    }}
                    className={`relative flex min-h-[40px] min-w-0 items-center justify-center rounded-lg border px-1 py-1 text-center transition-colors hover:opacity-80 active:opacity-60 ${
                      selected ? "border-2 shadow-md" : ""
                    }`}
                  >
                    {selected ? (
                      <span
                        aria-hidden="true"
                        className="absolute right-1 top-1 rounded-[3px] border px-1 py-px text-[13px] font-extrabold leading-none"
                        style={{ borderColor: gs.strong, color: gs.strong }}
                      >
                        {qty}
                      </span>
                    ) : null}
                    <span className="block w-full truncate text-[11px] font-semibold leading-tight">{s(sv, "name")}</span>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* Thanh kéo giữa 2 panel: mảnh (chỉ 1 đường 3px, màu xanh thép khác
            hẳn nền panel) để đọc ra là tay cầm nhưng không chiếm chỗ; kéo
            trái/phải trên desktop, lên/xuống trên mobile. Vùng bấm vẫn đủ
            rộng (padding trong suốt) để kéo được bằng ngón tay. */}
        <div
          role="separator"
          aria-label="Kéo để đổi kích thước 2 panel"
          className="group flex shrink-0 touch-none cursor-row-resize select-none items-center justify-center py-1.5 hover:opacity-80 lg:cursor-col-resize lg:px-1.5 lg:py-0"
          onPointerDown={onDividerPointerDown}
          onPointerMove={onDividerPointerMove}
          onPointerUp={onDividerPointerUp}
          onPointerCancel={onDividerPointerUp}
        >
          <span aria-hidden="true" className="h-[3px] w-16 rounded-full bg-[#9FBED8] transition-colors group-hover:bg-[#7FA8CC] group-active:bg-[#5B8FBF] lg:h-16 lg:w-[3px]" />
        </div>

        {/* Phải/dưới: bill của khách — hàng bill gọn, dòng bill tự cuộn, tổng tiền + nút xác nhận luôn thấy ở cuối */}
        <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-lg border border-[#E5E9ED] bg-[#F7F7F5] p-2">
          <div className="flex items-center justify-between gap-2">
            <h3 className="flex items-center gap-1.5 text-sm font-semibold text-ink">
              <Receipt className="h-4 w-4 shrink-0 text-navy" aria-hidden="true" />
              Bill của khách
            </h3>
            <span className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => setShowNote((v) => !v)}
                aria-expanded={showNote}
                className={`inline-flex min-h-[32px] items-center gap-1 rounded-lg px-2 text-xs font-semibold ${showNote || note.trim() ? "bg-tint-100 text-navy" : "text-navy hover:bg-tint-50"}`}
              >
                <StickyNote className="h-3.5 w-3.5" aria-hidden="true" />
                Ghi chú
              </button>
              <button type="button" onClick={clearBill} className="inline-flex min-h-[32px] items-center gap-1 px-2 text-xs font-semibold text-[#C0392B] hover:opacity-70">
                <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                Xoá hết
              </button>
            </span>
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
          <div className="mt-2 flex items-end gap-2">
            <div className="min-w-0 flex-1">
              {/* Icon UserRound trên nhãn đã bỏ (trùng với icon trong ô
                  nhập) — giữ khoảng trống h-4 để 2 cột thẳng hàng. */}
              <span className="mb-1 block h-4" aria-hidden="true" />
              <div className="flex">
                <div className="relative min-w-0 flex-1">
                  <UserRound className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" aria-hidden="true" />
                  <input
                    value={customerName}
                    onChange={(e) => { setCustomerName(e.target.value); setPickedCustomer(null); }}
                    placeholder="Không bắt buộc"
                    aria-label="Tên khách"
                    className={`${posInputCls} rounded-r-none border-r-0 pl-8`}
                  />
                </div>
                <button type="button" onClick={() => setShowCustomerSearch((v) => !v)} className="inline-flex h-9 shrink-0 items-center gap-1 rounded-r-lg border border-border bg-tint-50 px-2 text-xs font-semibold text-navy hover:bg-tint-100 active:bg-tint-100">
                  <Users className="h-4 w-4" aria-hidden="true" />
                  Khách quen
                </button>
              </div>
            </div>
            <div className="w-[132px] shrink-0">
              <span className="mb-1 flex h-4 items-center text-[#748294]" title="Tên thợ">
                <Scissors className="h-4 w-4" aria-hidden="true" />
                <span className="sr-only">Tên thợ</span>
              </span>
              <div className="relative">
                <select value={technicianId} onChange={(e) => setTechnicianId(e.target.value)} aria-label="Tên thợ" className={`${posInputCls} appearance-none pr-7`}>
                  <option value="">— Chọn thợ —</option>
                  {employees.map((em) => (
                    <option key={idOf(em)} value={idOf(em)}>{s(em, "fullName", "full_name")}</option>
                  ))}
                </select>
                <ChevronDown className="pointer-events-none absolute right-2 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" aria-hidden="true" />
              </div>
            </div>
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
          {/* Icon trong ô ghi chú đã bỏ (trùng với icon trên nút Ghi chú). */}
          {showNote || note.trim() ? (
            <div className="mt-2">
              <input
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="Ghi chú cho bill (không bắt buộc)"
                aria-label="Ghi chú"
                className={posInputCls}
              />
            </div>
          ) : null}

          {lines.length === 0 ? (
            <div className="mt-2 min-h-16 flex-1" aria-hidden="true" />
          ) : (
            <ul className="mt-2 min-h-16 flex-1 space-y-1 overflow-y-auto pr-0.5 [scrollbar-width:thin]">
              {lines.map((l, i) => (
                <li key={l.refId} className="flex items-center gap-1.5 border-b border-[#E5E9ED] pb-1 text-xs">
                  <span className="min-w-0 flex-1 truncate font-medium leading-tight">{l.name}</span>
                  <input
                    type="text"
                    inputMode="numeric"
                    value={formatVnd(l.unitPriceVnd)}
                    aria-label={`Giá ${l.name} (VND)`}
                    onChange={(e) => {
                      // Hiển thị luôn có dấu "." phân cách nghìn (vd 100.000):
                      // chỉ giữ lại chữ số rồi tính lại số tiền.
                      const digits = e.target.value.replace(/\D/g, "");
                      const v = digits ? Number(digits) : 0;
                      setLines((prev) => prev.map((x, j) => (j === i ? { ...x, unitPriceVnd: v } : x)));
                    }}
                    className="h-7 w-[72px] shrink-0 rounded-md border border-[#E5E9ED] bg-white px-1.5 text-right text-xs tabular-nums focus:border-blue focus:outline-none"
                  />
                  <span className="shrink-0 text-xs text-[#748294]">×</span>
                  <span className="flex shrink-0 items-center gap-0.5">
                    <button type="button" aria-label={`Giảm số lượng ${l.name}`} onClick={() => setLines((prev) => prev.map((x, j) => (j === i ? { ...x, quantity: Math.max(1, x.quantity - 1) } : x)))} className="flex h-7 w-7 items-center justify-center rounded-md border border-[#E5E9ED] bg-white text-sm font-bold leading-none">−</button>
                    <span className="w-5 text-center tabular-nums">{l.quantity}</span>
                    <button type="button" aria-label={`Tăng số lượng ${l.name}`} onClick={() => setLines((prev) => prev.map((x, j) => (j === i ? { ...x, quantity: x.quantity + 1 } : x)))} className="flex h-7 w-7 items-center justify-center rounded-md border border-[#E5E9ED] bg-white text-sm font-bold leading-none">+</button>
                  </span>
                  <span className="shrink-0 text-xs text-[#748294]">=</span>
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
              {discountOn ? null : <span className="font-normal text-[#B9AFA5]">Không áp dụng</span>}
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

          <div className="mt-2 flex shrink-0 items-center justify-between gap-2">
            <fieldset className="rounded-lg border border-[#E5E9ED] bg-tint-50 px-2 py-1.5">
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
            <dl className="shrink-0 text-right tabular-nums">
              <dt className="text-xs text-[#748294]">Tạm tính</dt>
              <dd className="text-base font-bold leading-tight">{formatVnd(subtotal)}</dd>
            </dl>
          </div>
          <div className="mt-2 flex shrink-0 items-end justify-between gap-2">
            <dl className="shrink-0 tabular-nums">
              <dt className="text-xs text-[#748294]">Khách thanh toán</dt>
              <dd className="text-2xl font-extrabold leading-tight text-[#244B70]">{formatVnd(total)}</dd>
            </dl>
            <button type="button" onClick={() => void confirmBill()} disabled={confirming || lines.length === 0} className={`${btnPrimary} min-h-[48px] flex-1 text-base`}>
              <Check className="h-5 w-5" aria-hidden="true" />
              {confirming ? "Đang xử lý..." : "Xác nhận bill"}
            </button>
          </div>
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
            <input type="number" inputMode="numeric" min={1} value={payAmount} onChange={(e) => setPayAmount(e.target.value)} placeholder={`Tối đa ${formatVnd(remaining)}`} className={inputCls} />
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
            <input type="number" inputMode="numeric" min={1} value={refundAmount} onChange={(e) => setRefundAmount(e.target.value)} placeholder={`Tối đa ${formatVnd(paid - refunded)}`} className={inputCls} />
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
