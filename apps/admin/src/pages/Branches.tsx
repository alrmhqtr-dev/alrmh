import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
import { api, errorMessage } from '../lib/api';
import { useAuth } from '../lib/auth';
import { WEEKDAYS, minuteToTime, timeToMinute } from '../lib/format';
import { Field, Input, Loading, PageHead, useToast } from '../ui';

type Branch = {
  id: string;
  name_en: string;
  name_ar: string;
  address_en: string;
  address_ar: string;
  phone: string;
  whatsapp: string;
  hours_en: string;
  hours_ar: string;
  open_minute: number;
  close_minute: number;
  slot_minutes: number;
  slot_capacity: number;
  closed_weekdays: number[];
  active: boolean;
  lat: number | string | null;
  lng: number | string | null;
};
const NEW_BRANCH: Branch = { id: '', name_en: '', name_ar: '', address_en: '', address_ar: '', phone: '', whatsapp: '', hours_en: '', hours_ar: '', open_minute: 960, close_minute: 1260, slot_minutes: 60, slot_capacity: 2, closed_weekdays: [5], active: true, lat: null, lng: null };
type HomeVisit = { open_minute: number; close_minute: number; slot_minutes: number; capacity: number; closed_weekdays: number[] };

function slotsPreview(open: number, close: number, step: number) {
  const out: string[] = [];
  for (let m = open; m + step <= close && out.length < 30; m += step) out.push(minuteToTime(m));
  return out;
}

function Days({ value, onChange, disabled }: { value: number[]; onChange: (v: number[]) => void; disabled?: boolean }) {
  return (
    <div className="chips">
      {WEEKDAYS.map((d, i) => {
        const closed = value.includes(i);
        return (
          <button key={d} type="button" disabled={disabled} className={`chip ${closed ? 'on' : ''}`} onClick={() => onChange(closed ? value.filter((x) => x !== i) : [...value, i].sort())}>
            {d}
          </button>
        );
      })}
    </div>
  );
}

function SlotFields({ open, close, step, capacity, onChange, disabled }: { open: number; close: number; step: number; capacity: number; onChange: (patch: Record<string, number>) => void; disabled?: boolean }) {
  const preview = slotsPreview(open, close, step);
  return (
    <>
      <div className="grid k4">
        <Field label="First visit from"><Input type="time" disabled={disabled} value={minuteToTime(open)} onChange={(e) => onChange({ open: timeToMinute(e.target.value) })} /></Field>
        <Field label="Last visit ends by"><Input type="time" disabled={disabled} value={minuteToTime(close)} onChange={(e) => onChange({ close: timeToMinute(e.target.value) })} /></Field>
        <Field label="Slot length (min)"><Input type="number" min={15} max={240} step={15} disabled={disabled} value={step} onChange={(e) => onChange({ step: Number(e.target.value) })} /></Field>
        <Field label="Visits per slot" hint="How many customers at once"><Input type="number" min={1} max={50} disabled={disabled} value={capacity} onChange={(e) => onChange({ capacity: Number(e.target.value) })} /></Field>
      </div>
      <div className="small secondary">Customers see: {preview.length ? preview.join(' · ') : 'no times — check the hours'}</div>
    </>
  );
}

export default function Branches() {
  const { can } = useAuth();
  const editable = can('owner', 'manager');
  const qc = useQueryClient();
  const toast = useToast();
  const branches = useQuery({ queryKey: ['branches'], queryFn: () => api<Branch[]>('/branches') });
  const settings = useQuery({ queryKey: ['settings'], queryFn: () => api<{ home_visit: HomeVisit; home_visit_fee: number }>('/settings') });
  const [b, setB] = useState<Branch | null>(null);
  const [h, setH] = useState<HomeVisit | null>(null);
  useEffect(() => {
    if (branches.data?.[0] && !b) setB(branches.data[0]);
  }, [branches.data, b]);
  useEffect(() => {
    if (settings.data && !h) setH(settings.data.home_visit);
  }, [settings.data, h]);

  const saveBranch = useMutation({
    mutationFn: () => (b!.id ? api(`/branches/${b!.id}`, { method: 'PATCH', body: b }) : api<{ id: string }>('/branches', { body: b })),
    onSuccess: (r: any) => {
      toast(b!.id ? 'Branch saved. New times show in the app now.' : 'Branch added. Customers can book there now.');
      if (!b!.id && r?.id) setB({ ...b!, id: r.id });
      qc.invalidateQueries({ queryKey: ['branches'] });
    },
    onError: (e) => toast(errorMessage(e), 'error'),
  });
  const saveHome = useMutation({
    mutationFn: () => api('/settings', { method: 'PATCH', body: { home_visit: h } }),
    onSuccess: () => {
      toast('Home visit times saved.');
      qc.invalidateQueries({ queryKey: ['settings'] });
    },
    onError: (e) => toast(errorMessage(e), 'error'),
  });

  if (!b || !h) return <Loading />;
  const set = (patch: Partial<Branch>) => setB({ ...b, ...patch });

  return (
    <div className="stack lg">
      <PageHead title="Branches & visits" sub="Opening details and the measurement times customers can book." />
      <div className="row wrap" style={{ gap: 8 }}>
        <div className="tabs" role="tablist">
          {(branches.data ?? []).map((x) => (
            <button key={x.id} role="tab" data-testid={`branch-tab-${x.id}`} aria-selected={x.id === b.id} className={x.id === b.id ? 'on' : ''} onClick={() => setB(x)}>
              {x.name_en}{x.active ? '' : ' (hidden)'}
            </button>
          ))}
          {!b.id ? <button role="tab" aria-selected className="on">New branch</button> : null}
        </div>
        {editable && b.id ? (
          <button className="btn secondary" data-testid="add-branch" onClick={() => setB(NEW_BRANCH)}>
            <Plus size={16} /> Add branch
          </button>
        ) : null}
      </div>
      <div className="card pad stack lg">
        <div className="row spread">
          <h2>{b.id ? `${b.name_en} branch` : 'New branch'}</h2>
          {editable ? <button className="btn" data-testid="branch-save" disabled={saveBranch.isPending} onClick={() => saveBranch.mutate()}>Save branch</button> : null}
        </div>
        <div className="grid k2">
          <Field label="Name (English)"><Input data-testid="branch-name-en" disabled={!editable} value={b.name_en} onChange={(e) => set({ name_en: e.target.value })} /></Field>
          <Field label="Name (Arabic)"><Input data-testid="branch-name-ar" disabled={!editable} dir="rtl" value={b.name_ar} onChange={(e) => set({ name_ar: e.target.value })} /></Field>
          <Field label="Address (English)"><Input data-testid="branch-address-en" disabled={!editable} value={b.address_en} onChange={(e) => set({ address_en: e.target.value })} /></Field>
          <Field label="Address (Arabic)"><Input data-testid="branch-address-ar" disabled={!editable} dir="rtl" value={b.address_ar} onChange={(e) => set({ address_ar: e.target.value })} /></Field>
          <Field label="Opening hours shown to customers (English)"><Input data-testid="branch-hours-en" disabled={!editable} value={b.hours_en} onChange={(e) => set({ hours_en: e.target.value })} /></Field>
          <Field label="Opening hours (Arabic)"><Input data-testid="branch-hours-ar" disabled={!editable} dir="rtl" value={b.hours_ar} onChange={(e) => set({ hours_ar: e.target.value })} /></Field>
          <Field label="Phone"><Input data-testid="branch-phone" disabled={!editable} value={b.phone} onChange={(e) => set({ phone: e.target.value })} /></Field>
          <Field label="WhatsApp"><Input data-testid="branch-whatsapp" disabled={!editable} value={b.whatsapp} onChange={(e) => set({ whatsapp: e.target.value })} /></Field>
          <Field label="Map position: latitude" hint="For the Directions button. In Google Maps, right-click the branch and copy the two numbers."><Input data-testid="branch-lat" disabled={!editable} type="number" step="any" placeholder="25.2425" value={b.lat ?? ''} onChange={(e) => set({ lat: e.target.value })} /></Field>
          <Field label="Map position: longitude" hint="Blank hides the Directions button."><Input data-testid="branch-lng" disabled={!editable} type="number" step="any" placeholder="51.4520" value={b.lng ?? ''} onChange={(e) => set({ lng: e.target.value })} /></Field>
        </div>
        <label className="check">
          <input type="checkbox" disabled={!editable} checked={b.active} onChange={(e) => set({ active: e.target.checked })} /> Show this branch in the app
        </label>
        <div className="divider" />
        <h3>Branch measurement slots</h3>
        <SlotFields
          disabled={!editable}
          open={b.open_minute}
          close={b.close_minute}
          step={b.slot_minutes}
          capacity={b.slot_capacity}
          onChange={(p) => set({ open_minute: p.open ?? b.open_minute, close_minute: p.close ?? b.close_minute, slot_minutes: p.step ?? b.slot_minutes, slot_capacity: p.capacity ?? b.slot_capacity })}
        />
        <Field label="Closed on" hint="Highlighted days can't be booked."><Days disabled={!editable} value={b.closed_weekdays} onChange={(v) => set({ closed_weekdays: v })} /></Field>
      </div>

      <div className="card pad stack lg">
        <div className="row spread">
          <div>
            <h2>Home visits</h2>
            <div className="small secondary">Fee is set under Fees & rules (currently QAR {settings.data?.home_visit_fee}).</div>
          </div>
          {editable ? <button className="btn" data-testid="home-save" disabled={saveHome.isPending} onClick={() => saveHome.mutate()}>Save home visits</button> : null}
        </div>
        <SlotFields
          disabled={!editable}
          open={h.open_minute}
          close={h.close_minute}
          step={h.slot_minutes}
          capacity={h.capacity}
          onChange={(p) => setH({ ...h, open_minute: p.open ?? h.open_minute, close_minute: p.close ?? h.close_minute, slot_minutes: p.step ?? h.slot_minutes, capacity: p.capacity ?? h.capacity })}
        />
        <Field label="No home visits on"><Days disabled={!editable} value={h.closed_weekdays} onChange={(v) => setH({ ...h, closed_weekdays: v })} /></Field>
      </div>
    </div>
  );
}
