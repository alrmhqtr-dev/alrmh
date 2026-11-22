import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Trash2 } from 'lucide-react';
import { api, errorMessage } from '../lib/api';
import { L, t } from '../lib/i18n';
import { useAuth } from '../lib/auth';
import { weekdays, minuteToTime, timeToMinute } from '../lib/format';
import { Field, Input, Loading, PageHead, useToast, confirmSave } from '../ui';

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
type HomeVisit = { windows: { start: number; end: number }[]; capacity: number; closed_weekdays: number[] };
const windowLabel = (w: { start: number; end: number }) => `${minuteToTime(w.start)}–${minuteToTime(w.end)}`;

function slotsPreview(open: number, close: number, step: number) {
  const out: string[] = [];
  for (let m = open; m + step <= close && out.length < 30; m += step) out.push(minuteToTime(m));
  return out;
}

function Days({ value, onChange, disabled }: { value: number[]; onChange: (v: number[]) => void; disabled?: boolean }) {
  return (
    <div className="chips">
      {weekdays().map((d, i) => {
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
        <Field label={t('First visit from', 'أول زيارة من')}><Input type="time" disabled={disabled} value={minuteToTime(open)} onChange={(e) => onChange({ open: timeToMinute(e.target.value) })} /></Field>
        <Field label={t('Last visit ends by', 'آخر زيارة تنتهي')}><Input type="time" disabled={disabled} value={minuteToTime(close)} onChange={(e) => onChange({ close: timeToMinute(e.target.value) })} /></Field>
        <Field label={t('Slot length (min)', 'مدة الموعد (دقيقة)')}><Input type="number" min={15} max={240} step={15} disabled={disabled} value={step} onChange={(e) => onChange({ step: Number(e.target.value) })} /></Field>
        <Field label={t('Visits per slot', 'زيارات لكل موعد')} hint={t('How many customers at once', 'عدد العملاء في الوقت نفسه')}><Input type="number" min={1} max={50} disabled={disabled} value={capacity} onChange={(e) => onChange({ capacity: Number(e.target.value) })} /></Field>
      </div>
      <div className="small secondary">{t('Customers see:', 'يرى العملاء:')} {preview.length ? preview.join(' · ') : t('no times — check the hours', 'لا أوقات — تحقق من الساعات')}</div>
    </>
  );
}

export default function Branches() {
  const { can } = useAuth();
  const editable = can('manage');
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
      toast(b!.id ? t('Branch saved. New times show in the app now.', 'تم حفظ الفرع وتظهر الأوقات الجديدة في التطبيق.') : t('Branch added. Customers can book there now.', 'تمت إضافة الفرع ويمكن للعملاء الحجز فيه.'));
      if (!b!.id && r?.id) setB({ ...b!, id: r.id });
      qc.invalidateQueries({ queryKey: ['branches'] });
    },
    onError: (e) => toast(errorMessage(e), 'error'),
  });
  const saveHome = useMutation({
    mutationFn: () => api('/settings', { method: 'PATCH', body: { home_visit: h } }),
    onSuccess: () => {
      toast(t('Home visit times saved.', 'تم حفظ أوقات الزيارات المنزلية.'));
      qc.invalidateQueries({ queryKey: ['settings'] });
    },
    onError: (e) => toast(errorMessage(e), 'error'),
  });

  if (!b || !h) return <Loading />;
  const set = (patch: Partial<Branch>) => setB({ ...b, ...patch });

  return (
    <div className="stack lg">
      <PageHead title={t('Branches & visits', 'الفروع والزيارات')} sub={t('Opening details and the measurement times customers can book.', 'بيانات الفروع وأوقات القياس المتاحة للحجز.')} />
      <div className="row wrap" style={{ gap: 8 }}>
        <div className="tabs" role="tablist">
          {(branches.data ?? []).map((x) => (
            <button key={x.id} role="tab" data-testid={`branch-tab-${x.id}`} aria-selected={x.id === b.id} className={x.id === b.id ? 'on' : ''} onClick={() => setB(x)}>
              {L(x)}{x.active ? '' : ` (${t('hidden', 'مخفي')})`}
            </button>
          ))}
          {!b.id ? <button role="tab" aria-selected className="on">{t('New branch', 'فرع جديد')}</button> : null}
        </div>
        {editable && b.id ? (
          <button className="btn secondary" data-testid="add-branch" onClick={() => setB(NEW_BRANCH)}>
            <Plus size={16} /> Add branch
          </button>
        ) : null}
      </div>
      <div className="card pad stack lg">
        <div className="row spread">
          <h2>{b.id ? `${t('Branch', 'فرع')} ${L(b)}` : t('New branch', 'فرع جديد')}</h2>
          {editable ? <button className="btn" data-testid="branch-save" disabled={saveBranch.isPending} onClick={async () => (!b!.id || (await confirmSave())) && saveBranch.mutate()}>{t('Save branch', 'حفظ الفرع')}</button> : null}
        </div>
        <div className="grid k2">
          <Field label={t('Name (English)', 'الاسم (إنجليزي)')}><Input data-testid="branch-name-en" disabled={!editable} value={b.name_en} onChange={(e) => set({ name_en: e.target.value })} /></Field>
          <Field label={t('Name (Arabic)', 'الاسم (عربي)')}><Input data-testid="branch-name-ar" disabled={!editable} dir="rtl" value={b.name_ar} onChange={(e) => set({ name_ar: e.target.value })} /></Field>
          <Field label={t('Address (English)', 'العنوان (إنجليزي)')}><Input data-testid="branch-address-en" disabled={!editable} value={b.address_en} onChange={(e) => set({ address_en: e.target.value })} /></Field>
          <Field label={t('Address (Arabic)', 'العنوان (عربي)')}><Input data-testid="branch-address-ar" disabled={!editable} dir="rtl" value={b.address_ar} onChange={(e) => set({ address_ar: e.target.value })} /></Field>
          <Field label={t('Opening hours shown to customers (English)', 'ساعات العمل للعملاء (إنجليزي)')}><Input data-testid="branch-hours-en" disabled={!editable} value={b.hours_en} onChange={(e) => set({ hours_en: e.target.value })} /></Field>
          <Field label={t('Opening hours (Arabic)', 'ساعات العمل (عربي)')}><Input data-testid="branch-hours-ar" disabled={!editable} dir="rtl" value={b.hours_ar} onChange={(e) => set({ hours_ar: e.target.value })} /></Field>
          <Field label={t('Phone', 'الهاتف')}><Input data-testid="branch-phone" disabled={!editable} value={b.phone} onChange={(e) => set({ phone: e.target.value })} /></Field>
          <Field label={t('WhatsApp', 'واتساب')}><Input data-testid="branch-whatsapp" disabled={!editable} value={b.whatsapp} onChange={(e) => set({ whatsapp: e.target.value })} /></Field>
          <Field label={t('Map position: latitude', 'الموقع: خط العرض')} hint={t('For the Directions button. In Google Maps, right-click the branch and copy the two numbers.', 'لزر الاتجاهات. في خرائط جوجل انقر بالزر الأيمن على الفرع وانسخ الرقمين.')}><Input data-testid="branch-lat" disabled={!editable} type="number" step="any" placeholder="25.2425" value={b.lat ?? ''} onChange={(e) => set({ lat: e.target.value })} /></Field>
          <Field label={t('Map position: longitude', 'الموقع: خط الطول')} hint={t('Blank hides the Directions button.', 'تركه فارغًا يخفي زر الاتجاهات.')}><Input data-testid="branch-lng" disabled={!editable} type="number" step="any" placeholder="51.4520" value={b.lng ?? ''} onChange={(e) => set({ lng: e.target.value })} /></Field>
        </div>
        <label className="check">
          <input type="checkbox" disabled={!editable} checked={b.active} onChange={(e) => set({ active: e.target.checked })} /> Show this branch in the app
        </label>
        <div className="divider" />
        <h3>{t('Branch measurement slots', 'مواعيد القياس في الفرع')}</h3>
        <SlotFields
          disabled={!editable}
          open={b.open_minute}
          close={b.close_minute}
          step={b.slot_minutes}
          capacity={b.slot_capacity}
          onChange={(p) => set({ open_minute: p.open ?? b.open_minute, close_minute: p.close ?? b.close_minute, slot_minutes: p.step ?? b.slot_minutes, slot_capacity: p.capacity ?? b.slot_capacity })}
        />
        <Field label={t('Closed on', 'مغلق يوم')} hint={t('Highlighted days can\'t be booked.', 'الأيام المميزة لا يمكن حجزها.')}><Days disabled={!editable} value={b.closed_weekdays} onChange={(v) => set({ closed_weekdays: v })} /></Field>
      </div>

      <div className="card pad stack lg">
        <div className="row spread">
          <div>
            <h2>{t('Home orders: visit times', 'الطلبات المنزلية: أوقات الزيارة')}</h2>
            <div className="small secondary">{t(`Fee is set under Fees & rules (currently QAR ${settings.data?.home_visit_fee}).`, `الرسوم تُحدد في الرسوم والقواعد (حاليًا ${settings.data?.home_visit_fee} ر.ق).`)}</div>
          </div>
          {editable ? <button className="btn" data-testid="home-save" disabled={saveHome.isPending} onClick={async () => (await confirmSave()) && saveHome.mutate()}>{t('Save home visits', 'حفظ الزيارات المنزلية')}</button> : null}
        </div>
        <div className="stack" style={{ gap: 8 }} data-testid="home-windows">
          <div className="small secondary">{t('Customers book one of these time windows; the tailor arrives within it.', 'يحجز العملاء إحدى هذه الفترات، ويصل الخياط خلالها.')}</div>
          {h.windows.map((w, i) => (
            <div key={i} className="row wrap" style={{ gap: 8, alignItems: 'flex-end' }}>
              <Field label={i ? '' : t('From', 'من')}><Input type="time" disabled={!editable} data-testid={`window-start-${i}`} value={minuteToTime(w.start)} onChange={(e) => setH({ ...h, windows: h.windows.map((x, k) => (k === i ? { ...x, start: timeToMinute(e.target.value) } : x)) })} /></Field>
              <Field label={i ? '' : t('To', 'إلى')}><Input type="time" disabled={!editable} data-testid={`window-end-${i}`} value={minuteToTime(w.end)} onChange={(e) => setH({ ...h, windows: h.windows.map((x, k) => (k === i ? { ...x, end: timeToMinute(e.target.value) } : x)) })} /></Field>
              {editable && h.windows.length > 1 ? (
                <button className="btn ghost icon-btn" aria-label={t('Remove window', 'حذف الفترة')} onClick={() => setH({ ...h, windows: h.windows.filter((_, k) => k !== i) })}><Trash2 size={16} /></button>
              ) : null}
            </div>
          ))}
          {editable && h.windows.length < 8 ? (
            <button className="btn sm secondary" style={{ alignSelf: 'flex-start' }} onClick={() => setH({ ...h, windows: [...h.windows, { start: h.windows.at(-1)?.end ?? 540, end: Math.min(1440, (h.windows.at(-1)?.end ?? 540) + 180) }] })}>
              <Plus size={14} /> {t('Add a window', 'إضافة فترة')}
            </button>
          ) : null}
          <Field label={t('Visits per window', 'زيارات لكل فترة')} hint={t('How many homes the tailors can visit in one window', 'عدد المنازل التي يمكن زيارتها في الفترة الواحدة')}>
            <Input type="number" min={1} max={50} disabled={!editable} style={{ maxWidth: 120 }} value={h.capacity} onChange={(e) => setH({ ...h, capacity: Number(e.target.value) })} />
          </Field>
          <div className="small secondary">{t('Customers see:', 'يرى العملاء:')} {[...h.windows].sort((a, b) => a.start - b.start).map(windowLabel).join(' · ')}</div>
        </div>
        <Field label={t('No home visits on', 'لا زيارات منزلية يوم')}><Days disabled={!editable} value={h.closed_weekdays} onChange={(v) => setH({ ...h, closed_weekdays: v })} /></Field>
      </div>
    </div>
  );
}
