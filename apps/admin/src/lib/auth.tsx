import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import { ADMIN_TOKEN_KEY, getAdminToken, loginAdmin } from "./api.js";

export interface AdminUser {
  email: string;
  role: string | null;
}

interface AuthContextValue {
  token: string | null;
  user: AdminUser | null;
  login: (email: string, password: string) => Promise<void>;
  logout: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [token, setToken] = useState<string | null>(() => getAdminToken());
  const [user, setUser] = useState<AdminUser | null>(() => {
    try {
      const raw = localStorage.getItem("ql_admin_user");
      return raw ? (JSON.parse(raw) as AdminUser) : null;
    } catch {
      return null;
    }
  });

  const login = useCallback(async (email: string, password: string) => {
    const result = await loginAdmin(email, password);
    try {
      localStorage.setItem(ADMIN_TOKEN_KEY, result.token);
      localStorage.setItem("ql_admin_user", JSON.stringify(result.user));
    } catch {
      // bỏ qua lỗi lưu trữ
    }
    setToken(result.token);
    setUser(result.user);
  }, []);

  const logout = useCallback(() => {
    try {
      localStorage.removeItem(ADMIN_TOKEN_KEY);
      localStorage.removeItem("ql_admin_user");
    } catch {
      // bỏ qua
    }
    setToken(null);
    setUser(null);
  }, []);

  const value = useMemo(() => ({ token, user, login, logout }), [token, user, login, logout]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth phải dùng trong AuthProvider.");
  return ctx;
}
