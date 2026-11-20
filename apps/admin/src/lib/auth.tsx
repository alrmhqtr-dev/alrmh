import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { api, getToken, setToken, setUnauthorizedHandler } from './api';
import { setLang, type Lang } from './i18n';

export type Role = string;
/** What a role allows; '*' is everything (owner). */
export type Perm = 'workshop' | 'pos' | 'pos.discount' | 'returns' | 'manage' | 'products' | 'purchases' | 'contacts' | 'expenses' | 'reports' | 'audit' | 'staff';
export type Staff = { id: string; email: string; name: string; role: Role; branch_id: string | null; permissions: string[]; language: Lang; role_en?: string; role_ar?: string };

type Ctx = {
  staff: Staff | null;
  ready: boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  /** True when the staff member has at least one of the permissions (or no permission is named). */
  can: (...perms: Perm[]) => boolean;
  switchLanguage: (l: Lang) => Promise<void>;
};
const AuthContext = createContext<Ctx | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const qc = useQueryClient();
  const [staff, setStaff] = useState<Staff | null>(null);
  const [ready, setReady] = useState(false);

  const signedIn = useCallback((s: Staff) => {
    setStaff(s);
    if (s.language) setLang(s.language);
  }, []);

  useEffect(() => {
    setUnauthorizedHandler(() => {
      setToken(null);
      setStaff(null);
      qc.clear();
    });
    if (!getToken()) return setReady(true);
    api<Staff>('/me')
      .then(signedIn)
      .catch(() => setToken(null))
      .finally(() => setReady(true));
  }, [qc, signedIn]);

  const login = useCallback(
    async (email: string, password: string) => {
      const r = await api<{ token: string; staff: Staff }>('/auth/login', { body: { email, password } });
      setToken(r.token);
      signedIn(r.staff);
    },
    [signedIn],
  );

  const logout = useCallback(async () => {
    try {
      await api('/auth/logout', { method: 'POST' });
    } catch {}
    setToken(null);
    setStaff(null);
    qc.clear();
  }, [qc]);

  const can = useCallback((...perms: Perm[]) => Boolean(staff && (!perms.length || staff.permissions.includes('*') || perms.some((p) => staff.permissions.includes(p)))), [staff]);

  const switchLanguage = useCallback(
    async (l: Lang) => {
      setLang(l);
      if (staff) {
        setStaff({ ...staff, language: l });
        await api('/me/language', { body: { language: l } }).catch(() => {});
      }
    },
    [staff],
  );

  return <AuthContext.Provider value={{ staff, ready, login, logout, can, switchLanguage }}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('AuthProvider missing');
  return ctx;
}
