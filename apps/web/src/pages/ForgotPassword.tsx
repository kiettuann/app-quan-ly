import { useState } from "react";
import { Link } from "react-router-dom";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import { post } from "../lib/api.js";
import { errMsg } from "../lib/ui.js";

const schema = z.object({
  email: z.string().email("Email chưa đúng định dạng."),
});
type Form = z.infer<typeof schema>;

// Quên mật khẩu: POST /api/v1/auth/forgot-password. Thông báo thành công luôn
// giống nhau, không tiết lộ email có tồn tại hay không.
export default function ForgotPasswordPage() {
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<Form>({ resolver: zodResolver(schema) });

  async function onSubmit(data: Form) {
    setError(null);
    setLoading(true);
    try {
      await post("/api/v1/auth/forgot-password", { email: data.email });
      setSent(true);
    } catch (err) {
      setError(errMsg(err));
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="mx-auto w-full max-w-md p-4">
      <h1 className="text-xl font-bold text-[#244B70]">Quên mật khẩu</h1>
      <p className="mt-1 text-sm text-[#748294]">Nhập email đăng ký để nhận liên kết đặt lại mật khẩu.</p>
      {sent ? (
        <p role="status" className="mt-6 rounded-lg border border-[#E5E9ED] bg-green-50 p-4 text-sm text-[#2E7D5B]">
          Nếu email này đã đăng ký, bạn sẽ nhận được liên kết đặt lại mật khẩu trong vài phút.
          Vui lòng kiểm tra cả hộp thư rác.
        </p>
      ) : (
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
          {error && (
            <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-[#C0392B]">{error}</p>
          )}
          <button type="submit" disabled={loading} className="h-11 w-full rounded-lg bg-[#244B70] text-sm font-semibold text-white disabled:opacity-50">
            {loading ? "Đang xử lý..." : "Gửi liên kết đặt lại"}
          </button>
        </form>
      </div>
      )}
      <p className="mt-4 text-sm text-[#748294]">
        <Link to="/dang-nhap" className="inline-flex min-h-[44px] items-center font-semibold text-[#3979A8]">Quay lại đăng nhập</Link>
      </p>
    </main>
  );
}
