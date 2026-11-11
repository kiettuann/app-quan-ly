// Kho hàng — sản phẩm CRUD, tồn kho thấp (GET /inventory/low-stock),
// phiếu nhập/xuất/điều chỉnh kho, đơn đặt hàng + nhận hàng.
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiPage, formatVnd, patch, post } from "../lib/api.js";
import { PO_STATUS_LABEL, idOf, n, s } from "../lib/types.js";
import type { Row } from "../lib/types.js";
import {
  Badge, badgeToneForStatus, btnPrimary, btnSecondary, Card, Empty, ErrorBox, Field,
  Loading, Notice, errMsg, inputCls,
} from "../lib/ui.js";

export default function InventoryPage() {
  const qc = useQueryClient();
  const [categoryId, setCategoryId] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<Row | null>(null);
  const [form, setForm] = useState({ name: "", sku: "", unit: "cái", costPriceVnd: "", sellPriceVnd: "", stockQuantity: "0", lowStockThreshold: "5", status: "active" });
  const [formError, setFormError] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ kind: "success" | "error"; text: string } | null>(null);
  const [catName, setCatName] = useState("");
  const [move, setMove] = useState({ productId: "", type: "in", quantity: "" });
  const [po, setPo] = useState({ supplierId: "", productId: "", quantity: "1", unitCostVnd: "" });
  const [supplierName, setSupplierName] = useState("");
  const [supplierPhone, setSupplierPhone] = useState("");

  const catsQ = useQuery({
    queryKey: ["product-categories"],
    queryFn: () => apiPage<Row>("/api/v1/product-categories?limit=100").then((r) => r.items),
  });
  const params = new URLSearchParams({ limit: "100" });
  if (categoryId) params.set("category_id", categoryId);
  const productsQ = useQuery({
    queryKey: ["products", categoryId],
    queryFn: () => apiPage<Row>(`/api/v1/products?${params.toString()}`).then((r) => r.items),
  });
  const lowStockQ = useQuery({
    queryKey: ["inventory", "low-stock"],
    queryFn: () => apiPage<Row>("/api/v1/inventory/low-stock?limit=100").then((r) => r.items),
  });
  const suppliersQ = useQuery({
    queryKey: ["suppliers"],
    queryFn: () => apiPage<Row>("/api/v1/suppliers?limit=100").then((r) => r.items),
  });
  const posQ = useQuery({
    queryKey: ["purchase-orders"],
    queryFn: () => apiPage<Row>("/api/v1/purchase-orders?limit=50").then((r) => r.items),
  });

  const saveMut = useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      editing ? patch<Row>(`/api/v1/products/${idOf(editing)}`, body) : post<Row>("/api/v1/products", body),
    onSuccess: () => {
      setNotice({ kind: "success", text: editing ? "Đã cập nhật sản phẩm." : "Đã thêm sản phẩm." });
      setShowForm(false); setEditing(null);
      void qc.invalidateQueries({ queryKey: ["products"] });
      void qc.invalidateQueries({ queryKey: ["inventory", "low-stock"] });
    },
    onError: (err) => setNotice({ kind: "error", text: errMsg(err) }),
  });
  const catMut = useMutation({
    mutationFn: (name: string) => post<Row>("/api/v1/product-categories", { name }),
    onSuccess: () => { setCatName(""); void qc.invalidateQueries({ queryKey: ["product-categories"] }); },
    onError: (err) => setNotice({ kind: "error", text: errMsg(err) }),
  });
  const moveMut = useMutation({
    mutationFn: () => post<Row>("/api/v1/stock-movements", { productId: move.productId, type: move.type, quantity: Number(move.quantity) }),
    onSuccess: () => {
      setNotice({ kind: "success", text: "Đã ghi nhận thay đổi kho." });
      setMove({ productId: "", type: "in", quantity: "" });
      void qc.invalidateQueries({ queryKey: ["products"] });
      void qc.invalidateQueries({ queryKey: ["inventory", "low-stock"] });
    },
    onError: (err) => setNotice({ kind: "error", text: errMsg(err) }),
  });
  const supplierMut = useMutation({
    mutationFn: () => post<Row>("/api/v1/suppliers", { name: supplierName.trim(), phone: supplierPhone.trim() || undefined }),
    onSuccess: () => { setSupplierName(""); setSupplierPhone(""); setNotice({ kind: "success", text: "Đã thêm nhà cung cấp." }); void qc.invalidateQueries({ queryKey: ["suppliers"] }); },
    onError: (err) => setNotice({ kind: "error", text: errMsg(err) }),
  });
  const poMut = useMutation({
    mutationFn: () => post<Row>("/api/v1/purchase-orders", {
      supplierId: po.supplierId,
      items: [{ productId: po.productId, quantity: Number(po.quantity), unitCostVnd: Number(po.unitCostVnd) }],
    }),
    onSuccess: () => {
      setNotice({ kind: "success", text: "Đã tạo đơn đặt hàng." });
      setPo({ supplierId: "", productId: "", quantity: "1", unitCostVnd: "" });
      void qc.invalidateQueries({ queryKey: ["purchase-orders"] });
    },
    onError: (err) => setNotice({ kind: "error", text: errMsg(err) }),
  });
  const receiveMut = useMutation({
    mutationFn: (id: string) => post<Row>(`/api/v1/purchase-orders/${id}/receive`, {}),
    onSuccess: () => {
      setNotice({ kind: "success", text: "Đã nhận hàng, tồn kho đã cập nhật." });
      void qc.invalidateQueries({ queryKey: ["purchase-orders"] });
      void qc.invalidateQueries({ queryKey: ["products"] });
    },
    onError: (err) => setNotice({ kind: "error", text: errMsg(err) }),
  });

  function startEdit(p: Row) {
    setEditing(p);
    setForm({
      name: s(p, "name"),
      sku: s(p, "sku"),
      unit: s(p, "unit") || "cái",
      costPriceVnd: String(n(p, "costPriceVnd", "cost_price_vnd")),
      sellPriceVnd: String(n(p, "sellPriceVnd", "sell_price_vnd")),
      stockQuantity: String(n(p, "stockQuantity", "stock_quantity")),
      lowStockThreshold: String(n(p, "lowStockThreshold", "low_stock_threshold")),
      status: s(p, "status") || "active",
    });
    setShowForm(true);
    setFormError(null);
  }

  function submit() {
    setFormError(null);
    if (!form.name.trim()) return setFormError("Vui lòng nhập tên sản phẩm.");
    if (!form.sku.trim()) return setFormError("Vui lòng nhập mã SKU.");
    if (!form.costPriceVnd || Number(form.costPriceVnd) < 0) return setFormError("Giá nhập phải là số >= 0.");
    if (!form.sellPriceVnd || Number(form.sellPriceVnd) < 0) return setFormError("Giá bán phải là số >= 0.");
    saveMut.mutate({
      categoryId: categoryId || undefined,
      name: form.name.trim(),
      sku: form.sku.trim(),
      unit: form.unit.trim() || undefined,
      costPriceVnd: Number(form.costPriceVnd),
      sellPriceVnd: Number(form.sellPriceVnd),
      stockQuantity: Number(form.stockQuantity),
      lowStockThreshold: Number(form.lowStockThreshold),
      status: form.status,
    });
  }

  const products = productsQ.data ?? [];
  const lowStock = lowStockQ.data ?? [];
  return (
    <main className="space-y-4 p-4">
      <div className="flex items-center justify-between gap-2">
        <h1 className="text-xl font-bold">Kho hàng</h1>
        <button
          type="button"
          onClick={() => { setEditing(null); setShowForm((v) => !v); }}
          className={btnPrimary}
        >
          {showForm ? "Đóng form" : "Thêm sản phẩm"}
        </button>
      </div>
      {notice ? <Notice kind={notice.kind} text={notice.text} onClose={() => setNotice(null)} /> : null}

      <Card title="Sản phẩm sắp hết hàng">
        {lowStockQ.isLoading ? <Loading /> : lowStockQ.isError ? (
          <ErrorBox message={errMsg(lowStockQ.error)} onRetry={() => void lowStockQ.refetch()} />
        ) : lowStock.length === 0 ? (
          <p className="text-sm text-[#748294]">Chưa có sản phẩm nào sắp hết hàng.</p>
        ) : (
          <ul className="space-y-2">
            {lowStock.map((p) => (
              <li key={idOf(p)} className="flex justify-between gap-2 text-sm">
                <span className="min-w-0 flex-1 truncate">{s(p, "name")}</span>
                <span className="shrink-0"><Badge tone="amber">Còn {n(p, "stockQuantity", "stock_quantity")} {s(p, "unit") || ""}</Badge></span>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card title="Nhóm sản phẩm">
        <div className="flex gap-2">
          <input value={catName} onChange={(e) => setCatName(e.target.value)} placeholder="Tên nhóm mới" aria-label="Tên nhóm sản phẩm mới" className={`${inputCls} min-w-0 flex-1`} />
          <button type="button" disabled={catMut.isPending || !catName.trim()} onClick={() => catMut.mutate(catName.trim())} className={`${btnSecondary} shrink-0`}>Thêm nhóm</button>
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          <button type="button" onClick={() => setCategoryId("")} className={categoryId === "" ? btnPrimary : btnSecondary}>Tất cả</button>
          {(catsQ.data ?? []).map((c) => (
            <button key={idOf(c)} type="button" onClick={() => setCategoryId(idOf(c))} className={categoryId === idOf(c) ? btnPrimary : btnSecondary}>{s(c, "name")}</button>
          ))}
        </div>
      </Card>

      {showForm ? (
        <Card title={editing ? "Sửa sản phẩm" : "Thêm sản phẩm"}>
          <div className="space-y-4">
            <Field label="Tên sản phẩm">
              <input value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} placeholder="vd: Sơn gel OPI đỏ" className={inputCls} />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Mã SKU">
                <input value={form.sku} onChange={(e) => setForm((f) => ({ ...f, sku: e.target.value }))} placeholder="vd: GEL-RED-01" className={inputCls} />
              </Field>
              <Field label="Đơn vị">
                <input value={form.unit} onChange={(e) => setForm((f) => ({ ...f, unit: e.target.value }))} className={inputCls} />
              </Field>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Giá nhập (VND)">
                <input type="number" inputMode="numeric" min={0} value={form.costPriceVnd} onChange={(e) => setForm((f) => ({ ...f, costPriceVnd: e.target.value }))} className={inputCls} />
              </Field>
              <Field label="Giá bán (VND)">
                <input type="number" inputMode="numeric" min={0} value={form.sellPriceVnd} onChange={(e) => setForm((f) => ({ ...f, sellPriceVnd: e.target.value }))} className={inputCls} />
              </Field>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Tồn kho hiện tại">
                <input type="number" inputMode="numeric" min={0} value={form.stockQuantity} onChange={(e) => setForm((f) => ({ ...f, stockQuantity: e.target.value }))} className={inputCls} />
              </Field>
              <Field label="Ngưỡng báo hết hàng">
                <input type="number" inputMode="numeric" min={0} value={form.lowStockThreshold} onChange={(e) => setForm((f) => ({ ...f, lowStockThreshold: e.target.value }))} className={inputCls} />
              </Field>
            </div>
            <Field label="Trạng thái">
              <select value={form.status} onChange={(e) => setForm((f) => ({ ...f, status: e.target.value }))} className={inputCls}>
                <option value="active">Đang bán</option>
                <option value="inactive">Ngừng bán</option>
              </select>
            </Field>
            {formError ? <p role="alert" className="text-sm text-[#C0392B]">{formError}</p> : null}
            <button type="button" onClick={submit} disabled={saveMut.isPending} className={`${btnPrimary} w-full`}>
              {saveMut.isPending ? "Đang xử lý..." : editing ? "Lưu thay đổi" : "Thêm sản phẩm"}
            </button>
          </div>
        </Card>
      ) : null}

      {productsQ.isLoading ? (
        <Loading />
      ) : productsQ.isError ? (
        <ErrorBox message={errMsg(productsQ.error)} onRetry={() => void productsQ.refetch()} />
      ) : products.length === 0 ? (
        <Empty text="Chưa có sản phẩm nào." action={<button type="button" onClick={() => setShowForm(true)} className={btnPrimary}>Thêm sản phẩm</button>} />
      ) : (
        <Card title={`${products.length} sản phẩm`}>
          <ul className="space-y-3">
            {products.map((p) => {
              const low = n(p, "stockQuantity", "stock_quantity") <= n(p, "lowStockThreshold", "low_stock_threshold");
              return (
                <li key={idOf(p)} className="rounded-lg border border-[#E5E9ED] p-3">
                  <div className="flex items-center justify-between gap-2">
                    <p className="min-w-0 flex-1 truncate text-sm font-medium">{s(p, "name")}</p>
                    {low ? <span className="shrink-0"><Badge tone="amber">Sắp hết</Badge></span> : null}
                  </div>
                  <p className="mt-1 break-words text-sm tabular-nums text-[#748294]">
                    SKU: {s(p, "sku")} · Giá bán: {formatVnd(n(p, "sellPriceVnd", "sell_price_vnd"))} · Tồn: {n(p, "stockQuantity", "stock_quantity")} {s(p, "unit")}
                  </p>
                  <button type="button" onClick={() => startEdit(p)} className={`${btnSecondary} mt-2`}>Sửa</button>
                </li>
              );
            })}
          </ul>
        </Card>
      )}

      <Card title="Nhập / xuất / điều chỉnh kho">
        <div className="space-y-4">
          <Field label="Sản phẩm">
            <select value={move.productId} onChange={(e) => setMove((m) => ({ ...m, productId: e.target.value }))} className={inputCls}>
              <option value="">— Chọn sản phẩm —</option>
              {products.map((p) => (
                <option key={idOf(p)} value={idOf(p)}>{s(p, "name")} (tồn {n(p, "stockQuantity", "stock_quantity")})</option>
              ))}
            </select>
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Loại">
              <select value={move.type} onChange={(e) => setMove((m) => ({ ...m, type: e.target.value }))} className={inputCls}>
                <option value="in">Nhập kho</option>
                <option value="out">Xuất kho</option>
                <option value="adjust">Điều chỉnh</option>
              </select>
            </Field>
            <Field label="Số lượng">
              <input type="number" inputMode="numeric" value={move.quantity} onChange={(e) => setMove((m) => ({ ...m, quantity: e.target.value }))} placeholder="vd: 10" className={inputCls} />
            </Field>
          </div>
          <p className="text-xs text-[#748294]">Nhập số dương cho nhập/xuất; điều chỉnh dùng số âm để giảm, số dương để tăng.</p>
          <button
            type="button"
            disabled={moveMut.isPending || !move.productId || !move.quantity}
            onClick={() => moveMut.mutate()}
            className={`${btnPrimary} w-full`}
          >
            {moveMut.isPending ? "Đang xử lý..." : "Ghi nhận"}
          </button>
        </div>
      </Card>

      <Card title="Đơn đặt hàng">
        <div className="space-y-4">
          <div className="flex flex-col gap-2 sm:flex-row">
            <input value={supplierName} onChange={(e) => setSupplierName(e.target.value)} placeholder="Tên nhà cung cấp mới" aria-label="Tên nhà cung cấp mới" className={`${inputCls} min-w-0 flex-1`} />
            <input value={supplierPhone} onChange={(e) => setSupplierPhone(e.target.value)} placeholder="SĐT" aria-label="SĐT nhà cung cấp" className={`${inputCls} min-w-0 flex-1`} />
            <button type="button" disabled={supplierMut.isPending || !supplierName.trim()} onClick={() => supplierMut.mutate()} className={`${btnSecondary} shrink-0`}>Thêm NCC</button>
          </div>
          <Field label="Nhà cung cấp">
            <select value={po.supplierId} onChange={(e) => setPo((p) => ({ ...p, supplierId: e.target.value }))} className={inputCls}>
              <option value="">— Chọn nhà cung cấp —</option>
              {(suppliersQ.data ?? []).map((sp) => (
                <option key={idOf(sp)} value={idOf(sp)}>{s(sp, "name")}</option>
              ))}
            </select>
          </Field>
          <Field label="Sản phẩm đặt">
            <select value={po.productId} onChange={(e) => setPo((p) => ({ ...p, productId: e.target.value }))} className={inputCls}>
              <option value="">— Chọn sản phẩm —</option>
              {products.map((p) => (
                <option key={idOf(p)} value={idOf(p)}>{s(p, "name")}</option>
              ))}
            </select>
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Số lượng">
              <input type="number" inputMode="numeric" min={1} value={po.quantity} onChange={(e) => setPo((p) => ({ ...p, quantity: e.target.value }))} className={inputCls} />
            </Field>
            <Field label="Giá nhập / đơn vị (VND)">
              <input type="number" inputMode="numeric" min={0} value={po.unitCostVnd} onChange={(e) => setPo((p) => ({ ...p, unitCostVnd: e.target.value }))} className={inputCls} />
            </Field>
          </div>
          <button
            type="button"
            disabled={poMut.isPending || !po.supplierId || !po.productId || !po.quantity || !po.unitCostVnd}
            onClick={() => poMut.mutate()}
            className={`${btnPrimary} w-full`}
          >
            {poMut.isPending ? "Đang xử lý..." : "Tạo đơn đặt hàng"}
          </button>
        </div>
        <div className="mt-4">
          {posQ.isLoading ? <Loading /> : posQ.isError ? (
            <ErrorBox message={errMsg(posQ.error)} onRetry={() => void posQ.refetch()} />
          ) : (posQ.data ?? []).length === 0 ? (
            <p className="text-sm text-[#748294]">Chưa có đơn đặt hàng nào.</p>
          ) : (
            <ul className="space-y-2">
              {(posQ.data ?? []).map((o) => (
                <li key={idOf(o)} className="flex items-center justify-between gap-2 rounded-lg border border-[#E5E9ED] p-3 text-sm">
                  <span className="min-w-0 flex-1 break-words tabular-nums">
                    {s(o, "supplierName", "supplier_name") || "Đơn đặt hàng"} · {formatVnd(n(o, "totalCostVnd", "total_cost_vnd"))}
                    {" "}<Badge tone={badgeToneForStatus(s(o, "status"))}>{PO_STATUS_LABEL[s(o, "status")] ?? s(o, "status")}</Badge>
                  </span>
                  {s(o, "status") !== "received" && s(o, "status") !== "cancelled" ? (
                    <button type="button" disabled={receiveMut.isPending} onClick={() => receiveMut.mutate(idOf(o))} className={`${btnSecondary} shrink-0`}>Nhận hàng</button>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </div>
      </Card>
    </main>
  );
}
