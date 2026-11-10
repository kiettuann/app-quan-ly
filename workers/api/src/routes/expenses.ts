// Expense routes — expense categories + expenses.
// Nguồn: CONTRACTS.md §3–§4, DATABASE_SCHEMA.md §8, PERMISSIONS.md §2.
// Chi phí lọc theo chi nhánh trong phạm vi của session; chi nhánh ngoài
// phạm vi -> 403. Xóa chi phí là hard delete (không phải lịch sử giao dịch).
import { Hono } from "hono";
import { apiError, type SessionContext } from "@quanly/shared";
import type { Env } from "../index.js";
import { authMiddleware } from "../auth.js";
import { requirePermission } from "../rbac.js";
import { auditInsertStatement } from "../audit.js";
import { newId, nowIso, pageMeta, pagination } from "../db.js";
import { expenseCategorySchema, expenseSchema } from "../validation.js";

export const expensesRoutes = new Hono<{ Bindings: Env; Variables: { session: SessionContext } }>();

for (const p of ["/expenses", "/expenses/*", "/expense-categories", "/expense-categories/*"]) {
  expensesRoutes.use(p, authMiddleware, requirePermission("expense.manage"));
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

/** Điều kiện branch_id IN (phạm vi session) + params. Rỗng -> không thấy gì. */
function branchInCondition(branchIds: readonly string[]): { sql: string; params: unknown[] } {
  if (branchIds.length === 0) return { sql: "1 = 0", params: [] };
  return {
    sql: `branch_id IN (${branchIds.map(() => "?").join(", ")})`,
    params: [...branchIds],
  };
}

interface ExpenseRow {
  id: string;
  tenantId: string;
  branchId: string;
  branchName: string | null;
  categoryId: string | null;
  categoryName: string | null;
  amountVnd: number;
  expenseDate: string;
  description: string | null;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
}

const EXPENSE_SELECT = `e.id, e.tenant_id AS tenantId, e.branch_id AS branchId,
  b.name AS branchName, e.category_id AS categoryId, ec.name AS categoryName,
  e.amount_vnd AS amountVnd, e.expense_date AS expenseDate, e.description,
  e.created_by AS createdBy, e.created_at AS createdAt, e.updated_at AS updatedAt
  FROM expenses e
  LEFT JOIN branches b ON b.id = e.branch_id
  LEFT JOIN expense_categories ec ON ec.id = e.category_id`;

async function findExpense(
  db: D1Database,
  tenantId: string,
  id: string,
): Promise<ExpenseRow | null> {
  return db
    .prepare(`SELECT ${EXPENSE_SELECT} WHERE e.tenant_id = ? AND e.id = ?`)
    .bind(tenantId, id)
    .first<ExpenseRow>();
}

// ---------- Expense categories ----------
expensesRoutes.get("/expense-categories", async (c) => {
  const session = c.get("session");
  const { page, limit, offset } = pagination(c);
  const tenantId = session.tenantId as string;
  const totalRow = await c.env.DB.prepare(
    `SELECT COUNT(*) AS total FROM expense_categories WHERE tenant_id = ?`,
  )
    .bind(tenantId)
    .first<{ total: number }>();
  const rows = await c.env.DB.prepare(
    `SELECT id, tenant_id AS tenantId, name, type, created_at AS createdAt, updated_at AS updatedAt
     FROM expense_categories WHERE tenant_id = ? ORDER BY name ASC LIMIT ? OFFSET ?`,
  )
    .bind(tenantId, limit, offset)
    .all();
  return c.json({ data: rows.results ?? [], meta: pageMeta(page, limit, totalRow?.total ?? 0) });
});

expensesRoutes.post("/expense-categories", async (c) => {
  const session = c.get("session");
  const body = await readBody(c);
  if (!body) return c.json(apiError("VALIDATION_ERROR", "Thiếu nội dung yêu cầu (JSON)."), 400);
  const parsed = expenseCategorySchema.safeParse(body);
  if (!parsed.success) {
    return c.json(apiError("VALIDATION_ERROR", validationMessage(parsed.error.issues)), 400);
  }
  const tenantId = session.tenantId as string;
  const existing = await c.env.DB.prepare(
    `SELECT id FROM expense_categories WHERE tenant_id = ? AND name = ?`,
  )
    .bind(tenantId, parsed.data.name)
    .first<{ id: string }>();
  if (existing) {
    return c.json(apiError("CONFLICT", "Danh mục chi phí này đã tồn tại."), 409);
  }
  const id = newId();
  const now = nowIso();
  await c.env.DB.batch([
    c.env.DB.prepare(
      `INSERT INTO expense_categories (id, tenant_id, name, type, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ).bind(id, tenantId, parsed.data.name, parsed.data.type ?? "other", now, now),
    auditInsertStatement(c.env.DB, {
      tenantId,
      userId: session.userId,
      action: "expense.category_create",
      entityType: "expense_category",
      entityId: id,
      metadata: { name: parsed.data.name, type: parsed.data.type ?? "other" },
    }),
  ]);
  return c.json(
    {
      data: {
        id,
        tenantId,
        name: parsed.data.name,
        type: parsed.data.type ?? "other",
        createdAt: now,
        updatedAt: now,
      },
    },
    201,
  );
});

// ---------- Expenses ----------
expensesRoutes.get("/expenses", async (c) => {
  const session = c.get("session");
  const { page, limit, offset } = pagination(c);
  const tenantId = session.tenantId as string;
  const branchId = c.req.query("branch_id");
  const categoryId = c.req.query("category_id");
  const from = c.req.query("from");
  const to = c.req.query("to");

  let scopeIds: readonly string[] = session.branchIds;
  if (branchId) {
    if (!session.branchIds.includes(branchId)) {
      return c.json(apiError("FORBIDDEN", "Chi nhánh ngoài phạm vi được phân quyền."), 403);
    }
    scopeIds = [branchId];
  }
  const scope = branchInCondition(scopeIds);
  const where = [`e.tenant_id = ?`, `e.${scope.sql}`];
  const params: unknown[] = [tenantId, ...scope.params];
  if (categoryId) {
    where.push(`e.category_id = ?`);
    params.push(categoryId);
  }
  if (from) {
    where.push(`e.expense_date >= ?`);
    params.push(from);
  }
  if (to) {
    where.push(`e.expense_date <= ?`);
    params.push(to);
  }
  const whereSql = where.join(" AND ");
  const totalRow = await c.env.DB.prepare(
    `SELECT COUNT(*) AS total FROM expenses e WHERE ${whereSql}`,
  )
    .bind(...params)
    .first<{ total: number }>();
  const rows = await c.env.DB.prepare(
    `SELECT ${EXPENSE_SELECT} WHERE ${whereSql} ORDER BY e.expense_date DESC, e.created_at DESC LIMIT ? OFFSET ?`,
  )
    .bind(...params, limit, offset)
    .all<ExpenseRow>();
  return c.json({ data: rows.results ?? [], meta: pageMeta(page, limit, totalRow?.total ?? 0) });
});

expensesRoutes.post("/expenses", async (c) => {
  const session = c.get("session");
  const body = await readBody(c);
  if (!body) return c.json(apiError("VALIDATION_ERROR", "Thiếu nội dung yêu cầu (JSON)."), 400);
  const parsed = expenseSchema.safeParse(body);
  if (!parsed.success) {
    return c.json(apiError("VALIDATION_ERROR", validationMessage(parsed.error.issues)), 400);
  }
  const tenantId = session.tenantId as string;
  const d = parsed.data;
  if (!session.branchIds.includes(d.branchId)) {
    return c.json(apiError("FORBIDDEN", "Chi nhánh ngoài phạm vi được phân quyền."), 403);
  }
  if (d.categoryId) {
    const cat = await c.env.DB.prepare(
      `SELECT id FROM expense_categories WHERE tenant_id = ? AND id = ?`,
    )
      .bind(tenantId, d.categoryId)
      .first<{ id: string }>();
    if (!cat) return c.json(apiError("NOT_FOUND", "Không tìm thấy danh mục chi phí."), 404);
  }
  const id = newId();
  const now = nowIso();
  await c.env.DB.batch([
    c.env.DB.prepare(
      `INSERT INTO expenses (id, tenant_id, branch_id, category_id, amount_vnd, expense_date,
        description, created_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(
      id,
      tenantId,
      d.branchId,
      d.categoryId ?? null,
      d.amountVnd,
      d.expenseDate,
      d.description,
      session.userId,
      now,
      now,
    ),
    auditInsertStatement(c.env.DB, {
      tenantId,
      userId: session.userId,
      action: "expense.create",
      entityType: "expense",
      entityId: id,
      branchId: d.branchId,
      metadata: { amountVnd: d.amountVnd, expenseDate: d.expenseDate },
    }),
  ]);
  const created = await findExpense(c.env.DB, tenantId, id);
  return c.json({ data: created }, 201);
});

expensesRoutes.get("/expenses/:id", async (c) => {
  const session = c.get("session");
  const expense = await findExpense(c.env.DB, session.tenantId as string, c.req.param("id"));
  if (!expense) return c.json(apiError("NOT_FOUND", "Không tìm thấy chi phí."), 404);
  if (!session.branchIds.includes(expense.branchId)) {
    return c.json(apiError("FORBIDDEN", "Chi nhánh ngoài phạm vi được phân quyền."), 403);
  }
  return c.json({ data: expense });
});

expensesRoutes.patch("/expenses/:id", async (c) => {
  const session = c.get("session");
  const body = await readBody(c);
  if (!body) return c.json(apiError("VALIDATION_ERROR", "Thiếu nội dung yêu cầu (JSON)."), 400);
  const parsed = expenseSchema.partial().safeParse(body);
  if (!parsed.success) {
    return c.json(apiError("VALIDATION_ERROR", validationMessage(parsed.error.issues)), 400);
  }
  const tenantId = session.tenantId as string;
  const id = c.req.param("id");
  const expense = await findExpense(c.env.DB, tenantId, id);
  if (!expense) return c.json(apiError("NOT_FOUND", "Không tìm thấy chi phí."), 404);
  if (!session.branchIds.includes(expense.branchId)) {
    return c.json(apiError("FORBIDDEN", "Chi nhánh ngoài phạm vi được phân quyền."), 403);
  }
  const d = parsed.data;
  if (d.branchId && !session.branchIds.includes(d.branchId)) {
    return c.json(apiError("FORBIDDEN", "Chi nhánh ngoài phạm vi được phân quyền."), 403);
  }
  if (d.categoryId) {
    const cat = await c.env.DB.prepare(
      `SELECT id FROM expense_categories WHERE tenant_id = ? AND id = ?`,
    )
      .bind(tenantId, d.categoryId)
      .first<{ id: string }>();
    if (!cat) return c.json(apiError("NOT_FOUND", "Không tìm thấy danh mục chi phí."), 404);
  }
  const sets: string[] = [];
  const values: unknown[] = [];
  const setField = (sql: string, value: unknown): void => {
    sets.push(sql);
    values.push(value);
  };
  if (d.branchId !== undefined) setField("branch_id = ?", d.branchId);
  if (d.categoryId !== undefined) setField("category_id = ?", d.categoryId);
  if (d.amountVnd !== undefined) setField("amount_vnd = ?", d.amountVnd);
  if (d.expenseDate !== undefined) setField("expense_date = ?", d.expenseDate);
  if (d.description !== undefined) setField("description = ?", d.description);
  if (sets.length === 0) {
    return c.json(apiError("VALIDATION_ERROR", "Không có trường nào để cập nhật."), 400);
  }
  sets.push("updated_at = ?");
  values.push(nowIso());
  await c.env.DB.batch([
    c.env.DB.prepare(`UPDATE expenses SET ${sets.join(", ")} WHERE id = ? AND tenant_id = ?`).bind(
      ...values,
      id,
      tenantId,
    ),
    auditInsertStatement(c.env.DB, {
      tenantId,
      userId: session.userId,
      action: "expense.update",
      entityType: "expense",
      entityId: id,
      branchId: d.branchId ?? expense.branchId,
      metadata: { updatedFields: Object.keys(d) },
    }),
  ]);
  const updated = await findExpense(c.env.DB, tenantId, id);
  return c.json({ data: updated });
});

expensesRoutes.delete("/expenses/:id", async (c) => {
  const session = c.get("session");
  const tenantId = session.tenantId as string;
  const id = c.req.param("id");
  const expense = await findExpense(c.env.DB, tenantId, id);
  if (!expense) return c.json(apiError("NOT_FOUND", "Không tìm thấy chi phí."), 404);
  if (!session.branchIds.includes(expense.branchId)) {
    return c.json(apiError("FORBIDDEN", "Chi nhánh ngoài phạm vi được phân quyền."), 403);
  }
  await c.env.DB.batch([
    c.env.DB.prepare(`DELETE FROM expenses WHERE id = ? AND tenant_id = ?`).bind(id, tenantId),
    auditInsertStatement(c.env.DB, {
      tenantId,
      userId: session.userId,
      action: "expense.delete",
      entityType: "expense",
      entityId: id,
      branchId: expense.branchId,
      metadata: { amountVnd: expense.amountVnd, expenseDate: expense.expenseDate },
    }),
  ]);
  return c.json({ data: { id, deleted: true } });
});
