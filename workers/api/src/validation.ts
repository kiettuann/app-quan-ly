// Zod schemas cho request body các module Phase 4–7.
// Dùng chung: parse bằng safeParse, lỗi -> 400 VALIDATION_ERROR kèm danh sách field.
import { isoDate, isoDateTime, phoneVn, vndInt, vndPositive } from "@quanly/shared";
import { z } from "zod";

export const loginSchema = z.object({
  email: z.string().email("Email chưa đúng định dạng."),
  password: z.string().min(1, "Mật khẩu không được để trống."),
});

export const registerTenantSchema = z.object({
  tenantName: z.string().trim().min(2, "Tên tiệm phải có ít nhất 2 ký tự.").max(100),
  phone: phoneVn,
  email: z.string().email("Email chưa đúng định dạng."),
  password: z.string().min(8, "Mật khẩu phải có ít nhất 8 ký tự."),
  branchName: z.string().trim().min(2, "Tên chi nhánh phải có ít nhất 2 ký tự.").max(100),
  branchAddress: z.string().trim().max(255).optional(),
});

export const forgotPasswordSchema = z.object({ email: z.string().email("Email chưa đúng định dạng.") });

export const resetPasswordSchema = z.object({
  token: z.string().min(10, "Token đặt lại mật khẩu không hợp lệ."),
  password: z.string().min(8, "Mật khẩu phải có ít nhất 8 ký tự."),
});

export const otpSendSchema = z.object({ email: z.string().email("Email chưa đúng định dạng.") });
export const otpVerifySchema = z.object({
  email: z.string().email("Email chưa đúng định dạng."),
  code: z.string().regex(/^\d{6}$/, "Mã OTP phải có 6 chữ số."),
});

export const branchSchema = z.object({
  name: z.string().trim().min(2).max(100),
  address: z.string().trim().max(255).optional().nullable(),
  phone: phoneVn.optional().nullable(),
  status: z.enum(["active", "inactive"]).optional(),
});

export const inviteUserSchema = z.object({
  email: z.string().email("Email chưa đúng định dạng."),
  fullName: z.string().trim().min(2).max(100),
  phone: phoneVn.optional().nullable(),
  role: z.enum(["branch_manager", "receptionist", "technician"]),
  branchIds: z.array(z.string().uuid()).min(1, "Chọn ít nhất 1 chi nhánh."),
});

export const roleSchema = z.object({
  name: z.string().trim().min(2).max(100),
  description: z.string().trim().max(255).optional(),
  permissions: z.array(z.string()).min(1, "Chọn ít nhất 1 quyền."),
});

export const serviceCategorySchema = z.object({
  name: z.string().trim().min(1).max(100),
  sortOrder: z.number().int().min(0).optional(),
});

export const serviceSchema = z.object({
  categoryId: z.string().uuid().optional().nullable(),
  name: z.string().trim().min(1).max(100),
  description: z.string().trim().max(500).optional().nullable(),
  priceVnd: vndInt,
  durationMinutes: z.number().int().min(5).max(480),
  status: z.enum(["active", "inactive"]).optional(),
});

export const serviceBranchSettingSchema = z.object({
  priceVnd: vndInt.optional().nullable(),
  isAvailable: z.boolean().optional(),
});

export const customerSchema = z.object({
  branchId: z.string().uuid().optional().nullable(),
  fullName: z.string().trim().min(1).max(100),
  phone: phoneVn,
  email: z.string().email("Email chưa đúng định dạng.").optional().nullable(),
  dob: isoDate.optional().nullable(),
  gender: z.enum(["male", "female", "other"]).optional().nullable(),
  notes: z.string().trim().max(500).optional().nullable(),
});

export const bookingCreateSchema = z.object({
  branchId: z.string().uuid(),
  customerId: z.string().uuid().optional(),
  customerNew: z
    .object({ fullName: z.string().trim().min(1).max(100), phone: phoneVn })
    .optional(),
  serviceIds: z.array(z.string().uuid()).min(1, "Chọn ít nhất 1 dịch vụ."),
  technicianId: z.string().uuid().optional().nullable(),
  startAt: isoDateTime,
  notes: z.string().trim().max(500).optional().nullable(),
  source: z.enum(["internal", "online"]).optional(),
});

export const bookingStatusSchema = z.object({
  toStatus: z.enum([
    "pending",
    "awaiting_deposit",
    "confirmed",
    "checked_in",
    "in_service",
    "completed",
    "cancelled",
    "no_show",
  ]),
  reason: z.string().trim().max(255).optional().nullable(),
});

export const invoiceCreateSchema = z.object({
  branchId: z.string().uuid(),
  bookingId: z.string().uuid().optional().nullable(),
  customerId: z.string().uuid().optional(),
  items: z
    .array(
      z.object({
        itemType: z.enum(["service", "product"]),
        refId: z.string().uuid().optional().nullable(),
        name: z.string().trim().min(1).max(200).optional(),
        unitPriceVnd: vndInt.optional(),
        quantity: z.number().int().min(1).max(100),
        technicianId: z.string().uuid().optional().nullable(),
        sellerId: z.string().uuid().optional().nullable(),
      }),
    )
    .min(1, "Hóa đơn phải có ít nhất 1 dòng."),
  discountVnd: vndInt.optional(),
  surchargeVnd: vndInt.optional(),
});

export const paymentSchema = z.object({
  amountVnd: vndPositive,
  method: z.enum(["cash", "bank_transfer"]),
  note: z.string().trim().max(255).optional().nullable(),
});

export const refundSchema = z.object({
  amountVnd: vndPositive,
  reason: z.string().trim().min(1).max(255),
});

export const commissionRuleSchema = z.object({
  name: z.string().trim().min(1).max(100),
  scopeType: z.enum(["service", "product", "employee", "role", "branch", "sales_tier"]),
  scopeRefId: z.string().trim().max(100).optional().nullable(),
  rateType: z.enum(["percent", "fixed"]),
  rateValue: z.number().int().min(0),
  minSalesVnd: vndInt.optional().nullable(),
  maxAmountVnd: vndInt.optional().nullable(),
  priority: z.number().int().min(1).max(100),
  validFrom: isoDate,
  validTo: isoDate.optional().nullable(),
  status: z.enum(["active", "inactive", "draft"]).optional(),
});

export const employeeSchema = z.object({
  branchId: z.string().uuid(),
  userId: z.string().uuid().optional().nullable(),
  fullName: z.string().trim().min(1).max(100),
  phone: phoneVn.optional().nullable(),
  position: z.string().trim().max(100).optional().nullable(),
  hireDate: isoDate.optional().nullable(),
  baseSalaryVnd: vndInt,
  skills: z.array(z.string().trim().max(50)).optional(),
});

export const attendanceSchema = z.object({
  employeeId: z.string().uuid(),
  branchId: z.string().uuid(),
  date: isoDate,
  note: z.string().trim().max(255).optional().nullable(),
});

export const payrollPeriodSchema = z.object({
  branchId: z.string().uuid().optional().nullable(),
  periodStart: isoDate,
  periodEnd: isoDate,
});

export const payrollAdjustSchema = z.object({
  bonusVnd: vndInt.optional(),
  allowanceVnd: vndInt.optional(),
  deductionVnd: vndInt.optional(),
  advanceVnd: vndInt.optional(),
});

export const productCategorySchema = z.object({ name: z.string().trim().min(1).max(100) });

export const productSchema = z.object({
  categoryId: z.string().uuid().optional().nullable(),
  name: z.string().trim().min(1).max(100),
  sku: z.string().trim().min(1).max(50),
  unit: z.string().trim().max(20).optional(),
  costPriceVnd: vndInt,
  sellPriceVnd: vndInt,
  stockQuantity: z.number().int().min(0).optional(),
  lowStockThreshold: z.number().int().min(0).optional(),
  status: z.enum(["active", "inactive"]).optional(),
});

export const stockMovementSchema = z.object({
  productId: z.string().uuid(),
  type: z.enum(["in", "out", "adjust", "sale"]),
  quantity: z.number().int(),
  locationId: z.string().uuid().optional().nullable(),
});

export const purchaseOrderSchema = z.object({
  supplierId: z.string().uuid(),
  items: z
    .array(
      z.object({
        productId: z.string().uuid(),
        quantity: z.number().int().min(1),
        unitCostVnd: vndInt,
      }),
    )
    .min(1),
});

export const supplierSchema = z.object({
  name: z.string().trim().min(1).max(100),
  phone: phoneVn.optional().nullable(),
  address: z.string().trim().max(255).optional().nullable(),
});

export const expenseCategorySchema = z.object({
  name: z.string().trim().min(1).max(100),
  type: z.enum(["rent", "salary", "supplies", "utilities", "marketing", "other"]).optional(),
});

export const expenseSchema = z.object({
  branchId: z.string().uuid(),
  categoryId: z.string().uuid().optional().nullable(),
  amountVnd: vndPositive,
  expenseDate: isoDate,
  description: z.string().trim().min(1).max(500),
});

export const publicBookingSchema = z.object({
  branchId: z.string().uuid(),
  serviceIds: z.array(z.string().uuid()).min(1),
  technicianId: z.string().uuid().optional().nullable(),
  startAt: isoDateTime,
  fullName: z.string().trim().min(1).max(100),
  phone: phoneVn,
  notes: z.string().trim().max(500).optional().nullable(),
});
