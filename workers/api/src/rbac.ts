// RBAC helper — kiểm tra quyền ở backend trên mọi request.
// Nguồn: PERMISSIONS.md §1-§2. Frontend ẩn nút chỉ để gọn, không thay kiểm tra này.
import type { Context } from "hono";
import { apiError, hasPermission, type PermissionKey, type SessionContext } from "@quanly/shared";
import type { Env } from "./index.js";

type Ctx = Context<{ Bindings: Env; Variables: { session: SessionContext } }>;

/** Yêu cầu quyền. Thiếu quyền -> 403 FORBIDDEN. */
export function requirePermission(permission: PermissionKey) {
  return async (c: Ctx, next: () => Promise<void>): Promise<Response | void> => {
    const session = c.get("session");
    if (!hasPermission(session.permissions as PermissionKey[], permission)) {
      return c.json(apiError("FORBIDDEN", "Bạn không có quyền thực hiện thao tác này."), 403);
    }
    await next();
  };
}

/** Yêu cầu chi nhánh trong phạm vi user. branch_id ngoài phạm vi -> 403. */
export function requireBranchAccess(branchId: string | null | undefined) {
  return async (c: Ctx, next: () => Promise<void>): Promise<Response | void> => {
    const session = c.get("session");
    if (!branchId) {
      return c.json(apiError("VALIDATION_ERROR", "Thiếu branch_id."), 400);
    }
    if (!session.branchIds.includes(branchId)) {
      return c.json(apiError("FORBIDDEN", "Chi nhánh ngoài phạm vi được phân quyền."), 403);
    }
    await next();
  };
}
