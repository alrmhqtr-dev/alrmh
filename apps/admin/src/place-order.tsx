import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { Plus, Trash2 } from 'lucide-react';
import { api, errorMessage } from './lib/api';
import { money, num } from './lib/format';
import { Field, Input, Modal, Select, useToast } from './ui';

type Catalogue = {
  collars: { id: string; name_en: string; active: boolean }[];
  fabrics: { id: string; name_en: string; price: number; active: boolean }[];
};
type Customer = {
  id: string;
  name: string | null;
  family: { id: string; name: string; relation: string; latest: unknown | null }[];
  addresses: { id: string; label: string; line1: string; area: string; is_default: boolean }[];
  tier: { tier: { name_en: string; points_per_thobe: number } };
};
type Line = { collarId: string; fabricId: string; qty: number };

/**
 * The order a customer places at their visit. They chose the type (collar) and
 * the cloth with the tailor and paid on the card machine; the order then shows
 * in their app and earns points for their tier.
 */
export function PlaceOrderModal({
  customerId,
  memberId,
  appointmentId,
  branchId,
  onClose,
}: {
  customerId: string;
  memberId?: string;
  appointmentId?: string;
  branchId?: string | null;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const toast = useToast();
  const navigate = useNavigate();
  const cat = useQuery({ queryKey: ['catalogue'], queryFn: () => api<Catalogue>('/catalogue') });
  const cust = useQuery({ queryKey: ['customer', customerId], queryFn: () => api<Customer>(`/customers/${customerId}`) });
  const branches = useQuery({ queryKey: ['branches'], queryFn: () => api<{ id: string; name_en: string; active: boolean }[]>('/branches') });
  const [member, setMember] = useState(memberId ?? '');
  const [lines, setLines] = useState<Line[]>([{ collarId: '', fabricId: '', qty: 1 }]);
  const [branch, setBranch] = useState(branchId ?? '');
  const [paid, setPaid] = useState(false);

  const collars = (cat.data?.collars ?? []).filter((c) => c.active);
  const fabrics = (cat.data?.fabrics ?? []).filter((f) => f.active);
  const memberId_ = member || cust.data?.family[0]?.id || '';
  const branchId_ = branch || branches.data?.find((b) => b.active)?.id || '';
  const subtotal = lines.reduce((a, l) => a + (fabrics.find((f) => f.id === l.fabricId)?.price ?? 0) * (Number(l.qty) || 0), 0);
  const total = subtotal;
  const thobes = lines.reduce((a, l) => a + (Number(l.qty) || 0), 0);
  const pts = thobes * (cust.data?.tier.tier.points_per_thobe ?? 0);
  const complete = lines.every((l) => l.collarId && l.fabricId && Number(l.qty) >= 1) && memberId_ && branchId_;
  const member_ = useMemo(() => cust.data?.family.find((f) => f.id === memberId_), [cust.data, memberId_]);

  const set = (i: number, patch: Partial<Line>) => setLines((ls) => ls.map((l, k) => (k === i ? { ...l, ...patch } : l)));

  const place = useMutation({
    mutationFn: () =>
      api<{ orderId: string; number: string; total: number; pointsToEarn: number }>(`/customers/${customerId}/orders`, {
        body: {
          memberId: memberId_,
          lines: lines.map((l) => ({ collarId: l.collarId, fabricId: l.fabricId, qty: Number(l.qty) })),
          branchId: branchId_,
          appointmentId,
          paidByCard: paid,
        },
      }),
    onSuccess: (r) => {
      toast(`Order #${r.number} placed. It's in the customer's app now.`);
      qc.invalidateQueries();
      onClose();
      navigate(`/orders/${r.orderId}`);
    },
    onError: (e) => toast(errorMessage(e), 'error'),
  });

  return (
    <Modal
      wide
      title={`New order${cust.data?.name ? ` · ${cust.data.name}` : ''}`}
      onClose={onClose}
      footer={
        <>
          <button className="btn secondary" onClick={onClose}>Cancel</button>
          <button className="btn" data-testid="place-order" disabled={!complete || !paid || place.isPending} onClick={() => place.mutate()}>
            Place order · {money(total)}
          </button>
        </>
      }
    >
      <div className="grid k2">
        <Field label="Thobes for">
          <Select data-testid="po-member" value={memberId_} onChange={(e) => setMember(e.target.value)}>
            {(cust.data?.family ?? []).map((m) => (
              <option key={m.id} value={m.id}>
                {m.name} ({m.relation})
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Tier">
          <Input disabled value={cust.data ? `${cust.data.tier.tier.name_en} · ${cust.data.tier.tier.points_per_thobe} pts per thobe` : ''} />
        </Field>
      </div>
      {member_ && !member_.latest ? <div className="note">No measurements saved for {member_.name} yet. Record them first so the workshop has them.</div> : null}

      <div className="stack" style={{ gap: 8 }}>
        {lines.map((l, i) => (
          <div key={i} className="row" style={{ gap: 8, alignItems: 'flex-end' }}>
            <div style={{ flex: 2 }}>
              <Field label={i ? '' : 'Type'}>
                <Select data-testid={`po-type-${i}`} value={l.collarId} onChange={(e) => set(i, { collarId: e.target.value })}>
                  <option value="">Choose…</option>
                  {collars.map((c) => <option key={c.id} value={c.id}>{c.name_en}</option>)}
                </Select>
              </Field>
            </div>
            <div style={{ flex: 2 }}>
              <Field label={i ? '' : 'Cloth'}>
                <Select data-testid={`po-cloth-${i}`} value={l.fabricId} onChange={(e) => set(i, { fabricId: e.target.value })}>
                  <option value="">Choose…</option>
                  {fabrics.map((f) => <option key={f.id} value={f.id}>{f.name_en} · {money(f.price)}</option>)}
                </Select>
              </Field>
            </div>
            <div style={{ width: 90 }}>
              <Field label={i ? '' : 'Thobes'}>
                <Input data-testid={`po-qty-${i}`} type="number" min={1} max={20} value={l.qty} onChange={(e) => set(i, { qty: e.target.value as any })} />
              </Field>
            </div>
            {lines.length > 1 ? (
              <button className="btn ghost icon-btn" aria-label="Remove line" onClick={() => setLines((ls) => ls.filter((_, k) => k !== i))}>
                <Trash2 size={16} />
              </button>
            ) : null}
          </div>
        ))}
        {lines.length < 10 ? (
          <button className="btn sm secondary" style={{ alignSelf: 'flex-start' }} data-testid="po-add-line" onClick={() => setLines((ls) => [...ls, { collarId: '', fabricId: '', qty: 1 }])}>
            <Plus size={14} /> Another type or cloth
          </button>
        ) : null}
      </div>

      <Field label="Collect from" hint="Thobes are collected from the branch when they're ready.">
        <Select data-testid="po-branch" value={branchId_} onChange={(e) => setBranch(e.target.value)}>
          {(branches.data ?? []).filter((b) => b.active).map((b) => <option key={b.id} value={b.id}>{b.name_en}</option>)}
        </Select>
      </Field>

      <div className="card pad" style={{ background: 'var(--subtle)' }}>
        <div className="row spread"><span className="secondary">{num(thobes)} thobes</span><span className="num">{money(subtotal)}</span></div>
        <div className="row spread strong"><span>Total</span><span className="num" data-testid="po-total">{money(total)}</span></div>
        <div className="small muted">Earns {num(pts)} points when collected.</div>
      </div>

      <label className="check">
        <input type="checkbox" data-testid="po-paid" checked={paid} onChange={(e) => setPaid(e.target.checked)} /> {money(total)} was paid on the card machine
      </label>
    </Modal>
  );
}
