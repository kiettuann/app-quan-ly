// Auth — CONTRACTS.md §5. Token + user lưu localStorage ("ql_token", "ql_user").
// Login trả { token, user? } (kèm expiresAt); nếu thiếu user thì gọi /auth/me.
import { createContext, useCallback, useContext, useEffect, useState } from "react";
import type { ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { api, get, post } from "./api.js";
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
    const t = localStorage.getItem("ql_token");
    if (t) {
      api("/api/v1/auth/logout", { method: "POST" }).catch(() => undefined);
    }
    clearSession();
    navigate("/dang-nhap");
  }, [clearSession, navigate]);

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
  useEffect(() => {
    const onUnauthorized = () => {
      clearSession();
      navigate("/dang-nhap");
    };
    window.addEventListener("ql:unauthorized", onUnauthorized);
    return () => window.removeEventListener("ql:unauthorized", onUnauthorized);
  }, [clearSession, navigate]);

  return (
    <AuthContext.Provider value={{ token, user, loading, login, logout, register, refreshMe }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth phải dùng trong AuthProvider.");
  return ctx;
}
