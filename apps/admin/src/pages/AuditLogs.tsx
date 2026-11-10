import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { EmptyBox, ErrorBox, LoadingBox, PageHeader, Pagination, inputCls, labelCls, primaryBtnCls } from "../components/ui.js";
import { formatDateTime } from "../lib/format.js";
import { getAuditLogs } from "../lib/api.js";

export default function AuditLogsPage() {
  const [page, setPage] = useState(1);
  const [tenantInput, setTenantInput] = useState("");
  const [actionInput, setActionInput] = useState("");
  const [filters, setFilters] = useState<{ tenantId: string; action: string }>({ tenantId: "", action: "" });

  const logsQuery = useQuery({
    queryKey: ["admin-audit-logs", page, filters.tenantId, filters.action],
    queryFn: () =>
      getAuditLogs({
        page,
        limit: 20,
        tenantId: filters.tenantId === "" ? undefined : filters.tenantId,
        action: filters.action === "" ? undefined : filters.action,
      }),
  });

  const logs = logsQuery.data?.items ?? [];
  const totalPages = logsQuery.data?.meta?.total_pages ?? 1;
  const total = logsQuery.data?.meta?.total ?? logs.length;

  return (
    <main>
      <PageHeader title="Audit logs" subtitle="Lịch sử thao tác trên nền tảng: ai, làm gì, trên dữ liệu nào, lúc nào. Mới nhất trước." />
      <form
        className="mb-4 grid gap-3 rounded-lg border border-[#E5E9ED] bg-white p-4 sm:grid-cols-3"
        onSubmit={(e) => {
          e.preventDefault();
          setPage(1);
          setFilters({ tenantId: tenantInput.trim(), action: actionInput.trim() });
        }}
      >
        <div>
          <label htmlFor="audit-tenant" className={labelCls}>
            Tenant ID
          </label>
          <input id="audit-tenant" value={tenantInput} onChange={(e) => setTenantInput(e.target.value)} placeholder="vd: ten-uuid..." className={inputCls} />
        </div>
        <div>
          <label htmlFor="audit-action" className={labelCls}>
            Hành động
          </label>
          <input id="audit-action" value={actionInput} onChange={(e) => setActionInput(e.target.value)} placeholder="vd: tenant.suspend" className={inputCls} />
        </div>
        <div className="flex items-end">
          <button type="submit" className={`${primaryBtnCls} w-full`}>
            Lọc
          </button>
        </div>
      </form>
      {logsQuery.isPending && <LoadingBox text="Đang tải audit logs..." />}
      {logsQuery.isError && <ErrorBox message="Không tải được audit logs." onRetry={() => logsQuery.refetch()} />}
      {logsQuery.data && logs.length === 0 && <EmptyBox message="Chưa có audit log nào khớp bộ lọc." />}
      {logs.length > 0 && (
        <div className="overflow-x-auto rounded-lg border border-[#E5E9ED] bg-white">
          <table className="w-full min-w-[640px] text-left text-sm">
            <thead>
              <tr className="border-b border-[#E5E9ED] text-[#748294]">
                <th className="px-4 py-3 font-semibold">Thời gian</th>
                <th className="px-4 py-3 font-semibold">Hành động</th>
                <th className="px-4 py-3 font-semibold">Đối tượng</th>
                <th className="px-4 py-3 font-semibold">Tenant</th>
                <th className="px-4 py-3 font-semibold">Người thực hiện</th>
              </tr>
            </thead>
            <tbody>
              {logs.map((l) => (
                <tr key={l.id} className="border-b border-[#E5E9ED] last:border-0">
                  <td className="px-4 py-3 text-[#748294]">{formatDateTime(l.createdAt)}</td>
                  <td className="px-4 py-3 font-medium">{l.action}</td>
                  <td className="px-4 py-3">
                    {l.entityType ?? "—"}
                    {l.entityId && <span className="block text-xs text-[#748294]">{l.entityId}</span>}
                  </td>
                  <td className="px-4 py-3 text-[#748294]">{l.tenantId ?? "—"}</td>
                  <td className="px-4 py-3 text-[#748294]">{l.userId ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {logsQuery.data && <Pagination page={page} totalPages={totalPages} total={total} onPage={setPage} />}
    </main>
  );
}
