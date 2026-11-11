// Báo cáo — doanh thu / lợi nhuận / dịch vụ hàng đầu / hiệu suất nhân viên
// theo khoảng ngày (GET /reports/*). Lợi nhuận = doanh thu − chi phí.
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { formatVnd, get, todayHcm } from "../lib/api.js";
import { arr, idOf, n, s } from "../lib/types.js";
import type { Row } from "../lib/types.js";
import { Card, Empty, ErrorBox, Field, Loading, errMsg, inputCls } from "../lib/ui.js";

export default function ReportsPage() {
  const firstOfMonth = todayHcm().slice(0, 8) + "01";
  const [from, setFrom] = useState(firstOfMonth);
  const [to, setTo] = useState(todayHcm());
  const qs = `from=${from}&to=${to}`;

  const revenueQ = useQuery({
    queryKey: ["reports", "revenue", from, to],
    queryFn: () => get<Row>(`/api/v1/reports/revenue?${qs}`),
    enabled: Boolean(from && to),
  });
  const profitQ = useQuery({
    queryKey: ["reports", "profit", from, to],
    queryFn: () => get<Row>(`/api/v1/reports/profit?${qs}`),
    enabled: Boolean(from && to),
  });
  const topQ = useQuery({
    queryKey: ["reports", "top-services", from, to],
    queryFn: () => get<Row>(`/api/v1/reports/top-services?${qs}`),
    enabled: Boolean(from && to),
  });
  const staffQ = useQuery({
    queryKey: ["reports", "staff-performance", from, to],
    queryFn: () => get<Row>(`/api/v1/reports/staff-performance?${qs}`),
    enabled: Boolean(from && to),
  });

  const topItems = topQ.data ? arr(topQ.data, "items", "services", "topServices") : [];
  const staffItems = staffQ.data ? arr(staffQ.data, "items", "staff", "performance") : [];

  return (
    <main className="space-y-4 p-4">
      <h1 className="text-xl font-bold">Báo cáo</h1>
      <Card title="Khoảng thời gian">
        <div className="grid grid-cols-2 gap-3">
          <Field label="Từ ngày">
            <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className={inputCls} />
          </Field>
          <Field label="Đến ngày">
            <input type="date" value={to} onChange={(e) => setTo(e.target.value)} className={inputCls} />
          </Field>
        </div>
        <p className="mt-3 text-xs text-[#748294]">Lợi nhuận = doanh thu − chi phí.</p>
      </Card>

      <Card title="Doanh thu">
        {revenueQ.isLoading ? <Loading /> : revenueQ.isError ? (
          <ErrorBox message={errMsg(revenueQ.error)} onRetry={() => void revenueQ.refetch()} />
        ) : (
          <dl className="space-y-2 text-sm">
            <div className="flex justify-between gap-2"><dt className="shrink-0 text-[#748294]">Tổng doanh thu</dt><dd className="text-right font-semibold tabular-nums text-[#244B70]">{formatVnd(n(revenueQ.data, "revenueVnd", "revenue_vnd", "totalRevenueVnd", "totalVnd"))}</dd></div>
            <div className="flex justify-between gap-2"><dt className="shrink-0 text-[#748294]">Số hóa đơn</dt><dd className="text-right tabular-nums">{n(revenueQ.data, "invoiceCount", "invoice_count", "count")}</dd></div>
            <div className="flex justify-between gap-2"><dt className="shrink-0 text-[#748294]">Số lượt khách</dt><dd className="text-right tabular-nums">{n(revenueQ.data, "customerCount", "customer_count")}</dd></div>
          </dl>
        )}
      </Card>

      <Card title="Lợi nhuận">
        {profitQ.isLoading ? <Loading /> : profitQ.isError ? (
          <ErrorBox message={errMsg(profitQ.error)} onRetry={() => void profitQ.refetch()} />
        ) : (
          <>
            <dl className="space-y-2 text-sm">
              <div className="flex justify-between gap-2"><dt className="shrink-0 text-[#748294]">Doanh thu</dt><dd className="text-right tabular-nums">{formatVnd(n(profitQ.data, "revenueVnd", "revenue_vnd"))}</dd></div>
              <div className="flex justify-between gap-2"><dt className="shrink-0 text-[#748294]">Chi phí</dt><dd className="text-right tabular-nums">{formatVnd(n(profitQ.data, "expenseVnd", "expense_vnd", "totalExpenseVnd"))}</dd></div>
              <div className="flex justify-between gap-2 font-semibold text-[#244B70]"><dt className="shrink-0">Lợi nhuận</dt><dd className="text-right tabular-nums">{formatVnd(n(profitQ.data, "profitVnd", "profit_vnd"))}</dd></div>
            </dl>
            <p className="mt-2 text-xs text-[#748294]">Lợi nhuận = doanh thu − chi phí (theo máy chủ).</p>
          </>
        )}
      </Card>

      <Card title="Dịch vụ hàng đầu">
        {topQ.isLoading ? <Loading /> : topQ.isError ? (
          <ErrorBox message={errMsg(topQ.error)} onRetry={() => void topQ.refetch()} />
        ) : topItems.length === 0 ? (
          <Empty text="Chưa có dữ liệu dịch vụ trong khoảng ngày này." />
        ) : (
          <ul className="space-y-2">
            {topItems.map((it) => (
              <li key={idOf(it) || s(it, "serviceName", "name")} className="text-sm">
                <p className="truncate font-medium">{s(it, "serviceName", "name")}</p>
                <p className="text-xs tabular-nums text-[#748294]">{n(it, "count", "quantity", "totalCount")} lượt · {formatVnd(n(it, "revenueVnd", "revenue_vnd", "totalVnd"))}</p>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card title="Hiệu suất nhân viên">
        {staffQ.isLoading ? <Loading /> : staffQ.isError ? (
          <ErrorBox message={errMsg(staffQ.error)} onRetry={() => void staffQ.refetch()} />
        ) : staffItems.length === 0 ? (
          <Empty text="Chưa có dữ liệu nhân viên trong khoảng ngày này." />
        ) : (
          <ul className="space-y-2">
            {staffItems.map((it) => (
              <li key={idOf(it) || s(it, "employeeName", "name")} className="text-sm">
                <p className="truncate font-medium">{s(it, "employeeName", "name")}</p>
                <p className="text-xs tabular-nums text-[#748294]">{n(it, "bookingCount", "booking_count", "count")} lịch · {formatVnd(n(it, "revenueVnd", "revenue_vnd", "totalVnd"))} · HH {formatVnd(n(it, "commissionVnd", "commission_vnd"))}</p>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </main>
  );
}
