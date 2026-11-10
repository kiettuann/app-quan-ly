// Tạo tài khoản Platform Admin — chạy local, in ra câu SQL để chạy bằng wrangler.
// Platform Admin là user có tenant_id NULL (không thuộc tenant nào); role
// platform_admin được suy ra từ đó (xem workers/api/src/auth.ts).
// Dùng: node scripts/create-platform-admin.mjs admin@quanly.store 'MatKhauManh123' 'Quản trị viên'
// Sau đó chạy câu SQL in ra bằng:
//   npx wrangler d1 execute quanly-store-db --remote --command "<SQL>"
// KHÔNG commit mật khẩu, KHÔNG chạy script này trên máy chủ production chung.
import { randomUUID } from "node:crypto";

const [email, password, fullName = "Quản trị nền tảng"] = process.argv.slice(2);
if (!email || !password || password.length < 8) {
  console.error("Dùng: node scripts/create-platform-admin.mjs <email> <mat-khau-8-ky-tu-tro-len> [ho-ten]");
  process.exit(1);
}

const salt = crypto.getRandomValues(new Uint8Array(16));
const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, [
  "deriveBits",
]);
const bits = await crypto.subtle.deriveBits(
  { name: "PBKDF2", salt, iterations: 100000, hash: "SHA-256" },
  key,
  256,
);
const toHex = (arr) => [...arr].map((b) => b.toString(16).padStart(2, "0")).join("");
const hash = `${toHex(salt)}$${toHex(new Uint8Array(bits))}`;
const id = randomUUID();
const now = new Date().toISOString();
console.log("-- Chạy bằng wrangler d1 execute (thay <SQL> bằng toàn bộ đoạn dưới):");
console.log(
  `INSERT INTO users (id, tenant_id, email, password_hash, full_name, status, created_at, updated_at) VALUES ('${id}', NULL, '${email}', '${hash}', '${fullName.replace(/'/g, "''")}', 'active', '${now}', '${now}');`,
);
console.log("-- Sau đó đăng nhập bằng email/mật khẩu trên tại apps/admin (/dang-nhap).");
