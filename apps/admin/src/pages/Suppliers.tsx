import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Pencil, Plus, Wallet } from 'lucide-react';
import { api, errorMessage } from '../lib/api';
import { useAuth } from '../lib/auth';
import { L, t } from '../lib/i18n';
import { date, methodLabel, money, todayQatar } from '../lib/format';
import { Empty, Field, Input, Loading, Modal, PageHead, Select, Stat, TextArea, useToast, confirmSave } from '../ui';

export function PayModal({ supplierId, purchaseId, due, onClose }: { supplierId: string; purchaseId?: string; due?: number; onClose: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [p, setP] = useState({ amount: due ? String(due) : '', method: 'bank_transfer', reference: '', date: todayQatar(), note: '' });
  const pay = useMutation({
    mutationFn: () => api('/supplier-payments', { body: { supplierId, purchaseId, ...p, amount: Number(p.amount) } }),
    onSuccess: () => {
      toast(t('Payment recorded.', 'تم تسجيل الدفعة.'));
      qc.invalidateQueries();
      onClose();
    },
    onError: (e) => toast(errorMessage(e), 'error'),
  });
  return (
    <Modal title={t('Pay supplier', 'دفع للمورد')} onClose={onClose} footer={<><button className="btn secondary" onClick={onClose}>{t('Cancel', 'إلغاء')}</button><button className="btn" data-testid="supplier-pay-save" disabled={!(Number(p.amount) > 0) || pay.isPending} onClick={() => pay.mutate()}>{t('Save', 'حفظ')}</button></>}>
      <div className="grid k2">
        <Field label={t('Amount', 'المبلغ')}><Input data-testid="supplier-pay-amount" type="number" value={p.amount} onChange={(e) => setP({ ...p, amount: e.target.value })} autoFocus /></Field>
        <Field label={t('Method', 'الطريقة')}>
          <Select value={p.method} onChange={(e) => setP({ ...p, method: e.target.value })}>
            {['bank_transfer', 'cash', 'card', 'cheque'].map((m) => <option key={m} value={m}>{methodLabel(m)}</option>)}
          </Select>
        </Field>
        <Field label={t('Date', 'التاريخ')}><Input type="date" value={p.date} onChange={(e) => setP({ ...p, date: e.target.value })} /></Field>
        <Field label={t('Reference', 'المرجع')}><Input value={p.reference} onChange={(e) => setP({ ...p, reference: e.target.value })} /></Field>
      </div>
      {p.method === 'cash' ? <div className="note">{t('Cash is taken from your open register.', 'يُخصم النقد من صندوقك المفتوح.')}</div> : null}
      <Field label={t('Note', 'ملاحظة')}><Input value={p.note} onChange={(e) => setP({ ...p, note: e.target.value })} /></Field>
    </Modal>
  );
}

export function SupplierDetail() {
  const { id } = useParams();
  const nav = useNavigate();
  const { can } = useAuth();
  const qc = useQueryClient();
  const toast = useToast();
  const s = useQuery({ queryKey: ['supplier', id], queryFn: () => api<any>(`/suppliers/${id}`) });
  const [paying, setPaying] = useState(false);
  const [edit, setEdit] = useState<any>(null);
  const save = useMutation({
    mutationFn: () => api(`/lists/suppliers/${id}`, { method: 'PATCH', body: edit }),
    onSuccess: () => {
      setEdit(null);
      qc.invalidateQueries({ queryKey: ['supplier', id] });
    },
    onError: (e) => toast(errorMessage(e), 'error'),
  });
  if (!s.data) return <Loading />;
  const d = s.data;
  return (
    <div className="stack lg">
      <PageHead title={d.name} sub={[d.business_name, d.phone, d.email].filter(Boolean).join(' · ')}>
        {can('purchases') ? (
          <>
            <button className="btn secondary" onClick={() => setEdit({ name: d.name, business_name: d.business_name ?? '', phone: d.phone ?? '', email: d.email ?? '', tax_number: d.tax_number ?? '', address: d.address ?? '', notes: d.notes ?? '', opening_balance: d.opening_balance, active: d.active })}><Pencil size={15} /> {t('Edit', 'تعديل')}</button>
            <button className="btn secondary" data-testid="supplier-pay" onClick={() => setPaying(true)}><Wallet size={15} /> {t('Pay', 'دفع')}</button>
            <Link className="btn" to={`/purchases/new?supplier=${d.id}`}><Plus size={15} /> {t('New purchase', 'مشتريات جديدة')}</Link>
          </>
        ) : null}
      </PageHead>
      <div className="grid k4">
        <Stat label={t('Bought', 'المشتريات')} value={money(d.totals.bought)} />
        <Stat label={t('Returned', 'المرتجع')} value={money(d.totals.returned)} />
        <Stat label={t('Paid', 'المدفوع')} value={money(d.totals.paid)} />
        <Stat label={t('Owed now', 'المستحق الآن')} value={<span data-testid="supplier-balance">{money(d.totals.balance)}</span>} tone={d.totals.balance > 0 ? 'gold' : undefined} sub={d.opening_balance ? `${t('Opening balance', 'الرصيد الافتتاحي')} ${money(d.opening_balance)}` : undefined} />
      </div>
      <div className="card table-wrap">
        <div style={{ padding: '16px 18px 8px' }}><h2>{t('Purchases', 'المشتريات')}</h2></div>
        {d.purchases.length ? (
          <table>
            <thead><tr><th>#</th><th>{t('Date', 'التاريخ')}</th><th>{t('Branch', 'الفرع')}</th><th>{t('Status', 'الحالة')}</th><th className="right">{t('Total', 'الإجمالي')}</th><th className="right">{t('Paid', 'المدفوع')}</th></tr></thead>
            <tbody>
              {d.purchases.map((p: any) => (
                <tr key={p.id} className="click" onClick={() => nav(`/purchases/${p.id}`)}>
                  <td className="strong">{p.number}{p.kind === 'return' ? <span className="badge" style={{ marginInlineStart: 6 }}>{t('Return', 'مرتجع')}</span> : null}</td>
                  <td className="small">{date(p.purchase_date)}</td>
                  <td className="small">{L({ name_en: p.branch_en, name_ar: p.branch_ar })}</td>
                  <td className="small">{p.status === 'received' ? t('Received', 'مستلمة') : p.status === 'ordered' ? t('Ordered', 'مطلوبة') : t('Cancelled', 'ملغاة')}</td>
                  <td className="right num">{p.kind === 'return' ? '−' : ''}{money(p.total)}</td>
                  <td className="right num">{p.paid ? money(p.paid) : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : <Empty>{t('No purchases yet.', 'لا مشتريات بعد.')}</Empty>}
      </div>
      <div className="card table-wrap">
        <div style={{ padding: '16px 18px 8px' }}><h2>{t('Payments', 'الدفعات')}</h2></div>
        {d.payments.length ? (
          <table>
            <thead><tr><th>{t('Date', 'التاريخ')}</th><th>{t('Method', 'الطريقة')}</th><th>{t('For', 'عن')}</th><th>{t('Reference', 'المرجع')}</th><th>{t('By', 'بواسطة')}</th><th className="right">{t('Amount', 'المبلغ')}</th></tr></thead>
            <tbody>
              {d.payments.map((p: any) => (
                <tr key={p.id}><td className="small">{date(p.paid_on)}</td><td className="small">{methodLabel(p.method)}</td><td className="small">{p.purchase_number ?? t('Account', 'الحساب')}</td><td className="small">{p.reference ?? '—'}</td><td className="small">{p.staff_name}</td><td className="right num">{money(p.amount)}</td></tr>
              ))}
            </tbody>
          </table>
        ) : <Empty>{t('No payments yet.', 'لا دفعات بعد.')}</Empty>}
      </div>
      {paying ? <PayModal supplierId={d.id} due={d.totals.balance > 0 ? d.totals.balance : undefined} onClose={() => setPaying(false)} /> : null}
      {edit ? (
        <Modal title={t('Edit supplier', 'تعديل المورد')} onClose={() => setEdit(null)} wide footer={<><button className="btn secondary" onClick={() => setEdit(null)}>{t('Cancel', 'إلغاء')}</button><button className="btn" onClick={async () => (await confirmSave()) && save.mutate()}>{t('Save', 'حفظ')}</button></>}>
          <div className="grid k2">
            {[
              ['name', t('Name', 'الاسم')],
              ['business_name', t('Business name', 'اسم النشاط')],
              ['phone', t('Mobile', 'الجوال')],
              ['email', t('Email', 'البريد')],
              ['tax_number', t('Tax number', 'الرقم الضريبي')],
              ['opening_balance', t('Opening balance', 'الرصيد الافتتاحي')],
            ].map(([k, label]) => (
              <Field key={k} label={label}><Input value={edit[k]} type={k === 'opening_balance' ? 'number' : 'text'} onChange={(e) => setEdit({ ...edit, [k]: e.target.value })} /></Field>
            ))}
          </div>
          <Field label={t('Address', 'العنوان')}><TextArea value={edit.address} onChange={(e) => setEdit({ ...edit, address: e.target.value })} /></Field>
          <Field label={t('Notes', 'ملاحظات')}><TextArea value={edit.notes} onChange={(e) => setEdit({ ...edit, notes: e.target.value })} /></Field>
          <label className="check"><input type="checkbox" checked={edit.active} onChange={(e) => setEdit({ ...edit, active: e.target.checked })} /> {t('In use', 'مفعّل')}</label>
        </Modal>
      ) : null}
    </div>
  );
}
