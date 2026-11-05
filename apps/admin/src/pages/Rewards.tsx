import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
import { api, errorMessage } from '../lib/api';
import { useAuth } from '../lib/auth';
import { date, money, num } from '../lib/format';
import { Field, Input, Loading, Modal, PageHead, Select, useToast } from '../ui';

type Option = { id: string; kind: 'discount' | 'product'; percent: number | null; product_id: string | null; product_name_en: string | null; cost_points: number; active: boolean; redeemed_count: number };
type Coupon = { code: string; percent: number; max_discount: number | null; starts_at: string | null; expires_at: string | null; active: boolean; uses: number };

export default function Rewards() {
  const { can } = useAuth();
  const editable = can('owner', 'manager');
  const qc = useQueryClient();
  const toast = useToast();
  const options = useQuery({ queryKey: ['reward-options'], queryFn: () => api<Option[]>('/reward-options') });
  const coupons = useQuery({ queryKey: ['coupons'], queryFn: () => api<Coupon[]>('/coupons') });
  const products = useQuery({ queryKey: ['catalogue'], queryFn: () => api<{ products: { id: string; name_en: string }[] }>('/catalogue') });
  const [opt, setOpt] = useState<Partial<Option> | null>(null);
  const [cp, setCp] = useState<Partial<Coupon> & { isNew?: boolean } | null>(null);

  const saveOpt = useMutation({
    mutationFn: () =>
      opt!.id
        ? api(`/reward-options/${opt!.id}`, { method: 'PATCH', body: { cost_points: Number(opt!.cost_points), percent: opt!.kind === 'discount' ? Number(opt!.percent) : undefined, active: opt!.active } })
        : api('/reward-options', { body: { kind: opt!.kind, percent: Number(opt!.percent), product_id: opt!.product_id, cost_points: Number(opt!.cost_points) } }),
    onSuccess: () => {
      toast('Reward saved.');
      qc.invalidateQueries({ queryKey: ['reward-options'] });
      setOpt(null);
    },
    onError: (e) => toast(errorMessage(e), 'error'),
  });
  const saveCp = useMutation({
    mutationFn: () => {
      const body = { percent: Number(cp!.percent), max_discount: cp!.max_discount ? Number(cp!.max_discount) : null, expires_at: cp!.expires_at || null, active: cp!.active };
      return cp!.isNew ? api('/coupons', { body: { ...body, code: cp!.code } }) : api(`/coupons/${cp!.code}`, { method: 'PATCH', body });
    },
    onSuccess: () => {
      toast('Coupon saved.');
      qc.invalidateQueries({ queryKey: ['coupons'] });
      setCp(null);
    },
    onError: (e) => toast(errorMessage(e), 'error'),
  });

  if (!options.data || !coupons.data) return <Loading />;
  const now = new Date().toISOString();

  return (
    <div className="stack lg">
      <PageHead title="Rewards & coupons" sub="What customers can redeem with points, and the coupon codes that work at checkout. One discount per order." />

      <div className="card">
        <div className="row spread" style={{ padding: '16px 18px 6px' }}>
          <h2>Redeem with points</h2>
          {editable ? <button className="btn sm" data-testid="add-reward" onClick={() => setOpt({ kind: 'discount', percent: 10, cost_points: 1000, active: true })}><Plus size={14} /> Add reward</button> : null}
        </div>
        <table>
          <thead><tr><th>Reward</th><th className="right">Cost</th><th className="right">Redeemed</th><th>Status</th></tr></thead>
          <tbody>
            {options.data.map((o) => (
              <tr key={o.id} className={editable ? 'click' : ''} onClick={() => editable && setOpt(o)}>
                <td className="strong">{o.kind === 'discount' ? `${o.percent}% off next order` : `Free ${o.product_name_en}`}</td>
                <td className="right num">{num(o.cost_points)} pts</td>
                <td className="right num">{o.redeemed_count}</td>
                <td>{o.active ? <span className="badge ok">Live</span> : <span className="badge">Hidden</span>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="card">
        <div className="row spread" style={{ padding: '16px 18px 6px' }}>
          <h2>Coupon codes</h2>
          {editable ? <button className="btn sm" data-testid="add-coupon" onClick={() => setCp({ isNew: true, code: '', percent: 10, max_discount: null, expires_at: '', active: true })}><Plus size={14} /> Add coupon</button> : null}
        </div>
        <table>
          <thead><tr><th>Code</th><th>Discount</th><th>Expires</th><th className="right">Uses</th><th>Status</th></tr></thead>
          <tbody>
            {coupons.data.map((c) => {
              const expired = c.expires_at && c.expires_at < now;
              return (
                <tr key={c.code} className={editable ? 'click' : ''} data-testid={`coupon-${c.code}`} onClick={() => editable && setCp({ ...c, expires_at: c.expires_at?.slice(0, 10) ?? '' })}>
                  <td className="strong num">{c.code}</td>
                  <td>{c.percent}%{c.max_discount ? ` up to ${money(c.max_discount)}` : ''}</td>
                  <td className="small">{c.expires_at ? date(c.expires_at) : 'No end date'}</td>
                  <td className="right num">{c.uses}</td>
                  <td>{!c.active ? <span className="badge">Off</span> : expired ? <span className="badge error">Expired</span> : <span className="badge ok">Live</span>}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {opt ? (
        <Modal title={opt.id ? 'Edit reward' : 'New reward'} onClose={() => setOpt(null)} footer={<><button className="btn secondary" onClick={() => setOpt(null)}>Cancel</button><button className="btn" data-testid="reward-save" disabled={saveOpt.isPending} onClick={() => saveOpt.mutate()}>Save</button></>}>
          {!opt.id ? (
            <Field label="Type">
              <Select value={opt.kind} onChange={(e) => setOpt({ ...opt, kind: e.target.value as any })}>
                <option value="discount">Percentage off next order</option>
                <option value="product">Free product</option>
              </Select>
            </Field>
          ) : null}
          <div className="grid k2">
            {opt.kind === 'discount' ? (
              <Field label="Discount (%)"><Input type="number" min={1} max={100} value={opt.percent ?? ''} onChange={(e) => setOpt({ ...opt, percent: e.target.value as any })} /></Field>
            ) : (
              <Field label="Product">
                <Select disabled={Boolean(opt.id)} value={opt.product_id ?? ''} onChange={(e) => setOpt({ ...opt, product_id: e.target.value })}>
                  <option value="">Choose…</option>
                  {(products.data?.products ?? []).map((p) => <option key={p.id} value={p.id}>{p.name_en}</option>)}
                </Select>
              </Field>
            )}
            <Field label="Cost (points)"><Input data-testid="reward-cost" type="number" min={1} value={opt.cost_points ?? ''} onChange={(e) => setOpt({ ...opt, cost_points: e.target.value as any })} /></Field>
          </div>
          {opt.id ? <label className="check"><input type="checkbox" checked={opt.active} onChange={(e) => setOpt({ ...opt, active: e.target.checked })} /> Show in the app</label> : null}
        </Modal>
      ) : null}

      {cp ? (
        <Modal title={cp.isNew ? 'New coupon' : `Edit ${cp.code}`} onClose={() => setCp(null)} footer={<><button className="btn secondary" onClick={() => setCp(null)}>Cancel</button><button className="btn" data-testid="coupon-save" disabled={saveCp.isPending} onClick={() => saveCp.mutate()}>Save</button></>}>
          <div className="grid k2">
            <Field label="Code" hint="Letters and numbers, 3–20">
              <Input data-testid="coupon-code" disabled={!cp.isNew} value={cp.code ?? ''} onChange={(e) => setCp({ ...cp, code: e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '') })} />
            </Field>
            <Field label="Discount (%)"><Input data-testid="coupon-percent" type="number" min={1} max={100} value={cp.percent ?? ''} onChange={(e) => setCp({ ...cp, percent: e.target.value as any })} /></Field>
            <Field label="Maximum discount (QAR)" hint="Blank for no cap"><Input type="number" min={0} value={cp.max_discount ?? ''} onChange={(e) => setCp({ ...cp, max_discount: (e.target.value || null) as any })} /></Field>
            <Field label="Expires on" hint="Blank for no end date"><Input type="date" value={cp.expires_at ?? ''} onChange={(e) => setCp({ ...cp, expires_at: e.target.value })} /></Field>
          </div>
          <label className="check"><input type="checkbox" checked={cp.active} onChange={(e) => setCp({ ...cp, active: e.target.checked })} /> Active</label>
        </Modal>
      ) : null}
    </div>
  );
}
