// Bookings — Phase 4 (MVP part 1). Nguồn: CONTRACTS.md §3–§4, API_SPEC.md §4,
// DATABASE_SCHEMA.md §4, packages/shared/src/booking.ts.
// Server tự tính end_at từ tổng duration và total từ giá dịch vụ (+ giá ghi đè
// theo chi nhánh); không tin giá client gửi. Trùng lịch -> 409 CONFLICT.
import { Hono, type Context } from "hono";
import { z } from "zod";
import {
  apiError,
  BOOKING_ACTIVE_STATUSES,
  BOOKING_STATUSES,
  canTransitionBooking,
  isoDateTime,
  type BookingStatus,
  type SessionContext,
} from "@quanly/shared";
import type { Env } from "../index.js";
import { authMiddleware } from "../auth.js";
import { requirePermission } from "../rbac.js";
import { newId, nowIso, pageMeta, pagination } from "../db.js";
import { bookingCreateSchema, bookingStatusSchema } from "../validation.js";
import { auditInsertStatement } from "../audit.js";
import type { z as zodType } from "zod";

export const bookingsRoutes = new Hono<{ Bindings: Env; Variables: { session: SessionContext } }>();

type AppCtx = Context<{ Bindings: Env; Variables: { session: SessionContext } }>;

/** Route param (luôn có khi route khớp); fallback '' để qua strict null check. */
function param(c: AppCtx, name: string): string {
  return c.req.param(name) ?? "";
}

const bookingUpdateSchema = z.object({
  startAt: isoDateTime,
  technicianId: z.string().uuid().nullable(),
  notes: z.string().trim().max(500).nullable(),
});

const cancelSchema = z.object({
  reason: z.string().trim().max(255).optional().nullable(),
});

interface BookingRow {
  id: string;
  tenantId: string;
  branchId: string;
  customerId: string;
  customerName: string | null;
  customerPhone: string | null;
  technicianId: string | null;
  technicianName: string | null;
  startAt: string;
  endAt: string;
  durationMinutes: number;
  status: string;
  source: string;
  totalPriceVnd: number;
  notes: string | null;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
}

interface BookingItemRow {
  id: string;
  serviceId: string;
  serviceName: string;
  priceVnd: number;
  durationMinutes: number;
  technicianId: string | null;
}

interface ServicePrice {
  id: string;
  name: string;
  priceVnd: number;
  durationMinutes: number;
}

interface EmployeeRow {
  id: string;
  fullName: string;
  status: string;
}

const BOOKING_SELECT = `b.id, b.tenant_id AS tenantId, b.branch_id AS branchId,
  b.customer_id AS customerId, cu.full_name AS customerName, cu.phone AS customerPhone,
  b.technician_id AS technicianId, e.full_name AS technicianName,
  b.start_at AS startAt, b.end_at AS endAt, b.duration_minutes AS durationMinutes,
  b.status, b.source, b.total_price_vnd AS totalPriceVnd, b.notes,
  b.created_by AS createdBy, b.created_at AS createdAt, b.updated_at AS updatedAt`;

function formatZodError(error: zodType.ZodError): string {
  return error.issues.map((i) => `${i.path.join(".") || "body"}: ${i.message}`).join("; ");
}

async function readBody(c: AppCtx): Promise<unknown> {
  try {
    return (await c.req.json()) as unknown;
  } catch {
    return null;
  }
}

function tenantOrNull(c: AppCtx): string | null {
  return c.get("session").tenantId;
}

function branchInScope(c: AppCtx, branchId: string): boolean {
  return c.get("session").branchIds.includes(branchId);
}

async function loadBooking(c: AppCtx, tenantId: string, id: string): Promise<BookingRow | null> {
  return c.env.DB.prepare(
    `SELECT ${BOOKING_SELECT} FROM bookings b
     LEFT JOIN customers cu ON cu.id = b.customer_id
     LEFT JOIN employees e ON e.id = b.technician_id
     WHERE b.id = ? AND b.tenant_id = ? LIMIT 1`,
  )
    .bind(id, tenantId)
    .first<BookingRow>();
}

async function loadBookingItems(c: AppCtx, bookingId: string): Promise<BookingItemRow[]> {
  const rows = await c.env.DB.prepare(
    `SELECT id, service_id AS serviceId, service_name_snapshot AS serviceName,
            price_vnd_snapshot AS priceVnd, duration_minutes_snapshot AS durationMinutes,
            technician_id AS technicianId
     FROM booking_items WHERE booking_id = ? ORDER BY created_at ASC`,
  )
    .bind(bookingId)
    .all<BookingItemRow>();
  return rows.results ?? [];
}

function bookingOut(row: BookingRow, items?: BookingItemRow[]) {
  return {
    id: row.id,
    tenantId: row.tenantId,
    branchId: row.branchId,
    customerId: row.customerId,
    customerName: row.customerName,
    customerPhone: row.customerPhone,
    technicianId: row.technicianId,
    technicianName: row.technicianName,
    startAt: row.startAt,
    endAt: row.endAt,
    durationMinutes: row.durationMinutes,
    status: row.status,
    source: row.source,
    totalPriceVnd: row.totalPriceVnd,
    notes: row.notes,
    createdBy: row.createdBy,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    items: items ?? undefined,
  };
}

/** Trùng lịch: cùng KTV, khoảng [start,end) giao nhau, trạng thái còn chiếm slot. */
async function hasConflict(
  c: AppCtx,
  tenantId: string,
  technicianId: string,
  startAt: string,
  endAt: string,
  excludeBookingId?: string,
): Promise<boolean> {
  const sql = excludeBookingId
    ? `SELECT id FROM bookings WHERE tenant_id = ? AND technician_id = ? AND id != ?
       AND status IN (${BOOKING_ACTIVE_STATUSES.map(() => "?").join(",")})
       AND start_at < ? AND end_at > ? LIMIT 1`
    : `SELECT id FROM bookings WHERE tenant_id = ? AND technician_id = ?
       AND status IN (${BOOKING_ACTIVE_STATUSES.map(() => "?").join(",")})
       AND start_at < ? AND end_at > ? LIMIT 1`;
  const params = excludeBookingId
    ? [tenantId, technicianId, excludeBookingId, ...BOOKING_ACTIVE_STATUSES, endAt, startAt]
    : [tenantId, technicianId, ...BOOKING_ACTIVE_STATUSES, endAt, startAt];
  const row = await c.env.DB.prepare(sql).bind(...params).first<{ id: string }>();
  return row !== null;
}

async function loadEmployee(c: AppCtx, tenantId: string, employeeId: string): Promise<EmployeeRow | null> {
  return c.env.DB.prepare(
    `SELECT id, full_name AS fullName, status FROM employees
     WHERE id = ? AND tenant_id = ? AND deleted_at IS NULL LIMIT 1`,
  )
    .bind(employeeId, tenantId)
    .first<EmployeeRow>();
}

/** Giá hiệu dụng của dịch vụ tại chi nhánh (giá ghi đè nếu có). */
async function loadServicePrice(
  c: AppCtx,
  tenantId: string,
  branchId: string,
  serviceId: string,
): Promise<{ service: ServicePrice; available: boolean } | null> {
  const service = await c.env.DB.prepare(
    `SELECT id, name, price_vnd AS priceVnd, duration_minutes AS durationMinutes
     FROM services WHERE id = ? AND tenant_id = ? AND deleted_at IS NULL LIMIT 1`,
  )
    .bind(serviceId, tenantId)
    .first<ServicePrice & { status: string }>();
  if (!service) return null;
  const setting = await c.env.DB.prepare(
    `SELECT price_vnd AS priceVnd, is_available AS isAvailable
     FROM service_branch_settings WHERE service_id = ? AND branch_id = ? AND tenant_id = ? LIMIT 1`,
  )
    .bind(serviceId, branchId, tenantId)
    .first<{ priceVnd: number | null; isAvailable: number }>();
  const available = setting ? setting.isAvailable === 1 : true;
  const priceVnd = setting?.priceVnd !== null && setting?.priceVnd !== undefined ? setting.priceVnd : service.priceVnd;
  return { service: { id: service.id, name: service.name, priceVnd, durationMinutes: service.durationMinutes }, available };
}

// ---------- GET /bookings/availability (đặt TRƯỚC /:id để tránh nhầm param) ----------
bookingsRoutes.get("/bookings/availability", authMiddleware, requirePermission("booking.view"), async (c) => {
  const tenantId = tenantOrNull(c);
  if (!tenantId) {
    return c.json(apiError("FORBIDDEN", "Phiên không gắn với tenant nào."), 403);
  }
  const date = c.req.query("date") ?? "";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(Date.parse(`${date}T00:00:00Z`))) {
    return c.json(apiError("VALIDATION_ERROR", "Tham số date phải đúng định dạng YYYY-MM-DD."), 400);
  }
  const technicianId = c.req.query("technician_id");
  const serviceId = c.req.query("service_id");
  const branchId = c.req.query("branch_id");
  if (branchId && !branchInScope(c, branchId)) {
    return c.json(apiError("FORBIDDEN", "Chi nhánh ngoài phạm vi được phân quyền."), 403);
  }
  let durationMinutes = 30;
  if (serviceId) {
    const svc = await c.env.DB.prepare(
      `SELECT duration_minutes AS durationMinutes FROM services WHERE id = ? AND tenant_id = ? AND deleted_at IS NULL LIMIT 1`,
    )
      .bind(serviceId, tenantId)
      .first<{ durationMinutes: number }>();
    if (!svc) {
      return c.json(apiError("NOT_FOUND", "Không tìm thấy dịch vụ."), 404);
    }
    durationMinutes = svc.durationMinutes;
  }
  // Kỹ thuật viên xét tới: 1 người nếu chỉ định, còn lại là nhân viên active
  // của chi nhánh (hoặc toàn tenant nếu không chỉ định chi nhánh).
  let technicians: EmployeeRow[] = [];
  if (technicianId) {
    const emp = await loadEmployee(c, tenantId, technicianId);
    if (!emp) {
      return c.json(apiError("NOT_FOUND", "Không tìm thấy kỹ thuật viên."), 404);
    }
    if (branchId) {
      const inBranch = await c.env.DB.prepare(
        `SELECT id FROM employees WHERE id = ? AND branch_id = ? AND tenant_id = ? LIMIT 1`,
      )
        .bind(technicianId, branchId, tenantId)
        .first<{ id: string }>();
      if (!inBranch) {
        return c.json(apiError("NOT_FOUND", "Kỹ thuật viên không thuộc chi nhánh này."), 404);
      }
    }
    technicians = emp.status === "active" ? [emp] : [];
  } else {
    const where = branchId ? `tenant_id = ? AND branch_id = ? AND status = 'active' AND deleted_at IS NULL` : `tenant_id = ? AND status = 'active' AND deleted_at IS NULL`;
    const params = branchId ? [tenantId, branchId] : [tenantId];
    const rows = await c.env.DB.prepare(
      `SELECT id, full_name AS fullName, status FROM employees WHERE ${where} ORDER BY created_at ASC`,
    )
      .bind(...params)
      .all<EmployeeRow>();
    technicians = rows.results ?? [];
  }
  // Ngày nghỉ (technician_availability.is_off) -> KTV đó không xét slot.
  // Ngày và giờ slot đều theo giờ Việt Nam (Asia/Ho_Chi_Minh, UTC+7):
  // 00:00 VN = 17:00Z hôm trước; slot "09:00" nghĩa là 09:00 VN = 02:00Z.
  const dayStart = new Date(`${date}T00:00:00+07:00`).toISOString();
  const dayEnd = new Date(new Date(`${date}T00:00:00+07:00`).getTime() + 24 * 60 * 60_000).toISOString();
  let freeTechs = technicians;
  if (technicians.length > 0) {
    const offRows = await c.env.DB.prepare(
      `SELECT technician_id AS technicianId FROM technician_availability
       WHERE tenant_id = ? AND date = ? AND is_off = 1
       AND technician_id IN (${technicians.map(() => "?").join(",")})`,
    )
      .bind(tenantId, date, ...technicians.map((t) => t.id))
      .all<{ technicianId: string }>();
    const offSet = new Set((offRows.results ?? []).map((r) => r.technicianId));
    freeTechs = technicians.filter((t) => !offSet.has(t.id));
  }
  // Booking đang chiếm slot của các KTV xét tới trong ngày.
  const busyByTech = new Map<string, Array<{ startAt: string; endAt: string }>>();
  if (freeTechs.length > 0) {
    const busy = await c.env.DB.prepare(
      `SELECT technician_id AS technicianId, start_at AS startAt, end_at AS endAt FROM bookings
       WHERE tenant_id = ? AND technician_id IN (${freeTechs.map(() => "?").join(",")})
       AND status IN (${BOOKING_ACTIVE_STATUSES.map(() => "?").join(",")})
       AND start_at < ? AND end_at > ?`,
    )
      .bind(tenantId, ...freeTechs.map((t) => t.id), ...BOOKING_ACTIVE_STATUSES, dayEnd, dayStart)
      .all<{ technicianId: string; startAt: string; endAt: string }>();
    for (const b of busy.results ?? []) {
      const list = busyByTech.get(b.technicianId) ?? [];
      list.push({ startAt: b.startAt, endAt: b.endAt });
      busyByTech.set(b.technicianId, list);
    }
  }
  const slots: string[] = [];
  for (let minutes = 8 * 60; minutes + durationMinutes <= 20 * 60; minutes += 30) {
    const hh = String(Math.floor(minutes / 60)).padStart(2, "0");
    const mm = String(minutes % 60).padStart(2, "0");
    const slotStart = new Date(`${date}T${hh}:${mm}:00+07:00`);
    const slotEnd = new Date(slotStart.getTime() + durationMinutes * 60_000);
    const slotStartIso = slotStart.toISOString();
    const slotEndIso = slotEnd.toISOString();
    // Slot trống nếu còn ít nhất 1 KTV không trùng lịch.
    const anyFree = freeTechs.some((tech) => {
      const busy = busyByTech.get(tech.id) ?? [];
      return !busy.some((b) => slotStartIso < b.endAt && b.startAt < slotEndIso);
    });
    if (anyFree) slots.push(`${hh}:${mm}`);
  }
  return c.json({
    data: {
      date,
      durationMinutes,
      technicianId: technicianId ?? null,
      branchId: branchId ?? null,
      slots,
    },
  });
});

// ---------- GET /bookings ----------
bookingsRoutes.get("/bookings", authMiddleware, requirePermission("booking.view"), async (c) => {
  const session = c.get("session");
  const tenantId = tenantOrNull(c);
  if (!tenantId) {
    return c.json(apiError("FORBIDDEN", "Phiên không gắn với tenant nào."), 403);
  }
  const branchId = c.req.query("branch_id");
  if (branchId && !branchInScope(c, branchId)) {
    return c.json(apiError("FORBIDDEN", "Chi nhánh ngoài phạm vi được phân quyền."), 403);
  }
  const technicianId = c.req.query("technician_id");
  const status = c.req.query("status");
  if (status && !(BOOKING_STATUSES as readonly string[]).includes(status)) {
    return c.json(apiError("VALIDATION_ERROR", "Trạng thái booking không hợp lệ."), 400);
  }
  const from = c.req.query("from");
  const to = c.req.query("to");
  const search = c.req.query("search")?.trim();
  const { page, limit, offset } = pagination(c);
  const where: string[] = [`b.tenant_id = ?`];
  const params: unknown[] = [tenantId];
  if (branchId) {
    where.push(`b.branch_id = ?`);
    params.push(branchId);
  } else if (session.role !== "tenant_owner") {
    if (session.branchIds.length === 0) {
      return c.json({ data: [], meta: pageMeta(page, limit, 0) });
    }
    where.push(`b.branch_id IN (${session.branchIds.map(() => "?").join(",")})`);
    params.push(...session.branchIds);
  }
  if (technicianId) {
    where.push(`b.technician_id = ?`);
    params.push(technicianId);
  }
  if (status) {
    where.push(`b.status = ?`);
    params.push(status);
  }
  if (from) {
    const fromIso = from.length === 10 ? `${from}T00:00:00.000Z` : from;
    if (Number.isNaN(Date.parse(fromIso))) {
      return c.json(apiError("VALIDATION_ERROR", "Tham số from không đúng định dạng ngày/giờ."), 400);
    }
    where.push(`b.start_at >= ?`);
    params.push(fromIso);
  }
  if (to) {
    if (to.length === 10) {
      const end = new Date(`${to}T00:00:00Z`);
      end.setUTCDate(end.getUTCDate() + 1);
      where.push(`b.start_at < ?`);
      params.push(end.toISOString());
    } else {
      if (Number.isNaN(Date.parse(to))) {
        return c.json(apiError("VALIDATION_ERROR", "Tham số to không đúng định dạng ngày/giờ."), 400);
      }
      where.push(`b.start_at <= ?`);
      params.push(to);
    }
  }
  if (search) {
    where.push(`(cu.full_name LIKE ? OR cu.phone LIKE ?)`);
    params.push(`%${search}%`, `%${search}%`);
  }
  const whereSql = where.join(" AND ");
  const fromSql = `FROM bookings b
    LEFT JOIN customers cu ON cu.id = b.customer_id
    LEFT JOIN employees e ON e.id = b.technician_id`;
  const totalRow = await c.env.DB.prepare(`SELECT COUNT(*) AS total ${fromSql} WHERE ${whereSql}`)
    .bind(...(params as string[]))
    .first<{ total: number }>();
  const rows = await c.env.DB.prepare(
    `SELECT ${BOOKING_SELECT} ${fromSql} WHERE ${whereSql} ORDER BY b.start_at DESC LIMIT ? OFFSET ?`,
  )
    .bind(...(params as string[]), limit, offset)
    .all<BookingRow>();
  return c.json({
    data: (rows.results ?? []).map((r) => bookingOut(r)),
    meta: pageMeta(page, limit, totalRow?.total ?? 0),
  });
});

// ---------- POST /bookings ----------
bookingsRoutes.post("/bookings", authMiddleware, requirePermission("booking.create"), async (c) => {
  const session = c.get("session");
  const tenantId = tenantOrNull(c);
  if (!tenantId) {
    return c.json(apiError("FORBIDDEN", "Phiên không gắn với tenant nào."), 403);
  }
  const parsed = bookingCreateSchema.safeParse(await readBody(c));
  if (!parsed.success) {
    return c.json(apiError("VALIDATION_ERROR", formatZodError(parsed.error)), 400);
  }
  const d = parsed.data;
  if (!branchInScope(c, d.branchId)) {
    return c.json(apiError("FORBIDDEN", "Chi nhánh ngoài phạm vi được phân quyền."), 403);
  }
  if (!d.customerId && !d.customerNew) {
    return c.json(apiError("VALIDATION_ERROR", "Chọn khách hàng có sẵn hoặc nhập khách hàng mới."), 400);
  }
  // Khách hàng.
  let customerId = d.customerId ?? null;
  let newCustomerId: string | null = null;
  if (customerId) {
    const customer = await c.env.DB.prepare(
      `SELECT id FROM customers WHERE id = ? AND tenant_id = ? AND deleted_at IS NULL LIMIT 1`,
    )
      .bind(customerId, tenantId)
      .first<{ id: string }>();
    if (!customer) {
      return c.json(apiError("NOT_FOUND", "Không tìm thấy khách hàng."), 404);
    }
  } else if (d.customerNew) {
    const dup = await c.env.DB.prepare(
      `SELECT id FROM customers WHERE tenant_id = ? AND phone = ? AND deleted_at IS NULL LIMIT 1`,
    )
      .bind(tenantId, d.customerNew.phone)
      .first<{ id: string }>();
    if (dup) {
      return c.json(apiError("CONFLICT", "Số điện thoại này đã có khách hàng trong tiệm."), 409);
    }
    newCustomerId = newId();
    customerId = newCustomerId;
  }
  // Dịch vụ: giá + duration snapshot từ server, kèm giá ghi đè theo chi nhánh.
  const servicePrices: ServicePrice[] = [];
  for (const serviceId of d.serviceIds) {
    const loaded = await loadServicePrice(c, tenantId, d.branchId, serviceId);
    if (!loaded) {
      return c.json(apiError("NOT_FOUND", "Không tìm thấy dịch vụ."), 404);
    }
    const statusRow = await c.env.DB.prepare(`SELECT status FROM services WHERE id = ? LIMIT 1`)
      .bind(serviceId)
      .first<{ status: string }>();
    if (statusRow?.status !== "active" || !loaded.available) {
      return c.json(apiError("UNPROCESSABLE", `Dịch vụ ${loaded.service.name} hiện không khả dụng tại chi nhánh này.`), 422);
    }
    servicePrices.push(loaded.service);
  }
  const totalDuration = servicePrices.reduce((sum, s) => sum + s.durationMinutes, 0);
  const totalPrice = servicePrices.reduce((sum, s) => sum + s.priceVnd, 0);
  const startAt = new Date(d.startAt).toISOString();
  const endAt = new Date(new Date(d.startAt).getTime() + totalDuration * 60_000).toISOString();
  // Kỹ thuật viên: chỉ định hoặc hệ thống tự chọn.
  let technicianId: string | null = d.technicianId ?? null;
  if (technicianId) {
    const emp = await loadEmployee(c, tenantId, technicianId);
    if (!emp) {
      return c.json(apiError("NOT_FOUND", "Không tìm thấy kỹ thuật viên."), 404);
    }
    const inBranch = await c.env.DB.prepare(
      `SELECT id FROM employees WHERE id = ? AND branch_id = ? AND tenant_id = ? LIMIT 1`,
    )
      .bind(technicianId, d.branchId, tenantId)
      .first<{ id: string }>();
    if (!inBranch) {
      return c.json(apiError("NOT_FOUND", "Kỹ thuật viên không thuộc chi nhánh này."), 404);
    }
    if (emp.status !== "active") {
      return c.json(apiError("UNPROCESSABLE", "Kỹ thuật viên hiện không hoạt động."), 422);
    }
    if (await hasConflict(c, tenantId, technicianId, startAt, endAt)) {
      return c.json(apiError("CONFLICT", "Lịch đã trùng với lịch hẹn khác của kỹ thuật viên này."), 409);
    }
  } else {
    const candidates = await c.env.DB.prepare(
      `SELECT id, full_name AS fullName, status FROM employees
       WHERE tenant_id = ? AND branch_id = ? AND status = 'active' AND deleted_at IS NULL ORDER BY created_at ASC`,
    )
      .bind(tenantId, d.branchId)
      .all<EmployeeRow>();
    let picked: string | null = null;
    for (const candidate of candidates.results ?? []) {
      if (!(await hasConflict(c, tenantId, candidate.id, startAt, endAt))) {
        picked = candidate.id;
        break;
      }
    }
    if (!picked) {
      return c.json(apiError("CONFLICT", "Không còn kỹ thuật viên trống vào thời gian này."), 409);
    }
    technicianId = picked;
  }
  const bookingId = newId();
  const now = nowIso();
  const statements: D1PreparedStatement[] = [];
  if (newCustomerId && d.customerNew) {
    statements.push(
      c.env.DB.prepare(
        `INSERT INTO customers (id, tenant_id, branch_id, full_name, phone, email, dob, gender, notes,
           total_spent_vnd, total_visits, last_visit_at, deleted_at, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, NULL, NULL, NULL, NULL, 0, 0, NULL, NULL, ?, ?)`,
      ).bind(newCustomerId, tenantId, d.branchId, d.customerNew.fullName, d.customerNew.phone, now, now),
    );
  }
  statements.push(
    c.env.DB.prepare(
      `INSERT INTO bookings (id, tenant_id, branch_id, customer_id, technician_id, start_at, end_at,
         duration_minutes, status, source, deposit_vnd, deposit_status, total_price_vnd, notes, created_by, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, 0, 'none', ?, ?, ?, ?, ?)`,
    ).bind(
      bookingId,
      tenantId,
      d.branchId,
      customerId,
      technicianId,
      startAt,
      endAt,
      totalDuration,
      d.source ?? "internal",
      totalPrice,
      d.notes ?? null,
      session.userId,
      now,
      now,
    ),
  );
  for (const s of servicePrices) {
    statements.push(
      c.env.DB.prepare(
        `INSERT INTO booking_items (id, booking_id, service_id, service_name_snapshot, price_vnd_snapshot, duration_minutes_snapshot, technician_id, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      ).bind(newId(), bookingId, s.id, s.name, s.priceVnd, s.durationMinutes, technicianId, now),
    );
  }
  statements.push(
    c.env.DB.prepare(
      `INSERT INTO booking_status_history (id, booking_id, from_status, to_status, changed_by, reason, created_at)
       VALUES (?, ?, '', 'pending', ?, NULL, ?)`,
    ).bind(newId(), bookingId, session.userId, now),
    auditInsertStatement(c.env.DB, {
      tenantId,
      userId: session.userId,
      action: "booking.create",
      entityType: "booking",
      entityId: bookingId,
      branchId: d.branchId,
    }),
  );
  await c.env.DB.batch(statements);
  const row = await loadBooking(c, tenantId, bookingId);
  const items = await loadBookingItems(c, bookingId);
  return c.json({ data: row ? bookingOut(row, items) : null }, 201);
});

// ---------- GET /bookings/:id ----------
bookingsRoutes.get("/bookings/:id", authMiddleware, requirePermission("booking.view"), async (c) => {
  const tenantId = tenantOrNull(c);
  if (!tenantId) {
    return c.json(apiError("FORBIDDEN", "Phiên không gắn với tenant nào."), 403);
  }
  const row = await loadBooking(c, tenantId, param(c, "id"));
  if (!row) {
    return c.json(apiError("NOT_FOUND", "Không tìm thấy lịch hẹn."), 404);
  }
  if (!branchInScope(c, row.branchId)) {
    return c.json(apiError("FORBIDDEN", "Lịch hẹn thuộc chi nhánh ngoài phạm vi của bạn."), 403);
  }
  const items = await loadBookingItems(c, row.id);
  return c.json({ data: bookingOut(row, items) });
});

// ---------- PATCH /bookings/:id (chỉ pending/confirmed) ----------
bookingsRoutes.patch("/bookings/:id", authMiddleware, requirePermission("booking.update"), async (c) => {
  const session = c.get("session");
  const tenantId = tenantOrNull(c);
  if (!tenantId) {
    return c.json(apiError("FORBIDDEN", "Phiên không gắn với tenant nào."), 403);
  }
  const row = await loadBooking(c, tenantId, param(c, "id"));
  if (!row) {
    return c.json(apiError("NOT_FOUND", "Không tìm thấy lịch hẹn."), 404);
  }
  if (!branchInScope(c, row.branchId)) {
    return c.json(apiError("FORBIDDEN", "Lịch hẹn thuộc chi nhánh ngoài phạm vi của bạn."), 403);
  }
  if (row.status !== "pending" && row.status !== "confirmed") {
    return c.json(apiError("UNPROCESSABLE", "Chỉ được sửa lịch hẹn ở trạng thái chờ xác nhận hoặc đã xác nhận."), 422);
  }
  const parsed = bookingUpdateSchema.safeParse(await readBody(c));
  if (!parsed.success) {
    return c.json(apiError("VALIDATION_ERROR", formatZodError(parsed.error)), 400);
  }
  const d = parsed.data;
  let startAt = row.startAt;
  let endAt = row.endAt;
  if (d.startAt !== undefined) {
    startAt = new Date(d.startAt).toISOString();
    endAt = new Date(new Date(d.startAt).getTime() + row.durationMinutes * 60_000).toISOString();
  }
  let technicianId: string | null = row.technicianId;
  if (d.technicianId !== undefined) {
    technicianId = d.technicianId;
  }
  if (technicianId) {
    const emp = await loadEmployee(c, tenantId, technicianId);
    if (!emp) {
      return c.json(apiError("NOT_FOUND", "Không tìm thấy kỹ thuật viên."), 404);
    }
    const inBranch = await c.env.DB.prepare(
      `SELECT id FROM employees WHERE id = ? AND branch_id = ? AND tenant_id = ? LIMIT 1`,
    )
      .bind(technicianId, row.branchId, tenantId)
      .first<{ id: string }>();
    if (!inBranch) {
      return c.json(apiError("NOT_FOUND", "Kỹ thuật viên không thuộc chi nhánh này."), 404);
    }
    if (emp.status !== "active") {
      return c.json(apiError("UNPROCESSABLE", "Kỹ thuật viên hiện không hoạt động."), 422);
    }
    if (await hasConflict(c, tenantId, technicianId, startAt, endAt, row.id)) {
      return c.json(apiError("CONFLICT", "Lịch đã trùng với lịch hẹn khác của kỹ thuật viên này."), 409);
    }
  }
  const now = nowIso();
  await c.env.DB.batch([
    c.env.DB.prepare(
      `UPDATE bookings SET start_at = ?, end_at = ?, technician_id = ?, notes = ?, updated_at = ? WHERE id = ?`,
    ).bind(startAt, endAt, technicianId, d.notes !== undefined ? d.notes : row.notes, now, row.id),
    auditInsertStatement(c.env.DB, {
      tenantId,
      userId: session.userId,
      action: "booking.update",
      entityType: "booking",
      entityId: row.id,
      branchId: row.branchId,
    }),
  ]);
  const updated = await loadBooking(c, tenantId, row.id);
  const items = await loadBookingItems(c, row.id);
  return c.json({ data: updated ? bookingOut(updated, items) : null });
});

// ---------- Đổi trạng thái (dùng chung cho /status và /cancel) ----------
async function applyStatusChange(
  c: AppCtx,
  booking: BookingRow,
  toStatus: BookingStatus,
  reason: string | null,
): Promise<Response> {
  const session = c.get("session");
  const tenantId = booking.tenantId;
  const fromStatus = booking.status as BookingStatus;
  if (!canTransitionBooking(fromStatus, toStatus)) {
    return c.json(
      apiError("UNPROCESSABLE", `Không thể chuyển lịch hẹn từ ${fromStatus} sang ${toStatus}.`),
      422,
    );
  }
  if (session.role === "technician") {
    const emp = await c.env.DB.prepare(
      `SELECT id FROM employees WHERE user_id = ? AND tenant_id = ? AND deleted_at IS NULL LIMIT 1`,
    )
      .bind(session.userId, tenantId)
      .first<{ id: string }>();
    if (!emp || booking.technicianId !== emp.id) {
      return c.json(apiError("FORBIDDEN", "Kỹ thuật viên chỉ được đổi trạng thái lịch hẹn của chính mình."), 403);
    }
  }
  const now = nowIso();
  const statements: D1PreparedStatement[] = [
    c.env.DB.prepare(`UPDATE bookings SET status = ?, updated_at = ? WHERE id = ?`).bind(toStatus, now, booking.id),
    c.env.DB.prepare(
      `INSERT INTO booking_status_history (id, booking_id, from_status, to_status, changed_by, reason, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).bind(newId(), booking.id, fromStatus, toStatus, session.userId, reason, now),
    auditInsertStatement(c.env.DB, {
      tenantId,
      userId: session.userId,
      action: "booking.status",
      entityType: "booking",
      entityId: booking.id,
      branchId: booking.branchId,
      metadata: { from: fromStatus, to: toStatus },
    }),
  ];
  if (toStatus === "completed") {
    statements.push(
      c.env.DB.prepare(`UPDATE customers SET last_visit_at = ?, updated_at = ? WHERE id = ?`).bind(now, now, booking.customerId),
    );
  }
  await c.env.DB.batch(statements);
  const updated = await loadBooking(c, tenantId, booking.id);
  const items = await loadBookingItems(c, booking.id);
  return c.json({ data: updated ? bookingOut(updated, items) : null });
}

// ---------- POST /bookings/:id/status ----------
bookingsRoutes.post("/bookings/:id/status", authMiddleware, requirePermission("booking.status"), async (c) => {
  const tenantId = tenantOrNull(c);
  if (!tenantId) {
    return c.json(apiError("FORBIDDEN", "Phiên không gắn với tenant nào."), 403);
  }
  const row = await loadBooking(c, tenantId, param(c, "id"));
  if (!row) {
    return c.json(apiError("NOT_FOUND", "Không tìm thấy lịch hẹn."), 404);
  }
  if (!branchInScope(c, row.branchId)) {
    return c.json(apiError("FORBIDDEN", "Lịch hẹn thuộc chi nhánh ngoài phạm vi của bạn."), 403);
  }
  const parsed = bookingStatusSchema.safeParse(await readBody(c));
  if (!parsed.success) {
    return c.json(apiError("VALIDATION_ERROR", formatZodError(parsed.error)), 400);
  }
  return applyStatusChange(c, row, parsed.data.toStatus, parsed.data.reason ?? null);
});

// ---------- POST /bookings/:id/cancel ----------
bookingsRoutes.post("/bookings/:id/cancel", authMiddleware, requirePermission("booking.status"), async (c) => {
  const tenantId = tenantOrNull(c);
  if (!tenantId) {
    return c.json(apiError("FORBIDDEN", "Phiên không gắn với tenant nào."), 403);
  }
  const row = await loadBooking(c, tenantId, param(c, "id"));
  if (!row) {
    return c.json(apiError("NOT_FOUND", "Không tìm thấy lịch hẹn."), 404);
  }
  if (!branchInScope(c, row.branchId)) {
    return c.json(apiError("FORBIDDEN", "Lịch hẹn thuộc chi nhánh ngoài phạm vi của bạn."), 403);
  }
  const parsed = cancelSchema.safeParse(await readBody(c));
  if (!parsed.success) {
    return c.json(apiError("VALIDATION_ERROR", formatZodError(parsed.error)), 400);
  }
  return applyStatusChange(c, row, "cancelled", parsed.data.reason ?? null);
});
