// Invoices / POS — Hono routes.
// Nguồn: CONTRACTS.md §4, API_SPEC.md §6, DATABASE_SCHEMA.md §5.
// Mọi route đi qua authMiddleware; tenant lấy từ session, không tin client.
// Tiền integer VND; total = subtotal − discount + surcharge (calculateInvoiceTotal).
import { Hono } from "hono";
import type { ZodError } from "zod";
import {
  apiError,
  applyMovement,
  calculateCommissions,
  calculateInvoiceTotal,
  checkStockAvailable,
  deriveInvoiceStatus,
  movementQuantity,
  type CommissionItemInput,
  type CommissionRuleInput,
  type SessionContext,
} from "@quanly/shared";
import type { Env } from "../index.js";
import { authMiddleware } from "../auth.js";
import { requirePermission } from "../rbac.js";
import { auditInsertStatement } from "../audit.js";
import { newId, nowIso, pageMeta, pagination } from "../db.js";
import { invoiceCreateSchema, paymentSchema, refundSchema } from "../validation.js";

export const invoiceRoutes = new Hono<{ Bindings: Env; Variables: { session: SessionContext } }>();

function zodMessage(err: ZodError): string {
  return err.issues.map((i) => `${i.path.join(".") || "body"}: ${i.message}`).join("; ");
}

const INVOICE_STATUSES = [
  "draft",
  "unpaid",
  "partially_paid",
  "paid",
  "refunded",
  "partially_refunded",
  "void",
  "cancelled",
] as const;

interface InvoiceRow {
  id: string;
  tenantId: string;
  branchId: string;
  bookingId: string | null;
  customerId: string;
  invoiceNo: string;
  subtotalVnd: number;
  discountVnd: number;
  surchargeVnd: number;
  totalVnd: number;
  paidVnd: number;
  refundedVnd: number;
  status: string;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
}

interface InvoiceItemRow {
  id: string;
  invoiceId: string;
  itemType: string;
  refId: string | null;
  nameSnapshot: string;
  unitPriceVndSnapshot: number;
  quantity: number;
  technicianId: string | null;
  sellerId: string | null;
  lineTotalVnd: number;
  createdAt: string;
}

const INVOICE_SELECT = `SELECT id, tenant_id AS tenantId, branch_id AS branchId,
  booking_id AS bookingId, customer_id AS customerId, invoice_no AS invoiceNo,
  subtotal_vnd AS subtotalVnd, discount_vnd AS discountVnd, surcharge_vnd AS surchargeVnd,
  total_vnd AS totalVnd, paid_vnd AS paidVnd, refunded_vnd AS refundedVnd,
  status, created_by AS createdBy, created_at AS createdAt, updated_at AS updatedAt
  FROM invoices`;

const ITEM_SELECT = `SELECT id, invoice_id AS invoiceId, item_type AS itemType,
  ref_id AS refId, name_snapshot AS nameSnapshot,
  unit_price_vnd_snapshot AS unitPriceVndSnapshot, quantity,
  technician_id AS technicianId, seller_id AS sellerId,
  line_total_vnd AS lineTotalVnd, created_at AS createdAt
  FROM invoice_items`;

type FlowError = {
  status: 400 | 403 | 404 | 409 | 422;
  code: "NOT_FOUND" | "FORBIDDEN" | "CONFLICT" | "UNPROCESSABLE" | "VALIDATION_ERROR";
  message: string;
};

function flowError(status: FlowError["status"], code: FlowError["code"], message: string): FlowError {
  return { status, code, message };
}

/** Branch ngoài phạm vi session -> true (403). */
function branchOutOfScope(session: SessionContext, branchId: string): boolean {
  return !session.branchIds.includes(branchId);
}

// ---------------------------------------------------------------------------
// Commission — active rules + tạo commission khi invoice thành "paid".
// ---------------------------------------------------------------------------

export interface ActiveCommissionRule {
  rule: CommissionRuleInput;
  versionId: string;
}

/**
 * Nạp các rule đang active của tenant kèm version hiện tại.
 * CommissionRuleInput được dựng từ dòng commission_rules HIỆN TẠI (không phải
 * snapshot JSON): các field versioned (rate/scope) chỉ đổi qua endpoint
 * versions (đồng thời ghi snapshot mới), còn metadata (status/priority/
 * validity) đổi qua PATCH không tạo version nên phải đọc từ dòng hiện tại
 * thì thay đổi mới có hiệu lực cho các invoice sau đó. rule_version_id lưu
 * vào calculation vẫn là version đã snapshot — lịch sử không bị tính lại.
 */
export async function loadActiveCommissionRules(
  db: D1Database,
  tenantId: string,
): Promise<ActiveCommissionRule[]> {
  const rows = await db
    .prepare(
      `SELECT r.id AS id, r.scope_type AS scopeType, r.scope_ref_id AS scopeRefId,
              r.rate_type AS rateType, r.rate_value AS rateValue,
              r.min_sales_vnd AS minSalesVnd, r.max_amount_vnd AS maxAmountVnd,
              r.priority AS priority, r.valid_from AS validFrom, r.valid_to AS validTo,
              r.status AS status, r.created_at AS createdAt, v.id AS versionId
       FROM commission_rules r
       JOIN commission_rule_versions v ON v.rule_id = r.id AND v.version = r.version
       WHERE r.tenant_id = ? AND r.status = 'active'`,
    )
    .bind(tenantId)
    .all<{
      id: string;
      scopeType: string;
      scopeRefId: string | null;
      rateType: string;
      rateValue: number;
      minSalesVnd: number | null;
      maxAmountVnd: number | null;
      priority: number;
      validFrom: string;
      validTo: string | null;
      status: string;
      createdAt: string;
      versionId: string;
    }>();
  return (rows.results ?? []).map((row) => ({
    versionId: row.versionId,
    rule: {
      id: row.id,
      ruleVersionId: row.versionId,
      scopeType: row.scopeType as CommissionRuleInput["scopeType"],
      scopeRefId: row.scopeRefId,
      rateType: row.rateType as "percent" | "fixed",
      rateValue: row.rateValue,
      minSalesVnd: row.minSalesVnd,
      maxAmountVnd: row.maxAmountVnd,
      priority: row.priority,
      validFrom: row.validFrom,
      validTo: row.validTo,
      status: row.status,
      createdAt: row.createdAt,
    },
  }));
}

/**
 * Tạo commission_calculations (pending) + commission_items cho một invoice vừa
 * thành "paid". Chạy calculateCommissions (shared) trên các rule active, gom
 * breakdown theo từng cặp (employee, ruleVersionId) thành một calculation mỗi
 * cặp: base_amount_vnd = tổng line total của nhân viên đó trong cặp đó,
 * commission_vnd = tổng hoa hồng của cặp đó. period = YYYY-MM của paidAt.
 * Ghi bằng db.batch riêng (được gọi sau khi payment đã commit).
 */
export async function createCommissionsForInvoice(
  db: D1Database,
  tenantId: string,
  invoice: { id: string; branchId: string },
): Promise<string[]> {
  const paidAt = nowIso();
  const itemRows = await db
    .prepare(
      `SELECT id, item_type AS itemType, ref_id AS refId,
              line_total_vnd AS lineTotalVnd,
              technician_id AS technicianId, seller_id AS sellerId
       FROM invoice_items WHERE invoice_id = ?`,
    )
    .bind(invoice.id)
    .all<{
      id: string;
      itemType: string;
      refId: string | null;
      lineTotalVnd: number;
      technicianId: string | null;
      sellerId: string | null;
    }>();
  const rows = itemRows.results ?? [];
  if (rows.length === 0) return [];
  const active = await loadActiveCommissionRules(db, tenantId);
  if (active.length === 0) return [];

  // Role của từng nhân viên (phục vụ scope role): employees -> users -> user_tenants -> roles.
  const employeeIds = [
    ...new Set(
      rows
        .map((r) => r.technicianId ?? r.sellerId)
        .filter((x): x is string => x !== null),
    ),
  ];
  const roles = new Map<string, string | null>();
  if (employeeIds.length > 0) {
    const placeholders = employeeIds.map(() => "?").join(",");
    const roleRows = await db
      .prepare(
        `SELECT e.id AS employeeId, r.name AS roleName
         FROM employees e
         LEFT JOIN users u ON u.id = e.user_id
         LEFT JOIN user_tenants ut ON ut.user_id = u.id AND ut.tenant_id = e.tenant_id
         LEFT JOIN roles r ON r.id = ut.role_id
         WHERE e.tenant_id = ? AND e.id IN (${placeholders})`,
      )
      .bind(tenantId, ...employeeIds)
      .all<{ employeeId: string; roleName: string | null }>();
    for (const rr of roleRows.results ?? []) roles.set(rr.employeeId, rr.roleName);
  }

  const inputs: CommissionItemInput[] = rows.map((r) => {
    const employeeId = r.technicianId ?? r.sellerId;
    return {
      id: r.id,
      itemType: r.itemType as "service" | "product",
      refId: r.refId,
      lineTotalVnd: r.lineTotalVnd,
      employeeId,
      employeeRole: employeeId ? (roles.get(employeeId) ?? null) : null,
      branchId: invoice.branchId,
    };
  });
  const result = calculateCommissions(
    inputs,
    active.map((a) => a.rule),
    paidAt,
  );
  if (result.breakdown.length === 0) return [];

  const lineTotals = new Map(rows.map((r) => [r.id, r.lineTotalVnd]));
  interface Group {
    employeeId: string;
    ruleVersionId: string;
    base: number;
    commission: number;
    items: { invoiceItemId: string; ruleId: string; amount: number }[];
  }
  const groups = new Map<string, Group>();
  for (const b of result.breakdown) {
    if (b.employeeId === null) continue;
    const key = `${b.employeeId}|${b.ruleVersionId}`;
    let g = groups.get(key);
    if (!g) {
      g = { employeeId: b.employeeId, ruleVersionId: b.ruleVersionId, base: 0, commission: 0, items: [] };
      groups.set(key, g);
    }
    g.base += lineTotals.get(b.invoiceItemId) ?? 0;
    g.commission += b.amountVnd;
    g.items.push({ invoiceItemId: b.invoiceItemId, ruleId: b.ruleId, amount: b.amountVnd });
  }

  const period = paidAt.slice(0, 7);
  const stmts: D1PreparedStatement[] = [];
  const calcIds: string[] = [];
  for (const g of groups.values()) {
    const calcId = newId();
    calcIds.push(calcId);
    stmts.push(
      db
        .prepare(
          `INSERT INTO commission_calculations
             (id, tenant_id, invoice_id, employee_id, rule_version_id,
              base_amount_vnd, commission_vnd, status, period, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?)`,
        )
        .bind(calcId, tenantId, invoice.id, g.employeeId, g.ruleVersionId, g.base, g.commission, period, paidAt, paidAt),
    );
    for (const it of g.items) {
      stmts.push(
        db
          .prepare(
            `INSERT INTO commission_items (id, calculation_id, invoice_item_id, rule_id, amount_vnd, created_at)
             VALUES (?, ?, ?, ?, ?, ?)`,
          )
          .bind(newId(), calcId, it.invoiceItemId, it.ruleId, it.amount, paidAt),
      );
    }
  }
  await db.batch(stmts);
  return calcIds;
}

// ---------------------------------------------------------------------------
// Tạo invoice (dùng chung cho POST /invoices và POST /bookings/:id/create-invoice).
// ---------------------------------------------------------------------------

interface ManualItemInput {
  itemType: "service" | "product";
  refId?: string | null;
  name?: string | null;
  unitPriceVnd?: number;
  quantity: number;
  technicianId?: string | null;
  sellerId?: string | null;
}

interface ResolvedLine {
  itemType: "service" | "product";
  refId: string | null;
  name: string;
  unitPriceVnd: number;
  quantity: number;
  technicianId: string | null;
  sellerId: string | null;
  lineTotalVnd: number;
  productId: string | null;
  newStock: number | null;
}

async function resolveManualItem(
  db: D1Database,
  tenantId: string,
  branchId: string,
  item: ManualItemInput,
): Promise<ResolvedLine | FlowError> {
  if (!item.refId) {
    return flowError(422, "UNPROCESSABLE", "Mỗi dòng hóa đơn cần có refId (dịch vụ hoặc sản phẩm).");
  }
  // Nhân viên thực hiện / bán (nếu có) phải thuộc tenant.
  for (const empId of [item.technicianId ?? null, item.sellerId ?? null]) {
    if (empId) {
      const emp = await db
        .prepare(`SELECT id FROM employees WHERE id = ? AND tenant_id = ? AND deleted_at IS NULL`)
        .bind(empId, tenantId)
        .first<{ id: string }>();
      if (!emp) return flowError(404, "NOT_FOUND", "Nhân viên trong dòng hóa đơn không tồn tại.");
    }
  }
  if (item.itemType === "service") {
    const svc = await db
      .prepare(
        `SELECT id, name, price_vnd AS priceVnd, status FROM services
         WHERE id = ? AND tenant_id = ? AND deleted_at IS NULL`,
      )
      .bind(item.refId, tenantId)
      .first<{ id: string; name: string; priceVnd: number; status: string }>();
    if (!svc) return flowError(404, "NOT_FOUND", "Dịch vụ không tồn tại.");
    if (svc.status !== "active") {
      return flowError(422, "UNPROCESSABLE", `Dịch vụ "${svc.name}" hiện không hoạt động.`);
    }
    const override = await db
      .prepare(
        `SELECT price_vnd AS priceVnd, is_available AS isAvailable
         FROM service_branch_settings WHERE service_id = ? AND branch_id = ?`,
      )
      .bind(item.refId, branchId)
      .first<{ priceVnd: number | null; isAvailable: number }>();
    if (override && override.isAvailable === 0) {
      return flowError(422, "UNPROCESSABLE", `Dịch vụ "${svc.name}" không áp dụng tại chi nhánh này.`);
    }
    const price = override?.priceVnd ?? svc.priceVnd;
    return {
      itemType: "service",
      refId: item.refId,
      name: item.name ?? svc.name,
      unitPriceVnd: price,
      quantity: item.quantity,
      technicianId: item.technicianId ?? null,
      sellerId: item.sellerId ?? null,
      lineTotalVnd: price * item.quantity,
      productId: null,
      newStock: null,
    };
  }
  const prod = await db
    .prepare(
      `SELECT id, name, sell_price_vnd AS sellPriceVnd, stock_quantity AS stockQuantity, status
       FROM products WHERE id = ? AND tenant_id = ? AND deleted_at IS NULL`,
    )
    .bind(item.refId, tenantId)
    .first<{ id: string; name: string; sellPriceVnd: number; stockQuantity: number; status: string }>();
  if (!prod) return flowError(404, "NOT_FOUND", "Sản phẩm không tồn tại.");
  if (prod.status !== "active") {
    return flowError(422, "UNPROCESSABLE", `Sản phẩm "${prod.name}" hiện không hoạt động.`);
  }
  if (!checkStockAvailable(prod.stockQuantity, item.quantity)) {
    return flowError(422, "UNPROCESSABLE",
      `Sản phẩm "${prod.name}" không đủ tồn kho (còn ${prod.stockQuantity}, cần ${item.quantity}).`,
    );
  }
  const price = prod.sellPriceVnd;
  return {
    itemType: "product",
    refId: item.refId,
    name: item.name ?? prod.name,
    unitPriceVnd: price,
    quantity: item.quantity,
    technicianId: item.technicianId ?? null,
    sellerId: item.sellerId ?? null,
    lineTotalVnd: price * item.quantity,
    productId: prod.id,
    newStock: applyMovement(prod.stockQuantity, "sale", item.quantity),
  };
}

interface CreateInvoiceInput {
  branchId: string;
  bookingId: string | null;
  customerId: string | null;
  manualItems: ManualItemInput[];
  discountVnd: number;
  surchargeVnd: number;
}

type CreateInvoiceResult =
  | { ok: true; invoice: InvoiceRow; items: InvoiceItemRow[] }
  | { ok: false; error: FlowError };

async function buildAndInsertInvoice(
  db: D1Database,
  session: SessionContext,
  tenantId: string,
  input: CreateInvoiceInput,
): Promise<CreateInvoiceResult> {
  const now = nowIso();
  if (branchOutOfScope(session, input.branchId)) {
    return { ok: false, error: flowError(403, "FORBIDDEN", "Chi nhánh ngoài phạm vi được phân quyền.") };
  }

  // Booking (nếu có): phải completed, cùng chi nhánh; prefill từ booking_items.
  let booking: { id: string; branchId: string; customerId: string; technicianId: string | null } | null = null;
  if (input.bookingId) {
    const row = await db
      .prepare(
        `SELECT id, branch_id AS branchId, customer_id AS customerId,
                technician_id AS technicianId, status
         FROM bookings WHERE id = ? AND tenant_id = ?`,
      )
      .bind(input.bookingId, tenantId)
      .first<{ id: string; branchId: string; customerId: string; technicianId: string | null; status: string }>();
    if (!row) return { ok: false, error: flowError(404, "NOT_FOUND", "Lịch hẹn không tồn tại.") };
    if (row.status !== "completed") {
      return {
        ok: false,
        error: flowError(422, "UNPROCESSABLE",
          "Chỉ tạo hóa đơn từ lịch hẹn đã hoàn thành (completed).",
        ),
      };
    }
    if (row.branchId !== input.branchId) {
      return { ok: false, error: flowError(422, "UNPROCESSABLE", "Lịch hẹn thuộc chi nhánh khác.") };
    }
    booking = row;
  }

  // Khách hàng: bắt buộc khi không có booking; nếu có cả hai mà khác nhau -> 422.
  const customerId = input.customerId ?? booking?.customerId ?? null;
  if (input.bookingId && input.customerId && booking && input.customerId !== booking.customerId) {
    return {
      ok: false,
      error: flowError(422, "UNPROCESSABLE", "Khách hàng không khớp với lịch hẹn."),
    };
  }
  if (!customerId) {
    return { ok: false, error: flowError(422, "UNPROCESSABLE", "Hóa đơn phải có khách hàng.") };
  }
  const customer = await db
    .prepare(`SELECT id FROM customers WHERE id = ? AND tenant_id = ? AND deleted_at IS NULL`)
    .bind(customerId, tenantId)
    .first<{ id: string }>();
  if (!customer) return { ok: false, error: flowError(404, "NOT_FOUND", "Khách hàng không tồn tại.") };

  // Dòng hóa đơn: từ booking thì dịch vụ lấy snapshot booking_items (dòng
  // service trong body bị bỏ qua — booking là nguồn duy nhất cho dịch vụ),
  // cộng thêm dòng product trong body (bán thêm tại quầy). Không booking thì
  // toàn bộ dòng trong body được định giá lại từ bảng services/products.
  const lines: ResolvedLine[] = [];
  if (booking) {
    const biRows = await db
      .prepare(
        `SELECT service_id AS serviceId, service_name_snapshot AS serviceName,
                price_vnd_snapshot AS priceVnd, technician_id AS technicianId
         FROM booking_items WHERE booking_id = ?`,
      )
      .bind(booking.id)
      .all<{ serviceId: string; serviceName: string; priceVnd: number; technicianId: string | null }>();
    for (const bi of biRows.results ?? []) {
      lines.push({
        itemType: "service",
        refId: bi.serviceId,
        name: bi.serviceName,
        unitPriceVnd: bi.priceVnd,
        quantity: 1,
        technicianId: bi.technicianId ?? booking.technicianId,
        sellerId: null,
        lineTotalVnd: bi.priceVnd,
        productId: null,
        newStock: null,
      });
    }
    for (const item of input.manualItems.filter((i) => i.itemType === "product")) {
      const resolved = await resolveManualItem(db, tenantId, input.branchId, item);
      if ("status" in resolved) return { ok: false, error: resolved };
      lines.push(resolved);
    }
  } else {
    for (const item of input.manualItems) {
      const resolved = await resolveManualItem(db, tenantId, input.branchId, item);
      if ("status" in resolved) return { ok: false, error: resolved };
      lines.push(resolved);
    }
  }
  if (lines.length === 0) {
    return { ok: false, error: flowError(422, "UNPROCESSABLE", "Hóa đơn phải có ít nhất 1 dòng.") };
  }

  const subtotal = lines.reduce((s, l) => s + l.lineTotalVnd, 0);
  let total: number;
  try {
    total = calculateInvoiceTotal({
      subtotalVnd: subtotal,
      discountVnd: input.discountVnd,
      surchargeVnd: input.surchargeVnd,
    });
  } catch (e) {
    return {
      ok: false,
      error: flowError(422, "UNPROCESSABLE", e instanceof Error ? e.message : "Giảm giá không hợp lệ."),
    };
  }

  // invoice_no = HD-YYYY- + số thứ tự của tenant (đếm + 1, 4 chữ số).
  const countRow = await db
    .prepare(`SELECT COUNT(*) AS total FROM invoices WHERE tenant_id = ?`)
    .bind(tenantId)
    .first<{ total: number }>();
  const seq = (countRow?.total ?? 0) + 1;
  const invoiceNo = `HD-${now.slice(0, 4)}-${String(seq).padStart(4, "0")}`;

  const invoiceId = newId();
  const stmts: D1PreparedStatement[] = [];
  stmts.push(
    db
      .prepare(
        `INSERT INTO invoices
           (id, tenant_id, branch_id, booking_id, customer_id, invoice_no,
            subtotal_vnd, discount_vnd, surcharge_vnd, total_vnd,
            paid_vnd, refunded_vnd, status, created_by, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0, 'unpaid', ?, ?, ?)`,
      )
      .bind(
        invoiceId, tenantId, input.branchId, input.bookingId, customerId, invoiceNo,
        subtotal, input.discountVnd, input.surchargeVnd, total,
        session.userId, now, now,
      ),
  );
  const itemRows: InvoiceItemRow[] = [];
  for (const line of lines) {
    const itemId = newId();
    itemRows.push({
      id: itemId,
      invoiceId,
      itemType: line.itemType,
      refId: line.refId,
      nameSnapshot: line.name,
      unitPriceVndSnapshot: line.unitPriceVnd,
      quantity: line.quantity,
      technicianId: line.technicianId,
      sellerId: line.sellerId,
      lineTotalVnd: line.lineTotalVnd,
      createdAt: now,
    });
    stmts.push(
      db
        .prepare(
          `INSERT INTO invoice_items
             (id, invoice_id, item_type, ref_id, name_snapshot,
              unit_price_vnd_snapshot, quantity, technician_id, seller_id,
              line_total_vnd, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .bind(
          itemId, invoiceId, line.itemType, line.refId, line.name,
          line.unitPriceVnd, line.quantity, line.technicianId, line.sellerId,
          line.lineTotalVnd, now,
        ),
    );
    if (line.itemType === "product" && line.productId && line.newStock !== null) {
      stmts.push(
        db
          .prepare(
            `INSERT INTO stock_movements
               (id, tenant_id, product_id, location_id, type, quantity,
                ref_type, ref_id, created_by, created_at)
             VALUES (?, ?, ?, NULL, 'sale', ?, 'invoice', ?, ?, ?)`,
          )
          .bind(newId(), tenantId, line.productId, movementQuantity("sale", line.quantity), invoiceId, session.userId, now),
      );
      stmts.push(
        db
          .prepare(`UPDATE products SET stock_quantity = ? WHERE id = ? AND tenant_id = ?`)
          .bind(line.newStock, line.productId, tenantId),
      );
    }
  }
  if (input.discountVnd > 0) {
    stmts.push(
      db
        .prepare(
          `INSERT INTO discounts (id, invoice_id, type, value, reason, applied_by, created_at)
           VALUES (?, ?, 'fixed', ?, NULL, ?, ?)`,
        )
        .bind(newId(), invoiceId, input.discountVnd, session.userId, now),
    );
  }
  stmts.push(
    auditInsertStatement(db, {
      tenantId,
      userId: session.userId,
      action: "invoice.create",
      entityType: "invoice",
      entityId: invoiceId,
      branchId: input.branchId,
      metadata: { invoiceNo, totalVnd: total, bookingId: input.bookingId ?? null },
    }),
  );
  await db.batch(stmts);

  const invoice: InvoiceRow = {
    id: invoiceId,
    tenantId,
    branchId: input.branchId,
    bookingId: input.bookingId,
    customerId,
    invoiceNo,
    subtotalVnd: subtotal,
    discountVnd: input.discountVnd,
    surchargeVnd: input.surchargeVnd,
    totalVnd: total,
    paidVnd: 0,
    refundedVnd: 0,
    status: "unpaid",
    createdBy: session.userId,
    createdAt: now,
    updatedAt: now,
  };
  return { ok: true, invoice, items: itemRows };
}

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

for (const p of ["/invoices", "/invoices/*", "/bookings", "/bookings/*"]) {
  invoiceRoutes.use(p, authMiddleware);
}

invoiceRoutes.post("/invoices", requirePermission("invoice.create"), async (c) => {
  const session = c.get("session");
  const tenantId = session.tenantId;
  if (!tenantId) {
    return c.json(apiError("FORBIDDEN", "Platform Admin không truy cập dữ liệu nghiệp vụ tenant."), 403);
  }
  const body = await c.req.json().catch(() => null);
  const parsed = invoiceCreateSchema.safeParse(body);
  if (!parsed.success) {
    return c.json(apiError("VALIDATION_ERROR", `Dữ liệu không hợp lệ: ${zodMessage(parsed.error)}`), 400);
  }
  const result = await buildAndInsertInvoice(c.env.DB, session, tenantId, {
    branchId: parsed.data.branchId,
    bookingId: parsed.data.bookingId ?? null,
    customerId: parsed.data.customerId ?? null,
    manualItems: parsed.data.items,
    discountVnd: parsed.data.discountVnd ?? 0,
    surchargeVnd: parsed.data.surchargeVnd ?? 0,
  });
  if (!result.ok) {
    return c.json(apiError(result.error.code, result.error.message), result.error.status);
  }
  return c.json({ data: { ...result.invoice, items: result.items } }, 201);
});

invoiceRoutes.get("/invoices", requirePermission("invoice.create"), async (c) => {
  const session = c.get("session");
  const tenantId = session.tenantId;
  if (!tenantId) {
    return c.json(apiError("FORBIDDEN", "Platform Admin không truy cập dữ liệu nghiệp vụ tenant."), 403);
  }
  const { page, limit, offset } = pagination(c);
  const branchId = c.req.query("branch_id");
  const status = c.req.query("status");
  const customerId = c.req.query("customer_id");
  const search = c.req.query("search");
  if (status && !INVOICE_STATUSES.includes(status as (typeof INVOICE_STATUSES)[number])) {
    return c.json(apiError("VALIDATION_ERROR", "Trạng thái hóa đơn không hợp lệ."), 400);
  }
  const conditions = ["i.tenant_id = ?"];
  const params: unknown[] = [tenantId];
  if (branchId) {
    if (branchOutOfScope(session, branchId)) {
      return c.json(apiError("FORBIDDEN", "Chi nhánh ngoài phạm vi được phân quyền."), 403);
    }
    conditions.push("i.branch_id = ?");
    params.push(branchId);
  } else if (session.branchIds.length > 0) {
    conditions.push(`i.branch_id IN (${session.branchIds.map(() => "?").join(",")})`);
    params.push(...session.branchIds);
  } else {
    conditions.push("1 = 0");
  }
  if (status) {
    conditions.push("i.status = ?");
    params.push(status);
  }
  if (customerId) {
    conditions.push("i.customer_id = ?");
    params.push(customerId);
  }
  if (search) {
    conditions.push("i.invoice_no LIKE ?");
    params.push(`%${search}%`);
  }
  const where = `WHERE ${conditions.join(" AND ")}`;
  const countRow = await c.env.DB.prepare(`SELECT COUNT(*) AS total FROM invoices i ${where}`)
    .bind(...params)
    .first<{ total: number }>();
  const total = countRow?.total ?? 0;
  const rows = await c.env.DB
    .prepare(`${INVOICE_SELECT.replace("FROM invoices", "FROM invoices i")} ${where} ORDER BY i.created_at DESC, i.id DESC LIMIT ? OFFSET ?`)
    .bind(...params, limit, offset)
    .all<InvoiceRow>();
  return c.json({ data: rows.results ?? [], meta: pageMeta(page, limit, total) });
});

invoiceRoutes.get("/invoices/:id", requirePermission("invoice.create"), async (c) => {
  const session = c.get("session");
  const tenantId = session.tenantId;
  if (!tenantId) {
    return c.json(apiError("FORBIDDEN", "Platform Admin không truy cập dữ liệu nghiệp vụ tenant."), 403);
  }
  const invoice = await c.env.DB.prepare(`${INVOICE_SELECT} WHERE id = ? AND tenant_id = ?`)
    .bind(c.req.param("id"), tenantId)
    .first<InvoiceRow>();
  if (!invoice) {
    return c.json(apiError("NOT_FOUND", "Không tìm thấy hóa đơn."), 404);
  }
  if (branchOutOfScope(session, invoice.branchId)) {
    return c.json(apiError("FORBIDDEN", "Chi nhánh ngoài phạm vi được phân quyền."), 403);
  }
  const items = await c.env.DB.prepare(`${ITEM_SELECT} WHERE invoice_id = ? ORDER BY created_at ASC, id ASC`)
    .bind(invoice.id)
    .all<InvoiceItemRow>();
  const payments = await c.env.DB
    .prepare(
      `SELECT id, invoice_id AS invoiceId, tenant_id AS tenantId, amount_vnd AS amountVnd,
              method, received_by AS receivedBy, paid_at AS paidAt, note, created_at AS createdAt
       FROM payments WHERE invoice_id = ? ORDER BY paid_at ASC, created_at ASC`,
    )
    .bind(invoice.id)
    .all();
  const refunds = await c.env.DB
    .prepare(
      `SELECT id, invoice_id AS invoiceId, tenant_id AS tenantId, amount_vnd AS amountVnd,
              reason, refunded_by AS refundedBy, refunded_at AS refundedAt, status,
              created_at AS createdAt
       FROM refunds WHERE invoice_id = ? ORDER BY refunded_at ASC, created_at ASC`,
    )
    .bind(invoice.id)
    .all();
  const discounts = await c.env.DB
    .prepare(
      `SELECT id, invoice_id AS invoiceId, type, value, reason, applied_by AS appliedBy,
              created_at AS createdAt
       FROM discounts WHERE invoice_id = ? ORDER BY created_at ASC`,
    )
    .bind(invoice.id)
    .all();
  return c.json({
    data: {
      ...invoice,
      items: items.results ?? [],
      payments: payments.results ?? [],
      refunds: refunds.results ?? [],
      discounts: discounts.results ?? [],
    },
  });
});

invoiceRoutes.post("/invoices/:id/payments", requirePermission("invoice.create"), async (c) => {
  const session = c.get("session");
  const tenantId = session.tenantId;
  if (!tenantId) {
    return c.json(apiError("FORBIDDEN", "Platform Admin không truy cập dữ liệu nghiệp vụ tenant."), 403);
  }
  const body = await c.req.json().catch(() => null);
  const parsed = paymentSchema.safeParse(body);
  if (!parsed.success) {
    return c.json(apiError("VALIDATION_ERROR", `Dữ liệu không hợp lệ: ${zodMessage(parsed.error)}`), 400);
  }
  const invoice = await c.env.DB.prepare(`${INVOICE_SELECT} WHERE id = ? AND tenant_id = ?`)
    .bind(c.req.param("id"), tenantId)
    .first<InvoiceRow>();
  if (!invoice) {
    return c.json(apiError("NOT_FOUND", "Không tìm thấy hóa đơn."), 404);
  }
  if (branchOutOfScope(session, invoice.branchId)) {
    return c.json(apiError("FORBIDDEN", "Chi nhánh ngoài phạm vi được phân quyền."), 403);
  }
  if (invoice.status === "void") {
    return c.json(apiError("UNPROCESSABLE", "Hóa đơn đã hủy, không thể thu tiền."), 422);
  }
  if (invoice.status === "refunded") {
    return c.json(apiError("UNPROCESSABLE", "Hóa đơn đã hoàn toàn bộ, không thể thu tiền."), 422);
  }
  const amount = parsed.data.amountVnd;
  if (invoice.paidVnd + amount > invoice.totalVnd) {
    return c.json(apiError("UNPROCESSABLE", "Số tiền thu vượt quá tổng tiền còn lại của hóa đơn."), 422);
  }
  const now = nowIso();
  const newPaid = invoice.paidVnd + amount;
  const newStatus = deriveInvoiceStatus(invoice.totalVnd, newPaid);
  const wasPaid = invoice.status === "paid";
  const paymentId = newId();
  const stmts: D1PreparedStatement[] = [];
  stmts.push(
    c.env.DB.prepare(
      `INSERT INTO payments (id, invoice_id, tenant_id, amount_vnd, method, received_by, paid_at, note, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(
      paymentId, invoice.id, tenantId, amount, parsed.data.method,
      session.userId, now, parsed.data.note ?? null, now,
    ),
  );
  stmts.push(
    c.env.DB.prepare(`UPDATE invoices SET paid_vnd = ?, status = ?, updated_at = ? WHERE id = ? AND tenant_id = ?`)
      .bind(newPaid, newStatus, now, invoice.id, tenantId),
  );
  // Khi hóa đơn vừa thành "paid": cộng doanh thu/lượt cho khách (chỉ tính ở
  // lần thanh toán chạm paid — các lần trả góp trước đó chưa tính vào
  // total_spent; xem ghi chú trong báo cáo).
  if (newStatus === "paid" && !wasPaid) {
    stmts.push(
      c.env.DB.prepare(
        `UPDATE customers
         SET total_spent_vnd = total_spent_vnd + ?, total_visits = total_visits + 1,
             last_visit_at = ?, updated_at = ?
         WHERE id = ? AND tenant_id = ?`,
      ).bind(amount, now, now, invoice.customerId, tenantId),
    );
  }
  stmts.push(
    auditInsertStatement(c.env.DB, {
      tenantId,
      userId: session.userId,
      action: "invoice.payment",
      entityType: "invoice",
      entityId: invoice.id,
      branchId: invoice.branchId,
      metadata: { invoiceNo: invoice.invoiceNo, amountVnd: amount, method: parsed.data.method, status: newStatus },
    }),
  );
  await c.env.DB.batch(stmts);

  let calculationIds: string[] = [];
  if (newStatus === "paid" && !wasPaid) {
    calculationIds = await createCommissionsForInvoice(c.env.DB, tenantId, invoice);
  }
  const updated: InvoiceRow = { ...invoice, paidVnd: newPaid, status: newStatus, updatedAt: now };
  return c.json(
    {
      data: {
        invoice: updated,
        payment: {
          id: paymentId,
          invoiceId: invoice.id,
          tenantId,
          amountVnd: amount,
          method: parsed.data.method,
          receivedBy: session.userId,
          paidAt: now,
          note: parsed.data.note ?? null,
          createdAt: now,
        },
        commissionCalculationIds: calculationIds,
      },
    },
    201,
  );
});

invoiceRoutes.post("/invoices/:id/refunds", requirePermission("invoice.refund"), async (c) => {
  const session = c.get("session");
  const tenantId = session.tenantId;
  if (!tenantId) {
    return c.json(apiError("FORBIDDEN", "Platform Admin không truy cập dữ liệu nghiệp vụ tenant."), 403);
  }
  const body = await c.req.json().catch(() => null);
  const parsed = refundSchema.safeParse(body);
  if (!parsed.success) {
    return c.json(apiError("VALIDATION_ERROR", `Dữ liệu không hợp lệ: ${zodMessage(parsed.error)}`), 400);
  }
  const invoice = await c.env.DB.prepare(`${INVOICE_SELECT} WHERE id = ? AND tenant_id = ?`)
    .bind(c.req.param("id"), tenantId)
    .first<InvoiceRow>();
  if (!invoice) {
    return c.json(apiError("NOT_FOUND", "Không tìm thấy hóa đơn."), 404);
  }
  if (branchOutOfScope(session, invoice.branchId)) {
    return c.json(apiError("FORBIDDEN", "Chi nhánh ngoài phạm vi được phân quyền."), 403);
  }
  const amount = parsed.data.amountVnd;
  // Hạn mức hoàn tiền theo role (PERMISSIONS.md §5, đề xuất 500.000đ):
  // Branch Manager chỉ hoàn tối đa 500.000đ không cần Owner.
  if (session.role === "branch_manager" && amount > 500000) {
    return c.json(
      apiError("FORBIDDEN", "Quản lý chi nhánh chỉ được hoàn tối đa 500.000đ; khoản lớn hơn cần Chủ tiệm duyệt."),
      403,
    );
  }
  if (amount > invoice.paidVnd - invoice.refundedVnd) {
    return c.json(apiError("UNPROCESSABLE", "Số tiền hoàn vượt quá số tiền đã thu chưa hoàn."), 422);
  }
  const now = nowIso();
  const newRefunded = invoice.refundedVnd + amount;
  const newStatus = newRefunded === invoice.paidVnd ? "refunded" : "partially_refunded";
  const refundId = newId();
  await c.env.DB.batch([
    c.env.DB.prepare(
      `INSERT INTO refunds (id, invoice_id, tenant_id, amount_vnd, reason, refunded_by, refunded_at, status, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'completed', ?)`,
    ).bind(refundId, invoice.id, tenantId, amount, parsed.data.reason, session.userId, now, now),
    c.env.DB.prepare(`UPDATE invoices SET refunded_vnd = ?, status = ?, updated_at = ? WHERE id = ? AND tenant_id = ?`)
      .bind(newRefunded, newStatus, now, invoice.id, tenantId),
    // Hoa hồng pending của invoice này bị đảo ngược (không xóa lén).
    c.env.DB.prepare(
      `UPDATE commission_calculations SET status = 'reversed', updated_at = ?
       WHERE invoice_id = ? AND tenant_id = ? AND status = 'pending'`,
    ).bind(now, invoice.id, tenantId),
    auditInsertStatement(c.env.DB, {
      tenantId,
      userId: session.userId,
      action: "invoice.refund",
      entityType: "invoice",
      entityId: invoice.id,
      branchId: invoice.branchId,
      metadata: { invoiceNo: invoice.invoiceNo, amountVnd: amount, status: newStatus },
    }),
  ]);
  const updated: InvoiceRow = { ...invoice, refundedVnd: newRefunded, status: newStatus, updatedAt: now };
  return c.json(
    {
      data: {
        invoice: updated,
        refund: {
          id: refundId,
          invoiceId: invoice.id,
          tenantId,
          amountVnd: amount,
          reason: parsed.data.reason,
          refundedBy: session.userId,
          refundedAt: now,
          status: "completed",
          createdAt: now,
        },
      },
    },
    201,
  );
});

invoiceRoutes.post("/invoices/:id/void", requirePermission("invoice.refund"), async (c) => {
  const session = c.get("session");
  const tenantId = session.tenantId;
  if (!tenantId) {
    return c.json(apiError("FORBIDDEN", "Platform Admin không truy cập dữ liệu nghiệp vụ tenant."), 403);
  }
  const invoice = await c.env.DB.prepare(`${INVOICE_SELECT} WHERE id = ? AND tenant_id = ?`)
    .bind(c.req.param("id"), tenantId)
    .first<InvoiceRow>();
  if (!invoice) {
    return c.json(apiError("NOT_FOUND", "Không tìm thấy hóa đơn."), 404);
  }
  if (branchOutOfScope(session, invoice.branchId)) {
    return c.json(apiError("FORBIDDEN", "Chi nhánh ngoài phạm vi được phân quyền."), 403);
  }
  // Chỉ hủy được khi chưa thu tiền (draft/unpaid/partially_paid + paid_vnd = 0).
  // Lưu ý: hủy không hoàn tồn kho sản phẩm đã bán — tồn kho chỉ hoàn qua
  // refund/xuất điều chỉnh riêng (không tự suy diễn ở đây).
  if (!["draft", "unpaid", "partially_paid"].includes(invoice.status) || invoice.paidVnd !== 0) {
    return c.json(apiError("UNPROCESSABLE", "Chỉ hủy được hóa đơn chưa thu tiền."), 422);
  }
  const now = nowIso();
  await c.env.DB.batch([
    c.env.DB.prepare(`UPDATE invoices SET status = 'void', updated_at = ? WHERE id = ? AND tenant_id = ?`)
      .bind(now, invoice.id, tenantId),
    auditInsertStatement(c.env.DB, {
      tenantId,
      userId: session.userId,
      action: "invoice.void",
      entityType: "invoice",
      entityId: invoice.id,
      branchId: invoice.branchId,
      metadata: { invoiceNo: invoice.invoiceNo },
    }),
  ]);
  return c.json({ data: { ...invoice, status: "void", updatedAt: now } });
});

invoiceRoutes.post("/bookings/:id/create-invoice", requirePermission("invoice.create"), async (c) => {
  const session = c.get("session");
  const tenantId = session.tenantId;
  if (!tenantId) {
    return c.json(apiError("FORBIDDEN", "Platform Admin không truy cập dữ liệu nghiệp vụ tenant."), 403);
  }
  const booking = await c.env.DB
    .prepare(
      `SELECT id, branch_id AS branchId, customer_id AS customerId, status
       FROM bookings WHERE id = ? AND tenant_id = ?`,
    )
    .bind(c.req.param("id"), tenantId)
    .first<{ id: string; branchId: string; customerId: string; status: string }>();
  if (!booking) {
    return c.json(apiError("NOT_FOUND", "Không tìm thấy lịch hẹn."), 404);
  }
  if (branchOutOfScope(session, booking.branchId)) {
    return c.json(apiError("FORBIDDEN", "Chi nhánh ngoài phạm vi được phân quyền."), 403);
  }
  if (booking.status !== "completed") {
    return c.json(apiError("UNPROCESSABLE", "Chỉ tạo hóa đơn từ lịch hẹn đã hoàn thành (completed)."), 422);
  }
  const existing = await c.env.DB
    .prepare(
      `SELECT id FROM invoices WHERE tenant_id = ? AND booking_id = ? AND status != 'void' LIMIT 1`,
    )
    .bind(tenantId, booking.id)
    .first<{ id: string }>();
  if (existing) {
    return c.json(apiError("CONFLICT", "Lịch hẹn này đã có hóa đơn."), 409);
  }
  // Body tùy chọn: chỉ discount/surcharge (dòng lấy từ booking_items).
  const body = await c.req.json().catch(() => ({}));
  const discountVnd =
    typeof body === "object" && body !== null && Number.isInteger((body as Record<string, unknown>).discountVnd)
      ? ((body as Record<string, unknown>).discountVnd as number)
      : 0;
  const surchargeVnd =
    typeof body === "object" && body !== null && Number.isInteger((body as Record<string, unknown>).surchargeVnd)
      ? ((body as Record<string, unknown>).surchargeVnd as number)
      : 0;
  if (discountVnd < 0 || surchargeVnd < 0) {
    return c.json(apiError("VALIDATION_ERROR", "Giảm giá / phụ thu không được âm."), 400);
  }
  const result = await buildAndInsertInvoice(c.env.DB, session, tenantId, {
    branchId: booking.branchId,
    bookingId: booking.id,
    customerId: booking.customerId,
    manualItems: [],
    discountVnd,
    surchargeVnd,
  });
  if (!result.ok) {
    return c.json(apiError(result.error.code, result.error.message), result.error.status);
  }
  return c.json({ data: { ...result.invoice, items: result.items } }, 201);
});
