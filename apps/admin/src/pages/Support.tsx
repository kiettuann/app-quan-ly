import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation } from "@tanstack/react-query";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { EmptyBox, ErrorBox, LoadingBox, PageHeader, inputCls, labelCls, primaryBtnCls } from "../components/ui.js";
import { TENANT_STATUS_LABEL, formatDate } from "../lib/format.js";
import { requestSupportAccess, type TenantSummary } from "../lib/api.js";

const supportSchema = z.object({
  tenantId: z.string().min(1, "Vui lòng nhập Tenant ID."),
  reason: z.string().min(10, "Lý do phải có ít nhất 10 ký tự — ghi rõ vì sao cần hỗ trợ tenant này."),
});
type SupportForm = z.infer<typeof supportSchema>;

// Hỗ trợ đặc quyền: tạo audit log phía server, chỉ trả về tóm tắt tenant.
// KHÔNG bao giờ hiển thị dữ liệu nghiệp vụ của tenant ở đây (PERMISSIONS.md §4).
export default function SupportPage() {
  const [summary, setSummary] = useState<TenantSummary | null>(null);
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<SupportForm>({ resolver: zodResolver(supportSchema) });

  const accessMutation = useMutation({
    mutationFn: (data: SupportForm) => requestSupportAccess(data.tenantId.trim(), data.reason.trim()),
    onSuccess: (data) => setSummary(data),
    onError: () => setSummary(null),
  });

  return (
    <main>
      <PageHeader
        title="Hỗ trợ"
        subtitle="Yêu cầu truy cập hỗ trợ một tenant. Mỗi yêu cầu đều ghi audit log kèm lý do — và chỉ hiện tóm tắt tenant, không hiện dữ liệu nghiệp vụ của tiệm."
      />
      <div className="rounded-lg border border-[#B7791F]/40 bg-yellow-50 p-4 text-sm text-[#203247]">
        <strong>Lưu ý:</strong> Trang này không hiển thị khách hàng, lịch hẹn, hóa đơn hay
        bất kỳ dữ liệu nghiệp vụ nào của tenant. Mọi thao tác hỗ trợ đều phải có lý do rõ ràng.
      </div>
      <form onSubmit={handleSubmit((data) => accessMutation.mutate(data))} className="mt-4 space-y-4 rounded-lg border border-[#E5E9ED] bg-white p-4">
        <div>
          <label htmlFor="support-tenant" className={labelCls}>
            Tenant ID
          </label>
          <input id="support-tenant" {...register("tenantId")} placeholder="vd: ten-uuid..." className={inputCls} />
          {errors.tenantId && <p className="mt-1 text-xs text-[#C0392B]">{errors.tenantId.message}</p>}
        </div>
        <div>
          <label htmlFor="support-reason" className={labelCls}>
            Lý do hỗ trợ
          </label>
          <textarea
            id="support-reason"
            {...register("reason")}
            rows={3}
            placeholder="vd: Khách báo không đăng nhập được sau khi đổi mật khẩu, cần kiểm tra tài khoản owner."
            className="mt-1 w-full rounded-lg border border-[#E5E9ED] bg-white px-3 py-2 text-sm"
          />
          {errors.reason && <p className="mt-1 text-xs text-[#C0392B]">{errors.reason.message}</p>}
        </div>
        <button type="submit" disabled={accessMutation.isPending} className={primaryBtnCls}>
          {accessMutation.isPending ? "Đang xử lý..." : "Yêu cầu truy cập hỗ trợ"}
        </button>
        {accessMutation.isError && (
          <ErrorBox message={accessMutation.error instanceof Error ? accessMutation.error.message : "Yêu cầu thất bại. Vui lòng thử lại."} />
        )}
      </form>

      {accessMutation.isPending && (
        <div className="mt-4">
          <LoadingBox text="Đang ghi audit log và lấy tóm tắt tenant..." />
        </div>
      )}
      {summary && (
        <section className="mt-4 rounded-lg border border-[#E5E9ED] bg-white p-4">
          <h2 className="text-base font-bold text-[#244B70]">Tóm tắt tenant</h2>
          <p className="mt-1 text-xs text-[#748294]">
            Đây là toàn bộ thông tin được phép hiện ở đây. Dữ liệu nghiệp vụ của tiệm không bao giờ hiện trên trang hỗ trợ.
          </p>
          <div className="mt-3 space-y-2 text-sm">
            <p><span className="text-[#748294]">Tên tiệm: </span><strong>{summary.name}</strong></p>
            <p><span className="text-[#748294]">Slug: </span>{summary.slug}</p>
            <p><span className="text-[#748294]">Trạng thái: </span>{TENANT_STATUS_LABEL[summary.status] ?? summary.status}</p>
            <p><span className="text-[#748294]">Gói: </span>{summary.planName ?? "—"}</p>
            <p><span className="text-[#748294]">Email: </span>{summary.email ?? "—"}</p>
            <p><span className="text-[#748294]">SĐT: </span>{summary.phone ?? "—"}</p>
            <p><span className="text-[#748294]">Ngày tạo: </span>{formatDate(summary.createdAt)}</p>
          </div>
        </section>
      )}
      {!summary && !accessMutation.isPending && !accessMutation.isError && (
        <div className="mt-4">
          <EmptyBox message="Chưa có yêu cầu hỗ trợ nào trong phiên này." />
        </div>
      )}
    </main>
  );
}
