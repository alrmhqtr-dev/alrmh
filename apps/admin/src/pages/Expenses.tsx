import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useSearchParams } from 'react-router-dom';
import { Plus, Trash2 } from 'lucide-react';
import { api, errorMessage } from '../lib/api';
import { useAuth } from '../lib/auth';
import { L, t } from '../lib/i18n';
import { date, methodLabel, money, todayQatar } from '../lib/format';
import { BranchSelect, DateRange, Empty, Field, Input, Loading, Modal, PageHead, Select, Stat, lastDays, useToast, type Range } from '../ui';

export default function Expenses() {
  const { can, staff } = useAuth();
  const [params, setParams] = useSearchParams();
  const qc = useQueryClient();
  const toast = useToast();
  const [range, setRange] = useState<Range>(lastDays(30));
  const [branch, setBranch] = useState('');
  const [category, setCategory] = useState('');
  const [form, setForm] = useState<any>(params.get('new') ? { branchId: staff?.branch_id ?? '', categoryId: '', amount: '', tax: '', date: todayQatar(), method: 'cash', reference: '', note: '' } : null);
  const cats = useQuery({ queryKey: ['list', 'expense-categories'], queryFn: () => api<any[]>('/lists/expense-categories') });
  const list = useQuery({ queryKey: ['expenses', range, branch, category], queryFn: () => api<any[]>(`/expenses?from=${range.from}&to=${range.to}${branch ? `&branch=${branch}` : ''}${category ? `&category=${category}` : ''}`) });
  const save = useMutation({
    mutationFn: () => api('/expenses', { body: { ...form, amount: Number(form.amount), tax: Number(form.tax) || 0, categoryId: form.categoryId || undefined } }),
    onSuccess: () => {
      toast(t('Expense recorded.', 'تم تسجيل المصروف.'));
      setForm(null);
      setParams({});
      qc.invalidateQueries({ queryKey: ['expenses'] });
      qc.invalidateQueries({ queryKey: ['register'] });
    },
    onError: (e) => toast(errorMessage(e), 'error'),
  });
  const del = useMutation({
    mutationFn: (id: string) => api(`/expenses/${id}/delete`, { method: 'POST' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['expenses'] }),
    onError: (e) => toast(errorMessage(e), 'error'),
  });
  const rows = list.data ?? [];
  const total = rows.reduce((a, r) => a + r.amount, 0);
  const byCat = new Map<string, number>();
  for (const r of rows) byCat.set(L({ name_en: r.category_en ?? 'Uncategorised', name_ar: r.category_ar ?? 'بدون فئة' }), (byCat.get(L({ name_en: r.category_en ?? 'Uncategorised', name_ar: r.category_ar ?? 'بدون فئة' })) ?? 0) + r.amount);
  return (
    <div className="stack lg">
      <PageHead title={t('Expenses', 'المصاريف')} sub={t('Rent, salaries, supplies and other running costs. Cash expenses come out of the open register.', 'الإيجار والرواتب والمستلزمات وغيرها. المصاريف النقدية تُخصم من الصندوق المفتوح.')}>
        <Link className="btn secondary" to="/expense-categories">{t('Categories', 'الفئات')}</Link>
        {can('expenses') ? <button className="btn" data-testid="add-expense" onClick={() => setForm({ branchId: staff?.branch_id ?? '', categoryId: '', amount: '', tax: '', date: todayQatar(), method: 'cash', reference: '', note: '' })}><Plus size={16} /> {t('Add expense', 'أضف مصروفًا')}</button> : null}
      </PageHead>
      <div className="filters">
        <DateRange value={range} onChange={setRange} />
        <BranchSelect value={branch} onChange={setBranch} />
        <select className="input" style={{ width: 190 }} value={category} onChange={(e) => setCategory(e.target.value)} aria-label={t('Category', 'الفئة')}>
          <option value="">{t('All categories', 'كل الفئات')}</option>
          {(cats.data ?? []).map((c) => <option key={c.id} value={c.id}>{L(c)}</option>)}
        </select>
      </div>
      <div className="grid k4">
        <Stat label={t('Total', 'الإجمالي')} value={money(total)} sub={t(`${rows.length} expenses`, `${rows.length} مصروف`)} />
        {[...byCat.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([k, v]) => <Stat key={k} label={k} value={money(v)} />)}
      </div>
      <div className="card table-wrap">
        {!list.data ? <Loading /> : rows.length ? (
          <table data-testid="expenses-table">
            <thead><tr><th>#</th><th>{t('Date', 'التاريخ')}</th><th>{t('Category', 'الفئة')}</th><th>{t('Branch', 'الفرع')}</th><th>{t('Paid by', 'طريقة الدفع')}</th><th>{t('Note', 'ملاحظة')}</th><th>{t('By', 'بواسطة')}</th><th className="right">{t('Amount', 'المبلغ')}</th><th><span className="sr-only">{t('Actions', 'إجراءات')}</span></th></tr></thead>
            <tbody>
              {rows.map((e) => (
                <tr key={e.id}>
                  <td className="strong">{e.number}</td>
                  <td className="small">{date(e.spent_on)}</td>
                  <td>{L({ name_en: e.category_en, name_ar: e.category_ar }) || '—'}</td>
                  <td className="small">{L({ name_en: e.branch_en, name_ar: e.branch_ar })}</td>
                  <td className="small">{methodLabel(e.method)}{e.reference ? <div className="muted">{e.reference}</div> : null}</td>
                  <td className="small">{e.note ?? '—'}</td>
                  <td className="small">{e.staff_name}</td>
                  <td className="right num">{money(e.amount)}</td>
                  <td className="right">{can('expenses') ? <button className="btn sm ghost" aria-label={t('Delete', 'حذف')} onClick={() => confirm(t('Delete this expense?', 'حذف هذا المصروف؟')) && del.mutate(e.id)}><Trash2 size={14} /></button> : null}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : <Empty>{t('No expenses in this period.', 'لا مصاريف في هذه الفترة.')}</Empty>}
      </div>
      {form ? (
        <Modal title={t('Add expense', 'أضف مصروفًا')} onClose={() => { setForm(null); setParams({}); }} footer={<><button className="btn secondary" onClick={() => { setForm(null); setParams({}); }}>{t('Cancel', 'إلغاء')}</button><button className="btn" data-testid="expense-save" disabled={!(Number(form.amount) > 0) || save.isPending} onClick={() => save.mutate()}>{t('Save', 'حفظ')}</button></>}>
          <div className="grid k2">
            <Field label={t('Amount (QAR)', 'المبلغ (ر.ق)')}><Input data-testid="expense-amount" type="number" min={0} value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} autoFocus /></Field>
            <Field label={t('Category', 'الفئة')}>
              <Select value={form.categoryId} onChange={(e) => setForm({ ...form, categoryId: e.target.value })}>
                <option value="">—</option>
                {(cats.data ?? []).filter((c) => c.active).map((c) => <option key={c.id} value={c.id}>{L(c)}</option>)}
              </Select>
            </Field>
            <Field label={t('Branch', 'الفرع')}><BranchSelect value={form.branchId} onChange={(v) => setForm({ ...form, branchId: v })} all={false} /></Field>
            <Field label={t('Date', 'التاريخ')}><Input type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} /></Field>
            <Field label={t('Paid by', 'طريقة الدفع')}>
              <Select value={form.method} onChange={(e) => setForm({ ...form, method: e.target.value })}>{['cash', 'card', 'bank_transfer', 'cheque'].map((m) => <option key={m} value={m}>{methodLabel(m)}</option>)}</Select>
            </Field>
            <Field label={t('Tax included (optional)', 'الضريبة المشمولة (اختياري)')}><Input type="number" min={0} value={form.tax} onChange={(e) => setForm({ ...form, tax: e.target.value })} /></Field>
            <Field label={t('Reference', 'المرجع')}><Input value={form.reference} onChange={(e) => setForm({ ...form, reference: e.target.value })} /></Field>
            <Field label={t('Note', 'ملاحظة')}><Input data-testid="expense-note" value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} /></Field>
          </div>
          {form.method === 'cash' && can('pos') ? <div className="note">{t('Cash is taken from your open register.', 'يُخصم النقد من صندوقك المفتوح.')}</div> : null}
        </Modal>
      ) : null}
    </div>
  );
}
