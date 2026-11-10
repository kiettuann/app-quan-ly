// Tổng quan — Phase 3: chỉ empty state trung thực, KHÔNG số liệu giả,
// KHÔNG biểu đồ trang trí (DESIGN_SYSTEM.md §1).
export default function OverviewPage() {
  return (
    <main className="p-4">
      <h1 className="text-xl font-bold">Tổng quan</h1>
      <p className="mt-4 rounded-lg border border-[#E5E9ED] bg-white p-4 text-sm">
        Chưa có dữ liệu. Doanh thu hôm nay, lịch hẹn sắp tới và nhân viên đang làm việc
        sẽ hiện ở đây sau khi Phase 4 hoàn thành module Booking và POS.
      </p>
    </main>
  );
}
