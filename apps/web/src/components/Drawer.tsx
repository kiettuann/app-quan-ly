import { NavLink } from "react-router-dom";
import { useAuth } from "../lib/auth.js";

// Drawer mở từ "Thêm" — DESIGN_SYSTEM.md §7, đúng thứ tự 11 mục, gom nhóm
// theo nghiệp vụ để dễ quét; tên và thứ tự mục không đổi.
const GROUPS: Array<{ heading: string; items: Array<{ to: string; label: string }> }> = [
  {
    heading: "Nghiệp vụ",
    items: [
      { to: "/dich-vu", label: "Dịch vụ" },
      { to: "/khach-hang", label: "Khách hàng" },
      { to: "/kho-hang", label: "Kho hàng" },
    ],
  },
  {
    heading: "Nhân sự & lương",
    items: [
      { to: "/cham-cong", label: "Chấm công" },
      { to: "/hoa-hong", label: "Hoa hồng" },
      { to: "/bang-luong", label: "Bảng lương" },
    ],
  },
  {
    heading: "Tài chính & báo cáo",
    items: [
      { to: "/chi-phi", label: "Chi phí" },
      { to: "/bao-cao", label: "Báo cáo" },
    ],
  },
  {
    heading: "Quản lý",
    items: [
      { to: "/chi-nhanh", label: "Chi nhánh" },
      { to: "/cai-dat", label: "Cài đặt" },
      { to: "/goi-dich-vu", label: "Gói dịch vụ" },
    ],
  },
];

export default function Drawer({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { user, logout } = useAuth();
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50" role="dialog" aria-label="Chức năng mở rộng">
      <button type="button" aria-label="Đóng" onClick={onClose} className="absolute inset-0 bg-black/30" />
      <div className="absolute right-0 top-0 flex h-full w-72 flex-col overflow-y-auto bg-white pb-[env(safe-area-inset-bottom)]">
        <div className="border-b border-border px-4 pb-3 pt-4">
          <div className="flex items-center justify-between gap-2">
            <p className="text-base font-bold text-navy">quanly.store</p>
            <button
              type="button"
              onClick={onClose}
              aria-label="Đóng menu"
              className="flex min-h-[44px] min-w-[44px] items-center justify-center rounded-lg text-sm font-semibold text-blue hover:bg-tint-50"
            >
              Đóng
            </button>
          </div>
          {user ? (
            <p className="mt-1 text-xs text-muted">
              {user.fullName ?? user.email}
              {user.role ? ` · ${user.role}` : ""}
            </p>
          ) : null}
        </div>
        <nav aria-label="Chức năng mở rộng" className="flex-1 px-2 py-2">
          {GROUPS.map(({ heading, items }) => (
            <div key={heading} className="mb-1">
              <p className="px-2 pb-1 pt-3 text-xs font-semibold uppercase tracking-wide text-muted">{heading}</p>
              <ul>
                {items.map(({ to, label }) => (
                  <li key={to}>
                    <NavLink
                      to={to}
                      onClick={onClose}
                      className={({ isActive }) =>
                        `flex min-h-[44px] items-center rounded-lg px-2 text-sm ${
                          isActive ? "bg-tint-100 font-semibold text-navy" : "text-ink hover:bg-tint-50"
                        }`
                      }
                    >
                      {label}
                    </NavLink>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </nav>
        <div className="border-t border-border p-4">
          <button
            type="button"
            onClick={() => {
              onClose();
              logout();
            }}
            className="inline-flex min-h-[44px] w-full items-center justify-center rounded-lg border border-border bg-white px-4 text-sm font-semibold text-error hover:bg-soft-error"
          >
            Đăng xuất
          </button>
        </div>
      </div>
    </div>
  );
}
