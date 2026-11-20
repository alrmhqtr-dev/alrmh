import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { Plus, Printer, Ruler, ShoppingCart } from 'lucide-react';
import { api, errorMessage } from '../lib/api';
import { useAuth } from '../lib/auth';
import { t } from '../lib/i18n';
import { MEASURE_KEYS, RELATION, date, measureLabel, phone } from '../lib/format';
import { Empty, Input, Loading, PageHead, SearchBox, Select, openPrint, useToast } from '../ui';
import { MeasureModal, MeasurementGrid, type Measurement } from '../measure';

type Found = { id: string; name: string | null; phone: string };
type Cust = { id: string; name: string | null; phone: string; family: { id: string; name: string; relation: string; size: string; latest: Measurement | null; measurement_count: number }[] };

/** اخذ المقاسات: find (or add) the customer, then measure each person. */
export function TakeMeasurements() {
  const { can } = useAuth();
  const qc = useQueryClient();
  const toast = useToast();
  const [q, setQ] = useState('');
  const [picked, setPicked] = useState<string | null>(null);
  const [adding, setAdding] = useState<{ name: string; phone: string } | null>(null);
  const [member, setMember] = useState<{ name: string; relation: string; size: string } | null>(null);
  const [measure, setMeasure] = useState<{ id: string; name: string; latest: Measurement | null } | null>(null);
  const found = useQuery({ queryKey: ['tailor-search', q], queryFn: () => api<Found[]>(`/customers?q=${encodeURIComponent(q)}`), enabled: q.trim().length >= 2 && !picked });
  const cust = useQuery({ queryKey: ['customer', picked], queryFn: () => api<Cust>(`/customers/${picked}`), enabled: Boolean(picked) });
  const add = useMutation({
    mutationFn: () => api<{ id: string }>('/customers', { body: adding }),
    onSuccess: (c) => {
      setPicked(c.id);
      setAdding(null);
    },
    onError: (e) => toast(errorMessage(e), 'error'),
  });
  const addMember = useMutation({
    mutationFn: () => api(`/customers/${picked}/members`, { body: member }),
    onSuccess: () => {
      setMember(null);
      qc.invalidateQueries({ queryKey: ['customer', picked] });
    },
    onError: (e) => toast(errorMessage(e), 'error'),
  });
  return (
    <div className="stack lg">
      <PageHead title={t('Take measurements', 'اخذ مقاسات العميل')} sub={t('Find the customer by mobile or name. Saved measurements show in their app and on the tailor ticket.', 'ابحث عن العميل بالجوال أو الاسم. تظهر المقاسات المحفوظة في تطبيقه وفي ورقة الخياط.')}>
        <Link className="btn secondary" to="/tailor/measurements"><Printer size={16} /> {t('Customer measurements', 'مقاسات العملاء')}</Link>
      </PageHead>
      {!picked ? (
        <div className="card pad stack">
          <div className="row wrap">
            <SearchBox value={q} onChange={setQ} placeholder={t('Mobile or name', 'الجوال أو الاسم')} testid="tailor-search" autoFocus />
            {can('contacts', 'pos', 'workshop') ? <button className="btn secondary" onClick={() => setAdding({ name: '', phone: q.replace(/\D/g, '') })}><Plus size={16} /> {t('New customer', 'عميل جديد')}</button> : null}
          </div>
          {adding ? (
            <div className="row wrap">
              <Input placeholder={t('Customer name', 'اسم العميل')} value={adding.name} onChange={(e) => setAdding({ ...adding, name: e.target.value })} style={{ maxWidth: 240 }} />
              <Input placeholder={t('Customer mobile', 'رقم العميل')} dir="ltr" value={adding.phone} onChange={(e) => setAdding({ ...adding, phone: e.target.value })} style={{ maxWidth: 200 }} />
              <button className="btn" disabled={!adding.name.trim() || add.isPending} onClick={() => add.mutate()}>{t('Add', 'إضافة')}</button>
            </div>
          ) : null}
          {found.data ? (
            found.data.length ? (
              <table>
                <tbody>
                  {found.data.slice(0, 20).map((c) => (
                    <tr key={c.id} className="click" onClick={() => setPicked(c.id)} data-testid={`tailor-pick-${c.phone}`}>
                      <td className="strong">{c.name ?? '—'}</td>
                      <td className="num">{phone(c.phone)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : <Empty>{t('No customer found.', 'لا يوجد عميل.')}</Empty>
          ) : null}
        </div>
      ) : !cust.data ? (
        <Loading />
      ) : (
        <div className="stack">
          <div className="card pad row spread wrap">
            <div>
              <h2>{cust.data.name}</h2>
              <div className="small muted num">{phone(cust.data.phone)}</div>
            </div>
            <div className="row wrap">
              <Link className="btn secondary" to={`/customers/${cust.data.id}`}>{t('Customer page', 'صفحة العميل')}</Link>
              {can('pos') ? <Link className="btn secondary" to={`/pos?customer=${cust.data.id}`}><ShoppingCart size={16} /> {t('Start an order', 'بدء طلب')}</Link> : null}
              <button className="btn ghost" onClick={() => { setPicked(null); setQ(''); }}>{t('Another customer', 'عميل آخر')}</button>
            </div>
          </div>
          {cust.data.family.map((m) => (
            <div key={m.id} className="card pad stack">
              <div className="row spread wrap">
                <div>
                  <div className="strong">{m.name}</div>
                  <div className="small secondary">{RELATION[m.relation]} · {m.size === 'child' ? t('Child', 'طفل') : t('Adult', 'بالغ')} · {m.measurement_count} {t('records', 'سجل')}</div>
                </div>
                <div className="row">
                  {m.latest ? <button className="btn sm secondary" onClick={() => openPrint(`measure/${m.id}`)}><Printer size={14} /> {t('Print', 'طباعة')}</button> : null}
                  {can('workshop', 'pos') ? <button className="btn sm" data-testid={`tailor-measure-${m.id}`} onClick={() => setMeasure({ id: m.id, name: m.name, latest: m.latest })}><Ruler size={14} /> {m.latest ? t('New measurements', 'مقاسات جديدة') : t('Measure', 'قياس')}</button> : null}
                </div>
              </div>
              {m.latest ? <MeasurementGrid m={m.latest} /> : <div className="small muted">{t('Not measured yet.', 'لم تؤخذ المقاسات بعد.')}</div>}
            </div>
          ))}
          {member ? (
            <div className="card pad row wrap">
              <Input placeholder={t('Name', 'الاسم')} value={member.name} onChange={(e) => setMember({ ...member, name: e.target.value })} style={{ maxWidth: 220 }} autoFocus />
              <Select value={member.relation} onChange={(e) => setMember({ ...member, relation: e.target.value })} style={{ maxWidth: 150 }}>
                {['father', 'son', 'brother', 'friend', 'other'].map((r) => <option key={r} value={r}>{RELATION[r]}</option>)}
              </Select>
              <Select value={member.size} onChange={(e) => setMember({ ...member, size: e.target.value })} style={{ maxWidth: 120 }}>
                <option value="adult">{t('Adult', 'بالغ')}</option>
                <option value="child">{t('Child', 'طفل')}</option>
              </Select>
              <button className="btn" disabled={!member.name.trim() || addMember.isPending} onClick={() => addMember.mutate()}>{t('Add', 'إضافة')}</button>
              <button className="btn ghost" onClick={() => setMember(null)}>{t('Cancel', 'إلغاء')}</button>
            </div>
          ) : (
            <button className="btn secondary" style={{ alignSelf: 'flex-start' }} onClick={() => setMember({ name: '', relation: 'son', size: 'adult' })}><Plus size={16} /> {t('Add a family member', 'إضافة فرد من العائلة')}</button>
          )}
        </div>
      )}
      {measure ? <MeasureModal memberId={measure.id} memberName={measure.name} previous={measure.latest} onClose={() => setMeasure(null)} onSaved={() => qc.invalidateQueries({ queryKey: ['customer', picked] })} /> : null}
    </div>
  );
}

/** مقاسات العملاء: everyone's latest measurements, ready to print. */
export function MeasurementsList() {
  const [q, setQ] = useState('');
  const list = useQuery({ queryKey: ['measurements', q], queryFn: () => api<any[]>(`/measurements${q ? `?q=${encodeURIComponent(q)}` : ''}`) });
  return (
    <div className="stack lg">
      <PageHead title={t('Customer measurements', 'مقاسات العملاء')} sub={t('The latest measurements of each person, in cm.', 'آخر مقاسات لكل شخص، بالسنتيمتر.')}>
        <SearchBox value={q} onChange={setQ} placeholder={t('Mobile or name', 'الجوال أو الاسم')} />
      </PageHead>
      <div className="card table-wrap">
        {!list.data ? <Loading /> : list.data.length ? (
          <table>
            <thead>
              <tr>
                <th>{t('Person', 'الشخص')}</th>
                <th>{t('Customer', 'العميل')}</th>
                {MEASURE_KEYS.map((k) => <th key={k} className="right">{measureLabel(k)}</th>)}
                <th>{t('Taken', 'التاريخ')}</th>
                <th><span className="sr-only">{t('Actions', 'إجراءات')}</span></th>
              </tr>
            </thead>
            <tbody>
              {list.data.map((m) => (
                <tr key={m.member_id}>
                  <td className="strong">{m.member_name}<div className="small muted">{RELATION[m.relation]}</div></td>
                  <td><Link to={`/customers/${m.customer_id}`}>{m.customer_name}</Link><div className="small muted num">{phone(m.phone)}</div></td>
                  {MEASURE_KEYS.map((k) => <td key={k} className="right num">{Number(m[k])}</td>)}
                  <td className="small">{date(m.taken_at)}<div className="muted">{m.tailor_name}</div></td>
                  <td className="right"><button className="btn sm ghost" aria-label={t('Print', 'طباعة')} onClick={() => openPrint(`measure/${m.member_id}`)}><Printer size={15} /></button></td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : <Empty>{t('No measurements yet.', 'لا مقاسات بعد.')}</Empty>}
      </div>
    </div>
  );
}

