import { useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";

const loginSchema = z.object({
  email: z.string().email("Email chưa đúng định dạng."),
  password: z.string().min(1, "Vui lòng nhập mật khẩu."),
});
type LoginForm = z.infer<typeof loginSchema>;

const API_URL = import.meta.env.VITE_API_URL ?? "http://localhost:8787";

// Đăng nhập thật qua API. Phase 3 API chưa triển khai login -> hiện lỗi thật
// từ server, KHÔNG giả vờ đăng nhập thành công, KHÔNG dữ liệu giả.
export default function LoginPage() {
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<LoginForm>({ resolver: zodResolver(loginSchema) });

  async function onSubmit(data: LoginForm) {
    setError(null);
    setLoading(true);
    try {
      const res = await fetch(`${API_URL}/api/v1/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      const body = (await res.json()) as { error?: { message?: string } };
      setError(body.error?.message ?? "Đăng nhập thất bại. Vui lòng thử lại.");
    } catch {
      setError("Không kết nối được tới máy chủ. Kiểm tra API đang chạy ở " + API_URL + " rồi thử lại.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="p-4">
      <h1 className="text-xl font-bold text-[#244B70]">quanly.store</h1>
      <p className="mt-1 text-sm text-[#748294]">Đăng nhập để quản lý tiệm nail của bạn.</p>
      <form onSubmit={handleSubmit(onSubmit)} className="mt-6 space-y-4">
        <div>
          <label htmlFor="email" className="text-sm font-medium">Email</label>
          <input
            id="email"
            type="email"
            placeholder="vd: chu@tiem.vn"
            {...register("email")}
            className="mt-1 h-11 w-full rounded-lg border border-[#E5E9ED] bg-white px-3 text-sm"
          />
          {errors.email && <p className="mt-1 text-xs text-[#C0392B]">{errors.email.message}</p>}
        </div>
        <div>
          <label htmlFor="password" className="text-sm font-medium">Mật khẩu</label>
          <input
            id="password"
            type="password"
            {...register("password")}
            className="mt-1 h-11 w-full rounded-lg border border-[#E5E9ED] bg-white px-3 text-sm"
          />
          {errors.password && <p className="mt-1 text-xs text-[#C0392B]">{errors.password.message}</p>}
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
          {loading ? "Đang xử lý..." : "Đăng nhập"}
        </button>
      </form>
    </main>
  );
}
