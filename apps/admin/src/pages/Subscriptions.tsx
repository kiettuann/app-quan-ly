import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Badge, EmptyBox, ErrorBox, LoadingBox, PageHeader, Pagination, inputCls, labelCls } from "../components/ui.js";
import { SUBSCRIPTION_STATUS_LABEL, formatDate } from "../lib/format.js";
import { getSubscriptions } from "../lib/api.js";

function statusTone(status: string): "green" | "yellow" | "red" | "gray" {
  if (status === "active" || status === "trial") return "green";
  if (status === "past_due") return "yellow";
  if (status === "cancelled") return "red";
  return "gray";
}

export default function SubscriptionsPage() {
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState("");

  const subsQuery = useQuery({
    queryKey: ["admin-subscriptions", page, status],
    queryFn: () => getSubscriptions(page, 20, status === "" ? undefined : status),
  });

  const subs = subsQuery.data?.items ?? [];
  const totalPages = subsQuery.data?.meta?.total_pages ?? 1;
  const total = subsQuery.data?.meta?.total ?? subs.length;

  return (
    <main>
      <PageHeader title="Subscriptions" subtitle="Gói đăng ký của từng tenant: gói nào, trạng thái nào, hết hạn khi nào." />
      <div className="mb-4 max-w-xs">
        <label htmlFor="sub-status" className={labelCls}>
          Lọc theo trạng thái
        </label>
        <select
          id="sub-status"
          value={status}
          onChange={(e) => {
            setStatus(e.target.value);
            setPage(1);
          }}
          className={inputCls}
        >
          <option value="">Tất cả trạng thái</option>
          <option value="trial">Dùng thử</option>
          <option value="active">Đang hoạt động</option>
          <option value="past_due">Quá hạn thanh toán</option>
          <option value="cancelled">Đã hủy</option>
        </select>
      </div>
      {subsQuery.isPending && <LoadingBox text="Đang tải subscriptions..." />}
      {subsQuery.isError && <ErrorBox message="Không tải được danh sách subscriptions." onRetry={() => subsQuery.refetch()} />}
      {subsQuery.data && subs.length === 0 && <EmptyBox message="Chưa có subscription nào." />}
      {subs.length > 0 && (
        <div className="overflow-x-auto rounded-lg border border-[#E5E9ED] bg-white">
          <table className="w-full min-w-[640px] text-left text-sm">
            <thead>
              <tr className="border-b border-[#E5E9ED] text-[#748294]">
                <th className="px-4 py-3 font-semibold">Tenant</th>
                <th className="px-4 py-3 font-semibold">Gói</th>
                <th className="px-4 py-3 font-semibold">Trạng thái</th>
                <th className="px-4 py-3 font-semibold">Bắt đầu</th>
                <th className="px-4 py-3 font-semibold">Hết hạn</th>
              </tr>
            </thead>
            <tbody>
              {subs.map((s) => (
                <tr key={s.id} className="border-b border-[#E5E9ED] last:border-0">
                  <td className="px-4 py-3 font-medium">{s.tenantName ?? s.tenantId}</td>
                  <td className="px-4 py-3">{s.planName ?? s.planId}</td>
                  <td className="px-4 py-3">
                    <Badge tone={statusTone(s.status)}>{SUBSCRIPTION_STATUS_LABEL[s.status] ?? s.status}</Badge>
                  </td>
                  <td className="px-4 py-3 text-[#748294]">{formatDate(s.startedAt)}</td>
                  <td className="px-4 py-3 text-[#748294]">{formatDate(s.endsAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {subsQuery.data && <Pagination page={page} totalPages={totalPages} total={total} onPage={setPage} />}
    </main>
  );
}
