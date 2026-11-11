import { useMutation, useQuery } from "@tanstack/react-query";
import { phoneVn } from "@quanly/shared";
import { useMemo, useState } from "react";
import { CalendarDays, Check, Clock, MapPin, Phone, Search, User } from "lucide-react";
import { EmptyBox, ErrorBox, FieldError, LoadingBox, PrimaryButton, SecondaryButton, StepHeader, SummaryRow } from "./components/ui.js";
import {
  cancelMyBooking,
  createBooking,
  getAvailability,
  getBranches,
  getMyBookings,
  getServices,
  type Branch,
  type CreatedBooking,
  type MyBooking,
  type ServiceItem,
} from "./lib/api.js";
import { BOOKING_STATUS_LABEL, formatDate, formatDateTime, formatVnd, todayIso } from "./lib/format.js";

const TOTAL_STEPS = 8;

function readTenantParam(): string {
  try {
    return new URLSearchParams(window.location.search).get("tenant") ?? "";
  } catch {
    return "";
  }
}

const inputCls =
  "mt-1 h-11 w-full rounded-lg border border-[#E5E9ED] bg-white px-3 text-sm outline-none transition-colors placeholder:text-[#748294] focus:border-[#3979A8] focus:ring-2 focus:ring-[#3979A8]/25 disabled:cursor-not-allowed disabled:bg-[#F7F7F5]";
const labelCls = "text-sm font-medium";

export default function App() {
  const [mode, setMode] = useState<"booking" | "lookup">("booking");
  return (
    <div className="mx-auto min-h-screen max-w-2xl bg-[#F7F7F5] px-4 pb-16 pt-4">
      <header className="mb-4">
        <h1 className="text-xl font-bold text-[#244B70]">quanly.store — Đặt lịch</h1>
        <p className="mt-1 text-sm text-[#748294]">Đặt lịch làm nail online, không cần tạo tài khoản.</p>
        <nav className="mt-3 flex gap-2" aria-label="Chuyển mục">
          <button
            type="button"
            onClick={() => setMode("booking")}
            className={`h-11 flex-1 rounded-lg text-sm font-semibold transition-colors ${mode === "booking" ? "bg-[#244B70] text-white" : "bg-white text-[#244B70] ring-1 ring-[#E5E9ED] hover:bg-[#F7F7F5]"}`}
          >
            Đặt lịch mới
          </button>
          <button
            type="button"
            onClick={() => setMode("lookup")}
            className={`h-11 flex-1 rounded-lg text-sm font-semibold transition-colors ${mode === "lookup" ? "bg-[#244B70] text-white" : "bg-white text-[#244B70] ring-1 ring-[#E5E9ED] hover:bg-[#F7F7F5]"}`}
          >
            Tra cứu lịch của tôi
          </button>
        </nav>
      </header>
      {mode === "booking" ? <BookingFlow /> : <MyBookingsView />}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Luồng đặt lịch 10 bước (UX_FLOWS.md §3, CONTRACTS.md §6):
// 1 slug tiệm → 2 chi nhánh → 3 dịch vụ → 4 kỹ thuật viên → 5 ngày →
// 6 giờ trống → 7 tên + SĐT → 8 xem lại → 9 đặt cọc ("Sắp ra mắt") →
// 10 xác nhận. Không có màn hình OTP: SĐT là định danh (quyết định MVP).
// ---------------------------------------------------------------------------

function BookingFlow() {
  const [step, setStep] = useState(1);
  const [slugInput, setSlugInput] = useState(readTenantParam());
  const [slug, setSlug] = useState(readTenantParam());
  const [branch, setBranch] = useState<Branch | null>(null);
  const [selectedServiceIds, setSelectedServiceIds] = useState<string[]>([]);
  const [technicianChoice, setTechnicianChoice] = useState(""); // "" = chưa chọn, "auto" = hệ thống tự chọn
  const [date, setDate] = useState("");
  const [time, setTime] = useState("");
  const [customerName, setCustomerName] = useState("");
  const [phone, setPhone] = useState("");
  const [infoError, setInfoError] = useState<string | null>(null);
  const [confirmation, setConfirmation] = useState<CreatedBooking | null>(null);

  const branchesQuery = useQuery({
    queryKey: ["public-branches", slug],
    queryFn: () => getBranches(slug),
    enabled: slug !== "",
  });
  const servicesQuery = useQuery({
    queryKey: ["public-services", branch?.id],
    queryFn: () => getServices(branch!.id),
    enabled: branch !== null,
  });
  // Danh sách kỹ thuật viên lấy từ availability (nếu server trả kèm).
  // Nếu server không trả, chỉ còn lựa chọn "Hệ thống tự chọn".
  const techniciansQuery = useQuery({
    queryKey: ["public-technicians", branch?.id],
    queryFn: async () => {
      try {
        const res = await getAvailability({ branchId: branch!.id, date: todayIso() });
        return res.technicians;
      } catch {
        return [];
      }
    },
    enabled: branch !== null,
  });
  const slotsQuery = useQuery({
    queryKey: ["public-availability", branch?.id, date, technicianChoice, selectedServiceIds.join(",")],
    queryFn: () =>
      getAvailability({
        branchId: branch!.id,
        date,
        technicianId: technicianChoice === "auto" ? null : technicianChoice || null,
        serviceIds: selectedServiceIds,
      }),
    enabled: branch !== null && date !== "",
  });

  const services = servicesQuery.data ?? [];
  const selectedServices = useMemo(
    () => services.filter((s) => selectedServiceIds.includes(s.id)),
    [services, selectedServiceIds],
  );
  const totalPrice = selectedServices.reduce((sum, s) => sum + s.priceVnd, 0);
  const totalDuration = selectedServices.reduce((sum, s) => sum + s.durationMinutes, 0);
  const technicianName =
    technicianChoice === "auto"
      ? "Hệ thống tự chọn"
      : (techniciansQuery.data ?? []).find((t) => t.id === technicianChoice)?.name ?? "";

  const confirmMutation = useMutation({
    mutationFn: () =>
      createBooking({
        tenantSlug: slug,
        branchId: branch!.id,
        serviceIds: selectedServiceIds,
        technicianId: technicianChoice === "auto" ? null : technicianChoice,
        date,
        startTime: time,
        customerName: customerName.trim(),
        customerPhone: phone.trim(),
      }),
    onSuccess: (data) => setConfirmation(data),
  });

  function resetFromBranch() {
    setSelectedServiceIds([]);
    setTechnicianChoice("");
    setDate("");
    setTime("");
  }
  function resetFromServices() {
    setTechnicianChoice("");
    setDate("");
    setTime("");
  }
  function resetFromDate() {
    setTime("");
  }

  function submitInfo() {
    if (customerName.trim() === "") {
      setInfoError("Vui lòng nhập họ tên.");
      return;
    }
    const check = phoneVn.safeParse(phone.trim());
    if (!check.success) {
      setInfoError("Số điện thoại phải có 10 số, bắt đầu bằng 0 (vd 0901234567).");
      return;
    }
    setInfoError(null);
    setStep(8);
  }

  function startOver() {
    setStep(1);
    setSlugInput("");
    setSlug("");
    setBranch(null);
    resetFromBranch();
    setCustomerName("");
    setPhone("");
    setConfirmation(null);
    confirmMutation.reset();
  }

  // --- Màn hình xác nhận sau khi đặt thành công (bước 10) ---
  if (confirmation) {
    return (
      <main>
        <div className="rounded-lg border border-[#2E7D5B]/30 bg-white p-4">
          <h2 className="text-xl font-bold text-[#2E7D5B]">Đặt lịch thành công</h2>
          <p className="mt-1 text-sm text-[#748294]">
            Tiệm sẽ liên hệ xác nhận qua số điện thoại bạn đã nhập. Vui lòng đến đúng giờ hẹn.
          </p>
          <div className="mt-4">
            <SummaryRow label="Mã lịch hẹn" value={confirmation.code ?? confirmation.id} />
            <SummaryRow label="Chi nhánh" value={confirmation.branchName ?? branch?.name ?? "—"} />
            <SummaryRow label="Dịch vụ" value={selectedServices.map((s) => s.name).join(", ")} />
            <SummaryRow label="Kỹ thuật viên" value={technicianName} />
            <SummaryRow label="Ngày giờ" value={confirmation.startAt ? formatDateTime(confirmation.startAt) : `${formatDate(date)} lúc ${time}`} />
            <SummaryRow label="Tổng tiền" value={confirmation.totalPriceVnd != null ? formatVnd(confirmation.totalPriceVnd) : formatVnd(totalPrice)} />
            <SummaryRow label="Trạng thái" value={BOOKING_STATUS_LABEL[confirmation.status] ?? confirmation.status} />
          </div>
          {branch?.address && (
            <p className="mt-3 flex items-start gap-2 text-sm text-[#748294]">
              <MapPin className="mt-0.5 h-4 w-4 shrink-0" /> {branch.address}
            </p>
          )}
        </div>
        <div className="mt-4 flex gap-2">
          <div className="flex-1">
            <PrimaryButton onClick={startOver}>Đặt lịch khác</PrimaryButton>
          </div>
        </div>
      </main>
    );
  }

  return (
    <main>
      {step === 1 && (
        <section>
          <StepHeader step={1} total={TOTAL_STEPS} title="Chọn tiệm" subtitle="Mỗi tiệm có một mã riêng (slug) — mã này tiệm sẽ gửi cho bạn, vd: tiem-nail-lan." />
          <label htmlFor="slug" className={labelCls}>
            Tên tiệm (slug)
          </label>
          <input
            id="slug"
            value={slugInput}
            onChange={(e) => setSlugInput(e.target.value.trim().toLowerCase())}
            placeholder="vd: tiem-nail-lan"
            autoCapitalize="off"
            autoCorrect="off"
            className={inputCls}
          />
          <div className="mt-4">
            <PrimaryButton
              disabled={slugInput === ""}
              onClick={() => {
                setSlug(slugInput);
                setBranch(null);
                resetFromBranch();
                setStep(2);
              }}
            >
              Tiếp tục
            </PrimaryButton>
          </div>
          <p className="mt-3 text-xs text-[#748294]">
            Hoặc mở link tiệm gửi sẵn có dạng ?tenant=&lt;mã-tiệm&gt; — mã sẽ tự điền.
          </p>
        </section>
      )}

      {step === 2 && (
        <section>
          <StepHeader step={2} total={TOTAL_STEPS} title="Chọn chi nhánh" subtitle={`Tiệm: ${slug}`} />
          {branchesQuery.isPending && <LoadingBox text="Đang tải danh sách chi nhánh..." />}
          {branchesQuery.isError && (
            <ErrorBox message="Không tải được danh sách chi nhánh. Kiểm tra lại mã tiệm hoặc thử lại." onRetry={() => branchesQuery.refetch()} />
          )}
          {branchesQuery.data && branchesQuery.data.length === 0 && (
            <EmptyBox message="Tiệm này chưa có chi nhánh nào mở đặt lịch online." />
          )}
          <ul className="space-y-2">
            {(branchesQuery.data ?? []).map((b) => (
              <li key={b.id}>
                <button
                  type="button"
                  onClick={() => {
                    setBranch(b);
                    resetFromBranch();
                    setStep(3);
                  }}
                  className="w-full rounded-lg border border-[#E5E9ED] bg-white p-4 text-left transition-colors hover:bg-[#F7F7F5] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#3979A8]"
                >
                  <p className="text-sm font-semibold">{b.name}</p>
                  <p className="mt-1 flex items-start gap-2 text-sm text-[#748294]">
                    <MapPin className="mt-0.5 h-4 w-4 shrink-0" /> {b.address}
                  </p>
                  {b.phone && (
                    <p className="mt-1 flex items-center gap-2 text-sm text-[#748294]">
                      <Phone className="h-4 w-4 shrink-0" /> {b.phone}
                    </p>
                  )}
                  {b.openTime && b.closeTime && (
                    <p className="mt-1 flex items-center gap-2 text-sm text-[#748294]">
                      <Clock className="h-4 w-4 shrink-0" /> Mở cửa {b.openTime} – {b.closeTime}
                    </p>
                  )}
                </button>
              </li>
            ))}
          </ul>
          <div className="mt-4">
            <SecondaryButton onClick={() => setStep(1)}>Quay lại</SecondaryButton>
          </div>
        </section>
      )}

      {step === 3 && (
        <section>
          <StepHeader step={3} total={TOTAL_STEPS} title="Chọn dịch vụ" subtitle={`${branch?.name ?? ""} — chọn một hoặc nhiều dịch vụ, giá hiện trước khi chọn.`} />
          {servicesQuery.isPending && <LoadingBox text="Đang tải dịch vụ..." />}
          {servicesQuery.isError && <ErrorBox message="Không tải được danh sách dịch vụ." onRetry={() => servicesQuery.refetch()} />}
          {servicesQuery.data && servicesQuery.data.length === 0 && <EmptyBox message="Chi nhánh này chưa có dịch vụ nào mở đặt online." />}
          <ul className="space-y-2">
            {services.map((s: ServiceItem) => {
              const selected = selectedServiceIds.includes(s.id);
              return (
                <li key={s.id}>
                  <button
                    type="button"
                    aria-pressed={selected}
                    onClick={() =>
                      setSelectedServiceIds((prev) => (selected ? prev.filter((id) => id !== s.id) : [...prev, s.id]))
                    }
                    className={`w-full rounded-lg border bg-white p-4 text-left transition-colors ${selected ? "border-[#244B70] bg-[#F2F6F9] ring-1 ring-[#244B70]" : "border-[#E5E9ED] hover:bg-[#F7F7F5]"}`}
                  >
                    <span className="flex items-start justify-between gap-3">
                      <span className="min-w-0">
                        <span className="flex items-center gap-1.5 text-sm font-semibold">
                          {selected && <Check className="h-4 w-4 shrink-0 text-[#244B70]" aria-hidden />}
                          <span className="break-words">{s.name}</span>
                        </span>
                        {s.categoryName && <span className="mt-0.5 block text-xs text-[#748294]">{s.categoryName}</span>}
                        <span className="mt-0.5 block text-xs text-[#748294]">{s.durationMinutes > 0 ? `${s.durationMinutes} phút` : "Thời lượng do tiệm xác nhận"}</span>
                      </span>
                      <span className="shrink-0 text-sm font-semibold tabular-nums text-[#244B70]">{formatVnd(s.priceVnd)}</span>
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
          {selectedServiceIds.length > 0 && (
            <p className="mt-3 rounded-lg bg-white p-3 text-sm ring-1 ring-[#E5E9ED]">
              Đã chọn {selectedServiceIds.length} dịch vụ · Tạm tính <strong>{formatVnd(totalPrice)}</strong>
              {totalDuration > 0 && ` · khoảng ${totalDuration} phút`}
            </p>
          )}
          <div className="mt-4 flex gap-2">
            <SecondaryButton onClick={() => setStep(2)}>Quay lại</SecondaryButton>
            <div className="flex-1">
              <PrimaryButton
                disabled={selectedServiceIds.length === 0}
                onClick={() => {
                  resetFromServices();
                  setStep(4);
                }}
              >
                Tiếp tục
              </PrimaryButton>
            </div>
          </div>
        </section>
      )}

      {step === 4 && (
        <section>
          <StepHeader step={4} total={TOTAL_STEPS} title="Chọn kỹ thuật viên" subtitle="Hoặc để hệ thống tự chọn người đang trống vào giờ bạn đặt." />
          {techniciansQuery.isPending && <LoadingBox text="Đang tải danh sách kỹ thuật viên..." />}
          <ul className="space-y-2">
            <li>
              <button
                type="button"
                aria-pressed={technicianChoice === "auto"}
                onClick={() => setTechnicianChoice("auto")}
                className={`w-full rounded-lg border bg-white p-4 text-left transition-colors ${technicianChoice === "auto" ? "border-[#244B70] bg-[#F2F6F9] ring-1 ring-[#244B70]" : "border-[#E5E9ED] hover:bg-[#F7F7F5]"}`}
              >
                <span className="flex items-center gap-1.5 text-sm font-semibold">
                  {technicianChoice === "auto" && <Check className="h-4 w-4 shrink-0 text-[#244B70]" aria-hidden />}
                  Hệ thống tự chọn
                </span>
                <span className="mt-0.5 block text-xs text-[#748294]">Tiệm sắp xếp kỹ thuật viên đang trống</span>
              </button>
            </li>
            {(techniciansQuery.data ?? []).map((t) => (
              <li key={t.id}>
                <button
                  type="button"
                  aria-pressed={technicianChoice === t.id}
                  onClick={() => setTechnicianChoice(t.id)}
                  className={`w-full rounded-lg border bg-white p-4 text-left transition-colors ${technicianChoice === t.id ? "border-[#244B70] bg-[#F2F6F9] ring-1 ring-[#244B70]" : "border-[#E5E9ED] hover:bg-[#F7F7F5]"}`}
                >
                  <span className="flex items-center gap-2 text-sm font-semibold">
                    {technicianChoice === t.id ? (
                      <Check className="h-4 w-4 shrink-0 text-[#244B70]" aria-hidden />
                    ) : (
                      <User className="h-4 w-4 shrink-0 text-[#748294]" />
                    )}
                    <span className="break-words">{t.name}</span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
          {(techniciansQuery.data ?? []).length === 0 && !techniciansQuery.isPending && (
            <p className="mt-3 text-xs text-[#748294]">Tiệm chưa công bố danh sách kỹ thuật viên — hệ thống sẽ tự chọn người trống.</p>
          )}
          <div className="mt-4 flex gap-2">
            <SecondaryButton onClick={() => setStep(3)}>Quay lại</SecondaryButton>
            <div className="flex-1">
              <PrimaryButton disabled={technicianChoice === ""} onClick={() => setStep(5)}>
                Tiếp tục
              </PrimaryButton>
            </div>
          </div>
        </section>
      )}

      {step === 5 && (
        <section>
          <StepHeader step={5} total={TOTAL_STEPS} title="Chọn ngày" subtitle="Chỉ chọn ngày từ hôm nay trở đi." />
          <label htmlFor="date" className={labelCls}>
            Ngày hẹn
          </label>
          <input
            id="date"
            type="date"
            min={todayIso()}
            value={date}
            onChange={(e) => {
              setDate(e.target.value);
              resetFromDate();
            }}
            className={inputCls}
          />
          <p className="mt-2 flex items-center gap-2 text-xs text-[#748294]">
            <CalendarDays className="h-4 w-4" /> Ngày đã qua không chọn được.
          </p>
          <div className="mt-4 flex gap-2">
            <SecondaryButton onClick={() => setStep(4)}>Quay lại</SecondaryButton>
            <div className="flex-1">
              <PrimaryButton disabled={date === ""} onClick={() => setStep(6)}>
                Tiếp tục
              </PrimaryButton>
            </div>
          </div>
        </section>
      )}

      {step === 6 && (
        <section>
          <StepHeader step={6} total={TOTAL_STEPS} title="Chọn giờ" subtitle={`Ngày ${formatDate(date)} — chỉ hiện giờ còn trống thật (đã trừ lịch đã đặt và giờ nghỉ).`} />
          {slotsQuery.isPending && <LoadingBox text="Đang kiểm tra giờ trống..." />}
          {slotsQuery.isError && <ErrorBox message="Không kiểm tra được giờ trống. Vui lòng thử lại." onRetry={() => slotsQuery.refetch()} />}
          {slotsQuery.data && slotsQuery.data.slots.length === 0 && (
            <EmptyBox message="Ngày này đã hết giờ trống. Vui lòng chọn ngày khác." action={<SecondaryButton onClick={() => setStep(5)}>Chọn ngày khác</SecondaryButton>} />
          )}
          <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
            {(slotsQuery.data?.slots ?? []).map((slot) => (
              <button
                key={slot}
                type="button"
                aria-pressed={time === slot}
                onClick={() => setTime(slot)}
                className={`h-11 rounded-lg text-sm font-semibold tabular-nums transition-colors ${time === slot ? "bg-[#244B70] text-white ring-2 ring-[#3979A8] ring-offset-2 ring-offset-[#F7F7F5]" : "bg-white text-[#203247] ring-1 ring-[#E5E9ED] hover:bg-[#F7F7F5]"}`}
              >
                {slot}
              </button>
            ))}
          </div>
          <div className="mt-4 flex gap-2">
            <SecondaryButton onClick={() => setStep(5)}>Quay lại</SecondaryButton>
            <div className="flex-1">
              <PrimaryButton disabled={time === ""} onClick={() => setStep(7)}>
                Tiếp tục
              </PrimaryButton>
            </div>
          </div>
        </section>
      )}

      {step === 7 && (
        <section>
          <StepHeader step={7} total={TOTAL_STEPS} title="Thông tin của bạn" subtitle="Số điện thoại dùng để tra cứu và hủy lịch sau này. Không gửi mã OTP." />
          <div>
            <label htmlFor="customerName" className={labelCls}>
              Họ tên
            </label>
            <input id="customerName" value={customerName} onChange={(e) => setCustomerName(e.target.value)} placeholder="vd: Nguyễn Thị Lan" className={inputCls} />
          </div>
          <div className="mt-4">
            <label htmlFor="phone" className={labelCls}>
              Số điện thoại
            </label>
            <input
              id="phone"
              value={phone}
              onChange={(e) => setPhone(e.target.value.replace(/[^0-9]/g, "").slice(0, 10))}
              placeholder="vd: 0901234567"
              inputMode="tel"
              autoComplete="tel"
              className={inputCls}
            />
            <p className="mt-1 text-xs text-[#748294]">10 số, bắt đầu bằng 0.</p>
          </div>
          {infoError && (
            <p role="alert" className="mt-4 rounded-lg bg-red-50 p-3 text-sm text-[#C0392B]">
              {infoError}
            </p>
          )}
          <div className="mt-4 flex gap-2">
            <SecondaryButton onClick={() => setStep(6)}>Quay lại</SecondaryButton>
            <div className="flex-1">
              <PrimaryButton onClick={submitInfo}>Xem lại</PrimaryButton>
            </div>
          </div>
        </section>
      )}

      {step === 8 && (
        <section>
          <StepHeader step={8} total={TOTAL_STEPS} title="Xem lại và xác nhận" subtitle="Kiểm tra kỹ trước khi gửi — giá dưới đây lấy từ giá dịch vụ do tiệm công bố." />
          <div className="rounded-lg border border-[#E5E9ED] bg-white p-4">
            <SummaryRow label="Tiệm / Chi nhánh" value={`${slug} — ${branch?.name ?? ""}`} />
            {branch?.address && <SummaryRow label="Địa chỉ" value={branch.address} />}
            <SummaryRow label="Dịch vụ" value={selectedServices.map((s) => `${s.name} (${formatVnd(s.priceVnd)})`).join(", ")} />
            <SummaryRow label="Kỹ thuật viên" value={technicianName} />
            <SummaryRow label="Ngày giờ" value={`${formatDate(date)} lúc ${time}`} />
            {totalDuration > 0 && <SummaryRow label="Thời lượng dự kiến" value={`Khoảng ${totalDuration} phút`} />}
            <SummaryRow label="Khách hàng" value={`${customerName.trim()} — ${phone.trim()}`} />
            <SummaryRow label="Tổng tiền" value={formatVnd(totalPrice)} />
          </div>
          <div className="mt-3 rounded-lg border border-[#E5E9ED] bg-white p-4">
            <p className="text-sm font-semibold">Đặt cọc</p>
            <p className="mt-1 text-sm text-[#748294]">
              Đặt cọc online: <strong className="text-[#203247]">Sắp ra mắt</strong> — hiện chưa thu tiền cọc qua đây.
              Lịch của bạn sẽ được tạo ở trạng thái chờ xác nhận, tiệm sẽ liên hệ lại để xác nhận và hướng dẫn đặt cọc nếu cần.
            </p>
          </div>
          {confirmMutation.isError && (
            <div className="mt-3">
              <ErrorBox message={confirmMutation.error instanceof Error ? confirmMutation.error.message : "Đặt lịch thất bại. Vui lòng thử lại."} />
            </div>
          )}
          <div className="mt-4 flex gap-2">
            <SecondaryButton onClick={() => setStep(7)}>Quay lại</SecondaryButton>
            <div className="flex-1">
              <PrimaryButton disabled={confirmMutation.isPending} onClick={() => confirmMutation.mutate()}>
                {confirmMutation.isPending ? "Đang xử lý..." : "Xác nhận đặt lịch"}
              </PrimaryButton>
            </div>
          </div>
        </section>
      )}
    </main>
  );
}

// ---------------------------------------------------------------------------
// Tra cứu lịch của tôi: SĐT (+ chi nhánh) → danh sách lịch, hủy lịch
// pending/confirmed. Không OTP ở MVP.
// ---------------------------------------------------------------------------

function MyBookingsView() {
  const [slugInput, setSlugInput] = useState(readTenantParam());
  const [slug, setSlug] = useState(readTenantParam());
  const [branchId, setBranchId] = useState("");
  const [phone, setPhone] = useState("");
  const [submitted, setSubmitted] = useState<{ phone: string; branchId: string | null } | null>(null);
  const [formError, setFormError] = useState<string | null>(null);

  const branchesQuery = useQuery({
    queryKey: ["lookup-branches", slug],
    queryFn: () => getBranches(slug),
    enabled: slug !== "",
  });
  const bookingsQuery = useQuery({
    queryKey: ["my-bookings", submitted?.phone, submitted?.branchId],
    queryFn: () => getMyBookings(submitted!.phone, submitted!.branchId),
    enabled: submitted !== null,
  });
  const cancelMutation = useMutation({
    mutationFn: ({ id, phone: p }: { id: string; phone: string }) => cancelMyBooking(id, p),
    onSuccess: () => bookingsQuery.refetch(),
  });

  function submitLookup() {
    const check = phoneVn.safeParse(phone.trim());
    if (!check.success) {
      setFormError("Số điện thoại phải có 10 số, bắt đầu bằng 0 (vd 0901234567).");
      return;
    }
    setFormError(null);
    setSubmitted({ phone: phone.trim(), branchId: branchId === "" ? null : branchId });
  }

  return (
    <main>
      <h2 className="text-xl font-bold text-[#244B70]">Tra cứu lịch của tôi</h2>
      <p className="mt-1 text-sm text-[#748294]">Nhập mã tiệm và số điện thoại đã dùng khi đặt lịch.</p>
      <div className="mt-4 space-y-4">
        <div>
          <label htmlFor="lookup-slug" className={labelCls}>
            Tên tiệm (slug)
          </label>
          <input
            id="lookup-slug"
            value={slugInput}
            onChange={(e) => {
              setSlugInput(e.target.value.trim().toLowerCase());
              setSlug(e.target.value.trim().toLowerCase());
              setBranchId("");
              setSubmitted(null);
            }}
            placeholder="vd: tiem-nail-lan"
            autoCapitalize="off"
            autoCorrect="off"
            className={inputCls}
          />
        </div>
        <div>
          <label htmlFor="lookup-branch" className={labelCls}>
            Chi nhánh (không bắt buộc)
          </label>
          <select
            id="lookup-branch"
            value={branchId}
            onChange={(e) => setBranchId(e.target.value)}
            disabled={slug === "" || branchesQuery.isPending}
            className={inputCls}
          >
            <option value="">Tất cả chi nhánh</option>
            {(branchesQuery.data ?? []).map((b: Branch) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </select>
          {slug !== "" && branchesQuery.isError && <FieldError message="Không tải được chi nhánh của tiệm này." />}
        </div>
        <div>
          <label htmlFor="lookup-phone" className={labelCls}>
            Số điện thoại
          </label>
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#748294]" />
            <input
              id="lookup-phone"
              value={phone}
              onChange={(e) => setPhone(e.target.value.replace(/[^0-9]/g, "").slice(0, 10))}
              placeholder="vd: 0901234567"
              inputMode="tel"
              autoComplete="tel"
              className={`${inputCls} pl-9`}
            />
          </div>
        </div>
        {formError && (
          <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-[#C0392B]">
            {formError}
          </p>
        )}
        <PrimaryButton disabled={slug === "" || phone.trim() === ""} onClick={submitLookup}>
          Tra cứu
        </PrimaryButton>
      </div>

      {submitted !== null && (
        <div className="mt-6">
          {bookingsQuery.isPending && <LoadingBox text="Đang tra cứu lịch hẹn..." />}
          {bookingsQuery.isError && <ErrorBox message="Không tra cứu được. Vui lòng thử lại." onRetry={() => bookingsQuery.refetch()} />}
          {bookingsQuery.data && bookingsQuery.data.length === 0 && (
            <EmptyBox message="Không tìm thấy lịch hẹn nào với số điện thoại này." />
          )}
          <ul className="space-y-2">
            {(bookingsQuery.data ?? []).map((b: MyBooking) => {
              const cancellable = b.status === "pending" || b.status === "confirmed";
              return (
                <li key={b.id} className="rounded-lg border border-[#E5E9ED] bg-white p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-sm font-semibold">{b.branchName}</p>
                      <p className="mt-0.5 text-sm text-[#748294]">{b.serviceNames || "Dịch vụ theo lịch hẹn"}</p>
                      <p className="mt-0.5 text-sm">{b.startAt ? formatDateTime(b.startAt) : "—"}</p>
                      {b.totalPriceVnd != null && <p className="mt-0.5 text-sm font-semibold text-[#244B70]">{formatVnd(b.totalPriceVnd)}</p>}
                    </div>
                    <span
                      className={`shrink-0 rounded-full px-2 py-1 text-xs font-semibold ${
                        b.status === "cancelled"
                          ? "bg-red-50 text-[#C0392B]"
                          : b.status === "completed"
                            ? "bg-green-50 text-[#2E7D5B]"
                            : "bg-yellow-50 text-[#B7791F]"
                      }`}
                    >
                      {BOOKING_STATUS_LABEL[b.status] ?? b.status}
                    </span>
                  </div>
                  {cancellable && (
                    <button
                      type="button"
                      disabled={cancelMutation.isPending}
                      onClick={() => {
                        if (window.confirm("Bạn chắc chắn muốn hủy lịch hẹn này?")) {
                          cancelMutation.mutate({ id: b.id, phone: submitted.phone });
                        }
                      }}
                      className="mt-3 h-11 w-full rounded-lg bg-white text-sm font-semibold text-[#C0392B] ring-1 ring-[#E5E9ED] transition-colors hover:bg-red-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#3979A8] disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {cancelMutation.isPending ? "Đang xử lý..." : "Hủy lịch hẹn này"}
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
          {cancelMutation.isError && (
            <div className="mt-3">
              <ErrorBox message={cancelMutation.error instanceof Error ? cancelMutation.error.message : "Hủy lịch thất bại. Vui lòng thử lại."} />
            </div>
          )}
        </div>
      )}
    </main>
  );
}
