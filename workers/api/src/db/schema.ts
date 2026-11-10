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
