// Commission engine — pure logic, dùng chung backend + test + simulator.
// Nguồn: API_SPEC.md §6, DATABASE_SCHEMA.md §6, PERMISSIONS.md.
// Quy tắc: mỗi invoice item xét các rule đang active, sắp xếp theo priority tăng
// dần (số nhỏ ưu tiên trước), rule đầu tiên khớp scope sẽ áp dụng cho item đó.
// percent = rateValue % của line total; fixed = rateValue VND cho cả dòng item.
// max_amount_vnd giới hạn tổng hoa hồng của rule đó trên một invoice.
// Rule chỉ áp dụng khi còn hiệu lực và (min_sales_vnd null hoặc subtotal >= min).
export type CommissionScopeType =
  | "service"
  | "product"
  | "employee"
  | "role"
  | "branch"
  | "sales_tier";

export interface CommissionRuleInput {
  id: string;
  ruleVersionId: string;
  scopeType: CommissionScopeType;
  /** service_id / product_id / employee_id / role name / branch_id, hoặc null = mọi. */
  scopeRefId: string | null;
  rateType: "percent" | "fixed";
  /** percent: 0-100 (số nguyên). fixed: VND nguyên. */
  rateValue: number;
  minSalesVnd: number | null;
  maxAmountVnd: number | null;
  priority: number;
  validFrom: string;
  validTo: string | null;
  status: string;
  createdAt: string;
}

export interface CommissionItemInput {
  id: string;
  itemType: "service" | "product";
  refId: string | null;
  lineTotalVnd: number;
  /** Người thực hiện (service) hoặc người bán (product). */
  employeeId: string | null;
  /** Role của employeeId (nếu biết), phục vụ scope role. */
  employeeRole: string | null;
  branchId: string;
}

export interface CommissionBreakdown {
  invoiceItemId: string;
  employeeId: string | null;
  ruleId: string;
  ruleVersionId: string;
  amountVnd: number;
}

export interface CommissionResult {
  breakdown: CommissionBreakdown[];
  totalVnd: number;
  /** Tổng theo từng nhân viên. */
  byEmployee: Record<string, number>;
}

function ruleApplies(
  rule: CommissionRuleInput,
  item: CommissionItemInput,
  invoiceSubtotalVnd: number,
  atIso: string,
): boolean {
  if (rule.status !== "active") return false;
  if (rule.validFrom > atIso) return false;
  if (rule.validTo !== null && atIso >= rule.validTo) return false;
  if (rule.minSalesVnd !== null && invoiceSubtotalVnd < rule.minSalesVnd) return false;
  switch (rule.scopeType) {
    case "service":
      return item.itemType === "service" && (rule.scopeRefId === null || rule.scopeRefId === item.refId);
    case "product":
      return item.itemType === "product" && (rule.scopeRefId === null || rule.scopeRefId === item.refId);
    case "employee":
      return rule.scopeRefId === null || rule.scopeRefId === item.employeeId;
    case "role":
      return rule.scopeRefId === null || rule.scopeRefId === item.employeeRole;
    case "branch":
      return rule.scopeRefId === null || rule.scopeRefId === item.branchId;
    case "sales_tier":
      // scopeRefId = ngưỡng doanh thu tối thiểu của invoice (VND, dạng chuỗi số).
      if (rule.scopeRefId === null) return true;
      return invoiceSubtotalVnd >= Number(rule.scopeRefId);
    default:
      return false;
  }
}

function ruleAmount(rule: CommissionRuleInput, lineTotalVnd: number): number {
  if (rule.rateType === "percent") {
    if (!Number.isInteger(rule.rateValue) || rule.rateValue < 0 || rule.rateValue > 100) {
      throw new Error("Tỷ lệ hoa hồng % phải là số nguyên 0–100");
    }
    return Math.floor((lineTotalVnd * rule.rateValue) / 100);
  }
  if (!Number.isInteger(rule.rateValue) || rule.rateValue < 0) {
    throw new Error("Hoa hồng cố định phải là số nguyên VND >= 0");
  }
  return rule.rateValue;
}

export function calculateCommissions(
  items: CommissionItemInput[],
  rules: CommissionRuleInput[],
  atIso: string,
): CommissionResult {
  const invoiceSubtotalVnd = items.reduce((s, i) => s + i.lineTotalVnd, 0);
  const sorted = [...rules].sort(
    (a, b) => a.priority - b.priority || (a.createdAt < b.createdAt ? -1 : 1),
  );
  const ruleTotals = new Map<string, number>();
  const breakdown: CommissionBreakdown[] = [];
  for (const item of items) {
    if (item.employeeId === null) continue; // Không có người thực hiện/bán -> không tính hoa hồng.
    const rule = sorted.find((r) => ruleApplies(r, item, invoiceSubtotalVnd, atIso));
    if (!rule) continue;
    let amount = ruleAmount(rule, item.lineTotalVnd);
    if (rule.maxAmountVnd !== null) {
      const used = ruleTotals.get(rule.id) ?? 0;
      amount = Math.max(0, Math.min(amount, rule.maxAmountVnd - used));
    }
    if (amount <= 0) continue;
    ruleTotals.set(rule.id, (ruleTotals.get(rule.id) ?? 0) + amount);
    breakdown.push({
      invoiceItemId: item.id,
      employeeId: item.employeeId,
      ruleId: rule.id,
      ruleVersionId: rule.ruleVersionId,
      amountVnd: amount,
    });
  }
  const byEmployee: Record<string, number> = {};
  let totalVnd = 0;
  for (const b of breakdown) {
    totalVnd += b.amountVnd;
    byEmployee[b.employeeId as string] = (byEmployee[b.employeeId as string] ?? 0) + b.amountVnd;
  }
  return { breakdown, totalVnd, byEmployee };
}
