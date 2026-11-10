// Tổng quan — UX_FLOWS.md §2.1: biết hôm nay thế nào trong 5 giây.
// GET /api/v1/reports/overview. Không biểu đồ trang trí, không số liệu giả.
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { formatDateTime, formatVnd, get } from "../lib/api.js";
import { arr, idOf, n, s } from "../lib/types.js";
import type { Row } from "../lib/types.js";
import { Badge, badgeToneForStatus, Card, Empty, ErrorBox, Loading } from "../lib/ui.js";
import { BOOKING_STATUS_LABEL } from "../lib/types.js";

export default function OverviewPage() {
  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ["reports", "overview"],
    queryFn: () => get<Row>("/api/v1/reports/overview"),
  });

  if (isLoading) {
    return (
      <main className="p-4">
        <h1 className="text-xl font-bold">Tổng quan</h1>
        <div className="mt-4"><Loading /></div>
      </main>
    );
  }
  if (isError || !data) {
    return (
      <main className="p-4">
        <h1 className="text-xl font-bold">Tổng quan</h1>
        <div className="mt-4">
          <ErrorBox message={error instanceof Error ? error.message : "Không tải được dữ liệu tổng quan."} onRetry={() => void refetch()} />
        </div>
      </main>
    );
  }

  const revenueToday = n(data, "revenueToday", "revenue_today", "todayRevenue");
  const bookingsToday = n(data, "bookingsToday", "bookings_today", "todayBookings");
  const inService = n(data, "inService", "in_service", "servingCount", "customersInService");
  const staffWorking = n(data, "staffWorking", "staff_working", "workingStaff");
  const commissionToday = n(data, "commissionToday", "commission_today");
  const lowStock = n(data, "lowStockCount", "low_stock_count", "lowStock");
  const upcoming = arr(data, "upcomingBookings", "upcoming", "nextBookings");

  return (
    <main className="space-y-4 p-4">
      <h1 className="text-xl font-bold">Tổng quan</h1>

      <div className="grid grid-cols-2 gap-3">
        <Card title="Doanh thu hôm nay">
          <p className="text-lg font-bold text-[#244B70]">{formatVnd(revenueToday)}</p>
        </Card>
        <Card title="Lịch hẹn hôm nay">
          <p className="text-lg font-bold text-[#244B70]">{bookingsToday}</p>
          {bookingsToday === 0 ? <p className="mt-1 text-xs text-[#748294]">Chưa có lịch hẹn hôm nay.</p> : null}
        </Card>
        <Card title="Đang phục vụ">
          <p className="text-lg font-bold text-[#244B70]">{inService}</p>
        </Card>
        <Card title="Nhân viên đang làm">
          <p className="text-lg font-bold text-[#244B70]">{staffWorking}</p>
        </Card>
      </div>

      {commissionToday > 0 ? (
        <Card title="Hoa hồng tạm tính hôm nay">
          <p className="text-base font-semibold text-[#244B70]">{formatVnd(commissionToday)}</p>
        </Card>
      ) : null}

      {lowStock > 0 ? (
        <p role="status" className="rounded-lg border border-[#E5E9ED] bg-amber-50 p-3 text-sm text-[#B7791F]">
          Có {lowStock} sản phẩm sắp hết hàng.{" "}
          <Link to="/kho-hang" className="font-semibold underline">Xem kho hàng</Link>
        </p>
      ) : null}

      <Card title="Lịch hẹn sắp tới">
        {upcoming.length === 0 ? (
          <Empty
            text="Chưa có lịch hẹn sắp tới."
            action={
              <Link to="/lich-hen" className="inline-flex min-h-[44px] items-center rounded-lg bg-[#244B70] px-4 text-sm font-semibold text-white">
                Tạo lịch hẹn
              </Link>
            }
          />
        ) : (
          <ul className="space-y-3">
            {upcoming.slice(0, 5).map((bk) => (
              <li key={idOf(bk)} className="flex items-center justify-between gap-2 border-b border-[#E5E9ED] pb-3 last:border-0 last:pb-0">
                <div>
                  <p className="text-sm font-medium">{s(bk, "customerName", "customer_name") || "Khách hàng"}</p>
                  <p className="text-xs text-[#748294]">{formatDateTime(s(bk, "startAt", "start_at"))}</p>
                </div>
                <Badge tone={badgeToneForStatus(s(bk, "status"))}>
                  {BOOKING_STATUS_LABEL[s(bk, "status")] ?? s(bk, "status")}
                </Badge>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </main>
  );
}
