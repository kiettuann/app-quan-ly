import { CalendarDays, LayoutDashboard, Plus, ShoppingBag, Users } from "lucide-react";
import { NavLink, useLocation } from "react-router-dom";

// Điều hướng chính ĐẶT TRÊN ĐẦU trang (Kalvin 2026-11-11) — thay BottomNav cũ.
// 5 mục như cũ, nhãn đầy đủ, không dùng icon thay nhãn. Active: chữ Navy +
// nền tint nhạt dạng pill; inactive: chữ phụ, mờ. Trên điện thoại: hàng cuộn
// ngang, icon + nhãn ngắn, không chiếm chiều cao của trang (đặc biệt là POS
// 1 màn hình — xem h-[calc(...)] trong pages/Sales.tsx).
const ITEMS = [
  { to: "/", label: "Tổng quan", Icon: LayoutDashboard },
  { to: "/lich-hen", label: "Lịch hẹn", Icon: CalendarDays },
  { to: "/ban-hang", label: "Bán hàng", Icon: ShoppingBag },
  { to: "/nhan-su", label: "Nhân sự", Icon: Users },
];

export default function TopNav({ onOpenDrawer }: { onOpenDrawer: () => void }) {
  const location = useLocation();
  // Trang Bán hàng nới rộng gần hết màn hình nên thanh nav cũng rộng theo.
  const isSales = location.pathname === "/ban-hang";
  return (
    <header className="sticky top-0 z-40 border-b border-border bg-white pt-[env(safe-area-inset-top)]">
      <div className={`mx-auto flex h-14 items-center gap-1 px-2 ${isSales ? "max-w-none" : "max-w-3xl"}`}>
        <span className="flex shrink-0 items-center gap-1.5 pl-1 pr-2">
          <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-navy text-sm font-bold text-white" aria-hidden="true">
            Q
          </span>
          <span className="hidden text-sm font-bold text-navy sm:block">quanly.store</span>
        </span>
        <nav aria-label="Điều hướng chính" className="flex min-w-0 flex-1 items-center gap-0.5 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {ITEMS.map(({ to, label, Icon }) => (
            <NavLink
              key={to}
              to={to}
              end={to === "/"}
              aria-label={label}
              className={({ isActive }) =>
                `flex min-h-[40px] shrink-0 items-center gap-1.5 whitespace-nowrap rounded-lg px-2.5 text-xs ${
                  isActive ? "bg-tint-100 font-semibold text-navy" : "font-medium text-muted hover:bg-tint-50 hover:text-ink"
                }`
              }
            >
              <Icon size={18} aria-hidden="true" />
              {label}
            </NavLink>
          ))}
          <button
            type="button"
            onClick={onOpenDrawer}
            aria-label="Mở chức năng mở rộng"
            className="flex min-h-[40px] shrink-0 items-center gap-1.5 whitespace-nowrap rounded-lg px-2.5 text-xs font-medium text-muted hover:bg-tint-50 hover:text-ink"
          >
            <Plus size={18} aria-hidden="true" />
            Thêm
          </button>
        </nav>
      </div>
    </header>
  );
}
