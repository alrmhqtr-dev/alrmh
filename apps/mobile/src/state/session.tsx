import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { api, setToken, setUnauthorizedHandler } from '@/api/client';
import { storage } from '@/lib/storage';
import { relinkPush, unlinkPush } from '@/lib/push';

type Ctx = {
  ready: boolean;
  signedIn: boolean;
  guest: boolean;
  returnTo: string | null;
  signIn: (token: string) => Promise<void>;
  signOut: () => Promise<void>;
  browseAsGuest: () => Promise<void>;
  setReturnTo: (path: string | null) => void;
};

const SessionContext = createContext<Ctx | null>(null);

export function SessionProvider({ children }: { children: ReactNode }) {
  const qc = useQueryClient();
  const [ready, setReady] = useState(false);
  const [signedIn, setSignedIn] = useState(false);
  const [guest, setGuest] = useState(false);
  const [returnTo, setReturnTo] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([storage.get('alrmh.token'), storage.get('alrmh.guest')]).then(([t, g]) => {
      if (t) {
        setToken(t);
        setSignedIn(true);
      }
      setGuest(g === '1');
      setReady(true);
    });
  }, []);

  const signOut = useCallback(async () => {
    await unlinkPush();
    try {
      await api('/auth/logout', { method: 'POST' });
    } catch {}
    setToken(null);
    await storage.set('alrmh.token', null);
    setSignedIn(false);
    qc.clear();
  }, [qc]);

  useEffect(() => {
    setUnauthorizedHandler(() => {
      setToken(null);
      storage.set('alrmh.token', null);
      setSignedIn(false);
      qc.clear();
    });
  }, [qc]);

  const signIn = useCallback(
    async (token: string) => {
      setToken(token);
      await storage.set('alrmh.token', token);
      await storage.set('alrmh.guest', null);
      setGuest(false);
      setSignedIn(true);
      qc.invalidateQueries();
      relinkPush();
    },
    [qc],
  );

  const browseAsGuest = useCallback(async () => {
    await storage.set('alrmh.guest', '1');
    setGuest(true);
  }, []);

  const value = useMemo(
    () => ({ ready, signedIn, guest, returnTo, signIn, signOut, browseAsGuest, setReturnTo }),
    [ready, signedIn, guest, returnTo, signIn, signOut, browseAsGuest],
  );
  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession() {
  const ctx = useContext(SessionContext);
  if (!ctx) throw new Error('SessionProvider missing');
  return ctx;
}
