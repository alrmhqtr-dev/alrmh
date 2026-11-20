import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { Plus, Shield } from 'lucide-react';
import { api, errorMessage } from '../lib/api';
import { useAuth } from '../lib/auth';
import { L, t } from '../lib/i18n';
import { date } from '../lib/format';
import { BranchSelect, Field, Input, Loading, Modal, PageHead, Select, useToast } from '../ui';

type Member = { id: string; email: string; name: string; phone: string | null; role: string; role_en: string; role_ar: string; active: boolean; branch_id: string | null; branch_name: string | null; branch_name_ar: string | null; language: 'ar' | 'en'; created_at: string; last_login_at: string | null };
type Role = { id: string; name_en: string; name_ar: string; permissions: string[] };

export default function Staff() {
  const { staff: me } = useAuth();
  const qc = useQueryClient();
  const toast = useToast();
  const list = useQuery({ queryKey: ['staff'], queryFn: () => api<Member[]>('/staff') });
  const roles = useQuery({ queryKey: ['roles'], queryFn: () => api<Role[]>('/roles') });
  const [edit, setEdit] = useState<(Partial<Member> & { password?: string; isNew?: boolean }) | null>(null);
  const save = useMutation({
    mutationFn: () =>
      edit!.isNew
        ? api('/staff', { body: { email: edit!.email, name: edit!.name, role: edit!.role, password: edit!.password, branchId: edit!.branch_id || null, phone: edit!.phone, language: edit!.language } })
        : api(`/staff/${edit!.id}`, { method: 'PATCH', body: { name: edit!.name, role: edit!.role, active: edit!.active, branchId: edit!.branch_id || null, phone: edit!.phone ?? null, ...(edit!.password ? { password: edit!.password } : {}) } }),
    onSuccess: () => {
      toast(edit!.isNew ? t('Staff member added. Share their password with them directly.', 'تمت إضافة الموظف. شارك كلمة المرور معه مباشرة.') : t('Saved.', 'تم الحفظ.'));
      qc.invalidateQueries({ queryKey: ['staff'] });
      setEdit(null);
    },
    onError: (e) => toast(errorMessage(e), 'error'),
  });
  if (!list.data) return <Loading />;
  return (
    <div className="stack lg">
      <PageHead title={t('Users', 'المستخدمين')} sub={t('Who can sign in to the admin and the POS, their role and branch.', 'من يمكنه الدخول إلى الإدارة ونقطة البيع، ودوره وفرعه.')}>
        <Link className="btn secondary" to="/roles"><Shield size={16} /> {t('Permissions', 'الصلاحيات')}</Link>
        <button className="btn" data-testid="add-staff" onClick={() => setEdit({ isNew: true, role: 'cashier', active: true, email: '', name: '', password: '', phone: '', language: 'ar', branch_id: me?.branch_id ?? null })}>
          <Plus size={16} /> {t('Add user', 'إضافة مستخدم')}
        </button>
      </PageHead>
      <div className="card table-wrap">
        <table>
          <thead><tr><th>{t('Name', 'الاسم')}</th><th>{t('Email', 'البريد الإلكتروني')}</th><th>{t('Role', 'الدور')}</th><th>{t('Branch', 'الفرع')}</th><th>{t('Last sign-in', 'آخر دخول')}</th><th>{t('Status', 'الحالة')}</th></tr></thead>
          <tbody>
            {list.data.map((m) => (
              <tr key={m.id} className="click" onClick={() => setEdit({ ...m, password: '' })} data-testid={`staff-${m.email}`}>
                <td className="strong">{m.name}{m.id === me?.id ? <span className="small muted"> {t('(you)', '(أنت)')}</span> : null}<div className="small muted num">{m.phone ?? ''}</div></td>
                <td dir="ltr" style={{ textAlign: 'start' }}>{m.email}</td>
                <td>{L({ name_en: m.role_en, name_ar: m.role_ar })}</td>
                <td>{L({ name_en: m.branch_name, name_ar: m.branch_name_ar }) || t('All branches', 'كل الفروع')}</td>
                <td className="small">{m.last_login_at ? date(m.last_login_at) : t('Never', 'لم يدخل')}</td>
                <td>{m.active ? <span className="badge ok">{t('Active', 'مفعّل')}</span> : <span className="badge">{t('Disabled', 'معطّل')}</span>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {edit ? (
        <Modal
          title={edit.isNew ? t('Add user', 'إضافة مستخدم') : `${t('Edit', 'تعديل')} ${edit.name}`}
          onClose={() => setEdit(null)}
          footer={<><button className="btn secondary" onClick={() => setEdit(null)}>{t('Cancel', 'إلغاء')}</button><button className="btn" data-testid="staff-save" disabled={save.isPending} onClick={() => save.mutate()}>{t('Save', 'حفظ')}</button></>}
        >
          <div className="grid k2">
            <Field label={t('Name', 'الاسم')}><Input data-testid="staff-name" value={edit.name ?? ''} onChange={(e) => setEdit({ ...edit, name: e.target.value })} /></Field>
            <Field label={t('Email', 'البريد الإلكتروني')}><Input data-testid="staff-email" type="email" dir="ltr" disabled={!edit.isNew} value={edit.email ?? ''} onChange={(e) => setEdit({ ...edit, email: e.target.value })} /></Field>
            <Field label={t('Role', 'الدور')}>
              <Select data-testid="staff-role" value={edit.role} onChange={(e) => setEdit({ ...edit, role: e.target.value })}>
                {(roles.data ?? []).map((r) => <option key={r.id} value={r.id}>{L(r)}</option>)}
              </Select>
            </Field>
            <Field label={t('Branch', 'الفرع')} hint={t('Their register and sales default to this branch.', 'الصندوق والمبيعات تكون لهذا الفرع افتراضيًا.')}>
              <BranchSelect value={edit.branch_id ?? ''} onChange={(v) => setEdit({ ...edit, branch_id: v || null })} testid="staff-branch" />
            </Field>
            <Field label={t('Mobile', 'الجوال')}><Input dir="ltr" value={edit.phone ?? ''} onChange={(e) => setEdit({ ...edit, phone: e.target.value })} /></Field>
            {edit.isNew ? (
              <Field label={t('Language', 'اللغة')}>
                <Select value={edit.language} onChange={(e) => setEdit({ ...edit, language: e.target.value as 'ar' | 'en' })}>
                  <option value="ar">العربية</option>
                  <option value="en">English</option>
                </Select>
              </Field>
            ) : null}
            <Field label={edit.isNew ? t('Password', 'كلمة المرور') : t('New password', 'كلمة مرور جديدة')} hint={edit.isNew ? t('At least 10 characters', '10 أحرف على الأقل') : t('Leave blank to keep the current one. Changing it signs them out.', 'اتركه فارغًا للإبقاء على الحالية. تغييرها يسجّل خروجه.')}>
              <Input data-testid="staff-password" type="text" dir="ltr" autoComplete="new-password" value={edit.password ?? ''} onChange={(e) => setEdit({ ...edit, password: e.target.value })} />
            </Field>
          </div>
          {!edit.isNew ? (
            <label className="check"><input type="checkbox" checked={edit.active} onChange={(e) => setEdit({ ...edit, active: e.target.checked })} /> {t('Can sign in', 'يمكنه الدخول')}</label>
          ) : null}
        </Modal>
      ) : null}
    </div>
  );
}
