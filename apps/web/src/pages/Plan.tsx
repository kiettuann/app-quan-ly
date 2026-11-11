// Gói dịch vụ — gói + đăng ký hiện tại (GET /tenants/me). Không có endpoint
// public liệt kê gói, nên chỉ hiện tính năng từ dữ liệu tenant. Nút nâng cấp
// hiện "Sắp ra mắt", không làm gì khác.
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { formatVnd, get } from "../lib/api.js";
import { arr, n, s } from "../lib/types.js";
import type { Row } from "../lib/types.js";
import { Card, Empty, ErrorBox, Loading, Notice, errMsg } from "../lib/ui.js";

export default function PlanPage() {
  const [notice, setNotice] = useState<string | null>(null);
  const tenantQ = useQuery({
    queryKey: ["tenant", "me"],
    queryFn: () => get<Row>("/api/v1/tenants/me"),
  });

  const tenant = tenantQ.data ?? null;
  const plan = tenant && tenant.plan && typeof tenant.plan === "object" ? (tenant.plan as Row) : null;
  const features = plan ? arr(plan, "features") : [];
  const maxBranches = plan ? n(plan, "maxBranches", "max_branches") : n(tenant, "maxBranches", "max_branches");
  const maxUsers = plan ? n(plan, "maxUsers", "max_users") : n(tenant, "maxUsers", "max_users");
  const maxBookings = plan ? n(plan, "maxBookingsPerMonth", "max_bookings_per_month") : n(tenant, "maxBookingsPerMonth", "max_bookings_per_month");

  return (
    <main className="space-y-4 p-4">
      <h1 className="text-xl font-bold">Gói dịch vụ</h1>
      {notice ? <Notice kind="info" text={notice} onClose={() => setNotice(null)} /> : null}
      {tenantQ.isLoading ? (
        <Loading />
      ) : tenantQ.isError || !tenant ? (
        <ErrorBox message={tenantQ.error ? errMsg(tenantQ.error) : "Không tải được thông tin gói."} onRetry={() => void tenantQ.refetch()} />
      ) : plan ? (
        <Card title={`Gói hiện tại: ${s(plan, "name")}`}>
          <dl className="space-y-2 text-sm">
            <div className="flex justify-between gap-2"><dt className="shrink-0 text-[#748294]">Giá</dt><dd className="text-right font-semibold tabular-nums">{formatVnd(n(plan, "priceVnd", "price_vnd"))} / tháng</dd></div>
            {maxBranches > 0 ? <div className="flex justify-between gap-2"><dt className="shrink-0 text-[#748294]">Số chi nhánh tối đa</dt><dd className="text-right tabular-nums">{maxBranches}</dd></div> : null}
            {maxUsers > 0 ? <div className="flex justify-between gap-2"><dt className="shrink-0 text-[#748294]">Số người dùng tối đa</dt><dd className="text-right tabular-nums">{maxUsers}</dd></div> : null}
            {maxBookings > 0 ? <div className="flex justify-between gap-2"><dt className="shrink-0 text-[#748294]">Lịch hẹn / tháng tối đa</dt><dd className="text-right tabular-nums">{maxBookings}</dd></div> : null}
            <div className="flex justify-between gap-2"><dt className="shrink-0 text-[#748294]">Trạng thái đăng ký</dt><dd className="min-w-0 break-words text-right">{s(tenant, "subscriptionStatus", "subscription_status") || s(plan, "status") || "Đang hoạt động"}</dd></div>
          </dl>
          {features.length > 0 ? (
            <>
              <p className="mt-4 text-sm font-medium">Tính năng của gói</p>
              <ul className="mt-2 list-disc space-y-1 pl-5 text-sm">
                {features.map((f, i) => (
                  <li key={i}>{typeof f === "string" ? f : s(f, "name", "label")}</li>
                ))}
              </ul>
            </>
          ) : null}
        </Card>
      ) : (
        <Card title="Gói hiện tại">
          <Empty text="Chưa có thông tin gói dịch vụ." />
          <dl className="mt-3 space-y-2 text-sm">
            <div className="flex justify-between gap-2"><dt className="shrink-0 text-[#748294]">Tên gói</dt><dd className="min-w-0 break-words text-right">{s(tenant, "planName", "plan_name") || "—"}</dd></div>
            <div className="flex justify-between gap-2"><dt className="shrink-0 text-[#748294]">Trạng thái đăng ký</dt><dd className="min-w-0 break-words text-right">{s(tenant, "subscriptionStatus", "subscription_status") || "—"}</dd></div>
          </dl>
        </Card>
      )}
      <button
        type="button"
        onClick={() => setNotice("Nâng cấp gói dịch vụ sắp ra mắt.")}
        className="inline-flex min-h-[44px] w-full items-center justify-center rounded-lg bg-[#244B70] px-4 text-sm font-semibold text-white"
      >
        Nâng cấp gói
      </button>
      <p className="text-xs text-[#748294]">Danh sách các gói khác sẽ hiện khi có gói nâng cấp. Hiện tại chỉ hiển thị gói của tiệm bạn.</p>
    </main>
  );
}
