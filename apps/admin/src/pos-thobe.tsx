import { useEffect, useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Pencil, Plus, Search, UserPlus } from 'lucide-react';
import { api, errorMessage } from './lib/api';
import { MEASURE_KEYS, date, measureLabel, money, num, phone, RELATION } from './lib/format';
import { t } from './lib/i18n';
import { Field, Input, Loading, Select, TextArea, useToast } from './ui';
import { ClothSelect, MetresInput, StyleWithNote, thobePrice, validMetres, type Cloth, type Style } from './thobe-options';
import { ThobePreview } from './thobe-preview';

type Cust = { id: string; name: string | null; phone: string };
type Member = {
  id: string; name: string; relation: string; size: string;
  latest: (Record<string, number> & { id?: string; taken_at: string; tailor_name?: string | null; remarks: string | null }) | null;
  /** The styles of the person's last thobe, to start from the same again. */
  last_thobe?: { collar?: { id: string } | null; cuff?: { id: string } | null; pocket?: boolean } | null;
};
type CustomerFull = { family: Member[] };
export type StyleNotes = { collar?: string; cuff?: string; pocket?: string };
export type ThobeLineIn = { memberId: string; collarId: string; cuffId: string | null; fabricId: string; metres: number; pocket: boolean; styleNotes: StyleNotes | null; qty: number; remarks: string | null };

const blankMeasures = () => Object.fromEntries(MEASURE_KEYS.map((k) => [k, ''])) as Record<string, string>;
const POCKET: Style[] = [
  { id: 'no', name_en: 'No pocket', name_ar: 'بدون جيب', image_url: null },
  { id: 'yes', name_en: 'Chest pocket', name_ar: 'جيب صدر', image_url: `${window.location.origin}/thobe/pocket.png` },
];

/**
 * Thobes at the counter, on one page: who they are for (a new customer or an existing one),
 * their measurements, collar, cuff, pocket and cloth, with a live preview beside them.
 */
export function ThobeDesk({
  items,
  customer,
  onCustomer,
  onAdd,
}: {
  items: { collars: Style[]; cuffs: Style[]; fabrics: (Cloth & { stock: number | null })[] };
  customer: Cust | null;
  onCustomer: (c: Cust | null) => void;
  onAdd: (line: ThobeLineIn) => void;
}) {
  const qc = useQueryClient();
  const toast = useToast();
  const [mode, setMode] = useState<'choose' | 'new' | 'existing'>('choose');
  const [newCust, setNewCust] = useState({ name: '', phone: '' });
  const [q, setQ] = useState('');
  const [memberId, setMemberId] = useState('');
  const [addMember, setAddMember] = useState<{ name: string; relation: string; size: string } | null>(null);
  const [meas, setMeas] = useState<Record<string, string>>(blankMeasures());
  const [measRemarks, setMeasRemarks] = useState('');
  // An existing person's measurements are shown, not opened for editing, until staff press Edit.
  const [editing, setEditing] = useState(false);
  const [loadedFor, setLoadedFor] = useState('');
  const [opt, setOpt] = useState({ collarId: '', cuffId: '', pocket: 'no', fabricId: '', metres: '', qty: '1', remarks: '', collarNote: '', cuffNote: '', pocketNote: '' });
  const [busy, setBusy] = useState(false);

  const found = useQuery({ queryKey: ['pos-customers', q], queryFn: () => api<Cust[]>(`/customers?q=${encodeURIComponent(q)}`), enabled: mode === 'existing' && !customer && q.trim().length >= 2 });
  const cust = useQuery({ queryKey: ['customer', customer?.id], queryFn: () => api<CustomerFull>(`/customers/${customer!.id}`), enabled: Boolean(customer) });
  const family = cust.data?.family ?? [];
  const member = family.find((m) => m.id === (memberId || family[0]?.id));

  // An existing person's last measurements fill the form; staff change only what changed.
  useEffect(() => {
    const key = member ? `${member.id}:${member.latest?.taken_at ?? ''}` : '';
    if (!member || key === loadedFor) return;
    setMeas(member.latest ? Object.fromEntries(MEASURE_KEYS.map((k) => [k, String(Number(member.latest![k]))])) : blankMeasures());
    setMeasRemarks(member.latest?.remarks ?? '');
    setEditing(false);
    // Start from the styles of their last thobe, if those styles are still offered.
    const last = member.last_thobe;
    if (last) {
      setOpt((o) => ({
        ...o,
        collarId: last.collar && items.collars.some((c) => c.id === last.collar!.id) ? last.collar.id : o.collarId,
        cuffId: last.cuff && items.cuffs.some((c) => c.id === last.cuff!.id) ? last.cuff.id : o.cuffId,
        pocket: last.pocket ? 'yes' : 'no',
      }));
    }
    setLoadedFor(key);
  }, [member, loadedFor, items]);
  // Back to the two cards when the customer is removed from the sale.
  useEffect(() => {
    if (!customer) {
      setMemberId('');
      setLoadedFor('');
    }
  }, [customer]);

  const measured = MEASURE_KEYS.every((k) => meas[k].trim() !== '' && Number.isFinite(Number(meas[k])) && Number(meas[k]) >= 0);
  const changed = !member?.latest || MEASURE_KEYS.some((k) => Number(meas[k]) !== Number(member.latest![k])) || (measRemarks.trim() || null) !== (member.latest.remarks ?? null);
  const cloth = items.fabrics.find((f) => f.id === opt.fabricId);
  const collar = items.collars.find((c) => c.id === opt.collarId);
  const cuff = items.cuffs.find((c) => c.id === opt.cuffId);
  const who = customer ? Boolean(member) : newCust.name.trim().length > 0 && newCust.phone.replace(/\D/g, '').length >= 8;
  const ready = who && measured && opt.collarId && (!items.cuffs.length || opt.cuffId) && opt.fabricId && validMetres(opt.metres) && Number(opt.qty) >= 1;
  const missing = useMemo(
    () =>
      [
        !who ? (customer ? t('who it is for', 'لمن') : t('name and mobile', 'الاسم والجوال')) : null,
        !measured ? t('all seven measurements', 'المقاسات السبعة') : null,
        !opt.collarId ? t('collar', 'الياقة') : null,
        items.cuffs.length && !opt.cuffId ? t('cuff', 'الكبك') : null,
        !opt.fabricId ? t('cloth', 'القماش') : null,
      ].filter(Boolean) as string[],
    [who, measured, opt, items.cuffs.length, customer],
  );

  const styleNotes = (): StyleNotes | null => {
    const n: StyleNotes = {};
    if (opt.collarNote.trim()) n.collar = opt.collarNote.trim();
    if (opt.cuffNote.trim()) n.cuff = opt.cuffNote.trim();
    if (opt.pocketNote.trim()) n.pocket = opt.pocketNote.trim();
    return Object.keys(n).length ? n : null;
  };
  const values = () => ({ ...Object.fromEntries(MEASURE_KEYS.map((k) => [k, Number(meas[k])])), remarks: measRemarks.trim() || null });
  const add = async () => {
    setBusy(true);
    try {
      let target: Member | undefined = member;
      if (!customer) {
        // New customer: name, mobile and these measurements are saved together.
        const c = await api<Cust & { existing?: boolean }>('/customers', { body: { name: newCust.name.trim(), phone: newCust.phone, measurements: values() } });
        const full = await api<CustomerFull>(`/customers/${c.id}`);
        qc.setQueryData(['customer', c.id], full);
        target = full.family.find((m) => m.relation === 'self') ?? full.family[0];
        if (c.existing && target) {
          await api(`/members/${target.id}/measurements`, { body: { ...values(), method: 'branch' } });
          toast(t('This mobile already had an account: the thobes and measurements were added to it.', 'لهذا الرقم حساب مسبق: أضيفت الثياب والمقاسات إليه.'));
        }
        onCustomer({ id: c.id, name: c.name, phone: c.phone });
        setMemberId(target?.id ?? '');
        setLoadedFor(target ? `${target.id}:` : '');
        setNewCust({ name: '', phone: '' });
      } else if (target && changed) {
        // New or changed measurements are kept as the person's latest.
        await api(`/members/${target.id}/measurements`, { body: { ...values(), method: 'branch' } });
      }
      if (!target) throw new Error(t('Choose who the thobes are for.', 'اختر لمن الثياب.'));
      qc.invalidateQueries({ queryKey: ['customer'] });
      onAdd({ memberId: target.id, collarId: opt.collarId, cuffId: opt.cuffId || null, fabricId: opt.fabricId, metres: Number(opt.metres), pocket: opt.pocket === 'yes', styleNotes: styleNotes(), qty: Math.trunc(Number(opt.qty)), remarks: opt.remarks.trim() || null });
      toast(t(`${opt.qty} thobe(s) added to the sale.`, `أضيف ${opt.qty} ثوب إلى الفاتورة.`));
      setOpt((o) => ({ ...o, qty: '1', remarks: '', collarNote: '', cuffNote: '', pocketNote: '' }));
    } catch (e) {
      toast(errorMessage(e), 'error');
    }
    setBusy(false);
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

  /* ---------- first: new or existing ---------- */
  if (!customer && mode === 'choose')
    return (
      <div className="choice-cards" data-testid="thobe-choose">
        <button className="choice-card" data-testid="thobe-new" onClick={() => setMode('new')}>
          <UserPlus size={34} strokeWidth={1.6} />
          <span className="h2">{t('New customer', 'عميل جديد')}</span>
          <span className="small secondary">{t('Name, mobile and measurements', 'الاسم والجوال والمقاسات')}</span>
        </button>
        <button className="choice-card" data-testid="thobe-existing" onClick={() => setMode('existing')}>
          <Search size={34} strokeWidth={1.6} />
          <span className="h2">{t('Existing customer', 'عميل حالي')}</span>
          <span className="small secondary">{t('Find by mobile or name', 'ابحث بالجوال أو الاسم')}</span>
        </button>
      </div>
    );

  if (!customer && mode === 'existing')
    return (
      <div className="card pad stack">
        <div className="row spread">
          <h2>{t('Existing customer', 'عميل حالي')}</h2>
          <button className="btn sm ghost" onClick={() => setMode('choose')}><ArrowLeft size={14} className="flip-rtl" /> {t('Back', 'رجوع')}</button>
        </div>
        <Input data-testid="thobe-find" placeholder={t('Mobile or name', 'الجوال أو الاسم')} value={q} onChange={(e) => setQ(e.target.value)} autoFocus />
        {q.trim().length >= 2 ? (
          found.data ? (
            found.data.length ? (
              <div className="stack" style={{ gap: 4 }}>
                {found.data.slice(0, 10).map((c) => (
                  <button key={c.id} className="btn ghost" data-testid={`thobe-pick-${c.phone}`} style={{ width: '100%', justifyContent: 'space-between' }} onClick={() => { onCustomer(c); setQ(''); }}>
                    <span>{c.name ?? '—'}</span>
                    <span className="small muted num">{phone(c.phone)}</span>
                  </button>
                ))}
              </div>
            ) : (
              <div className="note">
                {t('No customer found.', 'لا يوجد عميل.')} <button className="linklike strong" onClick={() => { setNewCust({ name: '', phone: /^\d+$/.test(q.trim()) ? q.trim() : '' }); setMode('new'); }}>{t('Add as a new customer', 'أضفه عميلًا جديدًا')}</button>
              </div>
            )
          ) : <Loading />
        ) : <div className="small muted">{t('Type at least two letters or digits.', 'اكتب حرفين أو رقمين على الأقل.')}</div>}
      </div>
    );

  if (customer && !cust.data) return <Loading />;

  /* ---------- the thobe page ---------- */
  return (
    <div className="thobe-desk" data-testid="thobe-desk">
      <div className="stack">
        <div className="card pad stack">
          <div className="row spread">
            <h2>{customer ? t('Customer', 'العميل') : t('New customer', 'عميل جديد')}</h2>
            {customer ? (
              <button className="btn sm ghost" data-testid="thobe-change-customer" onClick={() => { onCustomer(null); setMode('choose'); }}>{t('Change', 'تغيير')}</button>
            ) : (
              <button className="btn sm ghost" onClick={() => setMode('choose')}><ArrowLeft size={14} className="flip-rtl" /> {t('Back', 'رجوع')}</button>
            )}
          </div>
          {customer ? (
            <>
              <div><span className="strong">{customer.name ?? '—'}</span> <span className="small muted num">{phone(customer.phone)}</span></div>
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
            </>
          ) : (
            <div className="grid k2">
              <Field label={t('Name', 'الاسم')}><Input data-testid="thobe-new-name" value={newCust.name} onChange={(e) => setNewCust({ ...newCust, name: e.target.value })} autoFocus /></Field>
              <Field label={t('Mobile (8 digits)', 'الجوال (8 أرقام)')}><Input data-testid="thobe-new-phone" dir="ltr" inputMode="tel" value={newCust.phone} onChange={(e) => setNewCust({ ...newCust, phone: e.target.value })} /></Field>
            </div>
          )}
        </div>

        <div className="card pad stack">
          <div className="row spread">
            <h2>{t('Measurements (cm)', 'المقاسات (سم)')}</h2>
            <span className="small secondary" data-testid="thobe-measured-on">
              {member?.latest ? (changed ? t('Changed: saved as new measurements', 'معدّلة: تُحفظ مقاسات جديدة') : `${t('Taken', 'أُخذت')} ${date(member.latest.taken_at)}`) : t('New measurements', 'مقاسات جديدة')}
            </span>
          </div>
          {member?.latest && !editing ? (
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
                <span className="small secondary">{member.latest.tailor_name ?? ''}</span>
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
              {member?.latest ? (
                <div className="row" style={{ justifyContent: 'flex-end' }}>
                  <button
                    type="button"
                    className="btn sm ghost"
                    data-testid="thobe-m-cancel"
                    onClick={() => {
                      setMeas(Object.fromEntries(MEASURE_KEYS.map((k) => [k, String(Number(member.latest![k]))])));
                      setMeasRemarks(member.latest!.remarks ?? '');
                      setEditing(false);
                    }}
                  >
                    {t('Cancel changes', 'إلغاء التعديل')}
                  </button>
                </div>
              ) : null}
            </>
          )}
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
            <button className="btn" data-testid="thobe-add" disabled={!ready || busy} onClick={add}>
              <Plus size={16} /> {t('Add thobes to the sale', 'أضف الثياب إلى الفاتورة')}
            </button>
          </div>
        </div>
      </div>
      {/* The preview, and under it the collar, cuff and pocket, each with its own remarks. */}
      <aside className="thobe-desk-preview stack">
        <ThobePreview m={meas} collar={collar} cuff={cuff} pocket={opt.pocket === 'yes'} />
        <div className="card pad stack" data-testid="thobe-styles">
          <StyleWithNote label={t('Collar', 'الياقة')} items={items.collars} value={opt.collarId} onChange={(id) => setOpt({ ...opt, collarId: id })} testid="thobe-collar"
            note={opt.collarNote} onNote={(v) => setOpt({ ...opt, collarNote: v })} />
          {items.cuffs.length ? (
            <StyleWithNote label={t('Cuff', 'الكبك')} items={items.cuffs} value={opt.cuffId} onChange={(id) => setOpt({ ...opt, cuffId: id })} testid="thobe-cuff"
              note={opt.cuffNote} onNote={(v) => setOpt({ ...opt, cuffNote: v })} />
          ) : null}
          <StyleWithNote label={t('Pocket', 'الجيب')} items={POCKET} value={opt.pocket} onChange={(id) => setOpt({ ...opt, pocket: id })} testid="thobe-pocket"
            note={opt.pocketNote} onNote={(v) => setOpt({ ...opt, pocketNote: v })} />
        </div>
      </aside>
    </div>
  );
}
