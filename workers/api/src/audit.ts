// Audit log — ghi cho mọi thao tác quan trọng (ARCHITECTURE.md §3.6).
// Không bao giờ log OTP, token, mật khẩu.
import { newId, nowIso } from "./db.js";

export interface AuditInput {
  tenantId: string | null;
  userId: string | null;
  action: string;
  entityType: string;
  entityId?: string | null;
  branchId?: string | null;
  metadata?: Record<string, unknown>;
  ip?: string | null;
}

export function auditInsertStatement(db: D1Database, input: AuditInput): D1PreparedStatement {
  return db
    .prepare(
      `INSERT INTO audit_logs (id, tenant_id, user_id, action, entity_type, entity_id, branch_id, metadata_json, ip, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      newId(),
      input.tenantId,
      input.userId,
      input.action,
      input.entityType,
      input.entityId ?? null,
      input.branchId ?? null,
      JSON.stringify(input.metadata ?? {}),
      input.ip ?? null,
      nowIso(),
    );
}

export async function insertAudit(db: D1Database, input: AuditInput): Promise<void> {
  await auditInsertStatement(db, input).run();
}
