// Zod helpers dùng chung. Tiền integer VND, SĐT Việt Nam, ISO datetime.
import { z } from "zod";

export const vndInt = z.number().int("Số tiền phải là số nguyên VND").min(0, "Số tiền không được âm");

export const vndPositive = z
  .number()
  .int("Số tiền phải là số nguyên VND")
  .positive("Số tiền phải lớn hơn 0");

export const phoneVn = z
  .string()
  .trim()
  .regex(/^0\d{9}$/, "Số điện thoại phải có 10 số, bắt đầu bằng 0 (vd 0901234567)");

export const isoDateTime = z
  .string()
  .refine((v) => !Number.isNaN(Date.parse(v)), "Thời gian phải đúng định dạng ISO 8601");

export const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Ngày phải đúng định dạng YYYY-MM-DD");

export const paginationQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});
