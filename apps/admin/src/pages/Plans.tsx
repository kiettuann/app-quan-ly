import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { Badge, EmptyBox, ErrorBox, LoadingBox, PageHeader, Pagination, inputCls, labelCls, primaryBtnCls, secondaryBtnCls } from "../components/ui.js";
import { formatVnd } from "../lib/format.js";
import { createPlan, getPlans, updatePlan, type Plan, type PlanInput } from "../lib/api.js";

const planSchema = z.object({
  name: z.string().min(1, "Vui lòng nhập tên gói."),
  priceMonthlyVnd: z.coerce.number().int("Giá phải là số nguyên VND.").min(0, "Giá không được âm."),
  maxBranches: z.coerce.number().int("Phải là số nguyên.").min(1, "Tối thiểu 1 chi nhánh."),
  maxUsers: z.coerce.number().int("Phải là số nguyên.").min(1, "Tối thiểu 1 người dùng."),
  maxBookingsMonth: z.coerce.number().int("Phải là số nguyên.").min(0, "Không được âm."),
  featuresText: z.string(),
  status: z.enum(["active", "inactive"]),
});
type PlanForm = z.infer<typeof planSchema>;

function toInput(data: PlanForm): PlanInput {
  return {
    name: data.name.trim(),
    priceMonthlyVnd: data.priceMonthlyVnd,
    maxBranches: data.maxBranches,
    maxUsers: data.maxUsers,
    maxBookingsMonth: data.maxBookingsMonth,
    features: data.featuresText.split(",").map((s) => s.trim()).filter(Boolean),
    status: data.status,
  };
}

export default function PlansPage() {
  const [page, setPage] = useState(1);
  const [editing, setEditing] = useState<Plan | "new" | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const queryClient = useQueryClient();

  const plansQuery = useQuery({
    queryKey: ["admin-plans", page],
    queryFn: () => getPlans(page, 20),
  });
  const saveMutation = useMutation({
    mutationFn: (input: { id: string | null; data: PlanInput }) =>
      input.id ? updatePlan(input.id, input.data) : createPlan(input.data),
    onSuccess: async () => {
      setFormError(null);
      setEditing(null);
      await queryClient.invalidateQueries({ queryKey: ["admin-plans"] });
    },
    onError: (err) => setFormError(err instanceof Error ? err.message : "Lưu gói thất bại."),
  });

  const plans = plansQuery.data?.items ?? [];
  const totalPages = plansQuery.data?.meta?.total_pages ?? 1;
  const total = plansQuery.data?.meta?.total ?? plans.length;

  return (
    <main>
      <PageHeader
        title="Gói dịch vụ"
        subtitle="Các gói nền tảng bán cho tiệm (giá/tháng, giới hạn chi nhánh, người dùng, booking/tháng)."
        action={
          <button type="button" onClick={() => setEditing("new")} className={primaryBtnCls}>
            Tạo gói mới
          </button>
        }
      />
      {plansQuery.isPending && <LoadingBox text="Đang tải gói dịch vụ..." />}
      {plansQuery.isError && <ErrorBox message="Không tải được danh sách gói." onRetry={() => plansQuery.refetch()} />}
      {plansQuery.data && plans.length === 0 && <EmptyBox message="Chưa có gói dịch vụ nào." action={<button type="button" onClick={() => setEditing("new")} className={primaryBtnCls}>Tạo gói mới</button>} />}
      {plans.length > 0 && (
        <div className="overflow-x-auto rounded-lg border border-[#E5E9ED] bg-white">
          <table className="w-full min-w-[640px] text-left text-sm">
            <thead>
              <tr className="border-b border-[#E5E9ED] text-[#748294]">
                <th className="px-4 py-3 font-semibold">Tên gói</th>
                <th className="px-4 py-3 font-semibold">Giá / tháng</th>
                <th className="px-4 py-3 font-semibold">Chi nhánh</th>
                <th className="px-4 py-3 font-semibold">Người dùng</th>
                <th className="px-4 py-3 font-semibold">Booking / tháng</th>
                <th className="px-4 py-3 font-semibold">Trạng thái</th>
                <th className="px-4 py-3 font-semibold">Thao tác</th>
              </tr>
            </thead>
            <tbody>
              {plans.map((p) => (
                <tr key={p.id} className="border-b border-[#E5E9ED] last:border-0">
                  <td className="px-4 py-3">
                    <span className="font-medium">{p.name}</span>
                    {p.features.length > 0 && <span className="block text-xs text-[#748294]">{p.features.join(", ")}</span>}
                  </td>
                  <td className="px-4 py-3 font-semibold text-[#244B70]">{formatVnd(p.priceMonthlyVnd)}</td>
                  <td className="px-4 py-3">{p.maxBranches}</td>
                  <td className="px-4 py-3">{p.maxUsers}</td>
                  <td className="px-4 py-3">{p.maxBookingsMonth}</td>
                  <td className="px-4 py-3">
                    <Badge tone={p.status === "active" ? "green" : "gray"}>{p.status === "active" ? "Đang bán" : "Ngừng bán"}</Badge>
                  </td>
                  <td className="px-4 py-3">
                    <button type="button" onClick={() => setEditing(p)} className="text-sm font-semibold text-[#3979A8]">
                      Sửa
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {plansQuery.data && <Pagination page={page} totalPages={totalPages} total={total} onPage={setPage} />}

      {editing !== null && (
        <PlanFormCard
          plan={editing === "new" ? null : editing}
          saving={saveMutation.isPending}
          error={formError}
          onCancel={() => {
            setEditing(null);
            setFormError(null);
          }}
          onSubmit={(data) => saveMutation.mutate({ id: editing === "new" ? null : editing.id, data })}
        />
      )}
    </main>
  );
}

function PlanFormCard({
  plan,
  saving,
  error,
  onCancel,
  onSubmit,
}: {
  plan: Plan | null;
  saving: boolean;
  error: string | null;
  onCancel: () => void;
  onSubmit: (data: PlanInput) => void;
}) {
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<PlanForm>({
    resolver: zodResolver(planSchema),
    defaultValues: {
      name: plan?.name ?? "",
      priceMonthlyVnd: plan?.priceMonthlyVnd ?? 0,
      maxBranches: plan?.maxBranches ?? 3,
      maxUsers: plan?.maxUsers ?? 10,
      maxBookingsMonth: plan?.maxBookingsMonth ?? 500,
      featuresText: plan?.features.join(", ") ?? "",
      status: plan?.status === "inactive" ? "inactive" : "active",
    },
  });

  return (
    <section className="mt-6 rounded-lg border border-[#E5E9ED] bg-white p-4">
      <h2 className="text-base font-bold text-[#244B70]">{plan ? `Sửa gói: ${plan.name}` : "Tạo gói mới"}</h2>
      <form
        onSubmit={handleSubmit((data) => onSubmit(toInput(data)))}
        className="mt-4 grid gap-4 sm:grid-cols-2"
      >
        <div className="sm:col-span-2">
          <label htmlFor="plan-name" className={labelCls}>Tên gói</label>
          <input id="plan-name" {...register("name")} placeholder="vd: Cơ bản" className={inputCls} />
          {errors.name && <p className="mt-1 text-xs text-[#C0392B]">{errors.name.message}</p>}
        </div>
        <div>
          <label htmlFor="plan-price" className={labelCls}>Giá / tháng (VND)</label>
          <input id="plan-price" type="number" min={0} step={1} {...register("priceMonthlyVnd")} className={inputCls} />
          {errors.priceMonthlyVnd && <p className="mt-1 text-xs text-[#C0392B]">{errors.priceMonthlyVnd.message}</p>}
        </div>
        <div>
          <label htmlFor="plan-status" className={labelCls}>Trạng thái</label>
          <select id="plan-status" {...register("status")} className={inputCls}>
            <option value="active">Đang bán</option>
            <option value="inactive">Ngừng bán</option>
          </select>
        </div>
        <div>
          <label htmlFor="plan-branches" className={labelCls}>Tối đa chi nhánh</label>
          <input id="plan-branches" type="number" min={1} step={1} {...register("maxBranches")} className={inputCls} />
          {errors.maxBranches && <p className="mt-1 text-xs text-[#C0392B]">{errors.maxBranches.message}</p>}
        </div>
        <div>
          <label htmlFor="plan-users" className={labelCls}>Tối đa người dùng</label>
          <input id="plan-users" type="number" min={1} step={1} {...register("maxUsers")} className={inputCls} />
          {errors.maxUsers && <p className="mt-1 text-xs text-[#C0392B]">{errors.maxUsers.message}</p>}
        </div>
        <div className="sm:col-span-2">
          <label htmlFor="plan-bookings" className={labelCls}>Tối đa booking / tháng</label>
          <input id="plan-bookings" type="number" min={0} step={1} {...register("maxBookingsMonth")} className={inputCls} />
          {errors.maxBookingsMonth && <p className="mt-1 text-xs text-[#C0392B]">{errors.maxBookingsMonth.message}</p>}
        </div>
        <div className="sm:col-span-2">
          <label htmlFor="plan-features" className={labelCls}>Tính năng (phân cách bằng dấu phẩy)</label>
          <input id="plan-features" {...register("featuresText")} placeholder="vd: Đặt lịch online, POS, Hoa hồng" className={inputCls} />
        </div>
        {error && (
          <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-[#C0392B] sm:col-span-2">
            {error}
          </p>
        )}
        <div className="flex gap-2 sm:col-span-2">
          <button type="submit" disabled={saving} className={primaryBtnCls}>
            {saving ? "Đang lưu..." : plan ? "Lưu thay đổi" : "Tạo gói"}
          </button>
          <button type="button" onClick={onCancel} className={secondaryBtnCls}>
            Hủy
          </button>
        </div>
      </form>
    </section>
  );
}
