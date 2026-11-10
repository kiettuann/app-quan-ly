// Cài đặt — thông tin tenant (GET /tenants/me), danh sách user + mời user
// (POST /users), danh sách role + tạo role tùy chỉnh. Hiện vai trò của
// người đang đăng nhập.
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiPage, formatVnd, get, post } from "../lib/api.js";
import { useAuth } from "../lib/auth.js";
import { arr, idOf, n, s } from "../lib/types.js";
import type { Row } from "../lib/types.js";
import {
  btnPrimary, Card, Empty, ErrorBox, Field, Loading, Notice, errMsg, inputCls,
} from "../lib/ui.js";

const INVITE_ROLES = [
  { value: "branch_manager", label: "Quản lý chi nhánh" },
  { value: "receptionist", label: "Lễ tân" },
  { value: "technician", label: "Kỹ thuật viên" },
];

export default function SettingsPage() {
  const qc = useQueryClient();
  const { user } = useAuth();
  const [notice, setNotice] = useState<{ kind: "success" | "error"; text: string } | null>(null);
  const [invite, setInvite] = useState({ email: "", fullName: "", phone: "", role: "receptionist", branchIds: [] as string[] });
  const [inviteError, setInviteError] = useState<string | null>(null);
  const [roleForm, setRoleForm] = useState({ name: "", description: "", permissions: [] as string[] });
  const [roleError, setRoleError] = useState<string | null>(null);

  const tenantQ = useQuery({
    queryKey: ["tenant", "me"],
    queryFn: () => get<Row>("/api/v1/tenants/me"),
  });
  const usersQ = useQuery({
    queryKey: ["users"],
    queryFn: () => apiPage<Row>("/api/v1/users?limit=100").then((r) => r.items),
  });
  const rolesQ = useQuery({
    queryKey: ["roles"],
    queryFn: () => apiPage<Row>("/api/v1/roles?limit=100").then((r) => r.items),
  });
  const permissionsQ = useQuery({
    queryKey: ["permissions"],
    queryFn: () => apiPage<Row>("/api/v1/permissions?limit=100").then((r) => r.items),
  });
  const branchesQ = useQuery({
    queryKey: ["branches"],
    queryFn: () => apiPage<Row>("/api/v1/branches?limit=100").then((r) => r.items),
  });

  const inviteMut = useMutation({
    mutationFn: () => post<Row>("/api/v1/users", {
      email: invite.email.trim(),
      fullName: invite.fullName.trim(),
      phone: invite.phone.trim() || undefined,
      role: invite.role,
      branchIds: invite.branchIds,
    }),
    onSuccess: () => {
      setNotice({ kind: "success", text: "Đã mời người dùng. Họ sẽ nhận hướng dẫn đặt mật khẩu qua email." });
      setInvite({ email: "", fullName: "", phone: "", role: "receptionist", branchIds: [] });
      void qc.invalidateQueries({ queryKey: ["users"] });
    },
    onError: (err) => setNotice({ kind: "error", text: errMsg(err) }),
  });
  const roleMut = useMutation({
    mutationFn: () => post<Row>("/api/v1/roles", {
      name: roleForm.name.trim(),
      description: roleForm.description.trim() || undefined,
      permissions: roleForm.permissions,
    }),
    onSuccess: () => {
      setNotice({ kind: "success", text: "Đã tạo vai trò mới." });
      setRoleForm({ name: "", description: "", permissions: [] });
      void qc.invalidateQueries({ queryKey: ["roles"] });
    },
    onError: (err) => setNotice({ kind: "error", text: errMsg(err) }),
  });

  const tenant = tenantQ.data ?? null;
  const plan = tenant ? (tenant.plan && typeof tenant.plan === "object" ? (tenant.plan as Row) : null) : null;

  return (
    <main className="space-y-4 p-4">
      <h1 className="text-xl font-bold">Cài đặt</h1>
      {notice ? <Notice kind={notice.kind} text={notice.text} onClose={() => setNotice(null)} /> : null}

      <Card title="Tài khoản của tôi">
        <dl className="space-y-2 text-sm">
          <div className="flex justify-between gap-2"><dt className="text-[#748294]">Email</dt><dd className="font-medium">{user?.email ?? "—"}</dd></div>
          <div className="flex justify-between gap-2"><dt className="text-[#748294]">Họ tên</dt><dd>{user?.fullName ?? "—"}</dd></div>
          <div className="flex justify-between gap-2"><dt className="text-[#748294]">Vai trò hiện tại</dt><dd className="font-medium">{user?.role ?? "—"}</dd></div>
        </dl>
      </Card>

      <Card title="Thông tin tiệm">
        {tenantQ.isLoading ? <Loading /> : tenantQ.isError ? (
          <ErrorBox message={errMsg(tenantQ.error)} onRetry={() => void tenantQ.refetch()} />
        ) : tenant ? (
          <dl className="space-y-2 text-sm">
            <div className="flex justify-between gap-2"><dt className="text-[#748294]">Tên tiệm</dt><dd className="font-medium">{s(tenant, "name", "tenantName") || "—"}</dd></div>
            <div className="flex justify-between gap-2"><dt className="text-[#748294]">Số điện thoại</dt><dd>{s(tenant, "phone") || "—"}</dd></div>
            <div className="flex justify-between gap-2"><dt className="text-[#748294]">Email</dt><dd>{s(tenant, "email") || "—"}</dd></div>
            <div className="flex justify-between gap-2"><dt className="text-[#748294]">Gói hiện tại</dt><dd>{plan ? s(plan, "name") : s(tenant, "planName", "plan_name") || "—"}</dd></div>
            {plan ? (
              <div className="flex justify-between gap-2"><dt className="text-[#748294]">Giá gói</dt><dd>{formatVnd(n(plan, "priceVnd", "price_vnd"))} / tháng</dd></div>
            ) : null}
          </dl>
        ) : (
          <Empty text="Chưa có thông tin tiệm." />
        )}
      </Card>

      <Card title="Người dùng">
        {usersQ.isLoading ? <Loading /> : usersQ.isError ? (
          <ErrorBox message={errMsg(usersQ.error)} onRetry={() => void usersQ.refetch()} />
        ) : (usersQ.data ?? []).length === 0 ? (
          <p className="text-sm text-[#748294]">Chưa có người dùng nào.</p>
        ) : (
          <ul className="space-y-2">
            {(usersQ.data ?? []).map((u) => (
              <li key={idOf(u)} className="flex justify-between gap-2 rounded-lg border border-[#E5E9ED] p-3 text-sm">
                <span>{s(u, "fullName", "full_name") || s(u, "email")}</span>
                <span className="text-[#748294]">{s(u, "roleName", "role_name", "role")} · {s(u, "email")}</span>
              </li>
            ))}
          </ul>
        )}
        <div className="mt-4 space-y-4 border-t border-[#E5E9ED] pt-4">
          <p className="text-sm font-medium">Mời người dùng mới</p>
          <Field label="Email">
            <input type="email" value={invite.email} onChange={(e) => setInvite((x) => ({ ...x, email: e.target.value }))} placeholder="vd: nhanvien@tiem.vn" className={inputCls} />
          </Field>
          <Field label="Họ tên">
            <input value={invite.fullName} onChange={(e) => setInvite((x) => ({ ...x, fullName: e.target.value }))} placeholder="vd: Trần Thị Hoa" className={inputCls} />
          </Field>
          <Field label="Số điện thoại (không bắt buộc)">
            <input type="tel" inputMode="tel" value={invite.phone} onChange={(e) => setInvite((x) => ({ ...x, phone: e.target.value }))} className={inputCls} />
          </Field>
          <Field label="Vai trò">
            <select value={invite.role} onChange={(e) => setInvite((x) => ({ ...x, role: e.target.value }))} className={inputCls}>
              {INVITE_ROLES.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
            </select>
          </Field>
          <Field label="Chi nhánh được truy cập">
            {(branchesQ.data ?? []).length === 0 ? (
              <p className="text-sm text-[#748294]">Chưa có chi nhánh nào.</p>
            ) : (
              <ul className="space-y-2">
                {(branchesQ.data ?? []).map((b) => (
                  <li key={idOf(b)}>
                    <label className="flex min-h-[44px] items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        checked={invite.branchIds.includes(idOf(b))}
                        onChange={(e) => setInvite((x) => ({
                          ...x,
                          branchIds: e.target.checked ? [...x.branchIds, idOf(b)] : x.branchIds.filter((v) => v !== idOf(b)),
                        }))}
                      />
                      {s(b, "name")}
                    </label>
                  </li>
                ))}
              </ul>
            )}
          </Field>
          {inviteError ? <p role="alert" className="text-sm text-[#C0392B]">{inviteError}</p> : null}
          <button
            type="button"
            disabled={inviteMut.isPending}
            onClick={() => {
              setInviteError(null);
              if (!invite.email.includes("@")) return setInviteError("Email chưa đúng định dạng.");
              if (invite.fullName.trim().length < 2) return setInviteError("Họ tên phải có ít nhất 2 ký tự.");
              if (invite.branchIds.length === 0) return setInviteError("Chọn ít nhất 1 chi nhánh.");
              inviteMut.mutate();
            }}
            className={btnPrimary}
          >
            {inviteMut.isPending ? "Đang xử lý..." : "Gửi lời mời"}
          </button>
        </div>
      </Card>

      <Card title="Vai trò">
        {rolesQ.isLoading ? <Loading /> : rolesQ.isError ? (
          <ErrorBox message={errMsg(rolesQ.error)} onRetry={() => void rolesQ.refetch()} />
        ) : (rolesQ.data ?? []).length === 0 ? (
          <p className="text-sm text-[#748294]">Chưa có vai trò nào.</p>
        ) : (
          <ul className="space-y-2">
            {(rolesQ.data ?? []).map((r) => (
              <li key={idOf(r)} className="rounded-lg border border-[#E5E9ED] p-3 text-sm">
                <p className="font-medium">{s(r, "name")}</p>
                <p className="text-xs text-[#748294]">
                  {arr(r, "permissions").length > 0
                    ? arr(r, "permissions").map((p) => s(p, "name", "key")).join(", ")
                    : `${n(r, "permissionCount", "permission_count")} quyền`}
                </p>
              </li>
            ))}
          </ul>
        )}
        <div className="mt-4 space-y-4 border-t border-[#E5E9ED] pt-4">
          <p className="text-sm font-medium">Tạo vai trò tùy chỉnh</p>
          <Field label="Tên vai trò">
            <input value={roleForm.name} onChange={(e) => setRoleForm((x) => ({ ...x, name: e.target.value }))} placeholder="vd: Thu ngân" className={inputCls} />
          </Field>
          <Field label="Mô tả (không bắt buộc)">
            <input value={roleForm.description} onChange={(e) => setRoleForm((x) => ({ ...x, description: e.target.value }))} className={inputCls} />
          </Field>
          <Field label="Quyền">
            {permissionsQ.isLoading ? <Loading /> : (permissionsQ.data ?? []).length === 0 ? (
              <p className="text-sm text-[#748294]">Chưa tải được danh sách quyền.</p>
            ) : (
              <ul className="max-h-56 space-y-2 overflow-y-auto">
                {(permissionsQ.data ?? []).map((p) => {
                  const key = s(p, "key", "name", "id");
                  return (
                    <li key={idOf(p) || key}>
                      <label className="flex min-h-[44px] items-center gap-2 text-sm">
                        <input
                          type="checkbox"
                          checked={roleForm.permissions.includes(key)}
                          onChange={(e) => setRoleForm((x) => ({
                            ...x,
                            permissions: e.target.checked ? [...x.permissions, key] : x.permissions.filter((v) => v !== key),
                          }))}
                        />
                        {s(p, "description", "name", "key") || key}
                      </label>
                    </li>
                  );
                })}
              </ul>
            )}
          </Field>
          {roleError ? <p role="alert" className="text-sm text-[#C0392B]">{roleError}</p> : null}
          <button
            type="button"
            disabled={roleMut.isPending}
            onClick={() => {
              setRoleError(null);
              if (roleForm.name.trim().length < 2) return setRoleError("Tên vai trò phải có ít nhất 2 ký tự.");
              if (roleForm.permissions.length === 0) return setRoleError("Chọn ít nhất 1 quyền.");
              roleMut.mutate();
            }}
            className={btnPrimary}
          >
            {roleMut.isPending ? "Đang xử lý..." : "Tạo vai trò"}
          </button>
        </div>
      </Card>
    </main>
  );
}
