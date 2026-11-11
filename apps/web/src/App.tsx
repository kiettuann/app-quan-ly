import { useState } from "react";
import type { ReactNode } from "react";
import { Navigate, Route, Routes, useLocation } from "react-router-dom";
import TopNav from "./components/TopNav.js";
import Drawer from "./components/Drawer.js";
import { AuthProvider, useAuth } from "./lib/auth.js";
import { DEMO_NO_AUTH } from "./lib/demo.js";
import { btnPrimary } from "./lib/ui.js";
import AttendancePage from "./pages/Attendance.js";
import BookingsPage from "./pages/Bookings.js";
import BranchesPage from "./pages/Branches.js";
import CommissionPage from "./pages/Commission.js";
import CustomersPage from "./pages/Customers.js";
import ExpensesPage from "./pages/Expenses.js";
import ForgotPasswordPage from "./pages/ForgotPassword.js";
import InventoryPage from "./pages/Inventory.js";
import LoginPage from "./pages/Login.js";
import OverviewPage from "./pages/Overview.js";
import PayrollPage from "./pages/Payroll.js";
import PlanPage from "./pages/Plan.js";
import RegisterPage from "./pages/Register.js";
import ReportsPage from "./pages/Reports.js";
import ResetPasswordPage from "./pages/ResetPassword.js";
import SalesPage from "./pages/Sales.js";
import ServicesPage from "./pages/Services.js";
import SettingsPage from "./pages/Settings.js";
import StaffPage from "./pages/Staff.js";

const PUBLIC_PATHS = ["/dang-nhap", "/quen-mat-khau", "/dang-ky", "/dat-lai-mat-khau"];

/** Guard: mọi route trừ các trang auth đều yêu cầu đăng nhập.
 * Chế độ demo (DEMO_NO_AUTH): AuthProvider tự đăng nhập tài khoản demo khi
 * mở app nên không bao giờ hiện màn hình đăng nhập — trong lúc chờ phiên thì
 * hiện "Đang mở tiệm demo…", thất bại thì hiện nút thử lại. */
export function RequireAuth({ children }: { children: ReactNode }) {
  const { token, demoFailed, retryDemoLogin } = useAuth();
  const location = useLocation();
  if (DEMO_NO_AUTH) {
    if (token) return <>{children}</>;
    if (demoFailed) {
      return (
        <main className="flex min-h-screen flex-col items-center justify-center gap-3 p-4 text-center">
          <p className="text-base font-semibold">Không mở được tiệm demo.</p>
          <p className="text-sm text-muted">Kiểm tra mạng / API rồi thử lại.</p>
          <button type="button" onClick={() => retryDemoLogin()} className={btnPrimary}>
            Thử lại
          </button>
        </main>
      );
    }
    return (
      <main className="flex min-h-screen items-center justify-center p-4">
        <p className="text-sm text-muted">Đang mở tiệm demo…</p>
      </main>
    );
  }
  if (!token) return <Navigate to="/dang-nhap" state={{ from: location.pathname }} replace />;
  return <>{children}</>;
}

function Protected({ children }: { children: ReactNode }) {
  return <RequireAuth>{children}</RequireAuth>;
}

/** Trang auth (đăng nhập / đăng ký / quên mật khẩu): chế độ demo thì ẩn hẳn,
 * vào thẳng trang chính. Chế độ thường: giữ nguyên như cũ. */
function AuthPageGate({ children }: { children: ReactNode }) {
  if (DEMO_NO_AUTH) return <Navigate to="/" replace />;
  return <>{children}</>;
}

function Shell() {
  const [drawerOpen, setDrawerOpen] = useState(false);
  const location = useLocation();
  const isPublic = PUBLIC_PATHS.includes(location.pathname);
  // Trang Bán hàng (POS) cần gần hết chiều ngang màn hình để bấm bill trong
  // 1 màn hình không cuộn — chỉ route này bỏ max-w-3xl, các trang khác giữ nguyên.
  const isSales = location.pathname === "/ban-hang";
  return (
    // Container mobile-first, max-w-3xl: các trang đã tự có p-4 nên container
    // không thêm padding ngang (tránh padding kép). Nav chính nằm TRÊN ĐẦU
    // trang (TopNav, sticky) — không còn BottomNav nên không cần padding dưới.
    <div className={`mx-auto min-h-screen bg-[#F7F7F5] ${isSales ? "max-w-none" : "max-w-3xl"}`}>
      {!isPublic ? <TopNav onOpenDrawer={() => setDrawerOpen(true)} /> : null}
      <Routes>
        <Route path="/dang-nhap" element={<AuthPageGate><LoginPage /></AuthPageGate>} />
        <Route path="/quen-mat-khau" element={<AuthPageGate><ForgotPasswordPage /></AuthPageGate>} />
        <Route path="/dang-ky" element={<AuthPageGate><RegisterPage /></AuthPageGate>} />
        <Route path="/dat-lai-mat-khau" element={<AuthPageGate><ResetPasswordPage /></AuthPageGate>} />
        <Route path="/" element={<Protected><OverviewPage /></Protected>} />
        <Route path="/lich-hen" element={<Protected><BookingsPage /></Protected>} />
        <Route path="/ban-hang" element={<Protected><SalesPage /></Protected>} />
        <Route path="/nhan-su" element={<Protected><StaffPage /></Protected>} />
        <Route path="/dich-vu" element={<Protected><ServicesPage /></Protected>} />
        <Route path="/khach-hang" element={<Protected><CustomersPage /></Protected>} />
        <Route path="/kho-hang" element={<Protected><InventoryPage /></Protected>} />
        <Route path="/cham-cong" element={<Protected><AttendancePage /></Protected>} />
        <Route path="/hoa-hong" element={<Protected><CommissionPage /></Protected>} />
        <Route path="/bang-luong" element={<Protected><PayrollPage /></Protected>} />
        <Route path="/chi-phi" element={<Protected><ExpensesPage /></Protected>} />
        <Route path="/bao-cao" element={<Protected><ReportsPage /></Protected>} />
        <Route path="/chi-nhanh" element={<Protected><BranchesPage /></Protected>} />
        <Route path="/cai-dat" element={<Protected><SettingsPage /></Protected>} />
        <Route path="/goi-dich-vu" element={<Protected><PlanPage /></Protected>} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
      {!isPublic ? <Drawer open={drawerOpen} onClose={() => setDrawerOpen(false)} /> : null}
    </div>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <Shell />
    </AuthProvider>
  );
}
