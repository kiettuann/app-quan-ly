import { NavLink } from "react-router-dom";
import { useAuth } from "../lib/auth.js";

// Drawer mở từ "Thêm" — DESIGN_SYSTEM.md §7, đúng thứ tự 11 mục.
const ITEMS: Array<{ to: string; label: string }> = [
  { to: "/dich-vu", label: "Dịch vụ" },
  { to: "/khach-hang", label: "Khách hàng" },
  { to: "/kho-hang", label: "Kho hàng" },
  { to: "/cham-cong", label: "Chấm công" },
  { to: "/hoa-hong", label: "Hoa hồng" },
  { to: "/bang-luong", label: "Bảng lương" },
  { to: "/chi-phi", label: "Chi phí" },
  { to: "/bao-cao", label: "Báo cáo" },
  { to: "/chi-nhanh", label: "Chi nhánh" },
  { to: "/cai-dat", label: "Cài đặt" },
  { to: "/goi-dich-vu", label: "Gói dịch vụ" },
];

export default function Drawer({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { user, logout } = useAuth();
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50" role="dialog" aria-label="Chức năng mở rộng">
      <button type="button" aria-label="Đóng" onClick={onClose} className="absolute inset-0 bg-black/30" />
      <div className="absolute right-0 top-0 h-full w-72 overflow-y-auto bg-white p-4">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-base font-semibold text-[#203247]">Chức năng mở rộng</h2>
          <button type="button" onClick={onClose} className="min-h-[44px] min-w-[44px] text-[#3979A8]">
            Đóng
          </button>
        </div>
        {user ? (
          <p className="mb-2 text-xs text-[#748294]">
            {user.fullName ?? user.email}
            {user.role ? ` · ${user.role}` : ""}
          </p>
        ) : null}
        <ul>
          {ITEMS.map(({ to, label }) => (
            <li key={to} className="border-b border-[#E5E9ED]">
              <NavLink
                to={to}
                onClick={onClose}
                className={({ isActive }) =>
                  `flex min-h-[44px] items-center text-sm ${isActive ? "font-semibold text-[#244B70]" : "text-[#203247]"}`
                }
              >
                {label}
              </NavLink>
            </li>
          ))}
        </ul>
        <button
          type="button"
          onClick={() => {
            onClose();
            logout();
          }}
          className="mt-4 inline-flex min-h-[44px] items-center rounded-lg border border-[#E5E9ED] bg-white px-4 text-sm font-semibold text-[#C0392B]"
        >
          Đăng xuất
        </button>
      </div>
    </div>
  );
}
