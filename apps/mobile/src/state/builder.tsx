import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';

export type MeasureMethod = 'saved' | 'branch' | 'home';
export type HeldAppointment = { id: string; kind: 'branch' | 'home'; startsAt: string };

export type BuilderState = {
  collarId: string | null;
  fabricId: string | null;
  colourId: string | null;
  memberId: string | null;
  method: MeasureMethod | null;
  appointment: HeldAppointment | null;
  remarks: string;
  qty: number;
  reorderFrom: { orderId: string; number: string; date: string } | null;
};

const empty: BuilderState = {
  collarId: null,
  fabricId: null,
  colourId: null,
  memberId: null,
  method: null,
  appointment: null,
  remarks: '',
  qty: 1,
  reorderFrom: null,
};

type Ctx = { state: BuilderState; set: (patch: Partial<BuilderState>) => void; reset: (init?: Partial<BuilderState>) => void };
const BuilderContext = createContext<Ctx | null>(null);

export function BuilderProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<BuilderState>(empty);
  const set = useCallback((patch: Partial<BuilderState>) => setState((s) => ({ ...s, ...patch })), []);
  const reset = useCallback((init?: Partial<BuilderState>) => setState({ ...empty, ...init }), []);
  const value = useMemo<Ctx>(() => ({ state, set, reset }), [state, set, reset]);
  return <BuilderContext.Provider value={value}>{children}</BuilderContext.Provider>;
}

export function useBuilder() {
  const ctx = useContext(BuilderContext);
  if (!ctx) throw new Error('BuilderProvider missing');
  return ctx;
}
