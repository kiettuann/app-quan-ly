// Public booking routes — KHÔNG yêu cầu đăng nhập.
// Tenant được suy ra từ slug / branch_id, không bao giờ tin tenant_id client gửi.
// SĐT là định danh khách ở MVP: KHÔNG có SMS OTP (quyết định đã chốt).
// GET /public/my-bookings chỉ cần biết SĐT — giới hạn đã ghi rõ (không phải
// xác thực mạnh); hủy lịch yêu cầu SĐT khớp với khách của booking đó.
import { Hono } from "hono";
import { z } from "zod";
import {
  apiError,
  BOOKING_ACTIVE_STATUSES,
  isBookingSlotTaken,
  phoneVn,
  type BookingStatus,
  type SessionContext,
} from "@quanly/shared";
import type { Env } from "../index.js";
import { auditInsertStatement } from "../audit.js";
import { newId, nowIso } from "../db.js";
import { publicBookingSchema } from "../validation.js";

export const publicRoutes = new Hono<{ Bindings: Env; Variables: { session: SessionContext } }>();

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

interface BranchRow {
  id: string;
  tenantId: string;
  name: string;
  address: string | null;
  phone: string | null;
  status: string;
}

async function findActiveBranch(db: D1Database, branchId: string): Promise<BranchRow | null> {
  return db
    .prepare(
      `SELECT id, tenant_id AS tenantId, name, address, phone, status
       FROM branches WHERE id = ? AND status = 'active'`,
    )
    .bind(branchId)
    .first<BranchRow>();
}

interface ServiceRow {
  id: string;
  tenantId: string;
  categoryId: string | null;
  name: string;
  description: string | null;
  priceVnd: number;
  durationMinutes: number;
  status: string;
}

interface ServiceWithPrice extends ServiceRow {
  branchPriceVnd: number;
}

/** Dịch vụ active của tenant + giá override theo chi nhánh (nếu có). */
async function loadServicesWithBranchPrice(
  db: D1Database,
  tenantId: string,
  branchId: string,
  serviceIds: string[],
): Promise<ServiceWithPrice[] | null> {
  const placeholders = serviceIds.map(() => "?").join(", ");
  const services = await db
    .prepare(
      `SELECT id, tenant_id AS tenantId, category_id AS categoryId, name, description,
        price_vnd AS priceVnd, duration_minutes AS durationMinutes, status
       FROM services
       WHERE tenant_id = ? AND id IN (${placeholders}) AND status = 'active' AND deleted_at IS NULL`,
    )
    .bind(tenantId, ...serviceIds)
    .all<ServiceRow>();
  const found = services.results ?? [];
  if (found.length !== serviceIds.length) return null;
  const settings = await db
    .prepare(
      `SELECT service_id AS serviceId, price_vnd AS priceVnd, is_available AS isAvailable
       FROM service_branch_settings WHERE tenant_id = ? AND branch_id = ?`,
    )
    .bind(tenantId, branchId)
    .all<{ serviceId: string; priceVnd: number | null; isAvailable: number }>();
  const settingMap = new Map((settings.results ?? []).map((s) => [s.serviceId, s]));
  const out: ServiceWithPrice[] = [];
  for (const s of found) {
    const setting = settingMap.get(s.id);
    if (setting && setting.isAvailable === 0) return null;
    out.push({
      ...s,
      branchPriceVnd: setting?.priceVnd ?? s.priceVnd,
    });
  }
  // Giữ đúng thứ tự serviceIds client gửi.
  out.sort((a, b) => serviceIds.indexOf(a.id) - serviceIds.indexOf(b.id));
  return out;
}

/** [start, end) theo UTC của một ngày YYYY-MM-DD ở Asia/Ho_Chi_Minh (UTC+7). */
function vnDayBounds(date: string): { startIso: string; endIso: string } {
  const y = Number(date.slice(0, 4));
  const m = Number(date.slice(5, 7));
  const d = Number(date.slice(8, 10));
  const startMs = Date.UTC(y, m - 1, d) - 7 * 60 * 60 * 1000;
  return {
    startIso: new Date(startMs).toISOString(),
    endIso: new Date(startMs + 24 * 60 * 60 * 1000).toISOString(),
  };
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// ---------- Branches ----------
publicRoutes.get("/public/branches", async (c) => {
  const slug = c.req.query("tenant");
  if (!slug) return c.json(apiError("NOT_FOUND", "Không tìm thấy tiệm."), 404);
  const tenant = await c.env.DB.prepare(
    `SELECT id, name, slug, status FROM tenants WHERE slug = ?`,
  )
    .bind(slug)
    .first<{ id: string; name: string; slug: string; status: string }>();
  if (!tenant) return c.json(apiError("NOT_FOUND", "Không tìm thấy tiệm."), 404);
  const branches = await c.env.DB.prepare(
    `SELECT id, tenant_id AS tenantId, name, address, phone, status,
      created_at AS createdAt, updated_at AS updatedAt
     FROM branches WHERE tenant_id = ? AND status = 'active' ORDER BY created_at ASC`,
  )
    .bind(tenant.id)
    .all();
  return c.json({
    data: branches.results ?? [],
    meta: { tenant: { id: tenant.id, name: tenant.name, slug: tenant.slug } },
  });
});

// ---------- Services ----------
publicRoutes.get("/public/services", async (c) => {
  const branchId = c.req.query("branch_id");
  if (!branchId) {
    return c.json(apiError("VALIDATION_ERROR", "Thiếu branch_id."), 400);
  }
  const branch = await findActiveBranch(c.env.DB, branchId);
  if (!branch) return c.json(apiError("NOT_FOUND", "Không tìm thấy chi nhánh."), 404);
  const services = await c.env.DB.prepare(
    `SELECT s.id, s.tenant_id AS tenantId, s.category_id AS categoryId, s.name,
       s.description, s.price_vnd AS priceVnd, s.duration_minutes AS durationMinutes,
       sbs.price_vnd AS branchPriceVnd
     FROM services s
     LEFT JOIN service_branch_settings sbs
       ON sbs.service_id = s.id AND sbs.branch_id = ?
     WHERE s.tenant_id = ? AND s.status = 'active' AND s.deleted_at IS NULL
       AND (sbs.service_id IS NULL OR sbs.is_available = 1)
     ORDER BY s.name ASC`,
  )
    .bind(branchId, branch.tenantId)
    .all();
  const data = (services.results ?? []).map((s) => {
    const row = s as { branchPriceVnd: number | null; priceVnd: number } & Record<string, unknown>;
    const { branchPriceVnd, ...rest } = row;
    return { ...rest, priceVnd: branchPriceVnd ?? row.priceVnd };
  });
  return c.json({ data, meta: { branchId: branch.id } });
});

// ---------- Availability ----------
publicRoutes.get("/public/availability", async (c) => {
  const branchId = c.req.query("branch_id");
  const date = c.req.query("date");
  const serviceIdsParam = c.req.query("service_ids");
  const technicianId = c.req.query("technician_id") ?? undefined;
  if (!branchId || !date || !serviceIdsParam) {
    return c.json(
      apiError("VALIDATION_ERROR", "Thiếu branch_id, date hoặc service_ids."),
      400,
    );
  }
  if (!DATE_RE.test(date)) {
    return c.json(apiError("VALIDATION_ERROR", "date phải đúng định dạng YYYY-MM-DD."), 400);
  }
  const serviceIds = serviceIdsParam
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  if (serviceIds.length === 0) {
    return c.json(apiError("VALIDATION_ERROR", "Chọn ít nhất 1 dịch vụ."), 400);
  }
  const branch = await findActiveBranch(c.env.DB, branchId);
  if (!branch) return c.json(apiError("NOT_FOUND", "Không tìm thấy chi nhánh."), 404);
  const services = await loadServicesWithBranchPrice(c.env.DB, branch.tenantId, branchId, serviceIds);
  if (!services) {
    return c.json(
      apiError("NOT_FOUND", "Một hoặc nhiều dịch vụ không tồn tại hoặc không khả dụng tại chi nhánh này."),
      404,
    );
  }
  const totalDuration = services.reduce((sum, s) => sum + s.durationMinutes, 0);

  const employees = await c.env.DB.prepare(
    `SELECT id, full_name AS fullName FROM employees
     WHERE tenant_id = ? AND branch_id = ? AND status = 'active' AND deleted_at IS NULL
     ORDER BY created_at ASC`,
  )
    .bind(branch.tenantId, branchId)
    .all<{ id: string; fullName: string }>();
  let candidates = employees.results ?? [];
  if (technicianId) {
    const tech = candidates.find((e) => e.id === technicianId);
    if (!tech) return c.json(apiError("NOT_FOUND", "Không tìm thấy kỹ thuật viên tại chi nhánh này."), 404);
    candidates = [tech];
  }

  const bounds = vnDayBounds(date);
  const bookings = await c.env.DB.prepare(
    `SELECT id, technician_id AS technicianId, start_at AS startAt, end_at AS endAt, status
     FROM bookings
     WHERE tenant_id = ? AND branch_id = ? AND start_at >= ? AND start_at < ?`,
  )
    .bind(branch.tenantId, branchId, bounds.startIso, bounds.endIso)
    .all<{ id: string; technicianId: string | null; startAt: string; endAt: string; status: BookingStatus }>();
  const dayBookings = bookings.results ?? [];

  // Slot 30 phút, 08:00–20:00 (giờ Việt Nam). Slot chỉ được liệt kê khi
  // kết thúc (start + tổng thời lượng dịch vụ) không quá 20:00.
  const OPEN_MIN = 8 * 60;
  const CLOSE_MIN = 20 * 60;
  const slots: Array<{ time: string; available: boolean; technicianIds: string[] }> = [];
  for (let startMin = OPEN_MIN; startMin + totalDuration <= CLOSE_MIN; startMin += 30) {
    const dayStartMs = Date.UTC(
      Number(date.slice(0, 4)),
      Number(date.slice(5, 7)) - 1,
      Number(date.slice(8, 10)),
    );
    const slotStartMs = dayStartMs + (startMin - 7 * 60) * 60 * 1000;
    const slotEndMs = slotStartMs + totalDuration * 60 * 1000;
    const slotStartIso = new Date(slotStartMs).toISOString();
    const slotEndIso = new Date(slotEndMs).toISOString();
    const freeIds: string[] = [];
    for (const emp of candidates) {
      const empBookings = dayBookings.filter((b) => b.technicianId === emp.id);
      if (!isBookingSlotTaken(empBookings, { startAt: slotStartIso, endAt: slotEndIso })) {
        freeIds.push(emp.id);
      }
    }
    const hh = String(Math.floor(startMin / 60)).padStart(2, "0");
    const mm = String(startMin % 60).padStart(2, "0");
    slots.push({ time: `${hh}:${mm}`, available: freeIds.length > 0, technicianIds: freeIds });
  }
  return c.json({
    data: {
      branchId,
      date,
      serviceIds,
      durationMinutes: totalDuration,
      // Danh sách KTV của chi nhánh để app booking cho khách chọn (hoặc "Hệ thống tự chọn").
      technicians: candidates.map((e) => ({ id: e.id, name: e.fullName })),
      slots,
    },
  });
});

// ---------- Create public booking ----------
publicRoutes.post("/public/bookings", async (c) => {
  const body = await readBody(c);
  if (!body) return c.json(apiError("VALIDATION_ERROR", "Thiếu nội dung yêu cầu (JSON)."), 400);
  const parsed = publicBookingSchema.safeParse(body);
  if (!parsed.success) {
    return c.json(apiError("VALIDATION_ERROR", validationMessage(parsed.error.issues)), 400);
  }
  const d = parsed.data;
  const db = c.env.DB;
  const branch = await findActiveBranch(db, d.branchId);
  if (!branch) return c.json(apiError("NOT_FOUND", "Không tìm thấy chi nhánh."), 404);
  const tenantId = branch.tenantId;
  const services = await loadServicesWithBranchPrice(db, tenantId, d.branchId, d.serviceIds);
  if (!services) {
    return c.json(
      apiError("NOT_FOUND", "Một hoặc nhiều dịch vụ không tồn tại hoặc không khả dụng tại chi nhánh này."),
      404,
    );
  }
  const totalDuration = services.reduce((sum, s) => sum + s.durationMinutes, 0);
  const totalPrice = services.reduce((sum, s) => sum + s.branchPriceVnd, 0);
  const startAt = new Date(d.startAt);
  const endAt = new Date(startAt.getTime() + totalDuration * 60 * 1000);
  const startIso = startAt.toISOString();
  const endIso = endAt.toISOString();

  const employees = await db
    .prepare(
      `SELECT id, full_name AS fullName FROM employees
       WHERE tenant_id = ? AND branch_id = ? AND status = 'active' AND deleted_at IS NULL
       ORDER BY created_at ASC`,
    )
    .bind(tenantId, d.branchId)
    .all<{ id: string; fullName: string }>();
  const employeeList = employees.results ?? [];

  // Kiểm tra trùng lịch: cùng kỹ thuật viên, khoảng [start, end) chồng lấn,
  // trạng thái còn chiếm slot (BOOKING_ACTIVE_STATUSES). Trùng -> 409.
  const activeStatuses = BOOKING_ACTIVE_STATUSES.map(() => "?").join(", ");
  const checkConflict = async (technicianId: string): Promise<boolean> => {
    const rows = await db
      .prepare(
        `SELECT start_at AS startAt, end_at AS endAt, status FROM bookings
         WHERE tenant_id = ? AND technician_id = ? AND status IN (${activeStatuses})`,
      )
      .bind(tenantId, technicianId, ...BOOKING_ACTIVE_STATUSES)
      .all<{ startAt: string; endAt: string; status: BookingStatus }>();
    return isBookingSlotTaken(rows.results ?? [], { startAt: startIso, endAt: endIso });
  };

  let technicianId: string | null = null;
  if (d.technicianId) {
    const tech = employeeList.find((e) => e.id === d.technicianId);
    if (!tech) {
      return c.json(apiError("NOT_FOUND", "Không tìm thấy kỹ thuật viên tại chi nhánh này."), 404);
    }
    if (await checkConflict(tech.id)) {
      return c.json(apiError("CONFLICT", "Lịch đã trùng với lịch hẹn khác của kỹ thuật viên này."), 409);
    }
    technicianId = tech.id;
  } else {
    // Hệ thống tự chọn: nhân viên đầu tiên (theo created_at) không trùng lịch.
    for (const emp of employeeList) {
      if (!(await checkConflict(emp.id))) {
        technicianId = emp.id;
        break;
      }
    }
    if (!technicianId) {
      return c.json(
        apiError("CONFLICT", "Không còn kỹ thuật viên trống vào khung giờ này. Vui lòng chọn giờ khác."),
        409,
      );
    }
  }

  // Tìm-hoặc-tạo khách theo SĐT trong tenant (không SMS OTP ở MVP).
  const existingCustomer = await db
    .prepare(
      `SELECT id, tenant_id AS tenantId, branch_id AS branchId, full_name AS fullName,
        phone, email, created_at AS createdAt, updated_at AS updatedAt
       FROM customers WHERE tenant_id = ? AND phone = ? AND deleted_at IS NULL
       ORDER BY created_at ASC LIMIT 1`,
    )
    .bind(tenantId, d.phone)
    .first<{
      id: string;
      tenantId: string;
      branchId: string | null;
      fullName: string;
      phone: string;
      email: string | null;
      createdAt: string;
      updatedAt: string;
    }>();
  const now = nowIso();
  let customer = existingCustomer;
  const stmts: D1PreparedStatement[] = [];
  if (!customer) {
    const customerId = newId();
    customer = {
      id: customerId,
      tenantId,
      branchId: d.branchId,
      fullName: d.fullName,
      phone: d.phone,
      email: null,
      createdAt: now,
      updatedAt: now,
    };
    stmts.push(
      db.prepare(
        `INSERT INTO customers (id, tenant_id, branch_id, full_name, phone, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      ).bind(customerId, tenantId, d.branchId, d.fullName, d.phone, now, now),
    );
  }

  const bookingId = newId();
  stmts.push(
    db.prepare(
      `INSERT INTO bookings (id, tenant_id, branch_id, customer_id, technician_id, start_at,
        end_at, duration_minutes, status, source, deposit_vnd, deposit_status,
        total_price_vnd, notes, created_by, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', 'online', 0, 'none', ?, ?, NULL, ?, ?)`,
    ).bind(
      bookingId,
      tenantId,
      d.branchId,
      customer.id,
      technicianId,
      startIso,
      endIso,
      totalDuration,
      totalPrice,
      d.notes ?? null,
      now,
      now,
    ),
  );
  for (const s of services) {
    stmts.push(
      db.prepare(
        `INSERT INTO booking_items (id, booking_id, service_id, service_name_snapshot,
          price_vnd_snapshot, duration_minutes_snapshot, technician_id, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      ).bind(newId(), bookingId, s.id, s.name, s.branchPriceVnd, s.durationMinutes, technicianId, now),
    );
  }
  stmts.push(
    db.prepare(
      `INSERT INTO booking_status_history (id, booking_id, from_status, to_status, changed_by, reason, created_at)
       VALUES (?, ?, 'pending', 'pending', NULL, 'Tạo lịch online', ?)`,
    ).bind(newId(), bookingId, now),
  );
  stmts.push(
    auditInsertStatement(db, {
      tenantId,
      userId: null,
      action: "public.booking_create",
      entityType: "booking",
      entityId: bookingId,
      branchId: d.branchId,
      metadata: { customerId: customer.id, phone: d.phone, source: "online" },
    }),
  );
  await db.batch(stmts);

  return c.json(
    {
      data: {
        booking: {
          id: bookingId,
          tenantId,
          branchId: d.branchId,
          customerId: customer.id,
          technicianId,
          startAt: startIso,
          endAt: endIso,
          durationMinutes: totalDuration,
          status: "pending",
          source: "online",
          depositVnd: 0,
          depositStatus: "none",
          totalPriceVnd: totalPrice,
          notes: d.notes ?? null,
          createdAt: now,
          updatedAt: now,
        },
        customer,
        items: services.map((s) => ({
          serviceId: s.id,
          serviceName: s.name,
          priceVnd: s.branchPriceVnd,
          durationMinutes: s.durationMinutes,
          technicianId,
        })),
      },
    },
    201,
  );
});

// ---------- My bookings (phone lookup) ----------
publicRoutes.get("/public/my-bookings", async (c) => {
  const phone = c.req.query("phone");
  const branchId = c.req.query("branch_id");
  if (!phone || !branchId) {
    return c.json(apiError("VALIDATION_ERROR", "Thiếu phone hoặc branch_id."), 400);
  }
  if (!phoneVn.safeParse(phone).success) {
    return c.json(apiError("VALIDATION_ERROR", "Số điện thoại không đúng định dạng."), 400);
  }
  const branch = await c.env.DB.prepare(
    `SELECT id, tenant_id AS tenantId, status FROM branches WHERE id = ?`,
  )
    .bind(branchId)
    .first<{ id: string; tenantId: string; status: string }>();
  if (!branch) return c.json(apiError("NOT_FOUND", "Không tìm thấy chi nhánh."), 404);
  const customers = await c.env.DB.prepare(
    `SELECT id FROM customers WHERE tenant_id = ? AND phone = ? AND deleted_at IS NULL`,
  )
    .bind(branch.tenantId, phone)
    .all<{ id: string }>();
  const customerIds = (customers.results ?? []).map((r) => r.id);
  if (customerIds.length === 0) return c.json({ data: [] });
  const placeholders = customerIds.map(() => "?").join(", ");
  const rows = await c.env.DB.prepare(
    `SELECT b.id, b.branch_id AS branchId, b.customer_id AS customerId,
      cu.full_name AS customerName, cu.phone AS customerPhone,
      b.technician_id AS technicianId, b.start_at AS startAt, b.end_at AS endAt,
      b.duration_minutes AS durationMinutes, b.status, b.source,
      b.total_price_vnd AS totalPriceVnd, b.notes,
      (SELECT GROUP_CONCAT(service_name_snapshot, ', ') FROM booking_items WHERE booking_id = b.id) AS serviceNames,
      b.created_at AS createdAt, b.updated_at AS updatedAt
     FROM bookings b JOIN customers cu ON cu.id = b.customer_id
     WHERE b.tenant_id = ? AND b.branch_id = ? AND b.customer_id IN (${placeholders})
     ORDER BY b.start_at DESC LIMIT 50`,
  )
    .bind(branch.tenantId, branchId, ...customerIds)
    .all();
  return c.json({ data: rows.results ?? [] });
});

// ---------- Cancel own booking ----------
const cancelBodySchema = z.object({ phone: phoneVn });

publicRoutes.post("/public/my-bookings/:id/cancel", async (c) => {
  const body = await readBody(c);
  if (!body) return c.json(apiError("VALIDATION_ERROR", "Thiếu nội dung yêu cầu (JSON)."), 400);
  const parsed = cancelBodySchema.safeParse(body);
  if (!parsed.success) {
    return c.json(apiError("VALIDATION_ERROR", validationMessage(parsed.error.issues)), 400);
  }
  const db = c.env.DB;
  const booking = await db
    .prepare(
      `SELECT b.id, b.tenant_id AS tenantId, b.branch_id AS branchId,
        b.customer_id AS customerId, cu.phone AS customerPhone,
        b.technician_id AS technicianId, b.start_at AS startAt, b.end_at AS endAt,
        b.duration_minutes AS durationMinutes, b.status, b.source,
        b.total_price_vnd AS totalPriceVnd, b.notes,
        b.created_at AS createdAt, b.updated_at AS updatedAt
       FROM bookings b JOIN customers cu ON cu.id = b.customer_id
       WHERE b.id = ?`,
    )
    .bind(c.req.param("id"))
    .first<{
      id: string;
      tenantId: string;
      branchId: string;
      customerId: string;
      customerPhone: string;
      technicianId: string | null;
      startAt: string;
      endAt: string;
      durationMinutes: number;
      status: string;
      source: string;
      totalPriceVnd: number;
      notes: string | null;
      createdAt: string;
      updatedAt: string;
    }>();
  if (!booking) return c.json(apiError("NOT_FOUND", "Không tìm thấy lịch hẹn."), 404);
  if (booking.customerPhone !== parsed.data.phone) {
    return c.json(apiError("FORBIDDEN", "Số điện thoại không khớp với lịch hẹn này."), 403);
  }
  if (booking.status !== "pending" && booking.status !== "confirmed") {
    return c.json(
      apiError("UNPROCESSABLE", "Chỉ lịch ở trạng thái chờ xác nhận hoặc đã xác nhận mới được hủy."),
      422,
    );
  }
  const now = nowIso();
  await db.batch([
    db.prepare(`UPDATE bookings SET status = 'cancelled', updated_at = ? WHERE id = ?`).bind(now, booking.id),
    db.prepare(
      `INSERT INTO booking_status_history (id, booking_id, from_status, to_status, changed_by, reason, created_at)
       VALUES (?, ?, ?, 'cancelled', NULL, 'Khách hủy online', ?)`,
    ).bind(newId(), booking.id, booking.status, now),
    auditInsertStatement(db, {
      tenantId: booking.tenantId,
      userId: null,
      action: "public.booking_cancel",
      entityType: "booking",
      entityId: booking.id,
      branchId: booking.branchId,
      metadata: { fromStatus: booking.status },
    }),
  ]);
  return c.json({ data: { ...booking, status: "cancelled", updatedAt: now } });
});
