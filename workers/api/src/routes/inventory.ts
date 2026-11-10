// Inventory routes — product categories, products, stock movements,
// suppliers, purchase orders (+ receive/cancel), low-stock.
// Nguồn: CONTRACTS.md §3–§4, DATABASE_SCHEMA.md §7, API_SPEC.md §6.
// Mọi thay đổi tồn kho đều ghi một stock_movements và cập nhật
// products.stock_quantity trong cùng một batch. Không bao giờ bán âm.
import { Hono } from "hono";
import {
  apiError,
  applyMovement,
  movementQuantity,
  type SessionContext,
} from "@quanly/shared";
import type { Env } from "../index.js";
import { authMiddleware } from "../auth.js";
import { requirePermission } from "../rbac.js";
import { auditInsertStatement } from "../audit.js";
import { newId, nowIso, pageMeta, pagination } from "../db.js";
import {
  productCategorySchema,
  productSchema,
  purchaseOrderSchema,
  stockMovementSchema,
  supplierSchema,
} from "../validation.js";

export const inventoryRoutes = new Hono<{ Bindings: Env; Variables: { session: SessionContext } }>();

for (const p of ["/products", "/products/*", "/product-categories", "/product-categories/*", "/stock-movements", "/stock-movements/*", "/suppliers", "/suppliers/*", "/purchase-orders", "/purchase-orders/*", "/inventory", "/inventory/*"]) {
  inventoryRoutes.use(p, authMiddleware, requirePermission("inventory.manage"));
}

function validationMessage(issues: Array<{ path: Array<string | number>; message: string }>): string {
  return `Dữ liệu không hợp lệ: ${issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}`;
}

async function readBody(c: {
  req: { json: () => Promise<unknown> };
}): Promise<Record<string, unknown> | null> {
  try {
    const body = await c.req.json();
    if (body === null || typeof body !== "object" || Array.isArray(body)) return null;
    return body as Record<string, unknown>;
  } catch {
    return null;
  }
}

interface ProductRow {
  id: string;
  tenantId: string;
  categoryId: string | null;
  categoryName: string | null;
  name: string;
  sku: string;
  unit: string;
  costPriceVnd: number;
  sellPriceVnd: number;
  stockQuantity: number;
  lowStockThreshold: number;
  status: string;
  createdAt: string;
  updatedAt: string;
}

const PRODUCT_SELECT = `p.id, p.tenant_id AS tenantId, p.category_id AS categoryId,
  pc.name AS categoryName, p.name, p.sku, p.unit,
  p.cost_price_vnd AS costPriceVnd, p.sell_price_vnd AS sellPriceVnd,
  p.stock_quantity AS stockQuantity, p.low_stock_threshold AS lowStockThreshold,
  p.status, p.created_at AS createdAt, p.updated_at AS updatedAt
  FROM products p LEFT JOIN product_categories pc ON pc.id = p.category_id`;

async function findProduct(
  db: D1Database,
  tenantId: string,
  id: string,
): Promise<ProductRow | null> {
  return db
    .prepare(`SELECT ${PRODUCT_SELECT} WHERE p.tenant_id = ? AND p.id = ? AND p.deleted_at IS NULL`)
    .bind(tenantId, id)
    .first<ProductRow>();
}

// ---------- Product categories ----------
inventoryRoutes.get("/product-categories", async (c) => {
  const session = c.get("session");
  const { page, limit, offset } = pagination(c);
  const tenantId = session.tenantId as string;
  const totalRow = await c.env.DB.prepare(
    `SELECT COUNT(*) AS total FROM product_categories WHERE tenant_id = ?`,
  )
    .bind(tenantId)
    .first<{ total: number }>();
  const rows = await c.env.DB.prepare(
    `SELECT id, tenant_id AS tenantId, name, created_at AS createdAt, updated_at AS updatedAt
     FROM product_categories WHERE tenant_id = ? ORDER BY name ASC LIMIT ? OFFSET ?`,
  )
    .bind(tenantId, limit, offset)
    .all();
  return c.json({ data: rows.results ?? [], meta: pageMeta(page, limit, totalRow?.total ?? 0) });
});

inventoryRoutes.post("/product-categories", async (c) => {
  const session = c.get("session");
  const body = await readBody(c);
  if (!body) return c.json(apiError("VALIDATION_ERROR", "Thiếu nội dung yêu cầu (JSON)."), 400);
  const parsed = productCategorySchema.safeParse(body);
  if (!parsed.success) {
    return c.json(apiError("VALIDATION_ERROR", validationMessage(parsed.error.issues)), 400);
  }
  const tenantId = session.tenantId as string;
  const existing = await c.env.DB.prepare(
    `SELECT id FROM product_categories WHERE tenant_id = ? AND name = ?`,
  )
    .bind(tenantId, parsed.data.name)
    .first<{ id: string }>();
  if (existing) {
    return c.json(apiError("CONFLICT", "Danh mục sản phẩm này đã tồn tại."), 409);
  }
  const id = newId();
  const now = nowIso();
  await c.env.DB.batch([
    c.env.DB.prepare(
      `INSERT INTO product_categories (id, tenant_id, name, created_at, updated_at) VALUES (?, ?, ?, ?, ?)`,
    ).bind(id, tenantId, parsed.data.name, now, now),
    auditInsertStatement(c.env.DB, {
      tenantId,
      userId: session.userId,
      action: "inventory.category_create",
      entityType: "product_category",
      entityId: id,
      metadata: { name: parsed.data.name },
    }),
  ]);
  return c.json(
    { data: { id, tenantId, name: parsed.data.name, createdAt: now, updatedAt: now } },
    201,
  );
});

// ---------- Products ----------
inventoryRoutes.get("/products", async (c) => {
  const session = c.get("session");
  const { page, limit, offset } = pagination(c);
  const tenantId = session.tenantId as string;
  const categoryId = c.req.query("category_id");
  const status = c.req.query("status");
  const search = c.req.query("search")?.trim();
  const lowStock = c.req.query("low_stock") === "true";

  const where = [`p.tenant_id = ?`, `p.deleted_at IS NULL`];
  const params: unknown[] = [tenantId];
  if (categoryId) {
    where.push(`p.category_id = ?`);
    params.push(categoryId);
  }
  if (status) {
    where.push(`p.status = ?`);
    params.push(status);
  }
  if (search) {
    where.push(`(p.name LIKE ? OR p.sku LIKE ?)`);
    params.push(`%${search}%`, `%${search}%`);
  }
  if (lowStock) {
    where.push(`p.stock_quantity <= p.low_stock_threshold`);
  }
  const whereSql = where.join(" AND ");
  const totalRow = await c.env.DB.prepare(
    `SELECT COUNT(*) AS total FROM products p WHERE ${whereSql}`,
  )
    .bind(...params)
    .first<{ total: number }>();
  const rows = await c.env.DB.prepare(
    `SELECT ${PRODUCT_SELECT} WHERE ${whereSql} ORDER BY p.name ASC LIMIT ? OFFSET ?`,
  )
    .bind(...params, limit, offset)
    .all<ProductRow>();
  return c.json({ data: rows.results ?? [], meta: pageMeta(page, limit, totalRow?.total ?? 0) });
});

inventoryRoutes.post("/products", async (c) => {
  const session = c.get("session");
  const body = await readBody(c);
  if (!body) return c.json(apiError("VALIDATION_ERROR", "Thiếu nội dung yêu cầu (JSON)."), 400);
  const parsed = productSchema.safeParse(body);
  if (!parsed.success) {
    return c.json(apiError("VALIDATION_ERROR", validationMessage(parsed.error.issues)), 400);
  }
  const tenantId = session.tenantId as string;
  const d = parsed.data;
  if (d.categoryId) {
    const cat = await c.env.DB.prepare(
      `SELECT id FROM product_categories WHERE tenant_id = ? AND id = ?`,
    )
      .bind(tenantId, d.categoryId)
      .first<{ id: string }>();
    if (!cat) return c.json(apiError("NOT_FOUND", "Không tìm thấy danh mục sản phẩm."), 404);
  }
  const skuTaken = await c.env.DB.prepare(
    `SELECT id FROM products WHERE tenant_id = ? AND sku = ?`,
  )
    .bind(tenantId, d.sku)
    .first<{ id: string }>();
  if (skuTaken) {
    return c.json(apiError("CONFLICT", "Mã SKU này đã tồn tại trong tiệm."), 409);
  }
  const id = newId();
  const now = nowIso();
  const initialStock = d.stockQuantity ?? 0;
  const stmts: D1PreparedStatement[] = [
    c.env.DB.prepare(
      `INSERT INTO products (id, tenant_id, category_id, name, sku, unit, cost_price_vnd,
        sell_price_vnd, stock_quantity, low_stock_threshold, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(
      id,
      tenantId,
      d.categoryId ?? null,
      d.name,
      d.sku,
      d.unit ?? "cái",
      d.costPriceVnd,
      d.sellPriceVnd,
      initialStock,
      d.lowStockThreshold ?? 0,
      d.status ?? "active",
      now,
      now,
    ),
  ];
  if (initialStock > 0) {
    stmts.push(
      c.env.DB.prepare(
        `INSERT INTO stock_movements (id, tenant_id, product_id, location_id, type, quantity,
          ref_type, ref_id, created_by, created_at) VALUES (?, ?, ?, NULL, 'in', ?, 'initial', ?, ?, ?)`,
      ).bind(newId(), tenantId, id, initialStock, id, session.userId, now),
    );
  }
  stmts.push(
    auditInsertStatement(c.env.DB, {
      tenantId,
      userId: session.userId,
      action: "inventory.product_create",
      entityType: "product",
      entityId: id,
      metadata: { name: d.name, sku: d.sku, initialStock },
    }),
  );
  await c.env.DB.batch(stmts);
  const created = await findProduct(c.env.DB, tenantId, id);
  return c.json({ data: created }, 201);
});

inventoryRoutes.get("/products/:id", async (c) => {
  const session = c.get("session");
  const product = await findProduct(c.env.DB, session.tenantId as string, c.req.param("id"));
  if (!product) return c.json(apiError("NOT_FOUND", "Không tìm thấy sản phẩm."), 404);
  return c.json({ data: product });
});

inventoryRoutes.patch("/products/:id", async (c) => {
  const session = c.get("session");
  const body = await readBody(c);
  if (!body) return c.json(apiError("VALIDATION_ERROR", "Thiếu nội dung yêu cầu (JSON)."), 400);
  // stock_quantity không bao giờ được set trực tiếp — chỉ đổi qua stock_movements.
  if ("stock_quantity" in body || "stockQuantity" in body) {
    return c.json(
      apiError(
        "UNPROCESSABLE",
        "Không được sửa trực tiếp tồn kho. Hãy tạo phiếu nhập/xuất kho (stock_movements).",
      ),
      422,
    );
  }
  const parsed = productSchema.partial().safeParse(body);
  if (!parsed.success) {
    return c.json(apiError("VALIDATION_ERROR", validationMessage(parsed.error.issues)), 400);
  }
  const tenantId = session.tenantId as string;
  const id = c.req.param("id");
  const product = await findProduct(c.env.DB, tenantId, id);
  if (!product) return c.json(apiError("NOT_FOUND", "Không tìm thấy sản phẩm."), 404);
  const d = parsed.data;
  if (d.categoryId) {
    const cat = await c.env.DB.prepare(
      `SELECT id FROM product_categories WHERE tenant_id = ? AND id = ?`,
    )
      .bind(tenantId, d.categoryId)
      .first<{ id: string }>();
    if (!cat) return c.json(apiError("NOT_FOUND", "Không tìm thấy danh mục sản phẩm."), 404);
  }
  if (d.sku && d.sku !== product.sku) {
    const taken = await c.env.DB.prepare(
      `SELECT id FROM products WHERE tenant_id = ? AND sku = ? AND id != ?`,
    )
      .bind(tenantId, d.sku, id)
      .first<{ id: string }>();
    if (taken) return c.json(apiError("CONFLICT", "Mã SKU này đã tồn tại trong tiệm."), 409);
  }
  const sets: string[] = [];
  const values: unknown[] = [];
  const setField = (sql: string, value: unknown): void => {
    sets.push(sql);
    values.push(value);
  };
  if (d.categoryId !== undefined) setField("category_id = ?", d.categoryId);
  if (d.name !== undefined) setField("name = ?", d.name);
  if (d.sku !== undefined) setField("sku = ?", d.sku);
  if (d.unit !== undefined) setField("unit = ?", d.unit);
  if (d.costPriceVnd !== undefined) setField("cost_price_vnd = ?", d.costPriceVnd);
  if (d.sellPriceVnd !== undefined) setField("sell_price_vnd = ?", d.sellPriceVnd);
  if (d.lowStockThreshold !== undefined) setField("low_stock_threshold = ?", d.lowStockThreshold);
  if (d.status !== undefined) setField("status = ?", d.status);
  if (sets.length === 0) {
    return c.json(apiError("VALIDATION_ERROR", "Không có trường nào để cập nhật."), 400);
  }
  sets.push("updated_at = ?");
  values.push(nowIso());
  await c.env.DB.batch([
    c.env.DB.prepare(`UPDATE products SET ${sets.join(", ")} WHERE id = ? AND tenant_id = ?`).bind(
      ...values,
      id,
      tenantId,
    ),
    auditInsertStatement(c.env.DB, {
      tenantId,
      userId: session.userId,
      action: "inventory.product_update",
      entityType: "product",
      entityId: id,
      metadata: { updatedFields: Object.keys(d) },
    }),
  ]);
  const updated = await findProduct(c.env.DB, tenantId, id);
  return c.json({ data: updated });
});

inventoryRoutes.delete("/products/:id", async (c) => {
  const session = c.get("session");
  const tenantId = session.tenantId as string;
  const id = c.req.param("id");
  const product = await findProduct(c.env.DB, tenantId, id);
  if (!product) return c.json(apiError("NOT_FOUND", "Không tìm thấy sản phẩm."), 404);
  const now = nowIso();
  await c.env.DB.batch([
    c.env.DB.prepare(
      `UPDATE products SET deleted_at = ?, updated_at = ? WHERE id = ? AND tenant_id = ?`,
    ).bind(now, now, id, tenantId),
    auditInsertStatement(c.env.DB, {
      tenantId,
      userId: session.userId,
      action: "inventory.product_delete",
      entityType: "product",
      entityId: id,
      metadata: { name: product.name, sku: product.sku },
    }),
  ]);
  return c.json({ data: { id, deleted: true } });
});

// ---------- Low stock ----------
inventoryRoutes.get("/inventory/low-stock", async (c) => {
  const session = c.get("session");
  const { page, limit, offset } = pagination(c);
  const tenantId = session.tenantId as string;
  const whereSql = `p.tenant_id = ? AND p.deleted_at IS NULL AND p.status = 'active'
    AND p.stock_quantity <= p.low_stock_threshold`;
  const totalRow = await c.env.DB.prepare(
    `SELECT COUNT(*) AS total FROM products p WHERE ${whereSql}`,
  )
    .bind(tenantId)
    .first<{ total: number }>();
  const rows = await c.env.DB.prepare(
    `SELECT ${PRODUCT_SELECT} WHERE ${whereSql} ORDER BY p.stock_quantity ASC LIMIT ? OFFSET ?`,
  )
    .bind(tenantId, limit, offset)
    .all<ProductRow>();
  return c.json({ data: rows.results ?? [], meta: pageMeta(page, limit, totalRow?.total ?? 0) });
});

// ---------- Stock movements ----------
interface StockMovementRow {
  id: string;
  tenantId: string;
  productId: string;
  productName: string | null;
  locationId: string | null;
  type: string;
  quantity: number;
  refType: string | null;
  refId: string | null;
  createdBy: string | null;
  createdAt: string;
}

inventoryRoutes.get("/stock-movements", async (c) => {
  const session = c.get("session");
  const { page, limit, offset } = pagination(c);
  const tenantId = session.tenantId as string;
  const productId = c.req.query("product_id");
  const type = c.req.query("type");
  const from = c.req.query("from");
  const to = c.req.query("to");
  const where = [`sm.tenant_id = ?`];
  const params: unknown[] = [tenantId];
  if (productId) {
    where.push(`sm.product_id = ?`);
    params.push(productId);
  }
  if (type) {
    where.push(`sm.type = ?`);
    params.push(type);
  }
  if (from) {
    where.push(`substr(sm.created_at, 1, 10) >= ?`);
    params.push(from);
  }
  if (to) {
    where.push(`substr(sm.created_at, 1, 10) <= ?`);
    params.push(to);
  }
  const whereSql = where.join(" AND ");
  const totalRow = await c.env.DB.prepare(
    `SELECT COUNT(*) AS total FROM stock_movements sm WHERE ${whereSql}`,
  )
    .bind(...params)
    .first<{ total: number }>();
  const rows = await c.env.DB.prepare(
    `SELECT sm.id, sm.tenant_id AS tenantId, sm.product_id AS productId, p.name AS productName,
      sm.location_id AS locationId, sm.type, sm.quantity,
      sm.ref_type AS refType, sm.ref_id AS refId, sm.created_by AS createdBy,
      sm.created_at AS createdAt
     FROM stock_movements sm LEFT JOIN products p ON p.id = sm.product_id
     WHERE ${whereSql} ORDER BY sm.created_at DESC LIMIT ? OFFSET ?`,
  )
    .bind(...params, limit, offset)
    .all<StockMovementRow>();
  return c.json({ data: rows.results ?? [], meta: pageMeta(page, limit, totalRow?.total ?? 0) });
});

inventoryRoutes.post("/stock-movements", async (c) => {
  const session = c.get("session");
  const body = await readBody(c);
  if (!body) return c.json(apiError("VALIDATION_ERROR", "Thiếu nội dung yêu cầu (JSON)."), 400);
  const parsed = stockMovementSchema.safeParse(body);
  if (!parsed.success) {
    return c.json(apiError("VALIDATION_ERROR", validationMessage(parsed.error.issues)), 400);
  }
  const tenantId = session.tenantId as string;
  const d = parsed.data;
  // Quy tắc dấu: 'in' phải dương; 'out'/'sale' gửi số dương (nghĩa là xuất);
  // 'adjust' có dấu (âm = giảm, dương = tăng, khác 0).
  if (d.type === "in" && d.quantity <= 0) {
    return c.json(apiError("UNPROCESSABLE", "Nhập kho phải có số lượng lớn hơn 0."), 422);
  }
  if ((d.type === "out" || d.type === "sale") && d.quantity <= 0) {
    return c.json(apiError("UNPROCESSABLE", "Xuất/bán kho phải có số lượng lớn hơn 0."), 422);
  }
  if (d.type === "adjust" && d.quantity === 0) {
    return c.json(apiError("UNPROCESSABLE", "Điều chỉnh kho phải có số lượng khác 0."), 422);
  }
  const product = await findProduct(c.env.DB, tenantId, d.productId);
  if (!product) return c.json(apiError("NOT_FOUND", "Không tìm thấy sản phẩm."), 404);
  if (d.locationId) {
    const loc = await c.env.DB.prepare(
      `SELECT id FROM inventory_locations WHERE tenant_id = ? AND id = ?`,
    )
      .bind(tenantId, d.locationId)
      .first<{ id: string }>();
    if (!loc) return c.json(apiError("NOT_FOUND", "Không tìm thấy vị trí kho."), 404);
  }
  let newStock: number;
  try {
    newStock = applyMovement(product.stockQuantity, d.type, d.quantity);
  } catch (err) {
    return c.json(
      apiError("UNPROCESSABLE", err instanceof Error ? err.message : "Tồn kho không đủ."),
      422,
    );
  }
  const id = newId();
  const now = nowIso();
  const signedQty = movementQuantity(d.type, d.quantity);
  await c.env.DB.batch([
    c.env.DB.prepare(
      `INSERT INTO stock_movements (id, tenant_id, product_id, location_id, type, quantity,
        ref_type, ref_id, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, NULL, NULL, ?, ?)`,
    ).bind(id, tenantId, d.productId, d.locationId ?? null, d.type, signedQty, session.userId, now),
    c.env.DB.prepare(
      `UPDATE products SET stock_quantity = ?, updated_at = ? WHERE id = ? AND tenant_id = ?`,
    ).bind(newStock, now, d.productId, tenantId),
    auditInsertStatement(c.env.DB, {
      tenantId,
      userId: session.userId,
      action: "inventory.stock_movement_create",
      entityType: "stock_movement",
      entityId: id,
      metadata: { productId: d.productId, type: d.type, quantity: signedQty, newStock },
    }),
  ]);
  return c.json(
    {
      data: {
        id,
        tenantId,
        productId: d.productId,
        productName: product.name,
        locationId: d.locationId ?? null,
        type: d.type,
        quantity: signedQty,
        refType: null,
        refId: null,
        createdBy: session.userId,
        createdAt: now,
        newStockQuantity: newStock,
      },
    },
    201,
  );
});

// ---------- Suppliers ----------
inventoryRoutes.get("/suppliers", async (c) => {
  const session = c.get("session");
  const { page, limit, offset } = pagination(c);
  const tenantId = session.tenantId as string;
  const totalRow = await c.env.DB.prepare(
    `SELECT COUNT(*) AS total FROM suppliers WHERE tenant_id = ?`,
  )
    .bind(tenantId)
    .first<{ total: number }>();
  const rows = await c.env.DB.prepare(
    `SELECT id, tenant_id AS tenantId, name, phone, address,
      created_at AS createdAt, updated_at AS updatedAt
     FROM suppliers WHERE tenant_id = ? ORDER BY name ASC LIMIT ? OFFSET ?`,
  )
    .bind(tenantId, limit, offset)
    .all();
  return c.json({ data: rows.results ?? [], meta: pageMeta(page, limit, totalRow?.total ?? 0) });
});

inventoryRoutes.post("/suppliers", async (c) => {
  const session = c.get("session");
  const body = await readBody(c);
  if (!body) return c.json(apiError("VALIDATION_ERROR", "Thiếu nội dung yêu cầu (JSON)."), 400);
  const parsed = supplierSchema.safeParse(body);
  if (!parsed.success) {
    return c.json(apiError("VALIDATION_ERROR", validationMessage(parsed.error.issues)), 400);
  }
  const tenantId = session.tenantId as string;
  const id = newId();
  const now = nowIso();
  await c.env.DB.batch([
    c.env.DB.prepare(
      `INSERT INTO suppliers (id, tenant_id, name, phone, address, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).bind(id, tenantId, parsed.data.name, parsed.data.phone ?? null, parsed.data.address ?? null, now, now),
    auditInsertStatement(c.env.DB, {
      tenantId,
      userId: session.userId,
      action: "inventory.supplier_create",
      entityType: "supplier",
      entityId: id,
      metadata: { name: parsed.data.name },
    }),
  ]);
  return c.json(
    {
      data: {
        id,
        tenantId,
        name: parsed.data.name,
        phone: parsed.data.phone ?? null,
        address: parsed.data.address ?? null,
        createdAt: now,
        updatedAt: now,
      },
    },
    201,
  );
});

// ---------- Purchase orders ----------
interface PurchaseOrderRow {
  id: string;
  tenantId: string;
  supplierId: string;
  supplierName: string | null;
  status: string;
  totalCostVnd: number;
  createdAt: string;
  updatedAt: string;
}

interface PurchaseOrderItemRow {
  id: string;
  productId: string;
  productName: string | null;
  quantity: number;
  unitCostVnd: number;
  lineTotalVnd: number;
}

async function findPurchaseOrder(
  db: D1Database,
  tenantId: string,
  id: string,
): Promise<PurchaseOrderRow | null> {
  return db
    .prepare(
      `SELECT po.id, po.tenant_id AS tenantId, po.supplier_id AS supplierId, s.name AS supplierName,
        po.status, po.total_cost_vnd AS totalCostVnd,
        po.created_at AS createdAt, po.updated_at AS updatedAt
       FROM purchase_orders po LEFT JOIN suppliers s ON s.id = po.supplier_id
       WHERE po.tenant_id = ? AND po.id = ?`,
    )
    .bind(tenantId, id)
    .first<PurchaseOrderRow>();
}

async function listPurchaseOrderItems(
  db: D1Database,
  poId: string,
): Promise<PurchaseOrderItemRow[]> {
  const rows = await db
    .prepare(
      `SELECT poi.id, poi.product_id AS productId, p.name AS productName,
        poi.quantity, poi.unit_cost_vnd AS unitCostVnd,
        poi.quantity * poi.unit_cost_vnd AS lineTotalVnd
       FROM purchase_order_items poi LEFT JOIN products p ON p.id = poi.product_id
       WHERE poi.purchase_order_id = ? ORDER BY poi.created_at ASC`,
    )
    .bind(poId)
    .all<PurchaseOrderItemRow>();
  return rows.results ?? [];
}

inventoryRoutes.get("/purchase-orders", async (c) => {
  const session = c.get("session");
  const { page, limit, offset } = pagination(c);
  const tenantId = session.tenantId as string;
  const status = c.req.query("status");
  const supplierId = c.req.query("supplier_id");
  const where = [`po.tenant_id = ?`];
  const params: unknown[] = [tenantId];
  if (status) {
    where.push(`po.status = ?`);
    params.push(status);
  }
  if (supplierId) {
    where.push(`po.supplier_id = ?`);
    params.push(supplierId);
  }
  const whereSql = where.join(" AND ");
  const totalRow = await c.env.DB.prepare(
    `SELECT COUNT(*) AS total FROM purchase_orders po WHERE ${whereSql}`,
  )
    .bind(...params)
    .first<{ total: number }>();
  const rows = await c.env.DB.prepare(
    `SELECT po.id, po.tenant_id AS tenantId, po.supplier_id AS supplierId, s.name AS supplierName,
      po.status, po.total_cost_vnd AS totalCostVnd,
      po.created_at AS createdAt, po.updated_at AS updatedAt,
      (SELECT COUNT(*) FROM purchase_order_items poi WHERE poi.purchase_order_id = po.id) AS itemCount
     FROM purchase_orders po LEFT JOIN suppliers s ON s.id = po.supplier_id
     WHERE ${whereSql} ORDER BY po.created_at DESC LIMIT ? OFFSET ?`,
  )
    .bind(...params, limit, offset)
    .all();
  return c.json({ data: rows.results ?? [], meta: pageMeta(page, limit, totalRow?.total ?? 0) });
});

inventoryRoutes.post("/purchase-orders", async (c) => {
  const session = c.get("session");
  const body = await readBody(c);
  if (!body) return c.json(apiError("VALIDATION_ERROR", "Thiếu nội dung yêu cầu (JSON)."), 400);
  const parsed = purchaseOrderSchema.safeParse(body);
  if (!parsed.success) {
    return c.json(apiError("VALIDATION_ERROR", validationMessage(parsed.error.issues)), 400);
  }
  const tenantId = session.tenantId as string;
  const supplier = await c.env.DB.prepare(
    `SELECT id FROM suppliers WHERE tenant_id = ? AND id = ?`,
  )
    .bind(tenantId, parsed.data.supplierId)
    .first<{ id: string }>();
  if (!supplier) return c.json(apiError("NOT_FOUND", "Không tìm thấy nhà cung cấp."), 404);
  for (const item of parsed.data.items) {
    const product = await findProduct(c.env.DB, tenantId, item.productId);
    if (!product) {
      return c.json(
        apiError("NOT_FOUND", `Không tìm thấy sản phẩm ${item.productId}.`),
        404,
      );
    }
  }
  const totalCost = parsed.data.items.reduce((sum, i) => sum + i.quantity * i.unitCostVnd, 0);
  const id = newId();
  const now = nowIso();
  const stmts: D1PreparedStatement[] = [
    c.env.DB.prepare(
      `INSERT INTO purchase_orders (id, tenant_id, supplier_id, status, total_cost_vnd, created_at, updated_at)
       VALUES (?, ?, ?, 'draft', ?, ?, ?)`,
    ).bind(id, tenantId, parsed.data.supplierId, totalCost, now, now),
  ];
  for (const item of parsed.data.items) {
    stmts.push(
      c.env.DB.prepare(
        `INSERT INTO purchase_order_items (id, purchase_order_id, product_id, quantity, unit_cost_vnd, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      ).bind(newId(), id, item.productId, item.quantity, item.unitCostVnd, now),
    );
  }
  stmts.push(
    auditInsertStatement(c.env.DB, {
      tenantId,
      userId: session.userId,
      action: "inventory.purchase_order_create",
      entityType: "purchase_order",
      entityId: id,
      metadata: { supplierId: parsed.data.supplierId, totalCostVnd: totalCost },
    }),
  );
  await c.env.DB.batch(stmts);
  const po = await findPurchaseOrder(c.env.DB, tenantId, id);
  const items = await listPurchaseOrderItems(c.env.DB, id);
  return c.json({ data: { ...po, items } }, 201);
});

inventoryRoutes.post("/purchase-orders/:id/receive", async (c) => {
  const session = c.get("session");
  const tenantId = session.tenantId as string;
  const id = c.req.param("id");
  const po = await findPurchaseOrder(c.env.DB, tenantId, id);
  if (!po) return c.json(apiError("NOT_FOUND", "Không tìm thấy đơn nhập hàng."), 404);
  if (po.status !== "draft") {
    return c.json(
      apiError("UNPROCESSABLE", "Chỉ đơn nhập ở trạng thái nháp (draft) mới được nhận hàng."),
      422,
    );
  }
  const items = await listPurchaseOrderItems(c.env.DB, id);
  const now = nowIso();
  const stmts: D1PreparedStatement[] = [
    c.env.DB.prepare(
      `UPDATE purchase_orders SET status = 'received', updated_at = ? WHERE id = ? AND tenant_id = ?`,
    ).bind(now, id, tenantId),
  ];
  for (const item of items) {
    const product = await findProduct(c.env.DB, tenantId, item.productId);
    if (!product) {
      return c.json(apiError("NOT_FOUND", `Không tìm thấy sản phẩm ${item.productId}.`), 404);
    }
    const newStock = product.stockQuantity + item.quantity;
    stmts.push(
      c.env.DB.prepare(
        `INSERT INTO stock_movements (id, tenant_id, product_id, location_id, type, quantity,
          ref_type, ref_id, created_by, created_at) VALUES (?, ?, ?, NULL, 'in', ?, 'purchase_order', ?, ?, ?)`,
      ).bind(newId(), tenantId, item.productId, item.quantity, id, session.userId, now),
    );
    stmts.push(
      c.env.DB.prepare(
        `UPDATE products SET stock_quantity = ?, updated_at = ? WHERE id = ? AND tenant_id = ?`,
      ).bind(newStock, now, item.productId, tenantId),
    );
  }
  stmts.push(
    auditInsertStatement(c.env.DB, {
      tenantId,
      userId: session.userId,
      action: "inventory.purchase_order_receive",
      entityType: "purchase_order",
      entityId: id,
      metadata: { totalCostVnd: po.totalCostVnd, itemCount: items.length },
    }),
  );
  await c.env.DB.batch(stmts);
  const updated = await findPurchaseOrder(c.env.DB, tenantId, id);
  return c.json({ data: { ...updated, items } });
});

inventoryRoutes.post("/purchase-orders/:id/cancel", async (c) => {
  const session = c.get("session");
  const tenantId = session.tenantId as string;
  const id = c.req.param("id");
  const po = await findPurchaseOrder(c.env.DB, tenantId, id);
  if (!po) return c.json(apiError("NOT_FOUND", "Không tìm thấy đơn nhập hàng."), 404);
  if (po.status !== "draft") {
    return c.json(
      apiError("UNPROCESSABLE", "Chỉ đơn nhập ở trạng thái nháp (draft) mới được hủy."),
      422,
    );
  }
  const now = nowIso();
  await c.env.DB.batch([
    c.env.DB.prepare(
      `UPDATE purchase_orders SET status = 'cancelled', updated_at = ? WHERE id = ? AND tenant_id = ?`,
    ).bind(now, id, tenantId),
    auditInsertStatement(c.env.DB, {
      tenantId,
      userId: session.userId,
      action: "inventory.purchase_order_cancel",
      entityType: "purchase_order",
      entityId: id,
    }),
  ]);
  const updated = await findPurchaseOrder(c.env.DB, tenantId, id);
  const items = await listPurchaseOrderItems(c.env.DB, id);
  return c.json({ data: { ...updated, items } });
});
