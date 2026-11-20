import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useParams } from 'react-router-dom';
import { Award, Pencil, Plus, Ruler, ShoppingBag, ShoppingCart } from 'lucide-react';
import { api, errorMessage } from '../lib/api';
import { useAuth } from '../lib/auth';
import { RELATION, channelLabel, date, money, num, phone } from '../lib/format';
import { L, t } from '../lib/i18n';
import { MeasureModal, MeasurementGrid, type Measurement } from '../measure';
import { PlaceOrderModal } from '../place-order';
import { Empty, Field, Input, Loading, Modal, PageHead, Select, StageBadge, TextArea, useToast } from '../ui';

type Detail = {
  id: string;
  name: string | null;
  phone: string;
  email: string | null;
  language: string;
  created_at: string;
  balance: number;
  source: string;
  notes: string | null;
  group_id: string | null;
  family: { id: string; name: string; relation: string; size: string; latest: Measurement | null; measurement_count: number }[];
  addresses: { id: string; label: string; line1: string; area: string; city: string; notes: string | null; is_default: boolean }[];
  orders: { id: string; number: string; stage: string; total: number; created_at: string; channel: string; balance: number }[];
  ledger: { id: string; kind: string; points: number; remaining: number; expires_at: string | null; label: string | null; created_at: string; staff_name: string | null }[];
  tier: { tier: { name_en: string; name_ar: string; colour: string; points_per_thobe: number; points_per_product: number }; next: { name_en: string; name_ar: string } | null; lifetime: number; toNext: number };
};

export default function CustomerDetail() {
  const { id = '' } = useParams();
  const { can } = useAuth();
  const toast = useToast();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['customer', id], queryFn: () => api<Detail>(`/customers/${id}`) });
  const cat = useQuery({ queryKey: ['catalogue'], queryFn: () => api<{ products: { id: string; name_en: string; name_ar: string }[] }>('/catalogue') });
  const groups = useQuery({ queryKey: ['list', 'customer-groups'], queryFn: () => api<any[]>('/lists/customer-groups') });
  const label = (l: string | null, kind: string) => {
    if (!l) return kind;
    if (l.startsWith('Reward: ')) return `${t('Reward', 'مكافأة')}: ${L(cat.data?.products.find((p) => p.id === l.slice(8))) || l.slice(8)}`;
    return l;
  };
  const [measure, setMeasure] = useState<{ id: string; name: string; prev: Measurement | null } | null>(null);
  const [adjust, setAdjust] = useState(false);
  const [ordering, setOrdering] = useState(false);
  const [points, setPoints] = useState('');
  const [reason, setReason] = useState('');
  const [edit, setEdit] = useState<{ name: string; email: string; groupId: string; notes: string } | null>(null);
  const [member, setMember] = useState<{ name: string; relation: string; size: string } | null>(null);
  const saveEdit = useMutation({
    mutationFn: () => api(`/customers/${id}`, { method: 'PATCH', body: { name: edit!.name, email: edit!.email, groupId: edit!.groupId || null, notes: edit!.notes } }),
    onSuccess: () => {
      setEdit(null);
      qc.invalidateQueries({ queryKey: ['customer', id] });
    },
    onError: (e) => toast(errorMessage(e), 'error'),
  });
  const addMember = useMutation({
    mutationFn: () => api(`/customers/${id}/members`, { body: member }),
    onSuccess: () => {
      setMember(null);
      qc.invalidateQueries({ queryKey: ['customer', id] });
    },
    onError: (e) => toast(errorMessage(e), 'error'),
  });
  const adj = useMutation({
    mutationFn: () => api<{ balance: number }>(`/customers/${id}/points`, { body: { points: Number(points), reason } }),
    onSuccess: (r) => {
      toast(t(`Points updated. New balance ${num(r.balance)}.`, `تم تحديث النقاط. الرصيد الجديد ${num(r.balance)}.`));
      setAdjust(false);
      setPoints('');
      setReason('');
      qc.invalidateQueries({ queryKey: ['customer', id] });
    },
    onError: (e) => toast(errorMessage(e), 'error'),
  });

  if (!q.data) return <Loading />;
  const c = q.data;
  return (
    <div className="stack lg">
      <PageHead title={c.name ?? phone(c.phone)} sub={`${phone(c.phone)}${c.email ? ` · ${c.email}` : ''} · ${c.language === 'ar' ? t('Arabic', 'العربية') : t('English', 'الإنجليزية')} · ${t('joined', 'انضم')} ${date(c.created_at)}${c.source === 'pos' ? ` · ${t('added at the counter', 'أُضيف في المحل')}` : c.source === 'import' ? ` · ${t('imported', 'مستورد')}` : ''}${c.group_id ? ` · ${L(groups.data?.find((g) => g.id === c.group_id))}` : ''}`}>
        {can('contacts', 'pos') ? (
          <button className="btn secondary" data-testid="customer-edit" onClick={() => setEdit({ name: c.name ?? '', email: c.email ?? '', groupId: c.group_id ?? '', notes: c.notes ?? '' })}><Pencil size={15} /> {t('Edit', 'تعديل')}</button>
        ) : null}
        {can('pos') ? <Link className="btn secondary" to={`/pos?customer=${c.id}`}><ShoppingCart size={16} /> {t('New sale', 'بيع جديد')}</Link> : null}
        {can('workshop') && c.family.length ? (
          <button className="btn" data-testid="customer-place-order" onClick={() => setOrdering(true)}>
            <ShoppingBag size={16} /> {t('Place order', 'تسجيل طلب')}
          </button>
        ) : null}
      </PageHead>
      {c.notes ? <div className="note">{c.notes}</div> : null}

      <div className="grid" style={{ gridTemplateColumns: 'minmax(0, 2fr) minmax(280px, 1fr)', alignItems: 'start' }}>
        <div className="stack lg">
          <div className="row spread"><h2>{t('Family & measurements', 'العائلة والمقاسات')}</h2>{can('contacts', 'pos', 'workshop') ? <button className="btn sm secondary" onClick={() => setMember({ name: '', relation: 'son', size: 'adult' })}><Plus size={14} /> {t('Add person', 'إضافة شخص')}</button> : null}</div>
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
          ) : null}
          {c.family.map((m) => (
            <div key={m.id} className="card pad stack" data-testid={`member-${m.name}`}>
              <div className="row spread">
                <div>
                  <h3>{m.name}</h3>
                  <div className="small secondary">{RELATION[m.relation]} · {m.size === 'child' ? t('Child', 'طفل') : t('Adult', 'بالغ')} · {m.measurement_count} {t('records', 'سجل')}</div>
                </div>
                {can('workshop', 'pos') ? (
                  <button className="btn sm" data-testid={`record-${m.name}`} onClick={() => setMeasure({ id: m.id, name: m.name, prev: m.latest })}>
                    <Ruler size={14} /> {m.latest ? t('New measurements', 'مقاسات جديدة') : t('Record measurements', 'تسجيل المقاسات')}
                  </button>
                ) : null}
              </div>
              {m.latest ? <MeasurementGrid m={m.latest} /> : <div className="note">{t('Not measured yet.', 'لم تؤخذ المقاسات بعد.')}</div>}
            </div>
          ))}
          {!c.family.length ? <div className="card"><Empty>{t("The customer hasn't finished sign-up yet.", 'لم يُكمل العميل التسجيل بعد.')}</Empty></div> : null}

          <h2>{t('Orders and purchases', 'الطلبات والمشتريات')}</h2>
          <div className="card table-wrap">
            {c.orders.length ? (
              <table>
                <tbody>
                  {c.orders.map((o) => (
                    <tr key={o.id}>
                      <td><Link className="strong" to={`/orders/${o.id}`}>#{o.number}</Link></td>
                      <td><StageBadge stage={o.stage} /></td>
                      <td className="small">{channelLabel(o.channel)}</td>
                      <td className="small">{date(o.created_at)}</td>
                      <td className={`right num ${o.balance ? 'tone-gold' : 'muted'}`}>{o.balance ? `${t('due', 'متبقي')} ${money(o.balance)}` : ''}</td>
                      <td className="right num">{money(o.total)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <Empty>{t('No orders yet.', 'لا طلبات بعد.')}</Empty>
            )}
          </div>
        </div>

        <div className="stack lg">
          <div className="card dark pad stack" style={{ gap: 6 }}>
            <div className="row" style={{ gap: 8 }}>
              <Award size={18} color={c.tier.tier.colour} />
              <span className="overline" style={{ color: c.tier.tier.colour }} data-testid="customer-tier">{L(c.tier.tier)}</span>
            </div>
            <div style={{ fontSize: 30, fontWeight: 600, color: 'var(--gold)' }} className="num" data-testid="points-balance">{num(c.balance)}</div>
            <div className="small" style={{ color: 'rgba(255,255,255,0.7)' }}>
              {t('Points to use (QAR 1 each)', 'نقاط للاستخدام (1 ر.ق لكل نقطة)')} · {num(c.tier.lifetime)} {t('earned in all', 'مكتسبة إجمالًا')}{c.tier.next ? ` · ${num(c.tier.toNext)} ${t('to', 'إلى')} ${L(c.tier.next)}` : ''}
            </div>
            {can('manage') ? (
              <button className="btn gold sm" style={{ alignSelf: 'flex-start' }} data-testid="adjust-points" onClick={() => setAdjust(true)}>
                <Plus size={14} /> {t('Adjust points', 'تعديل النقاط')}
              </button>
            ) : null}
          </div>
          <div className="card">
            <div className="overline" style={{ padding: '14px 16px 4px' }}>{t('Points history', 'سجل النقاط')}</div>
            <table>
              <tbody>
                {c.ledger.slice(0, 12).map((e) => (
                  <tr key={e.id}>
                    <td>
                      <div className="small strong">{label(e.label, e.kind)}</div>
                      <div className="small muted">{date(e.created_at)}{e.staff_name ? ` · ${t('by', 'بواسطة')} ${e.staff_name}` : ''}{e.kind === 'earn' && e.expires_at ? ` · ${t('expires', 'تنتهي')} ${date(e.expires_at)}` : ''}</div>
                    </td>
                    <td className={`right num small strong ${e.points < 0 ? '' : ''}`} style={{ color: e.points > 0 ? 'var(--gold-ink)' : e.kind === 'expire' ? 'var(--error)' : undefined }}>
                      {e.points > 0 ? '+' : '−'}{num(Math.abs(e.points))}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!c.ledger.length ? <Empty>{t('No points yet.', 'لا نقاط بعد.')}</Empty> : null}
          </div>
          <div className="card pad stack" style={{ gap: 8 }}>
            <div className="overline">{t('Addresses', 'العناوين')}</div>
            {c.addresses.map((a) => (
              <div key={a.id} className="small">
                <span className="strong">{a.label}</span> {a.is_default ? <span className="badge">{t('Default', 'الافتراضي')}</span> : null}
                <div className="secondary">{a.line1}, {a.area}, {a.city}</div>
                {a.notes ? <div className="muted">{a.notes}</div> : null}
              </div>
            ))}
            {!c.addresses.length ? <div className="small muted">{t('No saved addresses.', 'لا عناوين محفوظة.')}</div> : null}
          </div>
        </div>
      </div>

      {measure ? <MeasureModal memberId={measure.id} memberName={measure.name} previous={measure.prev} onClose={() => setMeasure(null)} /> : null}
      {edit ? (
        <Modal title={t('Edit customer', 'تعديل العميل')} onClose={() => setEdit(null)} footer={<><button className="btn secondary" onClick={() => setEdit(null)}>{t('Cancel', 'إلغاء')}</button><button className="btn" data-testid="customer-edit-save" disabled={!edit.name.trim() || saveEdit.isPending} onClick={() => saveEdit.mutate()}>{t('Save', 'حفظ')}</button></>}>
          <div className="grid k2">
            <Field label={t('Name', 'الاسم')}><Input value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} /></Field>
            <Field label={t('Email', 'البريد')}><Input dir="ltr" value={edit.email} onChange={(e) => setEdit({ ...edit, email: e.target.value })} /></Field>
            <Field label={t('Customer group', 'مجموعة العملاء')}>
              <Select data-testid="customer-group" value={edit.groupId} onChange={(e) => setEdit({ ...edit, groupId: e.target.value })}>
                <option value="">{t('None', 'بدون')}</option>
                {(groups.data ?? []).filter((g) => g.active).map((g) => <option key={g.id} value={g.id}>{L(g)}{g.discount_percent ? ` · ${g.discount_percent}%` : ''}</option>)}
              </Select>
            </Field>
          </div>
          <Field label={t('Notes', 'ملاحظات')}><TextArea value={edit.notes} onChange={(e) => setEdit({ ...edit, notes: e.target.value })} /></Field>
          <div className="small muted">{t('The mobile number is the customer’s sign-in, so it can’t be changed here.', 'رقم الجوال هو حساب دخول العميل ولا يُغيّر من هنا.')}</div>
        </Modal>
      ) : null}
      {ordering ? <PlaceOrderModal customerId={c.id} onClose={() => setOrdering(false)} /> : null}
      {adjust ? (
        <Modal
          title={t('Adjust points', 'تعديل النقاط')}
          onClose={() => setAdjust(false)}
          footer={
            <>
              <button className="btn secondary" onClick={() => setAdjust(false)}>{t('Cancel', 'إلغاء')}</button>
              <button className="btn" data-testid="adjust-save" disabled={!Number(points) || !reason.trim() || adj.isPending} onClick={() => adj.mutate()}>{t('Save', 'حفظ')}</button>
            </>
          }
        >
          <div className="note">{t('Use a minus sign to remove points, e.g. −200. Added points expire on the normal schedule. The change and your name are recorded.', 'استخدم علامة السالب للخصم، مثل −200. تنتهي النقاط المضافة حسب الجدول المعتاد. يُسجّل التغيير واسمك.')}</div>
          <div className="grid k2">
            <Field label={t('Points', 'النقاط')}>
              <Input data-testid="adjust-points-input" type="number" value={points} onChange={(e) => setPoints(e.target.value)} placeholder={t('e.g. 100 or -200', 'مثل 100 أو -200')} />
            </Field>
            <Field label={t('Reason', 'السبب')}>
              <Input data-testid="adjust-reason" value={reason} onChange={(e) => setReason(e.target.value)} placeholder={t('e.g. Goodwill for late delivery', 'مثل تعويض عن تأخير')} />
            </Field>
          </div>
        </Modal>
      ) : null}
    </div>
  );
}
