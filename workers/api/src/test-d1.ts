// Test-only D1 adapter: chạy migration SQL thật trên SQLite thật (node:sqlite)
// để test API end-to-end mà không cần Wrangler/Miniflare.
// Chỉ implement đúng tập API D1 mà code dùng: prepare().bind().first()/all()/run()
// và db.batch(). Không dùng ở production.
import { DatabaseSync } from "node:sqlite";

type Row = Record<string, unknown>;

// Không implement D1PreparedStatement trực tiếp (generics của nó quá chặt);
// bên dưới ép kiểu qua `as unknown as D1PreparedStatement` ở createTestDb.
class TestStatement {
  constructor(
    private readonly db: DatabaseSync,
    private readonly sql: string,
    private params: unknown[] = [],
  ) {}

  bind(...params: unknown[]): TestStatement {
    return new TestStatement(this.db, this.sql, params);
  }

  first<T = Row>(colName?: string): Promise<T | null> {
    const stmt = this.db.prepare(this.sql);
    const row = stmt.get(...(this.params as never[])) as Row | undefined;
    if (!row) return Promise.resolve(null);
    if (colName) return Promise.resolve(row[colName] as T);
    return Promise.resolve(row as T);
  }

  all<T = Row>(): Promise<D1Result<T>> {
    const stmt = this.db.prepare(this.sql);
    const results = stmt.all(...(this.params as never[])) as T[];
    return Promise.resolve({ results, success: true, meta: {} as D1Result<T>["meta"] });
  }

  run(): Promise<D1Result> {
    const stmt = this.db.prepare(this.sql);
    const info = stmt.run(...(this.params as never[]));
    return Promise.resolve({
      results: [],
      success: true,
      meta: { changes: info.changes, last_row_id: Number(info.lastInsertRowid) } as D1Result["meta"],
    });
  }
}

/** Tạo DB test từ các file migration SQL (chạy tuần tự, giống wrangler apply). */
export function createTestDb(migrationSqls: string[]): D1Database {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec("PRAGMA foreign_keys = ON;");
  for (const sql of migrationSqls) {
    // Bỏ dòng PRAGMA (đã bật ở trên) rồi chạy toàn bộ file.
    const cleaned = sql
      .split("\n")
      .filter((l) => !l.trim().startsWith("PRAGMA"))
      .join("\n");
    sqlite.exec(cleaned);
  }
  const db = {
    prepare: (sql: string) => new TestStatement(sqlite, sql) as unknown as D1PreparedStatement,
    batch: async (statements: D1PreparedStatement[]) => {
      const out: D1Result[] = [];
      for (const s of statements) out.push(await s.run());
      return out;
    },
    exec: async (sql: string) => {
      sqlite.exec(sql);
      return { count: 0, duration: 0 };
    },
  } as unknown as D1Database;
  return db;
}
