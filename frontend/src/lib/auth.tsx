import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { api, ApiError, clearAuth, getStoredToken, getStoredUser, setAuth, type User } from './api';
import { phoneEmail, supabase } from './supabase';

type AuthState = {
  user: User | null;
  token: string | null;
  login: (phone: string, password: string) => Promise<User>;
  logout: () => void;
  refreshMe: () => Promise<void>;
  switchBusiness: (businessId: string) => Promise<void>;
};

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const stored = getStoredUser();
  const [user, setUser] = useState<User | null>(stored);
  const [token, setToken] = useState<string | null>(getStoredToken());

  const login = useCallback(async (phone: string, password: string) => {
    // A fresh sign-in starts in the shop used most recently.
    sessionStorage.removeItem('op_business');
    let res: { token: string; user: User };
    if (supabase) {
      const { data, error } = await supabase.auth.signInWithPassword({ email: phoneEmail(phone), password });
      if (error || !data.session) throw new ApiError(401, 'Invalid phone or password');
      const r = await api<{ user: User }>('/auth/login', { method: 'POST', body: '{}' });
      res = { token: data.session.access_token, user: r.user };
    } else {
      res = await api<{ token: string; user: User }>('/auth/login', {
        method: 'POST',
        body: JSON.stringify({ phone, password }),
      });
    }
    setAuth(res.token, res.user);
    // A password sign-in starts unlocked (see components/PinLock.tsx).
    sessionStorage.setItem('op_last_active', String(Date.now()));
    sessionStorage.removeItem('op_locked');
    setUser(res.user);
    setToken(res.token);
    return res.user;
  }, []);

  const logout = useCallback(() => {
    void supabase?.auth.signOut();
    clearAuth();
    sessionStorage.removeItem('op_last_active');
    sessionStorage.removeItem('op_locked');
    setUser(null);
    setToken(null);
  }, []);

  const refreshMe = useCallback(async () => {
    const storedToken = getStoredToken();
    if (!storedToken) return;
    const me = await api<User & { customerId?: string }>('/auth/me');
    const u: User = {
      id: me.id,
      name: me.name,
      phone: me.phone,
      role: me.role,
      businessId: me.businessId,
      customerId: me.customerId,
      staffRole: me.staffRole,
      businessName: me.businessName,
      businessCount: me.businessCount,
    };
    setAuth(storedToken, u);
    setUser(u);
  }, []);

  /** Moves this tab to another shop on the same account, then reloads so no old shop data stays on screen. */
  const switchBusiness = useCallback(async (businessId: string) => {
    const storedToken = getStoredToken();
    if (!storedToken) return;
    const previous = sessionStorage.getItem('op_business');
    sessionStorage.setItem('op_business', businessId);
    try {
      const me = await api<User>('/auth/switch', { method: 'POST', body: '{}' });
      setAuth(storedToken, {
        id: me.id,
        name: me.name,
        phone: me.phone,
        role: me.role,
        businessId: me.businessId,
        customerId: me.customerId,
        staffRole: me.staffRole,
        businessName: me.businessName,
        businessCount: me.businessCount,
      });
      sessionStorage.removeItem('op-seller-customer');
      window.location.hash = me.role === 'SELLER' ? '#/seller' : '#/customer';
      window.location.reload();
    } catch (e) {
      if (previous) sessionStorage.setItem('op_business', previous);
      throw e;
    }
  }, []);

  const value = useMemo(
    () => ({ user, token, login, logout, refreshMe, switchBusiness }),
    [user, token, login, logout, refreshMe, switchBusiness]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth outside provider');
  return ctx;
}
