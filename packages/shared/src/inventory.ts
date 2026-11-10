// Inventory math — pure logic. Nguồn: DATABASE_SCHEMA.md §7, API_SPEC.md §6.
// stock_quantity là tổng các stock_movements (cache), mọi thay đổi tồn kho đều
// phải ghi một movement. Không bao giờ bán âm.
export type StockMovementType = "in" | "out" | "adjust" | "sale";

export function checkStockAvailable(stockQuantity: number, quantity: number): boolean {
  if (!Number.isInteger(quantity) || quantity <= 0) {
    throw new Error("Số lượng phải là số nguyên > 0");
  }
  return stockQuantity >= quantity;
}

/** Số lượng ghi vào movement: xuất kho (sale/out) là số âm, nhập/điều chỉnh theo dấu của qty. */
export function movementQuantity(type: StockMovementType, quantity: number): number {
  if (!Number.isInteger(quantity)) throw new Error("Số lượng phải là số nguyên");
  if (type === "sale" || type === "out") return -Math.abs(quantity);
  return quantity;
}

/** Tồn kho mới sau khi áp movement; từ chối nếu âm. */
export function applyMovement(stockQuantity: number, type: StockMovementType, quantity: number): number {
  const next = stockQuantity + movementQuantity(type, quantity);
  if (next < 0) throw new Error("Tồn kho không đủ — không cho bán/xuất âm");
  return next;
}
