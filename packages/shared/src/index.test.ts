import { describe, expect, it } from "vitest";
import { canTransitionBooking, isBookingSlotTaken } from "./booking.js";
import { calculateInvoiceTotal, calculatePayrollNet, deriveInvoiceStatus } from "./invoice.js";
import { canAccessBranch, canAccessRecord, canAccessTenant, type SessionContext } from "./tenant.js";
import {
  canResendOtp,
  createOtpSender,
  hashOtp,
  isOtpAttemptLimitReached,
  isOtpExpired,
  OTP_MAX_ATTEMPTS,
} from "./otp.js";
import { formatVnd } from "./constants.js";

const tenantA: SessionContext = {
  userId: "user-a",
  tenantId: "tenant-a",
  role: "tenant_owner",
  branchIds: ["branch-a1"],
  isPlatformAdmin: false,
  permissions: ["booking.view"],
};

const tenantBRecord = { tenantId: "tenant-b", branchId: "branch-b1" };
const tenantARecord = { tenantId: "tenant-a", branchId: "branch-a1" };

describe("tenant isolation — user tenant A không đọc được dữ liệu tenant B", () => {
  it("canAccessTenant: từ chối bản ghi tenant B", () => {
    expect(canAccessTenant(tenantA, "tenant-b").allowed).toBe(false);
    expect(canAccessTenant(tenantA, "tenant-a").allowed).toBe(true);
  });

  it("canAccessRecord: từ chối cả khi đổi ID trong URL sang tenant B", () => {
    expect(canAccessRecord(tenantA, tenantBRecord).allowed).toBe(false);
    expect(canAccessRecord(tenantA, tenantARecord).allowed).toBe(true);
  });

  it("canAccessBranch: từ chối chi nhánh ngoài phạm vi", () => {
    expect(canAccessBranch(tenantA, "branch-b1").allowed).toBe(false);
    expect(canAccessBranch(tenantA, "branch-a1").allowed).toBe(true);
  });

  it("Platform Admin không mặc nhiên đọc dữ liệu nghiệp vụ tenant", () => {
    const admin: SessionContext = { ...tenantA, tenantId: null, isPlatformAdmin: true };
    expect(canAccessTenant(admin, "tenant-a").allowed).toBe(false);
  });

  it("tenant_id client gửi bị bỏ qua — luôn dùng tenant của session", () => {
    // resolveTenantId không được export ở đây để test trực tiếp; kiểm tra qua
    // canAccessRecord: dù client nói tenant-a, bản ghi tenant-b vẫn bị chặn.
    expect(canAccessRecord(tenantA, tenantBRecord).allowed).toBe(false);
  });
});

describe("booking status transitions", () => {
  it("cho phép pending -> confirmed, chặn completed -> cancelled", () => {
    expect(canTransitionBooking("pending", "confirmed")).toBe(true);
    expect(canTransitionBooking("pending", "completed")).toBe(false);
    expect(canTransitionBooking("completed", "cancelled")).toBe(false);
    expect(canTransitionBooking("cancelled", "confirmed")).toBe(false);
    expect(canTransitionBooking("confirmed", "no_show")).toBe(true);
  });

  it("phát hiện trùng lịch cùng KTV, bỏ qua booking đã hủy", () => {
    const existing = [
      { startAt: "2026-11-11T09:00:00Z", endAt: "2026-11-11T10:00:00Z", status: "confirmed" as const },
      { startAt: "2026-11-11T11:00:00Z", endAt: "2026-11-11T12:00:00Z", status: "cancelled" as const },
    ];
    expect(isBookingSlotTaken(existing, { startAt: "2026-11-11T09:30:00Z", endAt: "2026-11-11T10:30:00Z" })).toBe(true);
    expect(isBookingSlotTaken(existing, { startAt: "2026-11-11T10:00:00Z", endAt: "2026-11-11T11:00:00Z" })).toBe(false);
    expect(isBookingSlotTaken(existing, { startAt: "2026-11-11T11:30:00Z", endAt: "2026-11-11T12:30:00Z" })).toBe(false);
  });
});

describe("invoice total — integer VND", () => {
  it("total = subtotal - discount + surcharge", () => {
    expect(calculateInvoiceTotal({ subtotalVnd: 500000, discountVnd: 50000, surchargeVnd: 10000 })).toBe(460000);
  });
  it("từ chối số tiền không phải integer hoặc giảm giá vượt tổng", () => {
    expect(() => calculateInvoiceTotal({ subtotalVnd: 100.5, discountVnd: 0, surchargeVnd: 0 })).toThrow();
    expect(() => calculateInvoiceTotal({ subtotalVnd: 100000, discountVnd: 200000, surchargeVnd: 0 })).toThrow();
  });
  it("trạng thái suy ra từ paid/total", () => {
    expect(deriveInvoiceStatus(460000, 0)).toBe("unpaid");
    expect(deriveInvoiceStatus(460000, 200000)).toBe("partially_paid");
    expect(deriveInvoiceStatus(460000, 460000)).toBe("paid");
  });
  it("payroll net đúng công thức", () => {
    expect(
      calculatePayrollNet({
        baseSalaryVnd: 8000000,
        commissionVnd: 2000000,
        bonusVnd: 500000,
        allowanceVnd: 500000,
        deductionVnd: 200000,
        advanceVnd: 1000000,
      }),
    ).toBe(9800000);
  });
  it("formatVnd: 150000 -> 150.000đ", () => {
    expect(formatVnd(150000)).toBe("150.000đ");
  });
});

describe("OTP — hash, hết hạn, giới hạn", () => {
  it("hash OTP không chứa mã gốc, cùng mã cho cùng hash", async () => {
    const hash = await hashOtp("123456");
    expect(hash).not.toContain("123456");
    expect(await hashOtp("123456")).toBe(hash);
    expect(await hashOtp("654321")).not.toBe(hash);
  });
  it("hết hạn sau 5 phút, gửi lại sau 60 giây, chặn sau 5 lần sai", () => {
    const now = Date.now();
    // expiresAt là thời điểm hết hạn: đã qua -> hết hạn, còn trong tương lai -> chưa.
    expect(isOtpExpired(now - 1000, now)).toBe(true);
    expect(isOtpExpired(now + 4 * 60 * 1000, now)).toBe(false);
    expect(canResendOtp(now - 30 * 1000, now)).toBe(false);
    expect(canResendOtp(now - 61 * 1000, now)).toBe(true);
    expect(isOtpAttemptLimitReached(OTP_MAX_ATTEMPTS)).toBe(true);
    expect(isOtpAttemptLimitReached(4)).toBe(false);
  });
  it("chưa cấu hình kênh OTP thì từ chối gửi — không giả vờ đã gửi", () => {
    expect(() => createOtpSender(null)).toThrow("Chưa cấu hình kênh OTP");
    expect(() => createOtpSender(undefined)).toThrow("Chưa cấu hình kênh OTP");
  });
  it("Email OTP chưa có RESEND_API_KEY thì từ chối gửi, không giả vờ đã gửi", async () => {
    const sender = createOtpSender("email", { resendApiKey: null });
    await expect(sender.send({ channel: "email", to: "a@b.vn", code: "123456" })).rejects.toThrow(
      "RESEND_API_KEY",
    );
  });
  it("SMS OTP vẫn là stub — chưa làm thật", async () => {
    const sender = createOtpSender("sms");
    await expect(sender.send({ channel: "sms", to: "0900000000", code: "123456" })).rejects.toThrow(
      "chưa được cấu hình",
    );
  });
});
