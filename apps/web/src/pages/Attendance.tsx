// Chấm công — danh sách chấm công hôm nay, nút check-in / check-out,
// ca làm việc + tạo ca.
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiPage, formatDateTime, post, todayHcm } from "../lib/api.js";
import { idOf, s } from "../lib/types.js";
import type { Row } from "../lib/types.js";
import {
  btnPrimary, btnSecondary, Card, Empty, ErrorBox, Field, Loading, Notice, errMsg, inputCls,
} from "../lib/ui.js";

export default function AttendancePage() {
  const qc = useQueryClient();
  const [date, setDate] = useState(todayHcm());
  const [employeeId, setEmployeeId] = useState("");
  const [branchId, setBranchId] = useState("");
  const [notice, setNotice] = useState<{ kind: "success" | "error"; text: string } | null>(null);
  const [shift, setShift] = useState({ employeeId: "", date: todayHcm(), startTime: "09:00", endTime: "18:00" });
  const [shiftError, setShiftError] = useState<string | null>(null);

  const branchesQ = useQuery({
    queryKey: ["branches"],
    queryFn: () => apiPage<Row>("/api/v1/branches?limit=100").then((r) => r.items),
  });
  const staffQ = useQuery({
    queryKey: ["employees", "all"],
    queryFn: () => apiPage<Row>("/api/v1/employees?limit=100").then((r) => r.items),
  });
  const attendanceQ = useQuery({
    queryKey: ["attendance", date],
    queryFn: () => apiPage<Row>(`/api/v1/attendance?date=${date}&limit=100`).then((r) => r.items),
  });
  const shiftsQ = useQuery({
    queryKey: ["shifts", date],
    queryFn: () => apiPage<Row>(`/api/v1/shifts?date=${date}&limit=100`).then((r) => r.items),
  });

  const checkInMut = useMutation({
    mutationFn: () => post<Row>("/api/v1/attendance/check-in", { employeeId, branchId, date }),
    onSuccess: () => {
      setNotice({ kind: "success", text: "Đã check-in." });
      void qc.invalidateQueries({ queryKey: ["attendance"] });
    },
    onError: (err) => setNotice({ kind: "error", text: errMsg(err) }),
  });
  const checkOutMut = useMutation({
    mutationFn: () => post<Row>("/api/v1/attendance/check-out", { employeeId, branchId, date }),
    onSuccess: () => {
      setNotice({ kind: "success", text: "Đã check-out." });
      void qc.invalidateQueries({ queryKey: ["attendance"] });
    },
    onError: (err) => setNotice({ kind: "error", text: errMsg(err) }),
  });
  const shiftMut = useMutation({
    mutationFn: () => post<Row>("/api/v1/shifts", {
      employeeId: shift.employeeId,
      branchId: branchId || undefined,
      date: shift.date,
      startTime: shift.startTime,
      endTime: shift.endTime,
    }),
    onSuccess: () => {
      setNotice({ kind: "success", text: "Đã tạo ca làm việc." });
      setShift({ employeeId: "", date: todayHcm(), startTime: "09:00", endTime: "18:00" });
      void qc.invalidateQueries({ queryKey: ["shifts"] });
    },
    onError: (err) => setNotice({ kind: "error", text: errMsg(err) }),
  });

  const records = attendanceQ.data ?? [];
  const staff = staffQ.data ?? [];
  return (
    <main className="space-y-4 p-4">
      <h1 className="text-xl font-bold">Chấm công</h1>
      {notice ? <Notice kind={notice.kind} text={notice.text} onClose={() => setNotice(null)} /> : null}

      <Card title="Check-in / Check-out hôm nay">
        <div className="space-y-4">
          <Field label="Ngày">
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className={inputCls} />
          </Field>
          <Field label="Nhân viên">
            <select value={employeeId} onChange={(e) => setEmployeeId(e.target.value)} className={inputCls}>
              <option value="">— Chọn nhân viên —</option>
              {staff.map((e) => (
                <option key={idOf(e)} value={idOf(e)}>{s(e, "fullName", "full_name")}</option>
              ))}
            </select>
          </Field>
          <Field label="Chi nhánh">
            <select value={branchId} onChange={(e) => setBranchId(e.target.value)} className={inputCls}>
              <option value="">— Chọn chi nhánh —</option>
              {(branchesQ.data ?? []).map((b) => (
                <option key={idOf(b)} value={idOf(b)}>{s(b, "name")}</option>
              ))}
            </select>
          </Field>
          <div className="flex gap-2">
            <button type="button" disabled={checkInMut.isPending || !employeeId || !branchId} onClick={() => checkInMut.mutate()} className={btnPrimary}>
              {checkInMut.isPending ? "Đang xử lý..." : "Check-in"}
            </button>
            <button type="button" disabled={checkOutMut.isPending || !employeeId || !branchId} onClick={() => checkOutMut.mutate()} className={btnSecondary}>
              {checkOutMut.isPending ? "Đang xử lý..." : "Check-out"}
            </button>
          </div>
        </div>
      </Card>

      <Card title={`Chấm công ngày ${date}`}>
        {attendanceQ.isLoading ? (
          <Loading />
        ) : attendanceQ.isError ? (
          <ErrorBox message={errMsg(attendanceQ.error)} onRetry={() => void attendanceQ.refetch()} />
        ) : records.length === 0 ? (
          <Empty text="Chưa có lượt chấm công nào trong ngày này." />
        ) : (
          <ul className="space-y-2">
            {records.map((r) => (
              <li key={idOf(r)} className="flex justify-between gap-2 rounded-lg border border-[#E5E9ED] p-3 text-sm">
                <span>{s(r, "employeeName", "employee_name") || "Nhân viên"}</span>
                <span className="text-[#748294]">
                  Vào: {s(r, "checkInAt", "check_in_at") ? formatDateTime(s(r, "checkInAt", "check_in_at")) : "—"}
                  {" · "}Ra: {s(r, "checkOutAt", "check_out_at") ? formatDateTime(s(r, "checkOutAt", "check_out_at")) : "—"}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card title="Ca làm việc">
        {shiftsQ.isLoading ? (
          <Loading />
        ) : shiftsQ.isError ? (
          <ErrorBox message={errMsg(shiftsQ.error)} onRetry={() => void shiftsQ.refetch()} />
        ) : (shiftsQ.data ?? []).length === 0 ? (
          <p className="text-sm text-[#748294]">Chưa có ca làm việc nào trong ngày này.</p>
        ) : (
          <ul className="space-y-2">
            {(shiftsQ.data ?? []).map((sh) => (
              <li key={idOf(sh)} className="flex justify-between gap-2 rounded-lg border border-[#E5E9ED] p-3 text-sm">
                <span>{s(sh, "employeeName", "employee_name") || "Nhân viên"}</span>
                <span className="text-[#748294]">{s(sh, "startTime", "start_time")} – {s(sh, "endTime", "end_time")}</span>
              </li>
            ))}
          </ul>
        )}
        <div className="mt-4 space-y-4 border-t border-[#E5E9ED] pt-4">
          <p className="text-sm font-medium">Tạo ca làm việc</p>
          <Field label="Nhân viên">
            <select value={shift.employeeId} onChange={(e) => setShift((x) => ({ ...x, employeeId: e.target.value }))} className={inputCls}>
              <option value="">— Chọn nhân viên —</option>
              {staff.map((e) => (
                <option key={idOf(e)} value={idOf(e)}>{s(e, "fullName", "full_name")}</option>
              ))}
            </select>
          </Field>
          <Field label="Ngày">
            <input type="date" value={shift.date} onChange={(e) => setShift((x) => ({ ...x, date: e.target.value }))} className={inputCls} />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Giờ bắt đầu">
              <input type="time" value={shift.startTime} onChange={(e) => setShift((x) => ({ ...x, startTime: e.target.value }))} className={inputCls} />
            </Field>
            <Field label="Giờ kết thúc">
              <input type="time" value={shift.endTime} onChange={(e) => setShift((x) => ({ ...x, endTime: e.target.value }))} className={inputCls} />
            </Field>
          </div>
          {shiftError ? <p role="alert" className="text-sm text-[#C0392B]">{shiftError}</p> : null}
          <button
            type="button"
            disabled={shiftMut.isPending || !shift.employeeId}
            onClick={() => {
              setShiftError(null);
              if (shift.endTime <= shift.startTime) return setShiftError("Giờ kết thúc phải sau giờ bắt đầu.");
              shiftMut.mutate();
            }}
            className={btnPrimary}
          >
            {shiftMut.isPending ? "Đang xử lý..." : "Tạo ca"}
          </button>
        </div>
      </Card>
    </main>
  );
}
