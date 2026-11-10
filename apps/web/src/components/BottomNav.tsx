import { CalendarDays, LayoutDashboard, Plus, ShoppingBag, Users } from "lucide-react";
import { NavLink } from "react-router-dom";

// Hybrid Navigation — DESIGN_SYSTEM.md §7. 5 mục, nhãn đầy đủ, không dùng icon thay nhãn.
const ITEMS = [
  { to: "/", label: "Tổng quan", Icon: LayoutDashboard },
  { to: "/lich-hen", label: "Lịch hẹn", Icon: CalendarDays },
  { to: "/ban-hang", label: "Bán hàng", Icon: ShoppingBag },
  { to: "/nhan-su", label: "Nhân sự", Icon: Users },
];

export default function BottomNav({ onOpenDrawer }: { onOpenDrawer: () => void }) {
  return (
    <nav className="fixed bottom-0 left-0 right-0 border-t border-[#E5E9ED] bg-white">
      <div className="mx-auto flex max-w-3xl">
        {ITEMS.map(({ to, label, Icon }) => (
          <NavLink
            key={to}
            to={to}
            end={to === "/"}
            className={({ isActive }) =>
              `flex min-h-[56px] flex-1 flex-col items-center justify-center gap-0.5 text-xs ${
                isActive ? "font-semibold text-[#244B70]" : "text-[#748294]"
              }`
            }
          >
            <Icon size={20} />
            {label}
          </NavLink>
        ))}
        <button
          type="button"
          onClick={onOpenDrawer}
          className="flex min-h-[56px] flex-1 flex-col items-center justify-center gap-0.5 text-xs text-[#748294]"
        >
          <Plus size={20} />
          Thêm
        </button>
      </div>
    </nav>
  );
}
