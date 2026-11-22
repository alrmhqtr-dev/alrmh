import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, Plus } from 'lucide-react';
import { api, errorMessage } from '../lib/api';
import { L, t } from '../lib/i18n';
import { Field, Input, Loading, Modal, PageHead, useToast, confirmSave } from '../ui';

export const PERM_TEXT: Record<string, [string, string, string, string]> = {
  pos: ['Sell at the counter', 'البيع في نقطة البيع', 'Sales, drafts, quotations, own cash register, balance payments', 'المبيعات والمسودات وعروض الأسعار وصندوقه والدفعات المتبقية'],
  'pos.discount': ['Change prices and give discounts', 'تغيير الأسعار ومنح الخصومات', 'At the counter', 'في نقطة البيع'],
  returns: ['Returns, cancellations and refunds', 'المرتجعات والإلغاء والاسترداد', '', ''],
  workshop: ['Workshop and tailoring', 'الورشة والخياطة', 'Move orders, measurements, appointments, thobe photos', 'نقل الطلبات والمقاسات والمواعيد وصور الأثواب'],
  contacts: ['Customers', 'العملاء', 'Add and edit customers and groups, import contacts', 'إضافة وتعديل العملاء والمجموعات واستيراد جهات الاتصال'],
  products: ['Products and stock', 'المنتجات والمخزون', 'Products, brands, units, stock adjustments and transfers, labels, imports', 'المنتجات والعلامات والوحدات وتسويات ونقل المخزون والملصقات والاستيراد'],
  purchases: ['Suppliers and purchases', 'الموردون والمشتريات', 'Purchases, returns to suppliers, supplier payments', 'المشتريات ومرتجعات الموردين ودفعاتهم'],
  expenses: ['Expenses', 'المصاريف', '', ''],
  reports: ['Reports and exports', 'التقارير والتصدير', 'All registers, profit and loss, CSV exports', 'كل الصناديق والأرباح والخسائر وتصدير CSV'],
  manage: ['Settings and catalogue', 'الإعدادات والكتالوج', 'Fees, branches, rewards, coupons, discounts, company and invoice settings', 'الرسوم والفروع والمكافآت والقسائم والخصومات وإعدادات الشركة والفواتير'],
  audit: ['Activity log', 'سجل النشاط', '', ''],
  staff: ['Users and permissions', 'المستخدمون والصلاحيات', 'Staff accounts and roles', 'حسابات الموظفين والأدوار'],
};

type Role = { id: string; name_en: string; name_ar: string; permissions: string[]; builtin: boolean; staff_count: number };

/** الصلاحيات: what each role can do. Viewing needs only a sign-in. */
export default function Roles() {
  const qc = useQueryClient();
  const toast = useToast();
  const roles = useQuery({ queryKey: ['roles'], queryFn: () => api<Role[]>('/roles') });
  const perms = useQuery({ queryKey: ['permissions'], queryFn: () => api<string[]>('/permissions') });
  const [edit, setEdit] = useState<Partial<Role> | null>(null);
  const save = useMutation({
    mutationFn: () => (edit!.id ? api(`/roles/${edit!.id}`, { method: 'PATCH', body: { name_en: edit!.name_en, name_ar: edit!.name_ar, ...(edit!.id === 'owner' ? {} : { permissions: edit!.permissions }) } }) : api('/roles', { body: edit })),
    onSuccess: () => {
      toast(t('Saved. Staff with this role get the change at their next page load.', 'تم الحفظ. يحصل الموظفون على التغيير عند تحميل الصفحة التالية.'));
      setEdit(null);
      qc.invalidateQueries({ queryKey: ['roles'] });
    },
    onError: (e) => toast(errorMessage(e), 'error'),
  });
  const del = useMutation({
    mutationFn: () => api(`/roles/${edit!.id}/delete`, { method: 'POST' }),
    onSuccess: () => {
      setEdit(null);
      qc.invalidateQueries({ queryKey: ['roles'] });
    },
    onError: (e) => toast(errorMessage(e), 'error'),
  });
  if (!roles.data || !perms.data) return <Loading />;
  const has = (r: Role, p: string) => r.permissions.includes('*') || r.permissions.includes(p);
  return (
    <div className="stack lg">
      <PageHead title={t('Permissions', 'الصلاحيات')} sub={t('Every signed-in staff member can look things up. Each permission lets a role change something.', 'كل موظف مسجل يمكنه الاطلاع. كل صلاحية تسمح للدور بتغيير شيء.')}>
        <button className="btn" data-testid="add-role" onClick={() => setEdit({ name_en: '', name_ar: '', permissions: [] })}><Plus size={16} /> {t('Add role', 'إضافة دور')}</button>
      </PageHead>
      <div className="card table-wrap">
        <table className="perm-grid">
          <thead>
            <tr>
              <th>{t('Permission', 'الصلاحية')}</th>
              {roles.data.map((r) => (
                <th key={r.id} className="center"><button className="btn sm ghost" onClick={() => setEdit({ ...r })} data-testid={`role-${r.id}`}>{L(r)}</button><div className="small muted" style={{ textTransform: 'none' }}>{r.staff_count} {t('staff', 'موظف')}</div></th>
              ))}
            </tr>
          </thead>
          <tbody>
            {perms.data.map((p) => (
              <tr key={p}>
                <td><div className="strong">{PERM_TEXT[p] ? t(PERM_TEXT[p][0], PERM_TEXT[p][1]) : p}</div>{PERM_TEXT[p]?.[2] ? <div className="small muted">{t(PERM_TEXT[p][2], PERM_TEXT[p][3])}</div> : null}</td>
                {roles.data.map((r) => <td key={r.id} className="center">{has(r, p) ? <Check size={16} className="tone-ok" aria-label={t('Yes', 'نعم')} /> : <span className="muted">·</span>}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {edit ? (
        <Modal
          title={edit.id ? `${t('Role', 'الدور')}: ${L(edit)}` : t('New role', 'دور جديد')}
          onClose={() => setEdit(null)}
          wide
          footer={
            <>
              {edit.id && !edit.builtin ? <button className="btn danger" onClick={() => del.mutate()}>{t('Delete', 'حذف')}</button> : null}
              <div className="grow" />
              <button className="btn secondary" onClick={() => setEdit(null)}>{t('Cancel', 'إلغاء')}</button>
              <button className="btn" data-testid="role-save" disabled={!edit.name_en || !edit.name_ar || save.isPending} onClick={async () => (!edit.id || (await confirmSave())) && save.mutate()}>{t('Save', 'حفظ')}</button>
            </>
          }
        >
          <div className="grid k2">
            <Field label={t('Name (English)', 'الاسم (إنجليزي)')}><Input data-testid="role-name-en" dir="ltr" value={edit.name_en ?? ''} onChange={(e) => setEdit({ ...edit, name_en: e.target.value })} /></Field>
            <Field label={t('Name (Arabic)', 'الاسم (عربي)')}><Input data-testid="role-name-ar" dir="rtl" value={edit.name_ar ?? ''} onChange={(e) => setEdit({ ...edit, name_ar: e.target.value })} /></Field>
          </div>
          {edit.id === 'owner' ? (
            <div className="note">{t('The owner always has every permission.', 'المالك يملك كل الصلاحيات دائمًا.')}</div>
          ) : (
            <div className="grid k2">
              {perms.data.map((p) => (
                <label key={p} className="check" style={{ alignItems: 'flex-start' }}>
                  <input type="checkbox" data-testid={`perm-${p}`} checked={(edit.permissions ?? []).includes(p)} onChange={(e) => setEdit({ ...edit, permissions: e.target.checked ? [...(edit.permissions ?? []), p] : (edit.permissions ?? []).filter((x) => x !== p) })} />
                  <span><span className="strong">{PERM_TEXT[p] ? t(PERM_TEXT[p][0], PERM_TEXT[p][1]) : p}</span>{PERM_TEXT[p]?.[2] ? <span className="small muted" style={{ display: 'block' }}>{t(PERM_TEXT[p][2], PERM_TEXT[p][3])}</span> : null}</span>
                </label>
              ))}
            </div>
          )}
        </Modal>
      ) : null}
    </div>
  );
}
