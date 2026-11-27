import { useEffect, useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Pencil, Plus, Ruler } from 'lucide-react';
import { api, errorMessage } from './lib/api';
import { MEASURE_KEYS, date, measureLabel, money, num, phone, RELATION } from './lib/format';
import { t } from './lib/i18n';
import { Field, Input, Loading, Select, TextArea, useToast } from './ui';
import { ClothSelect, MetresInput, StyleRemarks, cleanNotes, drawnStyles, thobePrice, validMetres, type Cloth, type StyleNotes, type StyleOptions } from './thobe-options';
import { ThobePreview } from './thobe-preview';

type Cust = { id: string; name: string | null; phone: string };
type Member = {
  id: string; name: string; relation: string; size: string;
  latest: (Record<string, number> & { id?: string; taken_at: string; tailor_name?: string | null; remarks: string | null }) | null;
  /** The person's last thobe, to start from the same remarks again. */
  last_thobe?: { style_notes?: Record<string, string> | null } | null;
};
type CustomerFull = { family: Member[] };
export type ThobeLineIn = { memberId: string; collarId: string | null; cuffId: string | null; fabricId: string; metres: number; pocket: boolean; styleNotes: StyleNotes | null; qty: number; remarks: string | null };

const blankMeasures = () => Object.fromEntries(MEASURE_KEYS.map((k) => [k, ''])) as Record<string, string>;
const fromLatest = (m: Member) => (m.latest ? Object.fromEntries(MEASURE_KEYS.map((k) => [k, String(Number(m.latest![k]))])) : blankMeasures());

/**
 * Thobes at the counter for the sale's customer. The thobe page: who they're for (with a Measurements
 * button), the cloth and how many, and every collar, cuff and detail with a remarks box.
 * The measurements and the preview have their own screen, opened from that button.
 */
export function ThobeDesk({
  items,
  customer,
  onCustomer,
  onAdd,
}: {
  items: StyleOptions & { fabrics: (Cloth & { stock: number | null })[] };
  customer: Cust | null;
  onCustomer: (c: Cust | null) => void;
  onAdd: (line: ThobeLineIn) => void;
}) {
  const qc = useQueryClient();
  const toast = useToast();
  const [screen, setScreen] = useState<'thobe' | 'measure'>('thobe');
  const [memberId, setMemberId] = useState('');
  const [addMember, setAddMember] = useState<{ name: string; relation: string; size: string } | null>(null);
  const [meas, setMeas] = useState<Record<string, string>>(blankMeasures());
  const [measRemarks, setMeasRemarks] = useState('');
  // Saved measurements are shown, not opened for editing, until staff press Edit.
  const [editing, setEditing] = useState(false);
  const [loadedFor, setLoadedFor] = useState('');
  const [notes, setNotes] = useState<StyleNotes>({});
  const [opt, setOpt] = useState({ fabricId: '', metres: '', qty: '1', remarks: '' });
  const [busy, setBusy] = useState(false);

  const cust = useQuery({ queryKey: ['customer', customer?.id], queryFn: () => api<CustomerFull>(`/customers/${customer!.id}`), enabled: Boolean(customer) });
  const family = cust.data?.family ?? [];
  const member = family.find((m) => m.id === (memberId || family[0]?.id));

  // When the person changes (or their measurements are saved): their measurements, and their last thobe's remarks to start from.
  useEffect(() => {
    const key = member ? `${member.id}:${member.latest?.taken_at ?? ''}` : '';
    if (!member || key === loadedFor) return;
    setMeas(fromLatest(member));
    setMeasRemarks(member.latest?.remarks ?? '');
    setEditing(!member.latest);
    if (!loadedFor.startsWith(`${member.id}:`)) {
      const last = member.last_thobe?.style_notes ?? {};
      setNotes(Object.fromEntries(Object.entries(last).filter(([k]) => k.includes(':'))));
    }
    setLoadedFor(key);
  }, [member, loadedFor]);

  const measured = Boolean(member?.latest);
  const valid = MEASURE_KEYS.every((k) => meas[k].trim() !== '' && Number.isFinite(Number(meas[k])) && Number(meas[k]) >= 0);
  const changed = !member?.latest || MEASURE_KEYS.some((k) => Number(meas[k]) !== Number(member.latest![k])) || (measRemarks.trim() || null) !== (member.latest.remarks ?? null);
  const cloth = items.fabrics.find((f) => f.id === opt.fabricId);
  const drawn = drawnStyles(items, notes);
  const ready = Boolean(member) && measured && opt.fabricId && validMetres(opt.metres) && Number(opt.qty) >= 1;
  const missing = useMemo(
    () => [!measured ? t('measurements', 'المقاسات') : null, !opt.fabricId ? t('cloth', 'القماش') : null].filter(Boolean) as string[],
    [measured, opt.fabricId],
  );

  const saveMeasurements = async () => {
    if (!member) return;
    setBusy(true);
    try {
      await api(`/members/${member.id}/measurements`, { body: { ...Object.fromEntries(MEASURE_KEYS.map((k) => [k, Number(meas[k])])), remarks: measRemarks.trim() || null, method: 'branch' } });
      await qc.invalidateQueries({ queryKey: ['customer', customer!.id] });
      toast(t('Measurements saved.', 'حُفظت المقاسات.'));
      setEditing(false);
      setScreen('thobe');
    } catch (e) {
      toast(errorMessage(e), 'error');
    }
    setBusy(false);
  };
  const add = () => {
    if (!member) return;
    onAdd({
      memberId: member.id,
      collarId: drawn.collar?.id ?? null,
      cuffId: drawn.cuff?.id ?? null,
      fabricId: opt.fabricId,
      metres: Number(opt.metres),
      pocket: drawn.pocket,
      styleNotes: cleanNotes(notes),
      qty: Math.trunc(Number(opt.qty)),
      remarks: opt.remarks.trim() || null,
    });
    toast(t(`${opt.qty} thobe(s) added to the sale.`, `أضيف ${opt.qty} ثوب إلى الفاتورة.`));
    setOpt((o) => ({ ...o, qty: '1', remarks: '' }));
  };
  const saveMember = async () => {
    try {
      const m = await api<{ id: string }>(`/customers/${customer!.id}/members`, { body: addMember });
      await qc.invalidateQueries({ queryKey: ['customer', customer!.id] });
      setMemberId(m.id);
      setAddMember(null);
    } catch (e) {
      toast(errorMessage(e), 'error');
    }
  };

  if (!customer) return null;
  if (!cust.data) return <Loading />;

  /* ---------- measurements: their own screen ---------- */
  if (screen === 'measure' && member)
    return (
      <div className="thobe-desk" data-testid="thobe-measure">
        <div className="card pad stack">
          <div className="row spread">
            <div>
              <h2>{t('Measurements (cm)', 'المقاسات (سم)')}</h2>
              <div className="small secondary"><bdi>{member.name}</bdi> · {RELATION[member.relation]}</div>
            </div>
            <button className="btn sm ghost" data-testid="thobe-m-back" onClick={() => { setMeas(fromLatest(member)); setMeasRemarks(member.latest?.remarks ?? ''); setEditing(!member.latest); setScreen('thobe'); }}>
              <ArrowLeft size={14} className="flip-rtl" /> {t('Back to the thobe', 'رجوع إلى الثوب')}
            </button>
          </div>
          {member.latest && !editing ? (
            <>
              <table className="measure-view" data-testid="thobe-m-view">
                <tbody>
                  {MEASURE_KEYS.map((k) => (
                    <tr key={k}><td className="secondary">{measureLabel(k)}</td><td className="num strong" data-testid={`thobe-m-view-${k}`}>{num(Number(meas[k]))}</td></tr>
                  ))}
                </tbody>
              </table>
              {measRemarks ? <div className="small" style={{ whiteSpace: 'pre-line' }}><span className="secondary">{t('Notes', 'ملاحظات')}:</span> {measRemarks}</div> : null}
              <div className="row spread">
                <span className="small secondary">{t('Taken', 'أُخذت')} {date(member.latest.taken_at)}{member.latest.tailor_name ? ` · ${member.latest.tailor_name}` : ''}</span>
                <button type="button" className="btn sm secondary" data-testid="thobe-m-edit" onClick={() => setEditing(true)}><Pencil size={14} /> {t('Edit', 'تعديل')}</button>
              </div>
            </>
          ) : (
            <>
              <div className="measure-grid">
                {MEASURE_KEYS.map((k) => (
                  <Field key={k} label={measureLabel(k)}>
                    <Input data-testid={`thobe-m-${k}`} type="number" inputMode="decimal" step="any" min={0} value={meas[k]} onChange={(e) => setMeas({ ...meas, [k]: e.target.value })} />
                  </Field>
                ))}
              </div>
              <Field label={t('Measurement notes', 'ملاحظات المقاسات')}>
                <TextArea className="input notes" maxLength={300} value={measRemarks} onChange={(e) => setMeasRemarks(e.target.value)} />
              </Field>
              <div className="row" style={{ justifyContent: 'flex-end', gap: 8 }}>
                {member.latest ? (
                  <button type="button" className="btn ghost" data-testid="thobe-m-cancel" onClick={() => { setMeas(fromLatest(member)); setMeasRemarks(member.latest!.remarks ?? ''); setEditing(false); }}>
                    {t('Cancel changes', 'إلغاء التعديل')}
                  </button>
                ) : null}
                <button className="btn" data-testid="thobe-m-save" disabled={!valid || !changed || busy} onClick={saveMeasurements}>{t('Save measurements', 'حفظ المقاسات')}</button>
              </div>
            </>
          )}
        </div>
        <aside className="thobe-desk-preview">
          <ThobePreview m={meas} collar={drawn.collar} cuff={drawn.cuff} pocket={drawn.pocket} />
        </aside>
      </div>
    );

  /* ---------- the thobe page ---------- */
  return (
    <div className="thobe-desk" data-testid="thobe-desk">
      <div className="stack">
        <div className="card pad stack">
          <div className="row spread">
            <h2>{t('Customer', 'العميل')}</h2>
            <button className="btn sm ghost" data-testid="thobe-change-customer" onClick={() => onCustomer(null)}>{t('Change', 'تغيير')}</button>
          </div>
          <div><bdi className="strong">{customer.name ?? '—'}</bdi> <span className="small muted num">{phone(customer.phone)}</span></div>
          <Field label={t('Thobes for', 'الثياب لـ')}>
            <div className="chips">
              {family.map((m) => (
                <button key={m.id} className={`chip ${member?.id === m.id ? 'on' : ''}`} data-testid={`thobe-member-${m.id}`} onClick={() => setMemberId(m.id)}>
                  {m.name} · {RELATION[m.relation]}
                </button>
              ))}
              <button className="chip" onClick={() => setAddMember({ name: '', relation: 'son', size: 'adult' })}><Plus size={13} /> {t('Person', 'شخص')}</button>
            </div>
          </Field>
          {addMember ? (
            <div className="row wrap" style={{ gap: 8 }}>
              <Input placeholder={t('Name', 'الاسم')} value={addMember.name} onChange={(e) => setAddMember({ ...addMember, name: e.target.value })} style={{ maxWidth: 180 }} autoFocus />
              <Select value={addMember.relation} onChange={(e) => setAddMember({ ...addMember, relation: e.target.value })} style={{ maxWidth: 130 }}>
                {['father', 'son', 'brother', 'friend', 'other'].map((r) => <option key={r} value={r}>{RELATION[r]}</option>)}
              </Select>
              <Select value={addMember.size} onChange={(e) => setAddMember({ ...addMember, size: e.target.value })} style={{ maxWidth: 110 }}>
                <option value="adult">{t('Adult', 'بالغ')}</option>
                <option value="child">{t('Child', 'طفل')}</option>
              </Select>
              <button className="btn sm" disabled={!addMember.name.trim()} onClick={saveMember}>{t('Add', 'إضافة')}</button>
              <button className="btn sm ghost" onClick={() => setAddMember(null)}>{t('Cancel', 'إلغاء')}</button>
            </div>
          ) : null}
          {/* Measurements open on their own screen. */}
          <div className="row spread measure-button-row">
            <button className="btn secondary" data-testid="thobe-measurements" disabled={!member} onClick={() => setScreen('measure')}>
              <Ruler size={16} /> {t('Measurements', 'المقاسات')}
            </button>
            <span className={`small ${measured ? 'secondary' : 'tone-error strong'}`} data-testid="thobe-measured-on">
              {member?.latest ? `${t('Taken', 'أُخذت')} ${date(member.latest.taken_at)}` : t('Not taken yet', 'لم تؤخذ بعد')}
            </span>
          </div>
        </div>

        <div className="card pad stack">
          <h2>{t('Cloth', 'القماش')}</h2>
          <div className="thobe-row">
            <ClothSelect cloths={items.fabrics} value={opt.fabricId} testid="thobe-fabric" onChange={(f) => setOpt({ ...opt, fabricId: f?.id ?? '', metres: f ? Number(f.metres_per_thobe || 3.5).toFixed(2) : '' })} />
            <MetresInput value={opt.metres} onChange={(v) => setOpt({ ...opt, metres: v })} testid="thobe-metres" />
            <Field label={t('Thobes', 'عدد الثياب')}><Input data-testid="thobe-qty" style={{ width: 84 }} type="number" min={1} max={50} value={opt.qty} onChange={(e) => setOpt({ ...opt, qty: e.target.value })} /></Field>
          </div>
          {cloth && validMetres(opt.metres) ? (
            <div className="small secondary" data-testid="thobe-price">
              {num(Number(opt.metres))} {t('m', 'م')} × {money(cloth.price)} = <b className="num">{money(thobePrice(cloth, opt.metres))}</b> {t('a thobe', 'للثوب')}
            </div>
          ) : null}
          <Field label={t('Notes for the tailor', 'ملاحظات للخياط')}>
            <TextArea className="input notes" data-testid="thobe-remarks" maxLength={1000} value={opt.remarks} onChange={(e) => setOpt({ ...opt, remarks: e.target.value })} placeholder={t('e.g. looser sleeves', 'مثال: أكمام أوسع')} />
          </Field>
          <div className="row spread wrap">
            <span className="small tone-error">{missing.length ? `${t('Still needed:', 'مطلوب:')} ${missing.join('، ')}` : ''}</span>
            <button className="btn" data-testid="thobe-add" disabled={!ready} onClick={add}>
              <Plus size={16} /> {t('Add thobes to the sale', 'أضف الثياب إلى الفاتورة')}
            </button>
          </div>
        </div>
      </div>
      {/* Every collar, cuff and detail with its own remarks. The preview is with the measurements, on their own screen. */}
      <aside className="thobe-desk-preview stack">
        <div className="card pad">
          <StyleRemarks options={items} notes={notes} onChange={(k, v) => setNotes((n) => ({ ...n, [k]: v }))} />
        </div>
      </aside>
    </div>
  );
}
