import { CalendarDays, LayoutDashboard, Plus, ShoppingBag, Users } from "lucide-react";
import { NavLink } from "react-router-dom";

// Hybrid Navigation — DESIGN_SYSTEM.md §7. 5 mục, nhãn đầy đủ, không dùng icon thay nhãn.
// Active: chữ Navy + nền tint nhạt dạng pill; inactive: chữ phụ, mờ.
const ITEMS = [
  { to: "/", label: "Tổng quan", Icon: LayoutDashboard },
  { to: "/lich-hen", label: "Lịch hẹn", Icon: CalendarDays },
  { to: "/ban-hang", label: "Bán hàng", Icon: ShoppingBag },
  { to: "/nhan-su", label: "Nhân sự", Icon: Users },
];

export default function BottomNav({ onOpenDrawer }: { onOpenDrawer: () => void }) {
  return (
    <nav
      aria-label="Điều hướng chính"
      className="fixed bottom-0 left-0 right-0 border-t border-border bg-white pb-[env(safe-area-inset-bottom)]"
    >
      <div className="mx-auto flex max-w-3xl px-1 py-1">
        {ITEMS.map(({ to, label, Icon }) => (
          <NavLink
            key={to}
            to={to}
            end={to === "/"}
            aria-label={label}
            className={({ isActive }) =>
              `flex min-h-[56px] flex-1 flex-col items-center justify-center gap-0.5 rounded-xl text-xs ${
                isActive ? "bg-tint-100 font-semibold text-navy" : "font-medium text-muted hover:bg-tint-50 hover:text-ink"
              }`
            }
          >
            <Icon size={20} aria-hidden="true" />
            {label}
          </NavLink>
        ))}
        <button
          type="button"
          onClick={onOpenDrawer}
          aria-label="Mở chức năng mở rộng"
          className="flex min-h-[56px] flex-1 flex-col items-center justify-center gap-0.5 rounded-xl text-xs font-medium text-muted hover:bg-tint-50 hover:text-ink"
        >
          <Plus size={20} aria-hidden="true" />
          Thêm
        </button>
      </div>
    </nav>
  );
}
