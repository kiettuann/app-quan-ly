import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import { useAuth } from "../lib/auth.js";
import { errMsg } from "../lib/ui.js";

const loginSchema = z.object({
  email: z.string().email("Email chưa đúng định dạng."),
  password: z.string().min(1, "Vui lòng nhập mật khẩu."),
});
type LoginForm = z.infer<typeof loginSchema>;

// Đăng nhập thật qua API: lưu token qua useAuth rồi về Tổng quan.
export default function LoginPage() {
  const { login } = useAuth();
  const navigate = useNavigate();
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
      await login(data.email, data.password);
      navigate("/", { replace: true });
    } catch (err) {
      setError(errMsg(err));
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="mx-auto w-full max-w-md p-4">
      <h1 className="text-xl font-bold text-[#244B70]">quanly.store</h1>
      <p className="mt-1 text-sm text-[#748294]">Đăng nhập để quản lý tiệm nail của bạn.</p>
      <div className="mt-6 rounded-lg border border-[#E5E9ED] bg-white p-4">
      <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
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
    </div>
      <div className="mt-4 flex items-center justify-between text-sm">
        <Link to="/quen-mat-khau" className="inline-flex min-h-[44px] items-center font-semibold text-[#3979A8]">
          Quên mật khẩu?
        </Link>
        <Link to="/dang-ky" className="inline-flex min-h-[44px] items-center font-semibold text-[#3979A8]">
          Đăng ký tiệm mới
        </Link>
      </div>
    </main>
  );
}
