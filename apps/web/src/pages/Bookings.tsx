export default function BookingsPage() {
  return (
    <main className="p-4">
      <h1 className="text-xl font-bold">Lịch hẹn</h1>
      <p className="mt-4 rounded-lg border border-[#E5E9ED] bg-white p-4 text-sm">
        Chưa có lịch hẹn hôm nay. Module đặt lịch (Calendar/List, kiểm tra trùng ở backend)
        sẽ có ở Phase 4.
      </p>
      <button type="button" disabled className="mt-4 h-11 rounded-lg bg-[#244B70] px-4 text-sm font-semibold text-white opacity-50">
        Tạo lịch hẹn
      </button>
    </main>
  );
}
