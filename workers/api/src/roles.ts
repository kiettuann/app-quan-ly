// Role hệ thống + ma trận quyền. Nguồn: PERMISSIONS.md §2.
// Id role hệ thống cố định — khớp seed trong migration 0002.
import type { PermissionKey, RoleName } from "@quanly/shared";

export const SYSTEM_ROLE_IDS: Record<RoleName, string> = {
  platform_admin: "role_platform_admin",
  tenant_owner: "role_tenant_owner",
  branch_manager: "role_branch_manager",
  receptionist: "role_receptionist",
  technician: "role_technician",
  customer: "role_customer",
};

/** Quyền mặc định của từng role hệ thống (gán khi tạo tenant / mời user). */
export const ROLE_PERMISSIONS: Record<RoleName, readonly PermissionKey[]> = {
  platform_admin: ["admin.tenants", "admin.plans", "admin.audit"],
  tenant_owner: [
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
  ],
  branch_manager: [
    "branch.view",
    "user.invite",
    "booking.view",
    "booking.create",
    "booking.update",
    "booking.status",
    "invoice.create",
    "invoice.refund",
    "customer.view",
    "customer.manage",
    "employee.manage",
    "attendance.manage",
    "payroll.view",
    "commission.simulate",
    "inventory.manage",
    "expense.manage",
    "report.view",
  ],
  receptionist: [
    "branch.view",
    "booking.view",
    "booking.create",
    "booking.update",
    "booking.status",
    "invoice.create",
    "customer.view",
    "customer.manage",
    "attendance.manage",
    "inventory.manage",
  ],
  technician: ["branch.view", "booking.view", "booking.status", "customer.view", "attendance.manage", "payroll.view"],
  customer: ["booking.view", "customer.view"],
};

export function rolePermissionsFor(role: string): readonly PermissionKey[] {
  return ROLE_PERMISSIONS[role as RoleName] ?? [];
}
