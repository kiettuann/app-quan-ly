// DB helpers — dùng chung cho mọi route Phase 4–7.
export function newId(): string {
  return crypto.randomUUID();
}

export function nowIso(): string {
  return new Date().toISOString();
}

/** Ngày hiện tại dạng YYYY-MM-DD (UTC). */
export function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

export function pagination(c: { req: { query: (k: string) => string | undefined } }): {
  page: number;
  limit: number;
  offset: number;
} {
  const page = Math.max(1, Number.parseInt(c.req.query("page") ?? "1", 10) || 1);
  const limit = Math.min(100, Math.max(1, Number.parseInt(c.req.query("limit") ?? "20", 10) || 20));
  return { page, limit, offset: (page - 1) * limit };
}

export function pageMeta(page: number, limit: number, total: number): {
  page: number;
  limit: number;
  total: number;
  total_pages: number;
} {
  return { page, limit, total, total_pages: Math.max(1, Math.ceil(total / limit)) };
}

export function isValidUuid(v: string | null | undefined): boolean {
  return typeof v === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
}

/** Kỳ lương YYYY-MM của một ngày ISO (dùng cho commission period). */
export function periodOf(iso: string): string {
  return iso.slice(0, 7);
}
