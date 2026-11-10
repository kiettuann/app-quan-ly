// OTP abstraction. Nguồn: ARCHITECTURE.md §7, API_SPEC.md §5.
// Quyết định Kalvin 10/11/2026: dùng EMAIL OTP, miễn phí — kênh chính cho
// đăng nhập chủ tiệm / nhân viên (tham chiếu Resend free tier: 3.000 email/tháng,
// tối đa 100/ngày). SMS OTP giữ dạng stub để cắm provider sau, không làm thật.
// Khách đặt lịch online trong MVP: giữ SĐT làm định danh, chưa gửi OTP SMS.
// KHÔNG tạo key thật, KHÔNG hardcode key, KHÔNG log OTP.
// OTP: 6 số, hết hạn 5 phút, tối đa 5 lần nhập sai, gửi lại sau 60 giây,
// tối đa 5 lần gửi/giờ/người nhận. OTP chỉ lưu dạng HASH, không lưu plaintext.

export const OTP_LENGTH = 6;
export const OTP_TTL_MS = 5 * 60 * 1000; // 5 phút
export const OTP_MAX_ATTEMPTS = 5;
export const OTP_RESEND_COOLDOWN_MS = 60 * 1000; // 60 giây
export const OTP_MAX_SENDS_PER_HOUR = 5;

export type OtpChannel = "email" | "sms";

export interface OtpSendRequest {
  channel: OtpChannel;
  /** SĐT (sms) hoặc email (email) của người nhận. */
  to: string;
  /** Mã OTP 6 số — chỉ truyền trong bộ nhớ, KHÔNG log, KHÔNG lưu. */
  code: string;
}

export interface OtpSender {
  readonly channel: OtpChannel;
  send(request: OtpSendRequest): Promise<void>;
}

/**
 * Email OTP — kênh chính (Resend, free tier 3.000 email/tháng, tối đa 100/ngày).
 * Gửi qua Resend API bằng fetch. Cần RESEND_API_KEY đặt qua Cloudflare secret
 * (wrangler secret put) — KHÔNG hardcode, KHÔNG commit key.
 * Chưa có key -> throw lỗi cấu hình rõ ràng, KHÔNG giả vờ đã gửi.
 * KHÔNG log mã OTP, KHÔNG log địa chỉ email vào log production.
 */
export class EmailOtpSender implements OtpSender {
  readonly channel: OtpChannel = "email";
  constructor(
    private readonly apiKey: string | null | undefined,
    private readonly from: string = "quanly.store <no-reply@quanly.store>",
  ) {}

  async send(request: OtpSendRequest): Promise<void> {
    if (!this.apiKey) {
      throw new Error("Email OTP chưa được cấu hình (thiếu RESEND_API_KEY — đặt qua wrangler secret put)");
    }
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${this.apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: this.from,
        to: request.to,
        subject: "Mã xác minh quanly.store",
        text: `Mã xác minh của bạn là ${request.code}. Mã hết hạn sau 5 phút. Không chia sẻ mã này cho ai.`,
      }),
    });
    if (!res.ok) {
      throw new Error("Gửi email OTP thất bại. Vui lòng thử lại sau.");
    }
  }

  /**
   * Email đặt lại mật khẩu — mailer riêng, KHÔNG dùng lại template OTP
   * (token reset là chuỗi hex dài, hết hạn sau 1 giờ, không phải mã 6 số).
   * `resetUrl` là link tới trang đặt lại mật khẩu của app web kèm token.
   */
  async sendPasswordReset(to: string, resetUrl: string): Promise<void> {
    if (!this.apiKey) {
      throw new Error("Email chưa được cấu hình (thiếu RESEND_API_KEY — đặt qua wrangler secret put)");
    }
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${this.apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: this.from,
        to,
        subject: "Đặt lại mật khẩu quanly.store",
        text: `Bạn đã yêu cầu đặt lại mật khẩu quanly.store.\n\nBấm vào link sau để đặt mật khẩu mới (link hết hạn sau 1 giờ, chỉ dùng được 1 lần):\n${resetUrl}\n\nNếu bạn không yêu cầu, hãy bỏ qua email này.`,
      }),
    });
    if (!res.ok) {
      throw new Error("Gửi email đặt lại mật khẩu thất bại. Vui lòng thử lại sau.");
    }
  }
}

/** SMS OTP — STUB. Chưa cấu hình provider Việt Nam, chưa gửi thật. */
export class SmsOtpSender implements OtpSender {
  readonly channel: OtpChannel = "sms";
  async send(): Promise<void> {
    // Cố tình không gửi: chưa chốt SMS provider, chưa có API key.
    throw new Error("SMS OTP chưa được cấu hình (chưa chọn SMS provider)");
  }
}

/**
 * Chọn sender theo cấu hình. Chưa cấu hình -> throw rõ ràng,
 * hệ thống KHÔNG giả vờ đã gửi OTP (ARCHITECTURE.md §7).
 */
export function createOtpSender(
  channel: OtpChannel | null | undefined,
  opts?: { resendApiKey?: string | null; emailFrom?: string },
): OtpSender {
  if (channel === "email") return new EmailOtpSender(opts?.resendApiKey, opts?.emailFrom);
  if (channel === "sms") return new SmsOtpSender();
  throw new Error("Chưa cấu hình kênh OTP — không thể gửi OTP");
}

/** Hash OTP bằng SHA-256 (Web Crypto, chạy được trên Workers). Lưu hash, không lưu code. */
export async function hashOtp(code: string): Promise<string> {
  const data = new TextEncoder().encode(`quanly-store-otp:${code}`);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export function isOtpExpired(expiresAt: number, now = Date.now()): boolean {
  return now > expiresAt;
}

export function canResendOtp(lastSentAt: number | null, now = Date.now()): boolean {
  if (lastSentAt === null) return true;
  return now - lastSentAt >= OTP_RESEND_COOLDOWN_MS;
}

export function isOtpAttemptLimitReached(attempts: number): boolean {
  return attempts >= OTP_MAX_ATTEMPTS;
}

/** Tạo mã OTP 6 số. Chỉ dùng trong bộ nhớ / dev-mode log, không lưu plaintext. */
export function generateOtpCode(): string {
  const n = Math.floor(100000 + Math.random() * 900000);
  return String(n);
}
