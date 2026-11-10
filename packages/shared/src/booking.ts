// Trạng thái booking + quy tắc chuyển đổi. Nguồn: API_SPEC.md §4, DATABASE_SCHEMA.md §4.
export const BOOKING_STATUSES = [
  "pending",
  "awaiting_deposit",
  "confirmed",
  "checked_in",
  "in_service",
  "completed",
  "cancelled",
  "no_show",
] as const;
export type BookingStatus = (typeof BOOKING_STATUSES)[number];

/** Trạng thái còn "chiếm slot" khi kiểm tra trùng lịch. */
export const BOOKING_ACTIVE_STATUSES: readonly BookingStatus[] = [
  "pending",
  "awaiting_deposit",
  "confirmed",
  "checked_in",
  "in_service",
];

/** Chuyển đổi trạng thái hợp lệ. Còn lại -> server trả 422. */
export const BOOKING_TRANSITIONS: Record<BookingStatus, readonly BookingStatus[]> = {
  pending: ["confirmed", "cancelled"],
  awaiting_deposit: ["confirmed", "cancelled"],
  confirmed: ["checked_in", "cancelled", "no_show"],
  checked_in: ["in_service", "cancelled"],
  in_service: ["completed", "cancelled"],
  completed: [],
  cancelled: [],
  no_show: [],
};

export function canTransitionBooking(from: BookingStatus, to: BookingStatus): boolean {
  return BOOKING_TRANSITIONS[from]?.includes(to) ?? false;
}

/**
 * Kiểm tra trùng lịch: hai khoảng [start,end) trùng nhau khi
 * startA < endB && startB < endA. Chỉ xét booking đang chiếm slot,
 * cùng kỹ thuật viên. Server chạy kiểm tra này trong transaction.
 */
export function bookingsOverlap(
  a: { startAt: string; endAt: string },
  b: { startAt: string; endAt: string },
): boolean {
  return new Date(a.startAt) < new Date(b.endAt) && new Date(b.startAt) < new Date(a.endAt);
}

export function isBookingSlotTaken(
  existing: Array<{ startAt: string; endAt: string; status: BookingStatus }>,
  candidate: { startAt: string; endAt: string },
): boolean {
  return existing
    .filter((b) => BOOKING_ACTIVE_STATUSES.includes(b.status))
    .some((b) => bookingsOverlap(b, candidate));
}
