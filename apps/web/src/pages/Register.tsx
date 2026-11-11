import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import { useAuth } from "../lib/auth.js";
import { errMsg } from "../lib/ui.js";

const registerSchema = z.object({
  tenantName: z.string().trim().min(2, "Tên tiệm phải có ít nhất 2 ký tự."),
  phone: z.string().trim().min(9, "Số điện thoại chưa đúng.").max(15),
  email: z.string().email("Email chưa đúng định dạng."),
  password: z.string().min(8, "Mật khẩu phải có ít nhất 8 ký tự."),
  branchName: z.string().trim().min(2, "Tên chi nhánh phải có ít nhất 2 ký tự."),
  branchAddress: z.string().trim().max(255).optional(),
});
type RegisterForm = z.infer<typeof registerSchema>;

// Đăng ký tenant: POST /api/v1/tenants (tạo tenant + chủ + chi nhánh đầu tiên),
// sau đó tự đăng nhập và về Tổng quan.
export default function RegisterPage() {
  const { register: registerTenant } = useAuth();
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<RegisterForm>({ resolver: zodResolver(registerSchema) });

  async function onSubmit(data: RegisterForm) {
    setError(null);
    setLoading(true);
    try {
      await registerTenant({
        tenantName: data.tenantName,
        phone: data.phone,
        email: data.email,
        password: data.password,
        branchName: data.branchName,
        branchAddress: data.branchAddress || undefined,
      });
      navigate("/", { replace: true });
    } catch (err) {
      setError(errMsg(err));
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="mx-auto w-full max-w-md p-4">
      <h1 className="text-xl font-bold text-[#244B70]">Đăng ký tiệm mới</h1>
      <p className="mt-1 text-sm text-[#748294]">Tạo tài khoản quản lý cho tiệm nail của bạn.</p>
      <div className="mt-6 rounded-lg border border-[#E5E9ED] bg-white p-4">
      <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
        <div>
          <label htmlFor="tenantName" className="text-sm font-medium">Tên tiệm</label>
          <input id="tenantName" placeholder="vd: Nail Lumi" {...register("tenantName")} className="mt-1 h-11 w-full rounded-lg border border-[#E5E9ED] bg-white px-3 text-sm" />
          {errors.tenantName && <p className="mt-1 text-xs text-[#C0392B]">{errors.tenantName.message}</p>}
        </div>
        <div>
          <label htmlFor="phone" className="text-sm font-medium">Số điện thoại</label>
          <input id="phone" type="tel" inputMode="tel" placeholder="vd: 0901234567" {...register("phone")} className="mt-1 h-11 w-full rounded-lg border border-[#E5E9ED] bg-white px-3 text-sm" />
          {errors.phone && <p className="mt-1 text-xs text-[#C0392B]">{errors.phone.message}</p>}
        </div>
        <div>
          <label htmlFor="email" className="text-sm font-medium">Email</label>
          <input id="email" type="email" placeholder="vd: chu@tiem.vn" {...register("email")} className="mt-1 h-11 w-full rounded-lg border border-[#E5E9ED] bg-white px-3 text-sm" />
          {errors.email && <p className="mt-1 text-xs text-[#C0392B]">{errors.email.message}</p>}
        </div>
        <div>
          <label htmlFor="password" className="text-sm font-medium">Mật khẩu (ít nhất 8 ký tự)</label>
          <input id="password" type="password" {...register("password")} className="mt-1 h-11 w-full rounded-lg border border-[#E5E9ED] bg-white px-3 text-sm" />
          {errors.password && <p className="mt-1 text-xs text-[#C0392B]">{errors.password.message}</p>}
        </div>
        <div>
          <label htmlFor="branchName" className="text-sm font-medium">Tên chi nhánh đầu tiên</label>
          <input id="branchName" placeholder="vd: Chi nhánh Quận 1" {...register("branchName")} className="mt-1 h-11 w-full rounded-lg border border-[#E5E9ED] bg-white px-3 text-sm" />
          {errors.branchName && <p className="mt-1 text-xs text-[#C0392B]">{errors.branchName.message}</p>}
        </div>
        <div>
          <label htmlFor="branchAddress" className="text-sm font-medium">Địa chỉ chi nhánh (không bắt buộc)</label>
          <input id="branchAddress" placeholder="vd: 123 Nguyễn Huệ, Quận 1" {...register("branchAddress")} className="mt-1 h-11 w-full rounded-lg border border-[#E5E9ED] bg-white px-3 text-sm" />
          {errors.branchAddress && <p className="mt-1 text-xs text-[#C0392B]">{errors.branchAddress.message}</p>}
        </div>
        {error && (
          <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-[#C0392B]">{error}</p>
        )}
        <button type="submit" disabled={loading} className="h-11 w-full rounded-lg bg-[#244B70] text-sm font-semibold text-white disabled:opacity-50">
          {loading ? "Đang xử lý..." : "Tạo tài khoản"}
        </button>
      </form>
    </div>
      <p className="mt-4 text-sm text-[#748294]">
        Đã có tài khoản?{" "}
        <Link to="/dang-nhap" className="inline-flex min-h-[44px] items-center font-semibold text-[#3979A8]">Đăng nhập</Link>
      </p>
    </main>
  );
}
