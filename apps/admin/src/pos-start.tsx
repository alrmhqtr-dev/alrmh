import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, Search, UserPlus } from 'lucide-react';
import { api, errorMessage } from './lib/api';
import { t } from './lib/i18n';
import { phone } from './lib/format';
import { Field, Input, useToast } from './ui';

export type Cust = { id: string; name: string; phone: string };

/**
 * The first screen of a sale: a new customer or an existing one, nothing else to get wrong.
 * A new customer needs a mobile and name; their measurements are taken when thobes are made.
 * Every sale has a customer.
 */
export function CustomerStart({ onPick }: { onPick: (c: Cust) => void }) {
  const toast = useToast();
  const [mode, setMode] = useState<'choose' | 'new' | 'existing'>('choose');
  const [q, setQ] = useState('');
  const [v, setV] = useState({ name: '', phone: '' });
  const [busy, setBusy] = useState(false);
  const [taken, setTaken] = useState<Cust | null>(null);
  const found = useQuery({ queryKey: ['pos-customers', q], queryFn: () => api<Cust[]>(`/customers?q=${encodeURIComponent(q)}`), enabled: mode === 'existing' && q.trim().length >= 2 });

  const create = async () => {
    setBusy(true);
    try {
      const c = await api<Cust & { existing?: boolean }>('/customers', { body: { name: v.name.trim(), phone: v.phone } });
      // A new customer must be new: an existing mobile is found under Existing customer instead.
      if (c.existing) setTaken(c);
      else onPick({ id: c.id, name: c.name, phone: c.phone });
    } catch (e) {
      toast(errorMessage(e), 'error');
    }
    setBusy(false);
  };

  if (mode === 'choose')
    return (
      <div className="stack lg pos-start" data-testid="pos-start">
        <div className="choice-cards">
          <button className="choice-card" data-testid="start-new" onClick={() => setMode('new')}>
            <UserPlus size={34} strokeWidth={1.6} />
            <span className="strong">{t('New customer', 'عميل جديد')}</span>
            <span className="small secondary">{t('Mobile and name', 'الجوال والاسم')}</span>
          </button>
          <button className="choice-card" data-testid="start-existing" onClick={() => setMode('existing')}>
            <Search size={34} strokeWidth={1.6} />
            <span className="strong">{t('Existing customer', 'عميل حالي')}</span>
            <span className="small secondary">{t('Find by mobile or name', 'ابحث بالجوال أو الاسم')}</span>
          </button>
        </div>
      </div>
    );

  return (
    <div className="card pad stack pos-start-form" data-testid={mode === 'new' ? 'start-new-form' : 'start-find'}>
      <div className="row spread">
        <h2>{mode === 'new' ? t('New customer', 'عميل جديد') : t('Existing customer', 'عميل حالي')}</h2>
        <button className="btn sm ghost" onClick={() => setMode('choose')}><ArrowLeft size={14} className="flip-rtl" /> {t('Back', 'رجوع')}</button>
      </div>
      {mode === 'new' ? (
        <>
          <div className="grid k2">
            <Field label={t('Mobile (8 digits)', 'الجوال (8 أرقام)')}><Input data-testid="start-phone" dir="ltr" inputMode="tel" autoFocus value={v.phone} aria-invalid={Boolean(taken)} onChange={(e) => { setTaken(null); setV({ ...v, phone: e.target.value }); }} /></Field>
            <Field label={t('Name', 'الاسم')}><Input data-testid="start-name" value={v.name} onChange={(e) => setV({ ...v, name: e.target.value })} /></Field>
          </div>
          {taken ? (
            <div className="note tone-error" role="alert" data-testid="start-taken">
              {t(`This mobile already belongs to ${taken.name}. A new customer needs a new mobile; find them under Existing customer.`, `هذا الرقم مسجل باسم ${taken.name}. العميل الجديد يحتاج رقمًا جديدًا؛ ابحث عنه في العملاء الحاليين.`)}
            </div>
          ) : null}
          <div className="row" style={{ justifyContent: 'flex-end' }}>
            <button className="btn" data-testid="start-continue" disabled={busy || Boolean(taken) || !v.name.trim() || v.phone.replace(/\D/g, '').length < 8} onClick={create}>{t('Continue', 'متابعة')}</button>
          </div>
        </>
      ) : (
        <>
          <Input data-testid="start-search" autoFocus placeholder={t('Customer mobile or name', 'جوال العميل أو اسمه')} value={q} onChange={(e) => setQ(e.target.value)} />
          {found.data?.length ? (
            <div className="stack" style={{ gap: 4 }}>
              {found.data.slice(0, 8).map((c) => (
                <button key={c.id} className="btn ghost" data-testid={`start-pick-${c.phone}`} style={{ width: '100%', justifyContent: 'space-between' }} onClick={() => onPick(c)}>
                  <bdi className="strong">{c.name}</bdi>
                  <span className="small secondary num">{phone(c.phone)}</span>
                </button>
              ))}
            </div>
          ) : q.trim().length >= 2 && found.data ? (
            <div className="small secondary">
              {t('No customer found.', 'لا يوجد عميل.')}{' '}
              <button className="linklike strong" onClick={() => { setV({ name: '', phone: /^\d+$/.test(q.trim()) ? q.trim() : '' }); setMode('new'); }}>{t('Add as a new customer', 'أضفه عميلًا جديدًا')}</button>
            </div>
          ) : null}
        </>
      )}
    </div>
  );
}
