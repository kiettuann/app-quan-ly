// Crypto chuẩn cho Workers — KHÔNG tự thiết kế thuật toán.
// Mật khẩu: PBKDF2-SHA256 (100.000 vòng, salt ngẫu nhiên 16 byte), lưu dạng "salt$hash" (hex).
// Token (session/reset): random 32 byte hex, chỉ lưu SHA-256 hash trong DB.
export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, [
    "deriveBits",
  ]);
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt: salt as BufferSource, iterations: 100000, hash: "SHA-256" },
    key,
    256,
  );
  const saltHex = [...salt].map((b) => b.toString(16).padStart(2, "0")).join("");
  const hashHex = [...new Uint8Array(bits)].map((b) => b.toString(16).padStart(2, "0")).join("");
  return `${saltHex}$${hashHex}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [saltHex, hashHex] = stored.split("$");
  if (!saltHex || !hashHex) return false;
  const salt = new Uint8Array(saltHex.match(/../g)?.map((h) => Number.parseInt(h, 16)) ?? []);
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, [
    "deriveBits",
  ]);
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt: salt as BufferSource, iterations: 100000, hash: "SHA-256" },
    key,
    256,
  );
  const computed = [...new Uint8Array(bits)].map((b) => b.toString(16).padStart(2, "0")).join("");
  return computed === hashHex;
}

/** Token ngẫu nhiên (hex). Chỉ trả về cho client 1 lần, DB chỉ lưu hash. */
export function randomToken(bytes = 32): string {
  return [...crypto.getRandomValues(new Uint8Array(bytes))]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
