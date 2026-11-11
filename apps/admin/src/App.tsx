import type { ReactNode } from "react";
import { Navigate, NavLink, Route, Routes, useNavigate } from "react-router-dom";
import AuditLogsPage from "./pages/AuditLogs.js";
import LoginPage from "./pages/Login.js";
import PlansPage from "./pages/Plans.js";
import SubscriptionsPage from "./pages/Subscriptions.js";
import SupportPage from "./pages/Support.js";
import TenantsPage from "./pages/Tenants.js";
import { useAuth } from "./lib/auth.js";

function RequireAuth({ children }: { children: ReactNode }) {
  const { token } = useAuth();
  if (!token) return <Navigate to="/dang-nhap" replace />;
  return <>{children}</>;
}

const NAV = [
  { to: "/", label: "Tenants", end: true },
  { to: "/goi-dich-vu", label: "Gói dịch vụ" },
  { to: "/subscriptions", label: "Subscriptions" },
  { to: "/audit-logs", label: "Audit logs" },
  { to: "/ho-tro", label: "Hỗ trợ" },
];

function Shell({ children }: { children: ReactNode }) {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  return (
    <div className="mx-auto min-h-screen max-w-5xl bg-[#F7F7F5] px-4 pb-16 sm:px-6">
      <header className="flex flex-wrap items-center justify-between gap-2 border-b border-[#E5E9ED] py-4">
        <div className="min-w-0">
          <h1 className="text-xl font-bold text-[#244B70]">quanly.store — Quản trị nền tảng</h1>
          {user && <p className="mt-0.5 break-words text-xs text-[#748294]">Đăng nhập: {user.email}</p>}
        </div>
        <button
          type="button"
          onClick={() => {
            logout();
            navigate("/dang-nhap", { replace: true });
          }}
          className="h-11 shrink-0 rounded-lg bg-white px-4 text-sm font-semibold text-[#244B70] ring-1 ring-[#E5E9ED] transition-colors hover:bg-[#F7F7F5] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#3979A8]"
        >
          Đăng xuất
        </button>
      </header>
      <nav className="mb-6 mt-4 flex flex-wrap gap-2" aria-label="Điều hướng quản trị">
        {NAV.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.end}
            className={({ isActive }) =>
              `flex h-11 items-center justify-center rounded-lg px-4 text-sm font-semibold transition-colors ${
                isActive ? "bg-[#244B70] text-white" : "bg-white text-[#244B70] ring-1 ring-[#E5E9ED] hover:bg-[#F7F7F5]"
              }`
            }
          >
            {item.label}
          </NavLink>
        ))}
      </nav>
      {children}
    </div>
  );
}

export default function App() {
  return (
    <Routes>
      <Route path="/dang-nhap" element={<LoginPage />} />
      <Route
        path="/"
        element={
          <RequireAuth>
            <Shell>
              <TenantsPage />
            </Shell>
          </RequireAuth>
        }
      />
      <Route
        path="/goi-dich-vu"
        element={
          <RequireAuth>
            <Shell>
              <PlansPage />
            </Shell>
          </RequireAuth>
        }
      />
      <Route
        path="/subscriptions"
        element={
          <RequireAuth>
            <Shell>
              <SubscriptionsPage />
            </Shell>
          </RequireAuth>
        }
      />
      <Route
        path="/audit-logs"
        element={
          <RequireAuth>
            <Shell>
              <AuditLogsPage />
            </Shell>
          </RequireAuth>
        }
      />
      <Route
        path="/ho-tro"
        element={
          <RequireAuth>
            <Shell>
              <SupportPage />
            </Shell>
          </RequireAuth>
        }
      />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
