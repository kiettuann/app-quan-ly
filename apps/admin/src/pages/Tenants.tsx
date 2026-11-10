import { useMutation, useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Badge, EmptyBox, ErrorBox, LoadingBox, PageHeader, Pagination, dangerBtnCls, primaryBtnCls } from "../components/ui.js";
import { formatDate, TENANT_STATUS_LABEL } from "../lib/format.js";
import { getTenant, getTenants, setTenantStatus, type Tenant } from "../lib/api.js";

function statusTone(status: string): "green" | "yellow" | "red" | "gray" {
  if (status === "active") return "green";
  if (status === "trial") return "yellow";
  if (status === "suspended") return "red";
  return "gray";
}

export default function TenantsPage() {
  const [page, setPage] = useState(1);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const tenantsQuery = useQuery({
    queryKey: ["admin-tenants", page],
    queryFn: () => getTenants(page, 20),
  });
  const detailQuery = useQuery({
    queryKey: ["admin-tenant", selectedId],
    queryFn: () => getTenant(selectedId!),
    enabled: selectedId !== null,
  });
  const statusMutation = useMutation({
    mutationFn: ({ id, status }: { id: string; status: "active" | "suspended" }) => setTenantStatus(id, status),
    onSuccess: async () => {
      setActionError(null);
      await tenantsQuery.refetch();
      await detailQuery.refetch();
    },
    onError: (err) => setActionError(err instanceof Error ? err.message : "Đổi trạng thái thất bại."),
  });

  const tenants = tenantsQuery.data?.items ?? [];
  const totalPages = tenantsQuery.data?.meta?.total_pages ?? 1;
  const total = tenantsQuery.data?.meta?.total ?? tenants.length;
  const detail: Tenant | undefined = detailQuery.data;

  return (
    <main>
      <PageHeader title="Tenants" subtitle="Danh sách tiệm đang dùng nền tảng. Bấm vào một tiệm để xem chi tiết và tạm khóa / mở lại." />
      {tenantsQuery.isPending && <LoadingBox text="Đang tải danh sách tenants..." />}
      {tenantsQuery.isError && <ErrorBox message="Không tải được danh sách tenants." onRetry={() => tenantsQuery.refetch()} />}
      {tenantsQuery.data && tenants.length === 0 && <EmptyBox message="Chưa có tenant nào đăng ký." />}
      {tenants.length > 0 && (
        <div className="overflow-x-auto rounded-lg border border-[#E5E9ED] bg-white">
          <table className="w-full min-w-[640px] text-left text-sm">
            <thead>
              <tr className="border-b border-[#E5E9ED] text-[#748294]">
                <th className="px-4 py-3 font-semibold">Tên tiệm</th>
                <th className="px-4 py-3 font-semibold">Slug</th>
                <th className="px-4 py-3 font-semibold">Liên hệ</th>
                <th className="px-4 py-3 font-semibold">Gói</th>
                <th className="px-4 py-3 font-semibold">Trạng thái</th>
                <th className="px-4 py-3 font-semibold">Ngày tạo</th>
              </tr>
            </thead>
            <tbody>
              {tenants.map((t) => (
                <tr
                  key={t.id}
                  onClick={() => setSelectedId(t.id)}
                  className={`cursor-pointer border-b border-[#E5E9ED] last:border-0 hover:bg-[#F7F7F5] ${selectedId === t.id ? "bg-[#F7F7F5]" : ""}`}
                >
                  <td className="px-4 py-3 font-medium">{t.name}</td>
                  <td className="px-4 py-3 text-[#748294]">{t.slug}</td>
                  <td className="px-4 py-3">
                    {t.email ?? "—"}
                    {t.phone && <span className="block text-xs text-[#748294]">{t.phone}</span>}
                  </td>
                  <td className="px-4 py-3">{t.planName ?? "—"}</td>
                  <td className="px-4 py-3">
                    <Badge tone={statusTone(t.status)}>{TENANT_STATUS_LABEL[t.status] ?? t.status}</Badge>
                  </td>
                  <td className="px-4 py-3 text-[#748294]">{formatDate(t.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {tenantsQuery.data && <Pagination page={page} totalPages={totalPages} total={total} onPage={setPage} />}

      {selectedId !== null && (
        <section className="mt-6 rounded-lg border border-[#E5E9ED] bg-white p-4" aria-live="polite">
          <h2 className="text-base font-bold text-[#244B70]">Chi tiết tenant</h2>
          {detailQuery.isPending && <div className="mt-3"><LoadingBox text="Đang tải chi tiết..." /></div>}
          {detailQuery.isError && <div className="mt-3"><ErrorBox message="Không tải được chi tiết tenant." onRetry={() => detailQuery.refetch()} /></div>}
          {detail && (
            <div className="mt-3 space-y-2 text-sm">
              <p><span className="text-[#748294]">Tên: </span><strong>{detail.name}</strong></p>
              <p><span className="text-[#748294]">Slug: </span>{detail.slug}</p>
              <p><span className="text-[#748294]">Email: </span>{detail.email ?? "—"}</p>
              <p><span className="text-[#748294]">SĐT: </span>{detail.phone ?? "—"}</p>
              <p><span className="text-[#748294]">Gói: </span>{detail.planName ?? "—"}</p>
              <p><span className="text-[#748294]">Trạng thái: </span><Badge tone={statusTone(detail.status)}>{TENANT_STATUS_LABEL[detail.status] ?? detail.status}</Badge></p>
              <p><span className="text-[#748294]">Ngày tạo: </span>{formatDate(detail.createdAt)}</p>
              <div className="flex flex-wrap gap-2 pt-2">
                {detail.status === "suspended" ? (
                  <button
                    type="button"
                    disabled={statusMutation.isPending}
                    onClick={() => statusMutation.mutate({ id: detail.id, status: "active" })}
                    className={primaryBtnCls}
                  >
                    {statusMutation.isPending ? "Đang xử lý..." : "Mở lại tenant"}
                  </button>
                ) : (
                  <button
                    type="button"
                    disabled={statusMutation.isPending}
                    onClick={() => {
                      if (window.confirm(`Tạm khóa tenant "${detail.name}"? Tiệm sẽ không đăng nhập và đặt lịch được cho đến khi mở lại.`)) {
                        statusMutation.mutate({ id: detail.id, status: "suspended" });
                      }
                    }}
                    className={dangerBtnCls}
                  >
                    {statusMutation.isPending ? "Đang xử lý..." : "Tạm khóa tenant"}
                  </button>
                )}
              </div>
              {actionError && (
                <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-[#C0392B]">
                  {actionError}
                </p>
              )}
            </div>
          )}
        </section>
      )}
    </main>
  );
}
