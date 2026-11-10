// Tenant / branch isolation — logic thuần, dùng chung API + test.
// Nguồn: ARCHITECTURE.md §3, PERMISSIONS.md §3.
// NGUYÊN TẮC: tenant_id lấy từ phiên đã xác minh, KHÔNG tin tenant_id client gửi.

export interface SessionContext {
  userId: string;
  /** Tenant của phiên đã xác minh. null = Platform Admin (không thuộc tenant nào). */
  tenantId: string | null;
  role: string;
  /** Chi nhánh user được phép truy cập. Tenant Owner: mọi chi nhánh của tenant. */
  branchIds: readonly string[];
  isPlatformAdmin: boolean;
  permissions: readonly string[];
}

export type TenantAccessResult = { allowed: true } | { allowed: false; reason: string };

/** Bỏ qua tenant_id client gửi — luôn dùng tenant của session. */
export function resolveTenantId(session: SessionContext, _clientTenantId?: string | null): string | null {
  void _clientTenantId;
  return session.tenantId;
}

/** Bản ghi có thuộc tenant của session không? */
export function canAccessTenant(session: SessionContext, recordTenantId: string): TenantAccessResult {
  if (session.isPlatformAdmin) {
    // Platform Admin KHÔNG mặc nhiên đọc dữ liệu nghiệp vụ tenant.
    // Mọi thao tác hỗ trợ phải qua endpoint riêng + audit log (chưa implement ở Foundation).
    return { allowed: false, reason: "Platform Admin không được đọc dữ liệu nghiệp vụ tenant mặc định" };
  }
  if (session.tenantId === null) {
    return { allowed: false, reason: "Phiên không gắn tenant" };
  }
  if (session.tenantId !== recordTenantId) {
    return { allowed: false, reason: "Bản ghi thuộc tenant khác" };
  }
  return { allowed: true };
}

/** Chi nhánh trong request có nằm trong phạm vi user không? */
export function canAccessBranch(session: SessionContext, branchId: string): TenantAccessResult {
  if (session.isPlatformAdmin) {
    return { allowed: false, reason: "Platform Admin không truy cập chi nhánh tenant mặc định" };
  }
  if (!session.branchIds.includes(branchId)) {
    return { allowed: false, reason: "Chi nhánh ngoài phạm vi được phân quyền" };
  }
  return { allowed: true };
}

/** Kiểm tra gộp: tenant + (nếu có) branch. Dùng cho mọi truy cập theo ID (IDOR). */
export function canAccessRecord(
  session: SessionContext,
  record: { tenantId: string; branchId?: string | null },
): TenantAccessResult {
  const tenant = canAccessTenant(session, record.tenantId);
  if (!tenant.allowed) return tenant;
  if (record.branchId) {
    return canAccessBranch(session, record.branchId);
  }
  return { allowed: true };
}
