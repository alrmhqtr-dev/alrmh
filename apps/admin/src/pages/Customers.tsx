import { useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Link, useNavigate } from 'react-router-dom';
import { Download, Plus } from 'lucide-react';
import { api, downloadCsv, errorMessage } from '../lib/api';
import { useAuth } from '../lib/auth';
import { L, t } from '../lib/i18n';
import { date, money, num, phone } from '../lib/format';
import { Empty, Field, Input, Loading, Modal, PageHead, SearchBox, useToast } from '../ui';

type Row = { id: string; name: string | null; phone: string; email: string | null; language: string; created_at: string; orders: number; spent: number; points: number; due: number; source: string; group_en: string | null; group_ar: string | null };

export default function Customers() {
  const [q, setQ] = useState('');
  const nav = useNavigate();
  const { can } = useAuth();
  const toast = useToast();
  const [adding, setAdding] = useState<{ name: string; phone: string; email: string } | null>(null);
  const list = useQuery({ queryKey: ['customers', q], queryFn: () => api<Row[]>(`/customers${q ? `?q=${encodeURIComponent(q)}` : ''}`) });
  const add = useMutation({
    mutationFn: () => api<{ id: string; existing: boolean }>('/customers', { body: adding }),
    onSuccess: (c) => {
      if (c.existing) toast(t('That mobile already has an account.', 'لهذا الرقم حساب مسبق.'));
      nav(`/customers/${c.id}`);
    },
    onError: (e) => toast(errorMessage(e), 'error'),
  });
  return (
    <div className="stack lg">
      <PageHead title={t('Customers', 'العملاء')} sub={t('Find a customer by mobile number or name. App and counter customers are the same accounts.', 'ابحث عن عميل بالجوال أو الاسم. عملاء التطبيق والمحل هم نفس الحسابات.')}>
        <SearchBox value={q} onChange={setQ} placeholder={t('5555 1234 or name', '5555 1234 أو الاسم')} testid="customer-search" autoFocus />
        <Link className="btn secondary" to="/customer-groups">{t('Groups', 'المجموعات')}</Link>
        {can('reports') ? (
          <button className="btn secondary" data-testid="export-customers" onClick={() => downloadCsv('/export/customers.csv', 'alrmh-customers.csv').catch((e) => toast(errorMessage(e), 'error'))}>
            <Download size={16} /> {t('Export', 'تصدير')}
          </button>
        ) : null}
        {can('contacts', 'pos') ? <button className="btn" data-testid="add-customer" onClick={() => setAdding({ name: '', phone: q.replace(/\D/g, ''), email: '' })}><Plus size={16} /> {t('Add customer', 'إضافة عميل')}</button> : null}
      </PageHead>
      <div className="card table-wrap">
        {!list.data ? (
          <Loading />
        ) : list.data.length ? (
          <table>
            <thead>
              <tr><th>{t('Name', 'الاسم')}</th><th>{t('Mobile', 'الجوال')}</th><th>{t('Group', 'المجموعة')}</th><th>{t('Joined', 'الانضمام')}</th><th className="right">{t('Orders', 'الطلبات')}</th><th className="right">{t('Spent', 'المشتريات')}</th><th className="right">{t('Due', 'المتبقي')}</th><th className="right">{t('Points', 'النقاط')}</th></tr>
            </thead>
            <tbody>
              {list.data.map((c) => (
                <tr key={c.id} className="click" data-testid={`customer-${c.phone}`} onClick={() => nav(`/customers/${c.id}`)}>
                  <td className="strong">{c.name ?? <span className="muted">{t('No name yet', 'بدون اسم بعد')}</span>}{c.source !== 'app' ? <span className="small muted"> · {c.source === 'pos' ? t('counter', 'المحل') : t('imported', 'مستورد')}</span> : null}</td>
                  <td className="num">{phone(c.phone)}</td>
                  <td className="small">{L({ name_en: c.group_en, name_ar: c.group_ar }) || '—'}</td>
                  <td className="small">{date(c.created_at)}</td>
                  <td className="right num">{c.orders}</td>
                  <td className="right num">{money(c.spent)}</td>
                  <td className={`right num ${c.due ? 'tone-gold strong' : 'muted'}`}>{c.due ? money(c.due) : '—'}</td>
                  <td className="right num">{num(c.points)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <Empty>{t(`No customers match “${q}”.`, `لا عملاء يطابقون “${q}”.`)}</Empty>
        )}
      </div>
      {adding ? (
        <Modal title={t('Add customer', 'إضافة عميل')} onClose={() => setAdding(null)} footer={<><button className="btn secondary" onClick={() => setAdding(null)}>{t('Cancel', 'إلغاء')}</button><button className="btn" data-testid="add-customer-save" disabled={!adding.name.trim() || adding.phone.replace(/\D/g, '').length < 8 || add.isPending} onClick={() => add.mutate()}>{t('Add', 'إضافة')}</button></>}>
          <div className="grid k2">
            <Field label={t('Name', 'الاسم')}><Input value={adding.name} onChange={(e) => setAdding({ ...adding, name: e.target.value })} autoFocus /></Field>
            <Field label={t('Mobile', 'الجوال')} hint={t('Qatar mobile, 8 digits. It becomes their app sign-in.', 'جوال قطري 8 أرقام، ويصبح حساب دخوله للتطبيق.')}><Input dir="ltr" inputMode="tel" value={adding.phone} onChange={(e) => setAdding({ ...adding, phone: e.target.value })} /></Field>
            <Field label={t('Email (optional)', 'البريد (اختياري)')}><Input dir="ltr" value={adding.email} onChange={(e) => setAdding({ ...adding, email: e.target.value })} /></Field>
          </div>
        </Modal>
      ) : null}
    </div>
  );
}
