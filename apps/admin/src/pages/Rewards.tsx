import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Trash2 } from 'lucide-react';
import { api, errorMessage } from '../lib/api';
import { useAuth } from '../lib/auth';
import { date, money, num } from '../lib/format';
import { Field, Input, Loading, Modal, PageHead, useToast } from '../ui';

type Tier = { id: string; name_en: string; name_ar: string; min_points: number; points_per_product: number; points_per_thobe: number; colour: string; customers: number };
type Coupon = { code: string; percent: number; max_discount: number | null; starts_at: string | null; expires_at: string | null; active: boolean; uses: number; per_customer_limit: number | null; max_uses: number | null; min_subtotal: number | null };

export default function Rewards() {
  const { can } = useAuth();
  const editable = can('owner', 'manager');
  const qc = useQueryClient();
  const toast = useToast();
  const tiers = useQuery({ queryKey: ['tiers'], queryFn: () => api<Tier[]>('/tiers') });
  const coupons = useQuery({ queryKey: ['coupons'], queryFn: () => api<Coupon[]>('/coupons') });
  const [tier, setTier] = useState<(Partial<Tier> & { isNew?: boolean }) | null>(null);
  const [cp, setCp] = useState<Partial<Coupon> & { isNew?: boolean } | null>(null);

  const saveTier = useMutation({
    mutationFn: () => {
      const body = {
        name_en: tier!.name_en,
        name_ar: tier!.name_ar,
        min_points: Number(tier!.min_points),
        points_per_product: Number(tier!.points_per_product),
        points_per_thobe: Number(tier!.points_per_thobe),
        colour: tier!.colour,
      };
      return tier!.isNew ? api('/tiers', { body }) : api(`/tiers/${tier!.id}`, { method: 'PATCH', body });
    },
    onSuccess: () => {
      toast('Tier saved. New orders earn at these rates.');
      qc.invalidateQueries({ queryKey: ['tiers'] });
      setTier(null);
    },
    onError: (e) => toast(errorMessage(e), 'error'),
  });
  const deleteTier = useMutation({
    mutationFn: (id: string) => api(`/tiers/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      toast('Tier removed.');
      qc.invalidateQueries({ queryKey: ['tiers'] });
      setTier(null);
    },
    onError: (e) => toast(errorMessage(e), 'error'),
  });
  const saveCp = useMutation({
    mutationFn: () => {
      const body = {
        percent: Number(cp!.percent),
        max_discount: cp!.max_discount ? Number(cp!.max_discount) : null,
        expires_at: cp!.expires_at || null,
        active: cp!.active,
        per_customer_limit: cp!.per_customer_limit ? Number(cp!.per_customer_limit) : null,
        max_uses: cp!.max_uses ? Number(cp!.max_uses) : null,
        min_subtotal: cp!.min_subtotal ? Number(cp!.min_subtotal) : null,
      };
      return cp!.isNew ? api('/coupons', { body: { ...body, code: cp!.code } }) : api(`/coupons/${cp!.code}`, { method: 'PATCH', body });
    },
    onSuccess: () => {
      toast('Coupon saved.');
      qc.invalidateQueries({ queryKey: ['coupons'] });
      setCp(null);
    },
    onError: (e) => toast(errorMessage(e), 'error'),
  });

  if (!tiers.data || !coupons.data) return <Loading />;
  const now = new Date().toISOString();

  return (
    <div className="stack lg">
      <PageHead title="Rewards & coupons" sub="Loyalty tiers and the coupon codes that work at checkout. Points are worth QAR 1 each when customers pay." />

      <div className="card">
        <div className="row spread" style={{ padding: '16px 18px 6px' }}>
          <h2>Tiers</h2>
          {editable ? (
            <button
              className="btn sm"
              data-testid="add-tier"
              onClick={() => setTier({ isNew: true, name_en: '', name_ar: '', min_points: (tiers.data.at(-1)?.min_points ?? 0) + 300, points_per_product: 10, points_per_thobe: 15, colour: '#B8B8B8' })}
            >
              <Plus size={14} /> Add tier
            </button>
          ) : null}
        </div>
        <table>
          <thead><tr><th>Tier</th><th className="right">Reached at</th><th className="right">Per thobe</th><th className="right">Per product</th><th className="right">Customers</th></tr></thead>
          <tbody>
            {tiers.data.map((t) => (
              <tr key={t.id} className={editable ? 'click' : ''} data-testid={`tier-${t.id}`} onClick={() => editable && setTier(t)}>
                <td className="strong">
                  <span style={{ display: 'inline-block', width: 10, height: 10, borderRadius: 5, background: t.colour, marginRight: 8 }} />
                  {t.name_en} <span className="muted small">{t.name_ar}</span>
                </td>
                <td className="right num">{t.min_points ? `${num(t.min_points)} pts` : 'Everyone starts here'}</td>
                <td className="right num">{num(t.points_per_thobe)} pts</td>
                <td className="right num">{num(t.points_per_product)} pts</td>
                <td className="right num">{num(t.customers)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="note" style={{ margin: '0 18px 16px' }}>
          A customer's tier comes from every point they have ever earned, so spending points never moves them down. Thobes and products earn the points of the customer's tier when they order; points arrive on delivery.
        </div>
      </div>

      <div className="card">
        <div className="row spread" style={{ padding: '16px 18px 6px' }}>
          <h2>Coupon codes</h2>
          {editable ? <button className="btn sm" data-testid="add-coupon" onClick={() => setCp({ isNew: true, code: '', percent: 10, max_discount: null, expires_at: '', active: true, per_customer_limit: 1, max_uses: null, min_subtotal: null })}><Plus size={14} /> Add coupon</button> : null}
        </div>
        <table>
          <thead><tr><th>Code</th><th>Discount</th><th>Limits</th><th>Expires</th><th className="right">Uses</th><th>Status</th></tr></thead>
          <tbody>
            {coupons.data.map((c) => {
              const expired = c.expires_at && c.expires_at < now;
              return (
                <tr key={c.code} className={editable ? 'click' : ''} data-testid={`coupon-${c.code}`} onClick={() => editable && setCp({ ...c, expires_at: c.expires_at?.slice(0, 10) ?? '' })}>
                  <td className="strong num">{c.code}</td>
                  <td>{c.percent}%{c.max_discount ? ` up to ${money(c.max_discount)}` : ''}</td>
                  <td className="small">
                    {[c.per_customer_limit ? `${c.per_customer_limit} per customer` : null, c.max_uses ? `${num(c.max_uses)} in total` : null, c.min_subtotal ? `min ${money(c.min_subtotal)}` : null].filter(Boolean).join(' · ') || 'No limits'}
                  </td>
                  <td className="small">{c.expires_at ? date(c.expires_at) : 'No end date'}</td>
                  <td className="right num">{c.uses}{c.max_uses ? ` / ${num(c.max_uses)}` : ''}</td>
                  <td>{!c.active ? <span className="badge">Off</span> : expired ? <span className="badge error">Expired</span> : <span className="badge ok">Live</span>}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {tier ? (
        <Modal
          title={tier.isNew ? 'New tier' : `Edit ${tier.name_en}`}
          onClose={() => setTier(null)}
          footer={
            <>
              {!tier.isNew && tier.min_points !== 0 ? (
                <button className="btn ghost" style={{ marginRight: 'auto', color: 'var(--error)' }} data-testid="tier-delete" disabled={deleteTier.isPending} onClick={() => confirm(`Remove the ${tier.name_en} tier? Customers in it move to the tier below.`) && deleteTier.mutate(tier.id!)}>
                  <Trash2 size={14} /> Remove
                </button>
              ) : null}
              <button className="btn secondary" onClick={() => setTier(null)}>Cancel</button>
              <button className="btn" data-testid="tier-save" disabled={saveTier.isPending} onClick={() => saveTier.mutate()}>Save</button>
            </>
          }
        >
          <div className="grid k2">
            <Field label="Name (English)"><Input data-testid="tier-name-en" value={tier.name_en ?? ''} onChange={(e) => setTier({ ...tier, name_en: e.target.value })} /></Field>
            <Field label="Name (Arabic)"><Input data-testid="tier-name-ar" dir="rtl" value={tier.name_ar ?? ''} onChange={(e) => setTier({ ...tier, name_ar: e.target.value })} /></Field>
            <Field label="Reached at (points ever earned)" hint={tier.min_points === 0 && !tier.isNew ? 'The starting tier stays at 0.' : 'No two tiers can share a threshold.'}>
              <Input data-testid="tier-min" type="number" min={0} disabled={!tier.isNew && tier.min_points === 0} value={tier.min_points ?? ''} onChange={(e) => setTier({ ...tier, min_points: e.target.value as any })} />
            </Field>
            <Field label="Card colour"><Input data-testid="tier-colour" type="color" value={tier.colour ?? '#B8B8B8'} onChange={(e) => setTier({ ...tier, colour: e.target.value.toUpperCase() })} /></Field>
            <Field label="Points per thobe"><Input data-testid="tier-thobe" type="number" min={0} value={tier.points_per_thobe ?? ''} onChange={(e) => setTier({ ...tier, points_per_thobe: e.target.value as any })} /></Field>
            <Field label="Points per product"><Input data-testid="tier-product" type="number" min={0} value={tier.points_per_product ?? ''} onChange={(e) => setTier({ ...tier, points_per_product: e.target.value as any })} /></Field>
          </div>
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
            <Field label="Uses per customer" hint="Blank for no limit"><Input data-testid="coupon-per-customer" type="number" min={1} value={cp.per_customer_limit ?? ''} onChange={(e) => setCp({ ...cp, per_customer_limit: (e.target.value || null) as any })} /></Field>
            <Field label="Total uses" hint="Blank for no limit"><Input data-testid="coupon-max-uses" type="number" min={1} value={cp.max_uses ?? ''} onChange={(e) => setCp({ ...cp, max_uses: (e.target.value || null) as any })} /></Field>
            <Field label="Minimum subtotal (QAR)" hint="Blank for none"><Input data-testid="coupon-min" type="number" min={0} value={cp.min_subtotal ?? ''} onChange={(e) => setCp({ ...cp, min_subtotal: (e.target.value || null) as any })} /></Field>
          </div>
          <label className="check"><input type="checkbox" checked={cp.active} onChange={(e) => setCp({ ...cp, active: e.target.checked })} /> Active</label>
        </Modal>
      ) : null}
    </div>
  );
}
