import { useState } from "react";

// Bán hàng — Phase 3: empty state. Nút "Thu tiền cọc" là placeholder theo quyết
// định Kalvin 10/11/2026: hiển thị "Sắp ra mắt", KHÔNG logic thanh toán.
export default function SalesPage() {
  const [notice, setNotice] = useState<string | null>(null);
  return (
    <main className="p-4">
      <h1 className="text-xl font-bold">Bán hàng</h1>
      <p className="mt-4 rounded-lg border border-[#E5E9ED] bg-white p-4 text-sm">
        Chưa có hóa đơn nào. Module POS sẽ có ở Phase 4.
      </p>
      <button
        type="button"
        onClick={() => setNotice("Tính năng đặt cọc / thanh toán online sắp ra mắt.")}
        className="mt-4 h-11 rounded-lg border border-[#E5E9ED] bg-white px-4 text-sm font-semibold text-[#244B70]"
      >
        Thu tiền cọc
      </button>
      {notice && <p role="status" className="mt-3 text-sm text-[#748294]">{notice}</p>}
    </main>
  );
}
