import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
import { api, errorMessage } from '../lib/api';
import { useAuth, type Role } from '../lib/auth';
import { date } from '../lib/format';
import { Field, Input, Loading, Modal, PageHead, Select, useToast } from '../ui';

type Member = { id: string; email: string; name: string; role: Role; active: boolean; branch_id: string | null; branch_name: string | null; created_at: string; last_login_at: string | null };

const ROLE_INFO: Record<Role, string> = {
  owner: 'Everything, including staff accounts',
  manager: 'Everything except staff accounts',
  tailor: 'Orders, appointments and measurements',
  support: 'Read-only: look up customers and orders',
};

export default function Staff() {
  const { staff: me } = useAuth();
  const qc = useQueryClient();
  const toast = useToast();
  const list = useQuery({ queryKey: ['staff'], queryFn: () => api<Member[]>('/staff') });
  const branches = useQuery({ queryKey: ['branches'], queryFn: () => api<{ id: string; name_en: string }[]>('/branches') });
  const [edit, setEdit] = useState<(Partial<Member> & { password?: string; isNew?: boolean }) | null>(null);
  const save = useMutation({
    mutationFn: () =>
      edit!.isNew
        ? api('/staff', { body: { email: edit!.email, name: edit!.name, role: edit!.role, password: edit!.password, branchId: edit!.branch_id || null } })
        : api(`/staff/${edit!.id}`, { method: 'PATCH', body: { name: edit!.name, role: edit!.role, active: edit!.active, branchId: edit!.branch_id || null, ...(edit!.password ? { password: edit!.password } : {}) } }),
    onSuccess: () => {
      toast(edit!.isNew ? 'Staff member added. Share their password with them directly.' : 'Saved.');
      qc.invalidateQueries({ queryKey: ['staff'] });
      setEdit(null);
    },
    onError: (e) => toast(errorMessage(e), 'error'),
  });
  if (!list.data) return <Loading />;
  return (
    <div className="stack lg">
      <PageHead title="Staff" sub="Who can sign in to the admin, and what each role can do.">
        <button className="btn" data-testid="add-staff" onClick={() => setEdit({ isNew: true, role: 'tailor', active: true, email: '', name: '', password: '' })}>
          <Plus size={16} /> Add staff
        </button>
      </PageHead>
      <div className="card table-wrap">
        <table>
          <thead><tr><th>Name</th><th>Email</th><th>Role</th><th>Branch</th><th>Last sign-in</th><th>Status</th></tr></thead>
          <tbody>
            {list.data.map((m) => (
              <tr key={m.id} className="click" onClick={() => setEdit({ ...m, password: '' })}>
                <td className="strong">{m.name}{m.id === me?.id ? <span className="small muted"> (you)</span> : null}</td>
                <td>{m.email}</td>
                <td style={{ textTransform: 'capitalize' }}>{m.role}</td>
                <td>{m.branch_name ?? '—'}</td>
                <td className="small">{m.last_login_at ? date(m.last_login_at) : 'Never'}</td>
                <td>{m.active ? <span className="badge ok">Active</span> : <span className="badge">Disabled</span>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="grid k4">
        {(Object.keys(ROLE_INFO) as Role[]).map((r) => (
          <div key={r} className="card pad"><div className="strong" style={{ textTransform: 'capitalize' }}>{r}</div><div className="small secondary">{ROLE_INFO[r]}</div></div>
        ))}
      </div>
      {edit ? (
        <Modal
          title={edit.isNew ? 'Add staff member' : `Edit ${edit.name}`}
          onClose={() => setEdit(null)}
          footer={<><button className="btn secondary" onClick={() => setEdit(null)}>Cancel</button><button className="btn" data-testid="staff-save" disabled={save.isPending} onClick={() => save.mutate()}>Save</button></>}
        >
          <div className="grid k2">
            <Field label="Name"><Input data-testid="staff-name" value={edit.name ?? ''} onChange={(e) => setEdit({ ...edit, name: e.target.value })} /></Field>
            <Field label="Email"><Input data-testid="staff-email" type="email" disabled={!edit.isNew} value={edit.email ?? ''} onChange={(e) => setEdit({ ...edit, email: e.target.value })} /></Field>
            <Field label="Role" hint={edit.role ? ROLE_INFO[edit.role] : undefined}>
              <Select data-testid="staff-role" value={edit.role} onChange={(e) => setEdit({ ...edit, role: e.target.value as Role })}>
                {(Object.keys(ROLE_INFO) as Role[]).map((r) => <option key={r} value={r}>{r[0].toUpperCase() + r.slice(1)}</option>)}
              </Select>
            </Field>
            <Field label="Branch">
              <Select value={edit.branch_id ?? ''} onChange={(e) => setEdit({ ...edit, branch_id: e.target.value || null })}>
                <option value="">All branches</option>
                {(branches.data ?? []).map((b) => <option key={b.id} value={b.id}>{b.name_en}</option>)}
              </Select>
            </Field>
            <Field label={edit.isNew ? 'Password' : 'New password'} hint={edit.isNew ? 'At least 10 characters' : 'Leave blank to keep the current one. Changing it signs them out.'}>
              <Input data-testid="staff-password" type="text" autoComplete="new-password" value={edit.password ?? ''} onChange={(e) => setEdit({ ...edit, password: e.target.value })} />
            </Field>
          </div>
          {!edit.isNew ? (
            <label className="check"><input type="checkbox" checked={edit.active} onChange={(e) => setEdit({ ...edit, active: e.target.checked })} /> Can sign in</label>
          ) : null}
        </Modal>
      ) : null}
    </div>
  );
}
