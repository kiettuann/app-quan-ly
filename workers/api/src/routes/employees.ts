// Employees, attendance, shifts — Hono routes.
// Nguồn: CONTRACTS.md §4, API_SPEC.md §6, DATABASE_SCHEMA.md §5, PERMISSIONS.md.
// Chấm công: check-in tạo attendance_records cho ngày trong body, trạng thái
// present/late (muộn nếu check-in sau 09:00 giờ Việt Nam, UTC+7); check-in
// trùng ngày -> 409; check-out yêu cầu đã check-in cùng ngày.
import { Hono } from "hono";
import { z } from "zod";
import type { ZodError } from "zod";
import {
  apiError,
  BOOKING_ACTIVE_STATUSES,
  hasPermission,
  isoDate,
  vndInt,
  type PermissionKey,
  type SessionContext,
} from "@quanly/shared";
import type { Env } from "../index.js";
import { authMiddleware } from "../auth.js";
import { requirePermission } from "../rbac.js";
import { auditInsertStatement } from "../audit.js";
import { newId, nowIso, pageMeta, pagination } from "../db.js";
import { attendanceSchema, employeeSchema } from "../validation.js";

export const employeeRoutes = new Hono<{ Bindings: Env; Variables: { session: SessionContext } }>();

function zodMessage(err: ZodError): string {
  return err.issues.map((i) => `${i.path.join(".") || "body"}: ${i.message}`).join("; ");
}

interface EmployeeRow {
  id: string;
  tenantId: string;
  userId: string | null;
  branchId: string;
  fullName: string;
  phone: string | null;
  position: string | null;
  hireDate: string | null;
  baseSalaryVnd: number;
  status: string;
  deletedAt: string | null;
  createdAt: string;
  updatedAt: string;
  skillsJson: string | null;
}

const EMPLOYEE_SELECT = `SELECT e.id, e.tenant_id AS tenantId, e.user_id AS userId,
  e.branch_id AS branchId, e.full_name AS fullName, e.phone, e.position,
  e.hire_date AS hireDate, e.base_salary_vnd AS baseSalaryVnd, e.status,
  e.deleted_at AS deletedAt, e.created_at AS createdAt, e.updated_at AS updatedAt,
  ep.skills_json AS skillsJson
  FROM employees e LEFT JOIN employee_profiles ep ON ep.employee_id = e.id`;

function toEmployee(row: EmployeeRow): Record<string, unknown> {
  let skills: unknown[] = [];
  try {
    skills = JSON.parse(row.skillsJson ?? "[]") as unknown[];
  } catch {
    skills = [];
  }
  const { skillsJson, ...rest } = row;
  void skillsJson;
  return { ...rest, skills };
}

function branchOutOfScope(session: SessionContext, branchId: string): boolean {
  return !session.branchIds.includes(branchId);
}

async function loadEmployee(
  db: D1Database,
  tenantId: string,
  employeeId: string,
): Promise<EmployeeRow | null> {
  return db
    .prepare(`${EMPLOYEE_SELECT} WHERE e.id = ? AND e.tenant_id = ? AND e.deleted_at IS NULL`)
    .bind(employeeId, tenantId)
    .first<EmployeeRow>();
}

/** Chấm công: có quyền attendance.manage, hoặc chính nhân viên đó (own). */
function canManageAttendance(session: SessionContext, employee: EmployeeRow): boolean {
  if (hasPermission(session.permissions as PermissionKey[], "attendance.manage")) return true;
  return employee.userId !== null && employee.userId === session.userId;
}

/** Muộn nếu giờ hiện tại (Việt Nam, UTC+7) đã qua 09:00. */
function isLateNow(): boolean {
  const vn = new Date(Date.now() + 7 * 60 * 60 * 1000);
  const hh = vn.getUTCHours();
  const mm = vn.getUTCMinutes();
  return hh > 9 || (hh === 9 && mm > 0);
}

for (const p of ["/employees", "/employees/*", "/attendance", "/attendance/*", "/shifts", "/shifts/*"]) {
  employeeRoutes.use(p, authMiddleware);
}

employeeRoutes.get("/employees", requirePermission("employee.manage"), async (c) => {
  const session = c.get("session");
  const tenantId = session.tenantId;
  if (!tenantId) {
    return c.json(apiError("FORBIDDEN", "Platform Admin không truy cập dữ liệu nghiệp vụ tenant."), 403);
  }
  const { page, limit, offset } = pagination(c);
  const branchId = c.req.query("branch_id");
  const status = c.req.query("status");
  const search = c.req.query("search");
  if (status && !["active", "inactive"].includes(status)) {
    return c.json(apiError("VALIDATION_ERROR", "Trạng thái nhân viên không hợp lệ."), 400);
  }
  const conditions = ["e.tenant_id = ?", "e.deleted_at IS NULL"];
  const params: unknown[] = [tenantId];
  if (branchId) {
    if (branchOutOfScope(session, branchId)) {
      return c.json(apiError("FORBIDDEN", "Chi nhánh ngoài phạm vi được phân quyền."), 403);
    }
    conditions.push("e.branch_id = ?");
    params.push(branchId);
  } else if (session.branchIds.length > 0) {
    conditions.push(`e.branch_id IN (${session.branchIds.map(() => "?").join(",")})`);
    params.push(...session.branchIds);
  } else {
    conditions.push("1 = 0");
  }
  if (status) {
    conditions.push("e.status = ?");
    params.push(status);
  }
  if (search) {
    conditions.push("(e.full_name LIKE ? OR e.phone LIKE ?)");
    params.push(`%${search}%`, `%${search}%`);
  }
  const where = `WHERE ${conditions.join(" AND ")}`;
  const countRow = await c.env.DB.prepare(
    `SELECT COUNT(*) AS total FROM employees e WHERE ${conditions.join(" AND ")}`,
  )
    .bind(...params)
    .first<{ total: number }>();
  const total = countRow?.total ?? 0;
  const rows = await c.env.DB.prepare(
    `${EMPLOYEE_SELECT} ${where} ORDER BY e.created_at DESC, e.id DESC LIMIT ? OFFSET ?`,
  )
    .bind(...params, limit, offset)
    .all<EmployeeRow>();
  return c.json({ data: (rows.results ?? []).map(toEmployee), meta: pageMeta(page, limit, total) });
});

employeeRoutes.post("/employees", requirePermission("employee.manage"), async (c) => {
  const session = c.get("session");
  const tenantId = session.tenantId;
  if (!tenantId) {
    return c.json(apiError("FORBIDDEN", "Platform Admin không truy cập dữ liệu nghiệp vụ tenant."), 403);
  }
  const body = await c.req.json().catch(() => null);
  const parsed = employeeSchema.safeParse(body);
  if (!parsed.success) {
    return c.json(apiError("VALIDATION_ERROR", `Dữ liệu không hợp lệ: ${zodMessage(parsed.error)}`), 400);
  }
  const d = parsed.data;
  if (branchOutOfScope(session, d.branchId)) {
    return c.json(apiError("FORBIDDEN", "Chi nhánh ngoài phạm vi được phân quyền."), 403);
  }
  if (d.userId) {
    const user = await c.env.DB.prepare(`SELECT id FROM users WHERE id = ? AND tenant_id = ?`)
      .bind(d.userId, tenantId)
      .first<{ id: string }>();
    if (!user) {
      return c.json(apiError("NOT_FOUND", "Người dùng liên kết không thuộc tiệm này."), 404);
    }
    const linked = await c.env.DB
      .prepare(`SELECT id FROM employees WHERE user_id = ? AND tenant_id = ? AND deleted_at IS NULL`)
      .bind(d.userId, tenantId)
      .first<{ id: string }>();
    if (linked) {
      return c.json(apiError("CONFLICT", "Người dùng này đã liên kết với một nhân viên khác."), 409);
    }
  }
  const now = nowIso();
  const employeeId = newId();
  await c.env.DB.batch([
    c.env.DB.prepare(
      `INSERT INTO employees
         (id, tenant_id, user_id, branch_id, full_name, phone, position,
          hire_date, base_salary_vnd, status, deleted_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', NULL, ?, ?)`,
    ).bind(
      employeeId, tenantId, d.userId ?? null, d.branchId, d.fullName,
      d.phone ?? null, d.position ?? null, d.hireDate ?? null, d.baseSalaryVnd, now, now,
    ),
    c.env.DB.prepare(
      `INSERT INTO employee_profiles (employee_id, skills_json, bio, avatar_r2_key)
       VALUES (?, ?, NULL, NULL)`,
    ).bind(employeeId, JSON.stringify(d.skills ?? [])),
    auditInsertStatement(c.env.DB, {
      tenantId,
      userId: session.userId,
      action: "employee.create",
      entityType: "employee",
      entityId: employeeId,
      branchId: d.branchId,
      metadata: { fullName: d.fullName },
    }),
  ]);
  const created: EmployeeRow = {
    id: employeeId,
    tenantId,
    userId: d.userId ?? null,
    branchId: d.branchId,
    fullName: d.fullName,
    phone: d.phone ?? null,
    position: d.position ?? null,
    hireDate: d.hireDate ?? null,
    baseSalaryVnd: d.baseSalaryVnd,
    status: "active",
    deletedAt: null,
    createdAt: now,
    updatedAt: now,
    skillsJson: JSON.stringify(d.skills ?? []),
  };
  return c.json({ data: toEmployee(created) }, 201);
});

employeeRoutes.get("/employees/:id", requirePermission("employee.manage"), async (c) => {
  const session = c.get("session");
  const tenantId = session.tenantId;
  if (!tenantId) {
    return c.json(apiError("FORBIDDEN", "Platform Admin không truy cập dữ liệu nghiệp vụ tenant."), 403);
  }
  const employee = await loadEmployee(c.env.DB, tenantId, (c.req.param("id") ?? ""));
  if (!employee) {
    return c.json(apiError("NOT_FOUND", "Không tìm thấy nhân viên."), 404);
  }
  if (branchOutOfScope(session, employee.branchId)) {
    return c.json(apiError("FORBIDDEN", "Chi nhánh ngoài phạm vi được phân quyền."), 403);
  }
  return c.json({ data: toEmployee(employee) });
});

const employeePatchSchema = z.object({
  baseSalaryVnd: vndInt.optional(),
  position: z.string().trim().max(100).optional().nullable(),
  status: z.enum(["active", "inactive"]).optional(),
  branchId: z.string().uuid().optional(),
});

employeeRoutes.patch("/employees/:id", requirePermission("employee.manage"), async (c) => {
  const session = c.get("session");
  const tenantId = session.tenantId;
  if (!tenantId) {
    return c.json(apiError("FORBIDDEN", "Platform Admin không truy cập dữ liệu nghiệp vụ tenant."), 403);
  }
  const body = await c.req.json().catch(() => null);
  const parsed = employeePatchSchema.safeParse(body);
  if (!parsed.success) {
    return c.json(apiError("VALIDATION_ERROR", `Dữ liệu không hợp lệ: ${zodMessage(parsed.error)}`), 400);
  }
  const employee = await loadEmployee(c.env.DB, tenantId, (c.req.param("id") ?? ""));
  if (!employee) {
    return c.json(apiError("NOT_FOUND", "Không tìm thấy nhân viên."), 404);
  }
  if (branchOutOfScope(session, employee.branchId)) {
    return c.json(apiError("FORBIDDEN", "Chi nhánh ngoài phạm vi được phân quyền."), 403);
  }
  const d = parsed.data;
  if (d.branchId && branchOutOfScope(session, d.branchId)) {
    return c.json(apiError("FORBIDDEN", "Chi nhánh ngoài phạm vi được phân quyền."), 403);
  }
  const sets: string[] = [];
  const params: unknown[] = [];
  if (d.baseSalaryVnd !== undefined) {
    sets.push("base_salary_vnd = ?");
    params.push(d.baseSalaryVnd);
  }
  if (d.position !== undefined) {
    sets.push("position = ?");
    params.push(d.position);
  }
  if (d.status !== undefined) {
    sets.push("status = ?");
    params.push(d.status);
  }
  if (d.branchId !== undefined) {
    sets.push("branch_id = ?");
    params.push(d.branchId);
  }
  if (sets.length === 0) {
    return c.json(apiError("VALIDATION_ERROR", "Không có trường nào để cập nhật."), 400);
  }
  const now = nowIso();
  sets.push("updated_at = ?");
  params.push(now);
  await c.env.DB.batch([
    c.env.DB.prepare(`UPDATE employees SET ${sets.join(", ")} WHERE id = ? AND tenant_id = ?`)
      .bind(...params, employee.id, tenantId),
    auditInsertStatement(c.env.DB, {
      tenantId,
      userId: session.userId,
      action: "employee.update",
      entityType: "employee",
      entityId: employee.id,
      branchId: d.branchId ?? employee.branchId,
      metadata: { fields: Object.keys(d) },
    }),
  ]);
  return c.json({
    data: toEmployee({
      ...employee,
      baseSalaryVnd: d.baseSalaryVnd ?? employee.baseSalaryVnd,
      position: d.position !== undefined ? d.position : employee.position,
      status: d.status ?? employee.status,
      branchId: d.branchId ?? employee.branchId,
      updatedAt: now,
    }),
  });
});

employeeRoutes.delete("/employees/:id", requirePermission("employee.manage"), async (c) => {
  const session = c.get("session");
  const tenantId = session.tenantId;
  if (!tenantId) {
    return c.json(apiError("FORBIDDEN", "Platform Admin không truy cập dữ liệu nghiệp vụ tenant."), 403);
  }
  const employee = await loadEmployee(c.env.DB, tenantId, (c.req.param("id") ?? ""));
  if (!employee) {
    return c.json(apiError("NOT_FOUND", "Không tìm thấy nhân viên."), 404);
  }
  if (branchOutOfScope(session, employee.branchId)) {
    return c.json(apiError("FORBIDDEN", "Chi nhánh ngoài phạm vi được phân quyền."), 403);
  }
  // Chặn xóa mềm nếu còn lịch hẹn tương lai đang hoạt động với tư cách KTV.
  const future = await c.env.DB
    .prepare(
      `SELECT COUNT(*) AS total FROM bookings
       WHERE technician_id = ? AND tenant_id = ? AND start_at > ?
         AND status IN (${BOOKING_ACTIVE_STATUSES.map(() => "?").join(",")})`,
    )
    .bind(employee.id, tenantId, nowIso(), ...BOOKING_ACTIVE_STATUSES)
    .first<{ total: number }>();
  if ((future?.total ?? 0) > 0) {
    return c.json(
      apiError("UNPROCESSABLE", "Nhân viên còn lịch hẹn sắp tới, không thể xóa. Hãy chuyển lịch trước."),
      422,
    );
  }
  const now = nowIso();
  await c.env.DB.batch([
    c.env.DB.prepare(
      `UPDATE employees SET deleted_at = ?, status = 'inactive', updated_at = ? WHERE id = ? AND tenant_id = ?`,
    ).bind(now, now, employee.id, tenantId),
    auditInsertStatement(c.env.DB, {
      tenantId,
      userId: session.userId,
      action: "employee.delete",
      entityType: "employee",
      entityId: employee.id,
      branchId: employee.branchId,
      metadata: { fullName: employee.fullName },
    }),
  ]);
  return c.json({ data: { ...toEmployee(employee), deletedAt: now, status: "inactive", updatedAt: now } });
});

// ---------------------------------------------------------------------------
// Attendance
// ---------------------------------------------------------------------------

employeeRoutes.post("/attendance/check-in", async (c) => {
  const session = c.get("session");
  const tenantId = session.tenantId;
  if (!tenantId) {
    return c.json(apiError("FORBIDDEN", "Platform Admin không truy cập dữ liệu nghiệp vụ tenant."), 403);
  }
  const body = await c.req.json().catch(() => null);
  const parsed = attendanceSchema.safeParse(body);
  if (!parsed.success) {
    return c.json(apiError("VALIDATION_ERROR", `Dữ liệu không hợp lệ: ${zodMessage(parsed.error)}`), 400);
  }
  const d = parsed.data;
  if (branchOutOfScope(session, d.branchId)) {
    return c.json(apiError("FORBIDDEN", "Chi nhánh ngoài phạm vi được phân quyền."), 403);
  }
  const employee = await loadEmployee(c.env.DB, tenantId, d.employeeId);
  if (!employee) {
    return c.json(apiError("NOT_FOUND", "Không tìm thấy nhân viên."), 404);
  }
  if (employee.branchId !== d.branchId) {
    return c.json(apiError("UNPROCESSABLE", "Nhân viên không thuộc chi nhánh này."), 422);
  }
  if (!(canManageAttendance(session, employee))) {
    return c.json(apiError("FORBIDDEN", "Bạn chỉ được chấm công cho chính mình."), 403);
  }
  const existing = await c.env.DB
    .prepare(
      `SELECT id, check_in_at AS checkInAt, check_out_at AS checkOutAt, status, note
       FROM attendance_records WHERE employee_id = ? AND date = ?`,
    )
    .bind(d.employeeId, d.date)
    .first<{ id: string; checkInAt: string | null; checkOutAt: string | null; status: string; note: string | null }>();
  if (existing && existing.checkInAt) {
    return c.json(apiError("CONFLICT", "Nhân viên đã check-in ngày này rồi."), 409);
  }
  const now = nowIso();
  const status = isLateNow() ? "late" : "present";
  if (existing) {
    await c.env.DB.batch([
      c.env.DB.prepare(
        `UPDATE attendance_records SET check_in_at = ?, status = ?, note = ?, updated_at = ? WHERE id = ?`,
      ).bind(now, status, d.note ?? existing.note, now, existing.id),
      auditInsertStatement(c.env.DB, {
        tenantId,
        userId: session.userId,
        action: "attendance.check_in",
        entityType: "attendance_record",
        entityId: existing.id,
        branchId: d.branchId,
        metadata: { employeeId: d.employeeId, date: d.date, status },
      }),
    ]);
    return c.json({
      data: {
        id: existing.id, tenantId, branchId: d.branchId, employeeId: d.employeeId,
        date: d.date, checkInAt: now, checkOutAt: existing.checkOutAt,
        status, note: d.note ?? existing.note,
      },
    });
  }
  const recordId = newId();
  await c.env.DB.batch([
    c.env.DB.prepare(
      `INSERT INTO attendance_records
         (id, tenant_id, branch_id, employee_id, date, check_in_at, check_out_at,
          status, note, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, ?)`,
    ).bind(recordId, tenantId, d.branchId, d.employeeId, d.date, now, status, d.note ?? null, now, now),
    auditInsertStatement(c.env.DB, {
      tenantId,
      userId: session.userId,
      action: "attendance.check_in",
      entityType: "attendance_record",
      entityId: recordId,
      branchId: d.branchId,
      metadata: { employeeId: d.employeeId, date: d.date, status },
    }),
  ]);
  return c.json(
    {
      data: {
        id: recordId, tenantId, branchId: d.branchId, employeeId: d.employeeId,
        date: d.date, checkInAt: now, checkOutAt: null, status, note: d.note ?? null,
      },
    },
    201,
  );
});

employeeRoutes.post("/attendance/check-out", async (c) => {
  const session = c.get("session");
  const tenantId = session.tenantId;
  if (!tenantId) {
    return c.json(apiError("FORBIDDEN", "Platform Admin không truy cập dữ liệu nghiệp vụ tenant."), 403);
  }
  const body = await c.req.json().catch(() => null);
  const parsed = attendanceSchema.safeParse(body);
  if (!parsed.success) {
    return c.json(apiError("VALIDATION_ERROR", `Dữ liệu không hợp lệ: ${zodMessage(parsed.error)}`), 400);
  }
  const d = parsed.data;
  if (branchOutOfScope(session, d.branchId)) {
    return c.json(apiError("FORBIDDEN", "Chi nhánh ngoài phạm vi được phân quyền."), 403);
  }
  const employee = await loadEmployee(c.env.DB, tenantId, d.employeeId);
  if (!employee) {
    return c.json(apiError("NOT_FOUND", "Không tìm thấy nhân viên."), 404);
  }
  if (!(canManageAttendance(session, employee))) {
    return c.json(apiError("FORBIDDEN", "Bạn chỉ được chấm công cho chính mình."), 403);
  }
  const existing = await c.env.DB
    .prepare(
      `SELECT id, check_in_at AS checkInAt, check_out_at AS checkOutAt, status, note
       FROM attendance_records WHERE employee_id = ? AND date = ?`,
    )
    .bind(d.employeeId, d.date)
    .first<{ id: string; checkInAt: string | null; checkOutAt: string | null; status: string; note: string | null }>();
  if (!existing || !existing.checkInAt) {
    return c.json(apiError("UNPROCESSABLE", "Chưa check-in ngày này, không thể check-out."), 422);
  }
  if (existing.checkOutAt) {
    return c.json(apiError("CONFLICT", "Nhân viên đã check-out ngày này rồi."), 409);
  }
  const now = nowIso();
  await c.env.DB.batch([
    c.env.DB.prepare(`UPDATE attendance_records SET check_out_at = ?, updated_at = ? WHERE id = ?`)
      .bind(now, now, existing.id),
    auditInsertStatement(c.env.DB, {
      tenantId,
      userId: session.userId,
      action: "attendance.check_out",
      entityType: "attendance_record",
      entityId: existing.id,
      branchId: d.branchId,
      metadata: { employeeId: d.employeeId, date: d.date },
    }),
  ]);
  return c.json({
    data: {
      id: existing.id, tenantId, branchId: d.branchId, employeeId: d.employeeId,
      date: d.date, checkInAt: existing.checkInAt, checkOutAt: now,
      status: existing.status, note: existing.note,
    },
  });
});

employeeRoutes.get("/attendance", async (c) => {
  const session = c.get("session");
  const tenantId = session.tenantId;
  if (!tenantId) {
    return c.json(apiError("FORBIDDEN", "Platform Admin không truy cập dữ liệu nghiệp vụ tenant."), 403);
  }
  const { page, limit, offset } = pagination(c);
  const employeeId = c.req.query("employee_id");
  const date = c.req.query("date");
  const branchId = c.req.query("branch_id");
  const isManager = hasPermission(session.permissions as PermissionKey[], "attendance.manage");
  let forcedEmployeeId: string | null = null;
  if (!isManager) {
    // Không có quyền chấm công chung: chỉ xem chấm công của chính mình.
    const emp = await c.env.DB
      .prepare(`SELECT id FROM employees WHERE tenant_id = ? AND user_id = ? AND deleted_at IS NULL`)
      .bind(tenantId, session.userId)
      .first<{ id: string }>();
    if (!emp) return c.json({ data: [], meta: pageMeta(page, limit, 0) });
    forcedEmployeeId = emp.id;
    if (employeeId && employeeId !== forcedEmployeeId) {
      return c.json(apiError("FORBIDDEN", "Chỉ được xem chấm công của mình."), 403);
    }
  }
  const conditions = ["tenant_id = ?"];
  const params: unknown[] = [tenantId];
  const effEmployeeId = forcedEmployeeId ?? employeeId ?? null;
  if (effEmployeeId) {
    conditions.push("employee_id = ?");
    params.push(effEmployeeId);
  }
  if (date) {
    conditions.push("date = ?");
    params.push(date);
  }
  if (branchId) {
    if (branchOutOfScope(session, branchId)) {
      return c.json(apiError("FORBIDDEN", "Chi nhánh ngoài phạm vi được phân quyền."), 403);
    }
    conditions.push("branch_id = ?");
    params.push(branchId);
  } else if (session.branchIds.length > 0) {
    conditions.push(`branch_id IN (${session.branchIds.map(() => "?").join(",")})`);
    params.push(...session.branchIds);
  } else {
    conditions.push("1 = 0");
  }
  const where = `WHERE ${conditions.join(" AND ")}`;
  const countRow = await c.env.DB.prepare(`SELECT COUNT(*) AS total FROM attendance_records ${where}`)
    .bind(...params)
    .first<{ total: number }>();
  const total = countRow?.total ?? 0;
  const rows = await c.env.DB
    .prepare(
      `SELECT id, tenant_id AS tenantId, branch_id AS branchId, employee_id AS employeeId,
              date, check_in_at AS checkInAt, check_out_at AS checkOutAt,
              status, note, created_at AS createdAt, updated_at AS updatedAt
       FROM attendance_records ${where}
       ORDER BY date DESC, created_at DESC LIMIT ? OFFSET ?`,
    )
    .bind(...params, limit, offset)
    .all();
  return c.json({ data: rows.results ?? [], meta: pageMeta(page, limit, total) });
});

// ---------------------------------------------------------------------------
// Shifts
// ---------------------------------------------------------------------------

const shiftSchema = z.object({
  employeeId: z.string().uuid(),
  branchId: z.string().uuid(),
  date: isoDate,
  startTime: z.string().regex(/^\d{2}:\d{2}$/, "Giờ bắt đầu phải đúng định dạng HH:MM."),
  endTime: z.string().regex(/^\d{2}:\d{2}$/, "Giờ kết thúc phải đúng định dạng HH:MM."),
});

employeeRoutes.get("/shifts", requirePermission("employee.manage"), async (c) => {
  const session = c.get("session");
  const tenantId = session.tenantId;
  if (!tenantId) {
    return c.json(apiError("FORBIDDEN", "Platform Admin không truy cập dữ liệu nghiệp vụ tenant."), 403);
  }
  const { page, limit, offset } = pagination(c);
  const employeeId = c.req.query("employee_id");
  const branchId = c.req.query("branch_id");
  const date = c.req.query("date");
  const conditions = ["tenant_id = ?"];
  const params: unknown[] = [tenantId];
  if (branchId) {
    if (branchOutOfScope(session, branchId)) {
      return c.json(apiError("FORBIDDEN", "Chi nhánh ngoài phạm vi được phân quyền."), 403);
    }
    conditions.push("branch_id = ?");
    params.push(branchId);
  } else if (session.branchIds.length > 0) {
    conditions.push(`branch_id IN (${session.branchIds.map(() => "?").join(",")})`);
    params.push(...session.branchIds);
  } else {
    conditions.push("1 = 0");
  }
  if (employeeId) {
    conditions.push("employee_id = ?");
    params.push(employeeId);
  }
  if (date) {
    conditions.push("date = ?");
    params.push(date);
  }
  const where = `WHERE ${conditions.join(" AND ")}`;
  const countRow = await c.env.DB.prepare(`SELECT COUNT(*) AS total FROM staff_shifts ${where}`)
    .bind(...params)
    .first<{ total: number }>();
  const total = countRow?.total ?? 0;
  const rows = await c.env.DB
    .prepare(
      `SELECT id, tenant_id AS tenantId, branch_id AS branchId, employee_id AS employeeId,
              date, start_time AS startTime, end_time AS endTime, status,
              created_at AS createdAt, updated_at AS updatedAt
       FROM staff_shifts ${where}
       ORDER BY date DESC, start_time ASC LIMIT ? OFFSET ?`,
    )
    .bind(...params, limit, offset)
    .all();
  return c.json({ data: rows.results ?? [], meta: pageMeta(page, limit, total) });
});

employeeRoutes.post("/shifts", requirePermission("employee.manage"), async (c) => {
  const session = c.get("session");
  const tenantId = session.tenantId;
  if (!tenantId) {
    return c.json(apiError("FORBIDDEN", "Platform Admin không truy cập dữ liệu nghiệp vụ tenant."), 403);
  }
  const body = await c.req.json().catch(() => null);
  const parsed = shiftSchema.safeParse(body);
  if (!parsed.success) {
    return c.json(apiError("VALIDATION_ERROR", `Dữ liệu không hợp lệ: ${zodMessage(parsed.error)}`), 400);
  }
  const d = parsed.data;
  if (branchOutOfScope(session, d.branchId)) {
    return c.json(apiError("FORBIDDEN", "Chi nhánh ngoài phạm vi được phân quyền."), 403);
  }
  const employee = await loadEmployee(c.env.DB, tenantId, d.employeeId);
  if (!employee) {
    return c.json(apiError("NOT_FOUND", "Không tìm thấy nhân viên."), 404);
  }
  if (d.startTime >= d.endTime) {
    return c.json(apiError("UNPROCESSABLE", "Giờ kết thúc phải sau giờ bắt đầu."), 422);
  }
  // Trùng ca: cùng nhân viên + cùng ngày, khoảng [start,end) giao nhau.
  const overlap = await c.env.DB
    .prepare(
      `SELECT id FROM staff_shifts
       WHERE employee_id = ? AND date = ? AND status != 'cancelled'
         AND start_time < ? AND end_time > ? LIMIT 1`,
    )
    .bind(d.employeeId, d.date, d.endTime, d.startTime)
    .first<{ id: string }>();
  if (overlap) {
    return c.json(apiError("CONFLICT", "Nhân viên đã có ca làm trùng giờ trong ngày này."), 409);
  }
  const now = nowIso();
  const shiftId = newId();
  await c.env.DB.batch([
    c.env.DB.prepare(
      `INSERT INTO staff_shifts
         (id, tenant_id, branch_id, employee_id, date, start_time, end_time,
          status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'scheduled', ?, ?)`,
    ).bind(shiftId, tenantId, d.branchId, d.employeeId, d.date, d.startTime, d.endTime, now, now),
    auditInsertStatement(c.env.DB, {
      tenantId,
      userId: session.userId,
      action: "employee.shift.create",
      entityType: "staff_shift",
      entityId: shiftId,
      branchId: d.branchId,
      metadata: { employeeId: d.employeeId, date: d.date, startTime: d.startTime, endTime: d.endTime },
    }),
  ]);
  return c.json(
    {
      data: {
        id: shiftId, tenantId, branchId: d.branchId, employeeId: d.employeeId,
        date: d.date, startTime: d.startTime, endTime: d.endTime,
        status: "scheduled", createdAt: now, updatedAt: now,
      },
    },
    201,
  );
});
