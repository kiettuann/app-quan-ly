import { useState } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import BottomNav from "./components/BottomNav.js";
import Drawer from "./components/Drawer.js";
import BookingsPage from "./pages/Bookings.js";
import LoginPage from "./pages/Login.js";
import OverviewPage from "./pages/Overview.js";
import SalesPage from "./pages/Sales.js";
import StaffPage from "./pages/Staff.js";

// Phase 3 Foundation: shell + routing + nav. Chưa có đăng nhập thật
// (API /auth/login trả 501 ở Phase 3) — LoginPage gọi API và hiện lỗi thật,
// không giả vờ đăng nhập thành công.
export default function App() {
  const [drawerOpen, setDrawerOpen] = useState(false);
  return (
    <div className="mx-auto min-h-screen max-w-3xl bg-[#F7F7F5] pb-20">
      <Routes>
        <Route path="/dang-nhap" element={<LoginPage />} />
        <Route path="/" element={<OverviewPage />} />
        <Route path="/lich-hen" element={<BookingsPage />} />
        <Route path="/ban-hang" element={<SalesPage />} />
        <Route path="/nhan-su" element={<StaffPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
      <BottomNav onOpenDrawer={() => setDrawerOpen(true)} />
      <Drawer open={drawerOpen} onClose={() => setDrawerOpen(false)} />
    </div>
  );
}
