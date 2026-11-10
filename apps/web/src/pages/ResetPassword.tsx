// Đặt lại mật khẩu — mở từ link trong email (token 1 lần, hết hạn 1 giờ).
import { useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { post } from "../lib/api.js";

export default function ResetPasswordPage() {
  const [params] = useSearchParams();
  const token = params.get("token") ?? "";
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (password.length < 8) {
      setError("Mật khẩu phải có ít nhất 8 ký tự.");
      return;
    }
    if (password !== confirm) {
      setError("Mật khẩu nhập lại không khớp.");
      return;
    }
    setLoading(true);
    try {
      await post("/api/v1/auth/reset-password", { token, password });
      setDone(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Đặt lại mật khẩu thất bại. Link có thể đã hết hạn hoặc đã dùng rồi.");
    } finally {
      setLoading(false);
    }
  }

  if (!token) {
    return (
      <main className="p-4">
        <h1 className="text-xl font-bold text-[#244B70]">Đặt lại mật khẩu</h1>
        <p className="mt-4 rounded-lg border border-[#E5E9ED] bg-white p-4 text-sm">
          Link đặt lại mật khẩu không hợp lệ. Vui lòng yêu cầu gửi lại email đặt lại mật khẩu.
        </p>
        <Link to="/quen-mat-khau" className="mt-4 inline-block text-sm font-semibold text-[#3979A8]">
          Quên mật khẩu
        </Link>
      </main>
    );
  }

  return (
    <main className="p-4">
      <h1 className="text-xl font-bold text-[#244B70]">Đặt lại mật khẩu</h1>
      {done ? (
        <div className="mt-4 rounded-lg border border-[#E5E9ED] bg-white p-4">
          <p className="text-sm">Đặt lại mật khẩu thành công. Bạn có thể đăng nhập bằng mật khẩu mới.</p>
          <Link to="/dang-nhap" className="mt-3 inline-block text-sm font-semibold text-[#3979A8]">
            Đăng nhập
          </Link>
        </div>
      ) : (
        <form onSubmit={onSubmit} className="mt-6 space-y-4">
          <div>
            <label htmlFor="password" className="text-sm font-medium">
              Mật khẩu mới
            </label>
            <input
              id="password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="mt-1 h-11 w-full rounded-lg border border-[#E5E9ED] bg-white px-3 text-sm"
            />
          </div>
          <div>
            <label htmlFor="confirm" className="text-sm font-medium">
              Nhập lại mật khẩu mới
            </label>
            <input
              id="confirm"
              type="password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              className="mt-1 h-11 w-full rounded-lg border border-[#E5E9ED] bg-white px-3 text-sm"
            />
          </div>
          {error && (
            <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-[#C0392B]">
              {error}
            </p>
          )}
          <button
            type="submit"
            disabled={loading}
            className="h-11 w-full rounded-lg bg-[#244B70] text-sm font-semibold text-white disabled:opacity-50"
          >
            {loading ? "Đang xử lý..." : "Đặt lại mật khẩu"}
          </button>
        </form>
      )}
    </main>
  );
}
