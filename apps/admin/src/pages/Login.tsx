import { zodResolver } from "@hookform/resolvers/zod";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { useNavigate } from "react-router-dom";
import { z } from "zod";
import { inputCls, labelCls, primaryBtnCls } from "../components/ui.js";
import { useAuth } from "../lib/auth.js";

const loginSchema = z.object({
  email: z.string().email("Email chưa đúng định dạng."),
  password: z.string().min(1, "Vui lòng nhập mật khẩu."),
});
type LoginForm = z.infer<typeof loginSchema>;

// Đăng nhập bằng tài khoản platform_admin. Token lưu ở localStorage
// (key ql_admin_token). Chưa có MFA cho Platform Admin (xem README.md).
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
      setError(err instanceof Error ? err.message : "Đăng nhập thất bại. Vui lòng thử lại.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="mx-auto max-w-md p-4">
      <h1 className="text-xl font-bold text-[#244B70]">Quản trị nền tảng</h1>
      <p className="mt-1 text-sm text-[#748294]">Chỉ tài khoản quản trị nền tảng (platform_admin) mới đăng nhập được ở đây.</p>
      <form onSubmit={handleSubmit(onSubmit)} className="mt-6 space-y-4">
        <div>
          <label htmlFor="email" className={labelCls}>
            Email
          </label>
          <input id="email" type="email" placeholder="vd: admin@quanly.store" {...register("email")} className={inputCls} />
          {errors.email && <p className="mt-1 text-xs text-[#C0392B]">{errors.email.message}</p>}
        </div>
        <div>
          <label htmlFor="password" className={labelCls}>
            Mật khẩu
          </label>
          <input id="password" type="password" {...register("password")} className={inputCls} />
          {errors.password && <p className="mt-1 text-xs text-[#C0392B]">{errors.password.message}</p>}
        </div>
        {error && (
          <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-[#C0392B]">
            {error}
          </p>
        )}
        <button type="submit" disabled={loading} className={`${primaryBtnCls} w-full`}>
          {loading ? "Đang xử lý..." : "Đăng nhập"}
        </button>
      </form>
    </main>
  );
}
