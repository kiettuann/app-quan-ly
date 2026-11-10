import { describe, expect, it } from "vitest";
import {
  calculateCommissions,
  type CommissionItemInput,
  type CommissionRuleInput,
} from "./commission.js";

const at = "2026-11-15T10:00:00Z";

function rule(over: Partial<CommissionRuleInput>): CommissionRuleInput {
  return {
    id: "rule-1",
    ruleVersionId: "ver-1",
    scopeType: "service",
    scopeRefId: null,
    rateType: "percent",
    rateValue: 10,
    minSalesVnd: null,
    maxAmountVnd: null,
    priority: 10,
    validFrom: "2026-01-01",
    validTo: null,
    status: "active",
    createdAt: "2026-01-01T00:00:00Z",
    ...over,
  };
}

function item(over: Partial<CommissionItemInput>): CommissionItemInput {
  return {
    id: "item-1",
    itemType: "service",
    refId: "svc-1",
    lineTotalVnd: 500000,
    employeeId: "emp-1",
    employeeRole: "technician",
    branchId: "br-1",
    ...over,
  };
}

describe("commission engine — combined rules, priority, simulator", () => {
  it("percent 10% của 500.000đ = 50.000đ", () => {
    const r = calculateCommissions([item({})], [rule({})], at);
    expect(r.totalVnd).toBe(50000);
    expect(r.byEmployee["emp-1"]).toBe(50000);
    expect(r.breakdown[0]?.ruleId).toBe("rule-1");
  });

  it("rule priority thấp hơn (số nhỏ) thắng khi trùng scope", () => {
    const low = rule({ id: "rule-low", ruleVersionId: "ver-low", priority: 5, rateValue: 20 });
    const high = rule({ id: "rule-high", ruleVersionId: "ver-high", priority: 10, rateValue: 10 });
    const r = calculateCommissions([item({})], [high, low], at);
    expect(r.totalVnd).toBe(100000); // 20% thắng
    expect(r.breakdown[0]?.ruleId).toBe("rule-low");
  });

  it("rule hết hạn / chưa tới / inactive không áp dụng", () => {
    expect(calculateCommissions([item({})], [rule({ validTo: "2026-11-01" })], at).totalVnd).toBe(0);
    expect(calculateCommissions([item({})], [rule({ validFrom: "2026-12-01" })], at).totalVnd).toBe(0);
    expect(calculateCommissions([item({})], [rule({ status: "inactive" })], at).totalVnd).toBe(0);
  });

  it("min_sales_vnd chặn rule khi invoice nhỏ", () => {
    expect(
      calculateCommissions([item({ lineTotalVnd: 100000 })], [rule({ minSalesVnd: 200000 })], at)
        .totalVnd,
    ).toBe(0);
    expect(
      calculateCommissions([item({ lineTotalVnd: 300000 })], [rule({ minSalesVnd: 200000 })], at)
        .totalVnd,
    ).toBe(30000);
  });

  it("max_amount_vnd giới hạn tổng hoa hồng của rule trên một invoice", () => {
    const r = calculateCommissions(
      [item({ id: "i1" }), item({ id: "i2", lineTotalVnd: 500000 })],
      [rule({ maxAmountVnd: 60000 })],
      at,
    );
    expect(r.totalVnd).toBe(60000);
  });

  it("fixed rate: cố định mỗi dòng item; scope service chỉ khớp đúng service", () => {
    const r = calculateCommissions(
      [item({}), item({ id: "i2", refId: "svc-2" })],
      [rule({ rateType: "fixed", rateValue: 30000, scopeRefId: "svc-1" })],
      at,
    );
    expect(r.totalVnd).toBe(30000);
  });

  it("scope employee/role/branch/sales_tier khớp đúng đối tượng", () => {
    expect(
      calculateCommissions([item({})], [rule({ scopeType: "employee", scopeRefId: "emp-2" })], at)
        .totalVnd,
    ).toBe(0);
    expect(
      calculateCommissions([item({})], [rule({ scopeType: "role", scopeRefId: "technician" })], at)
        .totalVnd,
    ).toBe(50000);
    expect(
      calculateCommissions([item({})], [rule({ scopeType: "branch", scopeRefId: "br-9" })], at)
        .totalVnd,
    ).toBe(0);
    expect(
      calculateCommissions(
        [item({})],
        [rule({ scopeType: "sales_tier", scopeRefId: "400000" })],
        at,
      ).totalVnd,
    ).toBe(50000);
  });

  it("item không có nhân viên thì không tính hoa hồng; simulator không ghi dữ liệu (hàm thuần)", () => {
    const r = calculateCommissions([item({ employeeId: null })], [rule({})], at);
    expect(r.totalVnd).toBe(0);
    expect(r.breakdown).toEqual([]);
  });

  it("percent ngoài 0–100 thì throw", () => {
    expect(() => calculateCommissions([item({})], [rule({ rateValue: 101 })], at)).toThrow();
  });
});
