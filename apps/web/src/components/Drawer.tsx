// Drawer mở từ "Thêm" — DESIGN_SYSTEM.md §7. Các mục chưa có module ở
// Phase 3 chỉ hiện trạng thái "Sắp có", KHÔNG phải nút giả dẫn đi đâu.
const ITEMS = [
  "Dịch vụ",
  "Khách hàng",
  "Kho hàng",
  "Chấm công",
  "Hoa hồng",
  "Bảng lương",
  "Chi phí",
  "Báo cáo",
  "Chi nhánh",
  "Cài đặt",
  "Gói dịch vụ",
];

export default function Drawer({ open, onClose }: { open: boolean; onClose: () => void }) {
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
        <ul>
          {ITEMS.map((label) => (
            <li key={label} className="flex min-h-[44px] items-center justify-between border-b border-[#E5E9ED] text-sm">
              <span>{label}</span>
              <span className="text-xs text-[#748294]">Sắp có</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
