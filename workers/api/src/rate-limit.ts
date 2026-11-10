// Rate limit đơn giản, in-memory theo isolate của Worker.
// Hạn chế đã biết: mỗi isolate Cloudflare có bộ đếm riêng, nên giới hạn là
// "best effort" chống lạm dụng thô, không phải giới hạn cứng toàn cục.
// Dùng cho: login, forgot-password, gửi OTP. Không dùng cho nghiệp vụ thường.
const buckets = new Map<string, { count: number; resetAt: number }>();

export function checkRateLimit(key: string, max: number, windowMs: number, now = Date.now()): boolean {
  const bucket = buckets.get(key);
  if (!bucket || now >= bucket.resetAt) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return true;
  }
  if (bucket.count >= max) return false;
  bucket.count += 1;
  return true;
}

export function resetRateLimitsForTest(): void {
  buckets.clear();
}
