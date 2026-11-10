import { describe, expect, it } from "vitest";
import { applyMovement, checkStockAvailable, movementQuantity } from "./inventory.js";

describe("inventory math — không bán âm, mọi biến động có movement", () => {
  it("đủ tồn thì bán được, thiếu tồn thì không", () => {
    expect(checkStockAvailable(10, 5)).toBe(true);
    expect(checkStockAvailable(3, 5)).toBe(false);
    expect(checkStockAvailable(0, 1)).toBe(false);
  });
  it("số lượng <= 0 thì throw", () => {
    expect(() => checkStockAvailable(10, 0)).toThrow();
    expect(() => checkStockAvailable(10, -1)).toThrow();
  });
  it("sale/out ghi số âm, in ghi số dương, adjust giữ dấu", () => {
    expect(movementQuantity("sale", 5)).toBe(-5);
    expect(movementQuantity("out", 5)).toBe(-5);
    expect(movementQuantity("in", 5)).toBe(5);
    expect(movementQuantity("adjust", -2)).toBe(-2);
    expect(movementQuantity("adjust", 3)).toBe(3);
  });
  it("áp movement: nhập tăng tồn, bán giảm tồn, bán vượt tồn thì throw", () => {
    expect(applyMovement(10, "in", 5)).toBe(15);
    expect(applyMovement(10, "sale", 4)).toBe(6);
    expect(() => applyMovement(3, "sale", 5)).toThrow();
    expect(applyMovement(3, "adjust", -3)).toBe(0);
  });
});
