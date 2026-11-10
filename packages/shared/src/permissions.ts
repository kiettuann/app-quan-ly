// RBAC — danh mục permission key. Nguồn: PERMISSIONS.md.
// Quyền kiểm tra ở backend trên mọi request; frontend chỉ ẩn nút cho gọn.
export const PERMISSION_KEYS = [
  "tenant.manage",
  "branch.manage",
  "branch.view",
  "user.invite",
  "role.manage",
  "booking.view",
  "booking.create",
  "booking.update",
  "booking.status",
  "invoice.create",
  "invoice.refund",
  "revenue.view",
  "customer.view",
  "customer.manage",
  "service.manage",
  "employee.manage",
  "attendance.manage",
  "payroll.view",
  "payroll.manage",
  "commission.manage",
  "commission.simulate",
  "inventory.manage",
  "expense.manage",
  "report.view",
  "admin.tenants",
  "admin.plans",
  "admin.audit",
] as const;
export type PermissionKey = (typeof PERMISSION_KEYS)[number];

export type RoleName =
  | "platform_admin"
  | "tenant_owner"
  | "branch_manager"
  | "receptionist"
  | "technician"
  | "customer";

/** Role hệ thống mặc định. Owner có thể tạo role tùy chỉnh ở Phase 4 — chưa làm ở Foundation. */
export const SYSTEM_ROLES: readonly RoleName[] = [
  "platform_admin",
  "tenant_owner",
  "branch_manager",
  "receptionist",
  "technician",
  "customer",
];

export function hasPermission(granted: readonly PermissionKey[], required: PermissionKey): boolean {
  return granted.includes(required);
}

export function hasAnyPermission(granted: readonly PermissionKey[], required: readonly PermissionKey[]): boolean {
  return required.some((p) => granted.includes(p));
}
