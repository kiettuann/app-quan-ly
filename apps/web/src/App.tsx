import { useState } from "react";
import type { ReactNode } from "react";
import { Navigate, Route, Routes, useLocation } from "react-router-dom";
import BottomNav from "./components/BottomNav.js";
import Drawer from "./components/Drawer.js";
import { AuthProvider, useAuth } from "./lib/auth.js";
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

/** Guard: mọi route trừ /dang-nhap, /quen-mat-khau, /dang-ky, /dat-lai-mat-khau đều yêu cầu đăng nhập. */
export function RequireAuth({ children }: { children: ReactNode }) {
  const { token } = useAuth();
  const location = useLocation();
  if (!token) return <Navigate to="/dang-nhap" state={{ from: location.pathname }} replace />;
  return <>{children}</>;
}

function Protected({ children }: { children: ReactNode }) {
  return <RequireAuth>{children}</RequireAuth>;
}

function Shell() {
  const [drawerOpen, setDrawerOpen] = useState(false);
  const location = useLocation();
  const isPublic = ["/dang-nhap", "/quen-mat-khau", "/dang-ky", "/dat-lai-mat-khau"].includes(
    location.pathname,
  );
  return (
    <div className="mx-auto min-h-screen max-w-3xl bg-[#F7F7F5] pb-20">
      <Routes>
        <Route path="/dang-nhap" element={<LoginPage />} />
        <Route path="/quen-mat-khau" element={<ForgotPasswordPage />} />
        <Route path="/dang-ky" element={<RegisterPage />} />
        <Route path="/dat-lai-mat-khau" element={<ResetPasswordPage />} />
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
      {!isPublic ? (
        <>
          <BottomNav onOpenDrawer={() => setDrawerOpen(true)} />
          <Drawer open={drawerOpen} onClose={() => setDrawerOpen(false)} />
        </>
      ) : null}
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
