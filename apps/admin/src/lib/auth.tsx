import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { api, getToken, setToken, setUnauthorizedHandler } from './api';

export type Role = 'owner' | 'manager' | 'tailor' | 'support';
export type Staff = { id: string; email: string; name: string; role: Role; branch_id: string | null };

type Ctx = { staff: Staff | null; ready: boolean; login: (email: string, password: string) => Promise<void>; logout: () => Promise<void>; can: (...roles: Role[]) => boolean };
const AuthContext = createContext<Ctx | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const qc = useQueryClient();
  const [staff, setStaff] = useState<Staff | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    setUnauthorizedHandler(() => {
      setToken(null);
      setStaff(null);
      qc.clear();
    });
    if (!getToken()) return setReady(true);
    api<Staff>('/me')
      .then(setStaff)
      .catch(() => setToken(null))
      .finally(() => setReady(true));
  }, [qc]);

  const login = useCallback(async (email: string, password: string) => {
    const r = await api<{ token: string; staff: Staff }>('/auth/login', { body: { email, password } });
    setToken(r.token);
    setStaff(r.staff);
  }, []);

  const logout = useCallback(async () => {
    try {
      await api('/auth/logout', { method: 'POST' });
    } catch {}
    setToken(null);
    setStaff(null);
    qc.clear();
  }, [qc]);

  const can = useCallback((...roles: Role[]) => Boolean(staff && roles.includes(staff.role)), [staff]);

  return <AuthContext.Provider value={{ staff, ready, login, logout, can }}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('AuthProvider missing');
  return ctx;
}
