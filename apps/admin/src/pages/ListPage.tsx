import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { Plus } from 'lucide-react';
import { api, errorMessage } from '../lib/api';
import { useAuth } from '../lib/auth';
import { L, t } from '../lib/i18n';
import { date, money, num } from '../lib/format';
import { BranchSelect, Empty, Field, Input, Loading, Modal, PageHead, Select, TextArea, useToast, confirmSave } from '../ui';
import { LISTS, type ListDef, type ListField } from '../lists';

const toLocal = (iso: string | null | undefined) => (iso ? new Date(new Date(iso).getTime() + 3 * 3600_000).toISOString().slice(0, 16) : '');
const fromLocal = (v: string) => (v ? new Date(`${v}:00+03:00`).toISOString() : null);

/** Products, categories, brands or cloth for a discount, depending on what it applies to. */
function Targets({ appliesTo, value, onChange }: { appliesTo: string; value: string[]; onChange: (v: string[]) => void }) {
  const cat = useQuery({ queryKey: ['catalogue'], queryFn: () => api<any>('/catalogue'), enabled: ['category', 'product', 'fabric'].includes(appliesTo) });
  const brands = useQuery({ queryKey: ['list', 'brands'], queryFn: () => api<any[]>('/lists/brands'), enabled: appliesTo === 'brand' });
  if (appliesTo === 'all') return <div className="small muted">{t('Everything sold.', 'كل ما يُباع.')}</div>;
  const options: { id: string; label: string }[] =
    appliesTo === 'category'
      ? (cat.data?.categories ?? []).map((c: any) => ({ id: c.id, label: L(c) }))
      : appliesTo === 'product'
        ? (cat.data?.products ?? []).map((p: any) => ({ id: p.id, label: `${L(p)} · ${p.sku}` }))
        : appliesTo === 'fabric'
          ? (cat.data?.fabrics ?? []).map((f: any) => ({ id: f.id, label: L(f) }))
          : (brands.data ?? []).map((b) => ({ id: b.id, label: b.name }));
  return (
    <div className="chips" style={{ maxHeight: 160, overflowY: 'auto' }}>
      {options.map((o) => (
        <button key={o.id} type="button" className={`chip ${value.includes(o.id) ? 'on' : ''}`} onClick={() => onChange(value.includes(o.id) ? value.filter((x) => x !== o.id) : [...value, o.id])}>{o.label}</button>
      ))}
      {appliesTo === 'fabric' && !value.length ? <span className="small muted">{t('None picked = all cloth.', 'بدون اختيار = كل الأقمشة.')}</span> : null}
    </div>
  );
}

function FieldInput({ f, value, set, row }: { f: ListField; value: any; set: (v: any) => void; row: Record<string, any> }) {
  switch (f.type) {
    case 'textarea':
      return <TextArea value={value ?? ''} onChange={(e) => set(e.target.value)} style={{ minHeight: 60 }} />;
    case 'number':
    case 'money':
    case 'percent':
      return <Input type="number" inputMode="decimal" min={0} max={f.type === 'percent' ? 100 : undefined} step="any" value={value ?? ''} onChange={(e) => set(e.target.value)} />;
    case 'bool':
      return <label className="check"><input type="checkbox" checked={value !== false} onChange={(e) => set(e.target.checked)} /> {f.label()}</label>;
    case 'select':
      return <Select value={value ?? ''} onChange={(e) => set(e.target.value)}>{(f.options?.() ?? []).map(([v, l]) => <option key={v} value={v}>{l}</option>)}</Select>;
    case 'tags':
      return <Input dir={f.dir} value={Array.isArray(value) ? value.join(', ') : value ?? ''} onChange={(e) => set(e.target.value)} placeholder="S, M, L, XL" />;
    case 'datetime':
      return <Input type="datetime-local" value={toLocal(value)} onChange={(e) => set(fromLocal(e.target.value))} />;
    case 'branch':
      return <BranchSelect value={value ?? ''} onChange={(v) => set(v || null)} />;
    case 'targets':
      return <Targets appliesTo={row.applies_to ?? 'all'} value={Array.isArray(value) ? value : []} onChange={set} />;
    default:
      return <Input dir={f.dir} value={value ?? ''} onChange={(e) => set(e.target.value)} />;
  }
}

export function ListPage({ name }: { name: string }) {
  const def: ListDef = LISTS[name];
  const { can } = useAuth();
  const qc = useQueryClient();
  const toast = useToast();
  const nav = useNavigate();
  const [edit, setEdit] = useState<Record<string, any> | null>(null);
  const list = useQuery({ queryKey: ['list', def.resource], queryFn: () => api<any[]>(`/lists/${def.resource}`) });
  const mayEdit = can(...def.perms);
  const save = useMutation({
    mutationFn: () => {
      const body: Record<string, any> = {};
      for (const f of def.fields) if (edit![f.key] !== undefined) body[f.key] = f.type === 'tags' && typeof edit![f.key] === 'string' ? edit![f.key].split(',').map((s: string) => s.trim()).filter(Boolean) : edit![f.key];
      return edit!.id ? api(`/lists/${def.resource}/${edit!.id}`, { method: 'PATCH', body }) : api(`/lists/${def.resource}`, { body });
    },
    onSuccess: () => {
      toast(t('Saved.', 'تم الحفظ.'));
      setEdit(null);
      qc.invalidateQueries({ queryKey: ['list', def.resource] });
    },
    onError: (e) => toast(errorMessage(e), 'error'),
  });
  const del = useMutation({
    mutationFn: () => api(`/lists/${def.resource}/${edit!.id}/delete`, { method: 'POST' }),
    onSuccess: () => {
      toast(t('Deleted.', 'تم الحذف.'));
      setEdit(null);
      qc.invalidateQueries({ queryKey: ['list', def.resource] });
    },
    onError: (e) => toast(errorMessage(e), 'error'),
  });
  const cell = (row: any, c: ListDef['columns'][number]) => {
    const v = row[c.key];
    switch (c.type) {
      case 'money':
        return <span className="num">{v == null ? '—' : money(v)}</span>;
      case 'percent':
        return <span className="num">{v == null ? '—' : `${num(v)}%`}</span>;
      case 'num':
        return <span className="num">{v == null ? '—' : num(v)}</span>;
      case 'bool':
        return v ? <span className="badge ok">{c.key === 'active' ? t('Active', 'مفعّل') : t('Yes', 'نعم')}</span> : <span className="badge">{c.key === 'active' ? t('Off', 'متوقف') : t('No', 'لا')}</span>;
      case 'tags':
        return <span className="small">{(v ?? []).join(' · ')}</span>;
      case 'bilingual':
        return <span className="strong">{L(row, c.key)}</span>;
      case 'date':
        return <span className="small">{v ? date(v) : '—'}</span>;
      default:
        if (def.resource === 'discounts' && c.key === 'amount') return <span className="num">{row.kind === 'percent' ? `${num(v)}%` : money(v)}</span>;
        if (def.resource === 'discounts' && (c.key === 'applies_to' || c.key === 'channel')) {
          const opts = def.fields.find((f) => f.key === c.key)!.options!();
          return <span className="small">{opts.find(([k]) => k === v)?.[1] ?? v}{c.key === 'applies_to' && row.target_ids?.length ? ` (${row.target_ids.length})` : ''}</span>;
        }
        return <span>{v ?? '—'}</span>;
    }
  };
  return (
    <div className="stack lg">
      <PageHead title={def.title()} sub={def.sub()}>
        {mayEdit ? <button className="btn" data-testid={`add-${def.resource}`} onClick={() => setEdit({ active: true, ...(def.defaults ?? {}) })}><Plus size={16} /> {t('Add', 'أضف')}</button> : null}
      </PageHead>
      <div className="card table-wrap">
        {!list.data ? <Loading /> : list.data.length ? (
          <table data-testid={`list-${def.resource}`}>
            <thead><tr>{def.columns.map((c) => <th key={c.key} className={['money', 'num', 'percent'].includes(c.type ?? '') ? 'right' : ''}>{c.label()}</th>)}</tr></thead>
            <tbody>
              {list.data.map((row) => (
                <tr key={row.id} className={def.link || mayEdit ? 'click' : ''} onClick={() => (def.link ? nav(def.link(row)) : mayEdit ? setEdit({ ...row }) : null)}>
                  {def.columns.map((c, i) => <td key={c.key} className={`${['money', 'num', 'percent'].includes(c.type ?? '') ? 'right' : ''} ${i === 0 ? 'strong' : ''}`}>{cell(row, c)}</td>)}
                </tr>
              ))}
            </tbody>
          </table>
        ) : <Empty>{t('Nothing here yet.', 'لا شيء هنا بعد.')}</Empty>}
      </div>
      {edit ? (
        <Modal
          title={edit.id ? t('Edit', 'تعديل') : t('Add', 'إضافة')}
          onClose={() => setEdit(null)}
          wide
          footer={
            <>
              {edit.id ? <button className="btn danger" onClick={() => confirm(t('Delete this?', 'حذف؟')) && del.mutate()}>{t('Delete', 'حذف')}</button> : null}
              <div className="grow" />
              <button className="btn secondary" onClick={() => setEdit(null)}>{t('Cancel', 'إلغاء')}</button>
              <button className="btn" data-testid="list-save" disabled={save.isPending} onClick={async () => (!edit.id || (await confirmSave())) && save.mutate()}>{t('Save', 'حفظ')}</button>
            </>
          }
        >
          <div className="grid k2">
            {def.fields.map((f) => (
              <div key={f.key} style={f.type === 'textarea' || f.type === 'targets' ? { gridColumn: '1 / -1' } : undefined}>
                {f.type === 'bool' ? (
                  <FieldInput f={f} value={edit[f.key]} set={(v) => setEdit({ ...edit, [f.key]: v })} row={edit} />
                ) : (
                  <Field label={f.label() + (f.required ? ' *' : '')} hint={f.hint?.()}>
                    <FieldInput f={f} value={edit[f.key]} set={(v) => setEdit({ ...edit, [f.key]: v, ...(f.key === 'applies_to' ? { target_ids: [] } : {}) })} row={edit} />
                  </Field>
                )}
              </div>
            ))}
          </div>
          {def.link && edit.id ? <button className="btn ghost" onClick={() => nav(def.link!(edit))}>{t('Open page', 'فتح الصفحة')}</button> : null}
        </Modal>
      ) : null}
    </div>
  );
}

export default ListPage;
