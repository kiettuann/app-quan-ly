// Tính tiền hóa đơn — integer VND, backend là nguồn duy nhất.
// Nguồn: API_SPEC.md §6. Frontend chỉ hiển thị kết quả server trả về.
export interface InvoiceInput {
  subtotalVnd: number;
  discountVnd: number;
  surchargeVnd: number;
}

export function calculateInvoiceTotal(input: InvoiceInput): number {
  for (const [key, value] of Object.entries(input)) {
    if (!Number.isInteger(value) || value < 0) {
      throw new Error(`Trường ${key} phải là số nguyên VND >= 0`);
    }
  }
  if (input.discountVnd > input.subtotalVnd + input.surchargeVnd) {
    throw new Error("Giảm giá không được lớn hơn tổng tiền");
  }
  // total = subtotal - discount + surcharge
  return input.subtotalVnd - input.discountVnd + input.surchargeVnd;
}

export type InvoiceStatus = "draft" | "unpaid" | "partially_paid" | "paid" | "refunded" | "cancelled" | "void";

export function deriveInvoiceStatus(totalVnd: number, paidVnd: number): "unpaid" | "partially_paid" | "paid" {
  if (paidVnd <= 0) return "unpaid";
  if (paidVnd < totalVnd) return "partially_paid";
  return "paid";
}

/** net lương = base + commission + bonus + allowance - deduction - advance */
export function calculatePayrollNet(input: {
  baseSalaryVnd: number;
  commissionVnd: number;
  bonusVnd: number;
  allowanceVnd: number;
  deductionVnd: number;
  advanceVnd: number;
}): number {
  const values = Object.values(input);
  if (values.some((v) => !Number.isInteger(v) || v < 0)) {
    throw new Error("Mọi khoản lương phải là số nguyên VND >= 0");
  }
  return (
    input.baseSalaryVnd + input.commissionVnd + input.bonusVnd + input.allowanceVnd -
    input.deductionVnd - input.advanceVnd
  );
}
