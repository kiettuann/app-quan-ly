// Auth — CONTRACTS.md §5. Token + user lưu localStorage ("ql_token", "ql_user").
// Login trả { token, user? } (kèm expiresAt); nếu thiếu user thì gọi /auth/me.
import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { api, get, post } from "./api.js";
import { DEMO_EMAIL, DEMO_NO_AUTH, DEMO_PASSWORD } from "./demo.js";
import type { Row } from "./types.js";

export interface AuthUser {
  id: string;
  email: string;
  fullName?: string;
  role?: string;
  roleName?: string;
  tenantId?: string | null;
  permissions?: string[];
}

export interface RegisterData {
  tenantName: string;
  phone: string;
  email: string;
  password: string;
  branchName: string;
  branchAddress?: string;
}

interface AuthContextValue {
  token: string | null;
  user: AuthUser | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => void;
  register: (data: RegisterData) => Promise<void>;
  refreshMe: () => Promise<void>;
  /** Chế độ demo: đăng nhập demo tự động thất bại (mất mạng / API lỗi). */
  demoFailed: boolean;
  retryDemoLogin: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

function readStoredUser(): AuthUser | null {
  try {
    const raw = localStorage.getItem("ql_user");
    if (!raw) return null;
    return JSON.parse(raw) as AuthUser;
  } catch {
    return null;
  }
}

function toAuthUser(row: Row): AuthUser {
  const fullName = typeof row.fullName === "string" ? row.fullName : typeof row.full_name === "string" ? row.full_name : undefined;
  const role = typeof row.role === "string" ? row.role : typeof row.roleName === "string" ? row.roleName : undefined;
  return {
    id: String(row.id ?? row.userId ?? ""),
    email: String(row.email ?? ""),
    fullName,
    role,
    roleName: role,
    tenantId: typeof row.tenantId === "string" ? row.tenantId : null,
    permissions: Array.isArray(row.permissions) ? (row.permissions as string[]) : undefined,
  };
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const navigate = useNavigate();
  const [token, setToken] = useState<string | null>(() => localStorage.getItem("ql_token"));
  const [user, setUser] = useState<AuthUser | null>(() => readStoredUser());
  const [loading, setLoading] = useState(false);
  const [demoFailed, setDemoFailed] = useState(false);
  // Chặn đăng nhập demo tự động chạy 2 lần (StrictMode) và chặn vòng lặp
  // thử lại khi API trả 401 liên tục.
  const demoLoginStarted = useRef(false);
  const demoReloginAt = useRef(0);

  const clearSession = useCallback(() => {
    localStorage.removeItem("ql_token");
    localStorage.removeItem("ql_user");
    setToken(null);
    setUser(null);
  }, []);

  const refreshMe = useCallback(async () => {
    const me = await get<Row>("/api/v1/auth/me");
    const u = toAuthUser(me);
    setUser(u);
    localStorage.setItem("ql_user", JSON.stringify(u));
  }, []);

  const login = useCallback(
    async (email: string, password: string) => {
      const data = await post<Row>("/api/v1/auth/login", { email, password });
      const t = typeof data.token === "string" ? data.token : typeof data.sessionToken === "string" ? data.sessionToken : "";
      if (!t) throw new Error("Máy chủ không trả về phiên đăng nhập. Vui lòng thử lại.");
      localStorage.setItem("ql_token", t);
      setToken(t);
      const embedded = data.user && typeof data.user === "object" ? (data.user as Row) : null;
      if (embedded) {
        const u = toAuthUser(embedded);
        setUser(u);
        localStorage.setItem("ql_user", JSON.stringify(u));
      } else {
        try {
          await refreshMe();
        } catch {
          // Token đã lưu; /me sẽ được thử lại ở lần tải trang sau.
        }
      }
    },
    [refreshMe],
  );

  const logout = useCallback(() => {
    // Chế độ demo chưa cần đăng nhập: không có nút đăng xuất nào hiển thị,
    // logout là no-op để app không rơi về màn hình đăng nhập đã ẩn.
    if (DEMO_NO_AUTH) return;
    const t = localStorage.getItem("ql_token");
    if (t) {
      api("/api/v1/auth/logout", { method: "POST" }).catch(() => undefined);
    }
    clearSession();
    navigate("/dang-nhap");
  }, [clearSession, navigate]);

  /** Đăng nhập thầm bằng tài khoản demo (chế độ DEMO_NO_AUTH). */
  const demoLogin = useCallback(() => {
    setDemoFailed(false);
    setLoading(true);
    return login(DEMO_EMAIL, DEMO_PASSWORD)
      .catch(() => {
        setDemoFailed(true);
      })
      .finally(() => setLoading(false));
  }, [login]);

  const retryDemoLogin = useCallback(() => {
    demoLoginStarted.current = false;
    void demoLogin();
  }, [demoLogin]);

  // Chế độ demo: chưa có phiên thì tự đăng nhập tài khoản demo ngay khi mở
  // app, không hiện màn hình đăng nhập. Chế độ thường: không làm gì.
  useEffect(() => {
    if (!DEMO_NO_AUTH || token || demoLoginStarted.current) return;
    demoLoginStarted.current = true;
    void demoLogin();
  }, [token, demoLogin]);

  const register = useCallback(
    async (data: RegisterData) => {
      const res = await post<Row>("/api/v1/tenants", data);
      const t = typeof res.token === "string" ? res.token : "";
      if (t) {
        localStorage.setItem("ql_token", t);
        setToken(t);
        try {
          await refreshMe();
        } catch {
          // Sẽ thử lại sau khi đăng nhập.
        }
        return;
      }
      // Server không trả token: tự đăng nhập bằng tài khoản vừa tạo.
      await login(data.email, data.password);
    },
    [login, refreshMe],
  );

  // Khi có token mà chưa có user (tải lại trang), lấy /me một lần.
  useEffect(() => {
    if (token && !user) {
      setLoading(true);
      refreshMe()
        .catch(() => undefined)
        .finally(() => setLoading(false));
    }
  }, [token, user, refreshMe]);

  // api.ts bắn sự kiện này khi gặp 401.
  // Chế độ demo: phiên hết hạn thì đăng nhập lại thầm bằng tài khoản demo
  // (chống vòng lặp: tối đa 1 lần / 10 giây; thất bại thì hiện màn hình thử
  // lại thay vì quay về /dang-nhap đã ẩn). Chế độ thường: đăng xuất như cũ.
  useEffect(() => {
    const onUnauthorized = () => {
      if (DEMO_NO_AUTH) {
        const now = Date.now();
        if (now - demoReloginAt.current < 10_000) return;
        demoReloginAt.current = now;
        demoLoginStarted.current = true;
        void demoLogin();
        return;
      }
      clearSession();
      navigate("/dang-nhap");
    };
    window.addEventListener("ql:unauthorized", onUnauthorized);
    return () => window.removeEventListener("ql:unauthorized", onUnauthorized);
  }, [clearSession, navigate, demoLogin]);

  return (
    <AuthContext.Provider value={{ token, user, loading, login, logout, register, refreshMe, demoFailed, retryDemoLogin }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth phải dùng trong AuthProvider.");
  return ctx;
}
