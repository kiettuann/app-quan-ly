// Drizzle schema — Identity & SaaS, migration 0001. Nguồn: DATABASE_SCHEMA.md §2.
// Tiền integer VND, thời gian TEXT ISO 8601 UTC, PK id TEXT (UUID v4 tạo ở server).
import { index, integer, primaryKey, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

const timestamps = {
  createdAt: text("created_at").notNull().$defaultFn(() => new Date().toISOString()),
  updatedAt: text("updated_at").notNull().$defaultFn(() => new Date().toISOString()),
};

export const plans = sqliteTable("plans", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  priceMonthlyVnd: integer("price_monthly_vnd").notNull().default(0),
  maxBranches: integer("max_branches").notNull().default(1),
  maxUsers: integer("max_users").notNull().default(5),
  maxBookingsMonth: integer("max_bookings_month").notNull().default(200),
  featuresJson: text("features_json").notNull().default("{}"),
  status: text("status").notNull().default("active"),
  ...timestamps,
});

export const tenants = sqliteTable(
  "tenants",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    slug: text("slug").notNull(),
    phone: text("phone"),
    email: text("email"),
    status: text("status").notNull().default("trial"), // active | suspended | trial
    planId: text("plan_id").references(() => plans.id),
    ...timestamps,
  },
  (t) => [uniqueIndex("tenants_slug_unique").on(t.slug)],
);

export const branches = sqliteTable(
  "branches",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id").notNull().references(() => tenants.id),
    name: text("name").notNull(),
    address: text("address"),
    phone: text("phone"),
    status: text("status").notNull().default("active"),
    ...timestamps,
  },
  (t) => [index("branches_tenant_idx").on(t.tenantId)],
);

export const users = sqliteTable(
  "users",
  {
    id: text("id").primaryKey(),
    // tenant_id nullable cho Platform Admin (không thuộc tenant nào).
    tenantId: text("tenant_id").references(() => tenants.id),
    email: text("email").notNull(),
    passwordHash: text("password_hash").notNull(),
    fullName: text("full_name").notNull(),
    phone: text("phone"),
    status: text("status").notNull().default("invited"), // active | invited | disabled
    ...timestamps,
  },
  (t) => [uniqueIndex("users_email_unique").on(t.email)],
);

export const roles = sqliteTable(
  "roles",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id").references(() => tenants.id), // null = role hệ thống
    name: text("name").notNull(),
    description: text("description"),
    isSystem: integer("is_system", { mode: "boolean" }).notNull().default(false),
    ...timestamps,
  },
  (t) => [uniqueIndex("roles_tenant_name_unique").on(t.tenantId, t.name)],
);

export const permissions = sqliteTable(
  "permissions",
  {
    id: text("id").primaryKey(),
    key: text("key").notNull(),
    module: text("module").notNull(),
    description: text("description"),
  },
  (t) => [uniqueIndex("permissions_key_unique").on(t.key)],
);

export const userTenants = sqliteTable(
  "user_tenants",
  {
    userId: text("user_id").notNull().references(() => users.id),
    tenantId: text("tenant_id").notNull().references(() => tenants.id),
    roleId: text("role_id").notNull().references(() => roles.id),
  },
  (t) => [primaryKey({ columns: [t.userId, t.tenantId] })],
);

export const rolePermissions = sqliteTable(
  "role_permissions",
  {
    roleId: text("role_id").notNull().references(() => roles.id),
    permissionId: text("permission_id").notNull().references(() => permissions.id),
  },
  (t) => [primaryKey({ columns: [t.roleId, t.permissionId] })],
);

export const userBranchAccess = sqliteTable(
  "user_branch_access",
  {
    userId: text("user_id").notNull().references(() => users.id),
    branchId: text("branch_id").notNull().references(() => branches.id),
    tenantId: text("tenant_id").notNull().references(() => tenants.id),
  },
  (t) => [primaryKey({ columns: [t.userId, t.branchId] })],
);

export const sessions = sqliteTable(
  "sessions",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull().references(() => users.id),
    // Chỉ lưu hash của token, không lưu token thật.
    tokenHash: text("token_hash").notNull(),
    expiresAt: text("expires_at").notNull(),
    revokedAt: text("revoked_at"),
    createdAt: text("created_at").notNull().$defaultFn(() => new Date().toISOString()),
  },
  (t) => [index("sessions_user_idx").on(t.userId)],
);

export const auditLogs = sqliteTable(
  "audit_logs",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id").references(() => tenants.id),
    userId: text("user_id").references(() => users.id),
    action: text("action").notNull(),
    entityType: text("entity_type").notNull(),
    entityId: text("entity_id"),
    branchId: text("branch_id"),
    metadataJson: text("metadata_json").notNull().default("{}"),
    ip: text("ip"),
    createdAt: text("created_at").notNull().$defaultFn(() => new Date().toISOString()),
  },
  (t) => [
    index("audit_logs_tenant_created_idx").on(t.tenantId, t.createdAt),
    index("audit_logs_entity_idx").on(t.entityType, t.entityId),
  ],
);

export const subscriptions = sqliteTable(
  "subscriptions",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id").notNull().references(() => tenants.id),
    planId: text("plan_id").notNull().references(() => plans.id),
    status: text("status").notNull().default("trial"), // trial | active | past_due | cancelled
    startedAt: text("started_at").notNull(),
    endsAt: text("ends_at"),
    ...timestamps,
  },
  (t) => [index("subscriptions_tenant_idx").on(t.tenantId)],
);

// ---------- Phase 4 — Business tables (migration 0002). ----------
// Schema Drizzle chỉ để drizzle-kit generate/đối chiếu; runtime API dùng SQL
// thô qua D1 (xem CONTRACTS.md §0). Giữ tên bảng/cột khớp migration 0002.
export const customers = sqliteTable(
  "customers",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id").notNull().references(() => tenants.id),
    branchId: text("branch_id").references(() => branches.id),
    fullName: text("full_name").notNull(),
    phone: text("phone").notNull(),
    email: text("email"),
    dob: text("dob"),
    gender: text("gender"),
    notes: text("notes"),
    totalSpentVnd: integer("total_spent_vnd").notNull().default(0),
    totalVisits: integer("total_visits").notNull().default(0),
    lastVisitAt: text("last_visit_at"),
    deletedAt: text("deleted_at"),
    ...timestamps,
  },
  (t) => [index("customers_tenant_phone_idx").on(t.tenantId, t.phone)],
);

export const emailOtpChallenges = sqliteTable("email_otp_challenges", {
  id: text("id").primaryKey(),
  email: text("email").notNull(),
  otpHash: text("otp_hash").notNull(),
  purpose: text("purpose").notNull().default("login"),
  expiresAt: text("expires_at").notNull(),
  attempts: integer("attempts").notNull().default(0),
  maxAttempts: integer("max_attempts").notNull().default(5),
  resendAfter: text("resend_after").notNull(),
  createdAt: text("created_at").notNull().$defaultFn(() => new Date().toISOString()),
});

export const passwordResets = sqliteTable("password_resets", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull().references(() => users.id),
  tokenHash: text("token_hash").notNull(),
  expiresAt: text("expires_at").notNull(),
  usedAt: text("used_at"),
  createdAt: text("created_at").notNull().$defaultFn(() => new Date().toISOString()),
});

export const serviceCategories = sqliteTable("service_categories", {
  id: text("id").primaryKey(),
  tenantId: text("tenant_id").notNull().references(() => tenants.id),
  name: text("name").notNull(),
  sortOrder: integer("sort_order").notNull().default(0),
  status: text("status").notNull().default("active"),
  ...timestamps,
});

export const services = sqliteTable(
  "services",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id").notNull().references(() => tenants.id),
    categoryId: text("category_id").references(() => serviceCategories.id),
    name: text("name").notNull(),
    description: text("description"),
    priceVnd: integer("price_vnd").notNull().default(0),
    durationMinutes: integer("duration_minutes").notNull().default(30),
    status: text("status").notNull().default("active"),
    deletedAt: text("deleted_at"),
    ...timestamps,
  },
  (t) => [index("services_tenant_status_idx").on(t.tenantId, t.status)],
);

export const bookings = sqliteTable(
  "bookings",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id").notNull().references(() => tenants.id),
    branchId: text("branch_id").notNull().references(() => branches.id),
    customerId: text("customer_id").notNull().references(() => customers.id),
    technicianId: text("technician_id"),
    startAt: text("start_at").notNull(),
    endAt: text("end_at").notNull(),
    durationMinutes: integer("duration_minutes").notNull(),
    status: text("status").notNull().default("pending"),
    source: text("source").notNull().default("internal"),
    depositVnd: integer("deposit_vnd").notNull().default(0),
    depositStatus: text("deposit_status").notNull().default("none"),
    totalPriceVnd: integer("total_price_vnd").notNull().default(0),
    notes: text("notes"),
    createdBy: text("created_by"),
    ...timestamps,
  },
  (t) => [index("bookings_tenant_branch_start_idx").on(t.tenantId, t.branchId, t.startAt)],
);

export const bookingItems = sqliteTable("booking_items", {
  id: text("id").primaryKey(),
  bookingId: text("booking_id").notNull().references(() => bookings.id),
  serviceId: text("service_id").notNull().references(() => services.id),
  serviceNameSnapshot: text("service_name_snapshot").notNull(),
  priceVndSnapshot: integer("price_vnd_snapshot").notNull(),
  durationMinutesSnapshot: integer("duration_minutes_snapshot").notNull(),
  technicianId: text("technician_id"),
  createdAt: text("created_at").notNull().$defaultFn(() => new Date().toISOString()),
});

export const bookingStatusHistory = sqliteTable("booking_status_history", {
  id: text("id").primaryKey(),
  bookingId: text("booking_id").notNull().references(() => bookings.id),
  fromStatus: text("from_status").notNull(),
  toStatus: text("to_status").notNull(),
  changedBy: text("changed_by"),
  reason: text("reason"),
  createdAt: text("created_at").notNull().$defaultFn(() => new Date().toISOString()),
});

export const invoices = sqliteTable(
  "invoices",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id").notNull().references(() => tenants.id),
    branchId: text("branch_id").notNull().references(() => branches.id),
    bookingId: text("booking_id").references(() => bookings.id),
    customerId: text("customer_id").notNull().references(() => customers.id),
    invoiceNo: text("invoice_no").notNull(),
    subtotalVnd: integer("subtotal_vnd").notNull().default(0),
    discountVnd: integer("discount_vnd").notNull().default(0),
    surchargeVnd: integer("surcharge_vnd").notNull().default(0),
    totalVnd: integer("total_vnd").notNull().default(0),
    paidVnd: integer("paid_vnd").notNull().default(0),
    refundedVnd: integer("refunded_vnd").notNull().default(0),
    status: text("status").notNull().default("draft"),
    createdBy: text("created_by"),
    ...timestamps,
  },
  (t) => [index("invoices_tenant_created_idx").on(t.tenantId, t.createdAt)],
);

export const invoiceItems = sqliteTable("invoice_items", {
  id: text("id").primaryKey(),
  invoiceId: text("invoice_id").notNull().references(() => invoices.id),
  itemType: text("item_type").notNull(),
  refId: text("ref_id"),
  nameSnapshot: text("name_snapshot").notNull(),
  unitPriceVndSnapshot: integer("unit_price_vnd_snapshot").notNull(),
  quantity: integer("quantity").notNull().default(1),
  technicianId: text("technician_id"),
  sellerId: text("seller_id"),
  lineTotalVnd: integer("line_total_vnd").notNull(),
  createdAt: text("created_at").notNull().$defaultFn(() => new Date().toISOString()),
});

export const payments = sqliteTable("payments", {
  id: text("id").primaryKey(),
  invoiceId: text("invoice_id").notNull().references(() => invoices.id),
  tenantId: text("tenant_id").notNull().references(() => tenants.id),
  amountVnd: integer("amount_vnd").notNull(),
  method: text("method").notNull().default("cash"),
  receivedBy: text("received_by"),
  paidAt: text("paid_at").notNull(),
  note: text("note"),
  createdAt: text("created_at").notNull().$defaultFn(() => new Date().toISOString()),
});

export const refunds = sqliteTable("refunds", {
  id: text("id").primaryKey(),
  invoiceId: text("invoice_id").notNull().references(() => invoices.id),
  tenantId: text("tenant_id").notNull().references(() => tenants.id),
  amountVnd: integer("amount_vnd").notNull(),
  reason: text("reason"),
  refundedBy: text("refunded_by"),
  refundedAt: text("refunded_at").notNull(),
  status: text("status").notNull().default("completed"),
  createdAt: text("created_at").notNull().$defaultFn(() => new Date().toISOString()),
});

export const employees = sqliteTable(
  "employees",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id").notNull().references(() => tenants.id),
    userId: text("user_id").references(() => users.id),
    branchId: text("branch_id").notNull().references(() => branches.id),
    fullName: text("full_name").notNull(),
    phone: text("phone"),
    position: text("position"),
    hireDate: text("hire_date"),
    baseSalaryVnd: integer("base_salary_vnd").notNull().default(0),
    status: text("status").notNull().default("active"),
    deletedAt: text("deleted_at"),
    ...timestamps,
  },
  (t) => [index("employees_tenant_branch_idx").on(t.tenantId, t.branchId)],
);

export const commissionRules = sqliteTable("commission_rules", {
  id: text("id").primaryKey(),
  tenantId: text("tenant_id").notNull().references(() => tenants.id),
  name: text("name").notNull(),
  scopeType: text("scope_type").notNull(),
  scopeRefId: text("scope_ref_id"),
  rateType: text("rate_type").notNull(),
  rateValue: integer("rate_value").notNull(),
  minSalesVnd: integer("min_sales_vnd"),
  maxAmountVnd: integer("max_amount_vnd"),
  priority: integer("priority").notNull().default(10),
  validFrom: text("valid_from").notNull(),
  validTo: text("valid_to"),
  status: text("status").notNull().default("active"),
  version: integer("version").notNull().default(1),
  ...timestamps,
});

export const commissionRuleVersions = sqliteTable("commission_rule_versions", {
  id: text("id").primaryKey(),
  ruleId: text("rule_id").notNull().references(() => commissionRules.id),
  version: integer("version").notNull(),
  snapshotJson: text("snapshot_json").notNull(),
  createdAt: text("created_at").notNull().$defaultFn(() => new Date().toISOString()),
});

export const commissionCalculations = sqliteTable("commission_calculations", {
  id: text("id").primaryKey(),
  tenantId: text("tenant_id").notNull().references(() => tenants.id),
  invoiceId: text("invoice_id").notNull().references(() => invoices.id),
  employeeId: text("employee_id").notNull().references(() => employees.id),
  ruleVersionId: text("rule_version_id").notNull().references(() => commissionRuleVersions.id),
  baseAmountVnd: integer("base_amount_vnd").notNull(),
  commissionVnd: integer("commission_vnd").notNull(),
  status: text("status").notNull().default("pending"),
  period: text("period").notNull(),
  ...timestamps,
});

export const payrollPeriods = sqliteTable("payroll_periods", {
  id: text("id").primaryKey(),
  tenantId: text("tenant_id").notNull().references(() => tenants.id),
  branchId: text("branch_id").references(() => branches.id),
  periodStart: text("period_start").notNull(),
  periodEnd: text("period_end").notNull(),
  status: text("status").notNull().default("draft"),
  ...timestamps,
});

export const payrolls = sqliteTable("payrolls", {
  id: text("id").primaryKey(),
  payrollPeriodId: text("payroll_period_id").notNull().references(() => payrollPeriods.id),
  employeeId: text("employee_id").notNull().references(() => employees.id),
  tenantId: text("tenant_id").notNull().references(() => tenants.id),
  baseSalaryVnd: integer("base_salary_vnd").notNull().default(0),
  commissionVnd: integer("commission_vnd").notNull().default(0),
  bonusVnd: integer("bonus_vnd").notNull().default(0),
  allowanceVnd: integer("allowance_vnd").notNull().default(0),
  deductionVnd: integer("deduction_vnd").notNull().default(0),
  advanceVnd: integer("advance_vnd").notNull().default(0),
  netVnd: integer("net_vnd").notNull().default(0),
  status: text("status").notNull().default("draft"),
  paidAt: text("paid_at"),
  confirmedBy: text("confirmed_by"),
  ...timestamps,
});

export const attendanceRecords = sqliteTable("attendance_records", {
  id: text("id").primaryKey(),
  tenantId: text("tenant_id").notNull().references(() => tenants.id),
  branchId: text("branch_id").notNull().references(() => branches.id),
  employeeId: text("employee_id").notNull().references(() => employees.id),
  date: text("date").notNull(),
  checkInAt: text("check_in_at"),
  checkOutAt: text("check_out_at"),
  status: text("status").notNull().default("present"),
  note: text("note"),
  ...timestamps,
});

export const products = sqliteTable(
  "products",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id").notNull().references(() => tenants.id),
    categoryId: text("category_id"),
    name: text("name").notNull(),
    sku: text("sku").notNull(),
    unit: text("unit").notNull().default("cái"),
    costPriceVnd: integer("cost_price_vnd").notNull().default(0),
    sellPriceVnd: integer("sell_price_vnd").notNull().default(0),
    stockQuantity: integer("stock_quantity").notNull().default(0),
    lowStockThreshold: integer("low_stock_threshold").notNull().default(0),
    status: text("status").notNull().default("active"),
    deletedAt: text("deleted_at"),
    ...timestamps,
  },
  (t) => [index("products_tenant_name_idx").on(t.tenantId, t.name)],
);

export const stockMovements = sqliteTable("stock_movements", {
  id: text("id").primaryKey(),
  tenantId: text("tenant_id").notNull().references(() => tenants.id),
  productId: text("product_id").notNull().references(() => products.id),
  locationId: text("location_id"),
  type: text("type").notNull(),
  quantity: integer("quantity").notNull(),
  refType: text("ref_type"),
  refId: text("ref_id"),
  createdBy: text("created_by"),
  createdAt: text("created_at").notNull().$defaultFn(() => new Date().toISOString()),
});

export const purchaseOrders = sqliteTable("purchase_orders", {
  id: text("id").primaryKey(),
  tenantId: text("tenant_id").notNull().references(() => tenants.id),
  supplierId: text("supplier_id").notNull(),
  status: text("status").notNull().default("draft"),
  totalCostVnd: integer("total_cost_vnd").notNull().default(0),
  ...timestamps,
});

export const expenses = sqliteTable("expenses", {
  id: text("id").primaryKey(),
  tenantId: text("tenant_id").notNull().references(() => tenants.id),
  branchId: text("branch_id").notNull().references(() => branches.id),
  categoryId: text("category_id"),
  amountVnd: integer("amount_vnd").notNull(),
  expenseDate: text("expense_date").notNull(),
  description: text("description"),
  receiptR2Key: text("receipt_r2_key"),
  createdBy: text("created_by"),
  ...timestamps,
});
