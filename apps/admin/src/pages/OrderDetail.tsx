import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useParams } from 'react-router-dom';
import { ArrowRight, Printer, Ruler } from 'lucide-react';
import { api, errorMessage } from '../lib/api';
import { useAuth } from '../lib/auth';
import { STAGE_LABEL, date, dateTime, money, phone } from '../lib/format';
import { MeasureModal, MeasurementGrid, type Measurement } from '../measure';
import { Field, Input, Loading, Modal, PageHead, StageBadge, TextArea, useToast } from '../ui';
import { nextStage } from './Orders';

type Detail = {
  id: string;
  number: string;
  stage: string;
  total: number;
  subtotal: number;
  delivery_fee: number;
  home_visit_fee: number;
  discount: number;
  discount_label: string | null;
  created_at: string;
  paid_at: string | null;
  expected_delivery: string | null;
  address: { label: string; line1: string; area: string; city: string; notes?: string | null };
  customer_id: string;
  customer_name: string;
  phone: string;
  payment_status: string;
  payment_ref: string | null;
  points_to_earn: number;
  points_awarded: boolean;
  items: { id: string; kind: string; snapshot: any; qty: number; unit_price: number; line_total: number }[];
  events: { stage: string; at: string; note: string | null; staff_name: string | null }[];
  appointments: { id: string; kind: string; starts_at: string; status: string; member_id: string; member_name: string; branch_name: string | null; line1: string | null; area: string | null }[];
  measurements: (Measurement & { member_id: string })[];
  refunds: { id: string; amount: number; reference: string | null; note: string | null; created_at: string; staff_name: string | null }[];
  refunded: number;
  stages: string[];
};

export default function OrderDetail() {
  const { id = '' } = useParams();
  const qc = useQueryClient();
  const toast = useToast();
  const { can } = useAuth();
  const q = useQuery({ queryKey: ['order', id], queryFn: () => api<Detail>(`/orders/${id}`) });
  const [measure, setMeasure] = useState<{ id: string; name: string } | null>(null);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [refundOpen, setRefundOpen] = useState(false);
  const [refund, setRefund] = useState({ amount: '', reference: '', note: '' });
  const recordRefund = useMutation({
    mutationFn: () => api<{ left: number }>(`/orders/${id}/refunds`, { body: { amount: Number(refund.amount), reference: refund.reference, note: refund.note } }),
    onSuccess: (r) => {
      toast(r.left ? `Refund recorded. ${money(r.left)} could still be refunded.` : 'Refund recorded. The customer was notified.');
      setRefundOpen(false);
      refresh();
      qc.invalidateQueries({ queryKey: ['overview'] });
    },
    onError: (e) => toast(errorMessage(e), 'error'),
  });
  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['order', id] });
    qc.invalidateQueries({ queryKey: ['orders'] });
    qc.invalidateQueries({ queryKey: ['overview'] });
  };
  const move = useMutation({
    mutationFn: (to: string) => api(`/orders/${id}/stage`, { body: { stage: to } }),
    onSuccess: (_, to) => {
      toast(`Moved to ${STAGE_LABEL[to]}. The customer was notified.`);
      refresh();
    },
    onError: (e) => toast(errorMessage(e), 'error'),
  });
  const cancel = useMutation({
    mutationFn: () => api<{ refundDue: number }>(`/orders/${id}/cancel`, { body: { reason } }),
    onSuccess: (r) => {
      toast(r.refundDue ? `Order cancelled. Refund ${money(r.refundDue)} in SADAD.` : 'Order cancelled.');
      setCancelOpen(false);
      refresh();
    },
    onError: (e) => toast(errorMessage(e), 'error'),
  });

  if (!q.data) return <Loading />;
  const o = q.data;
  const thobes = o.items.filter((i) => i.kind === 'thobe');
  const next = nextStage(o.stage, thobes.length > 0);
  const discount = o.discount_label?.split(':') ?? [];
  const refundable = Math.round((o.total - o.refunded) * 100) / 100;

  return (
    <div className="stack lg">
      <PageHead
        title={`Order #${o.number}`}
        sub={
          <span className="row wrap" style={{ gap: 8 }}>
            <StageBadge stage={o.stage} /> Placed {dateTime(o.created_at)} · Due {date(o.expected_delivery)}
          </span>
        }
      >
        <button className="btn secondary" onClick={() => window.print()}>
          <Printer size={16} /> Tailor sheet
        </button>
        {next && can('owner', 'manager', 'tailor') ? (
          <button className="btn" data-testid="detail-advance" disabled={move.isPending} onClick={() => move.mutate(next)}>
            Move to {STAGE_LABEL[next]} <ArrowRight size={16} />
          </button>
        ) : null}
        {can('owner', 'manager') && !['delivered', 'cancelled', 'out_for_delivery'].includes(o.stage) ? (
          <button className="btn danger" onClick={() => setCancelOpen(true)}>Cancel order</button>
        ) : null}
        {can('owner', 'manager') && o.paid_at && refundable > 0 ? (
          <button className="btn secondary" data-testid="record-refund" onClick={() => { setRefund({ amount: o.stage === 'cancelled' ? String(refundable) : '', reference: '', note: '' }); setRefundOpen(true); }}>
            Record refund
          </button>
        ) : null}
      </PageHead>
      {o.stage === 'cancelled' && o.paid_at && refundable > 0 ? (
        <div className="note gold" data-testid="refund-due">Refund due: {money(refundable)}. Make it in SADAD, then record it here so the customer is told.</div>
      ) : null}

      <div className="grid" style={{ gridTemplateColumns: 'minmax(0, 2fr) minmax(280px, 1fr)', alignItems: 'start' }}>
        <div className="stack lg">
          {thobes.map((it) => {
            const s = it.snapshot;
            const m = o.measurements.find((x) => x.member_id === s.member?.id);
            const appt = o.appointments.find((a) => a.member_id === s.member?.id);
            return (
              <div key={it.id} className="card pad stack">
                <div className="row spread">
                  <div>
                    <h3>Thobe for {s.member?.name} {it.qty > 1 ? <span className="badge dark">×{it.qty}</span> : null}</h3>
                    <div className="small secondary">{s.member?.relation && s.member.relation !== 'self' ? s.member.relation : 'Account holder'}</div>
                  </div>
                  <span className="num strong">{money(it.line_total)}</span>
                </div>
                <div className="grid k3">
                  <div><div className="overline">Collar</div><div className="strong">{s.thobe?.collar?.name_en}</div></div>
                  <div><div className="overline">Fabric</div><div className="strong">{s.thobe?.fabric?.name_en}</div></div>
                  <div>
                    <div className="overline">Colour</div>
                    <div className="strong row" style={{ gap: 6 }}><span className="swatch" style={{ background: s.thobe?.colour?.hex }} />{s.thobe?.colour?.name_en}</div>
                  </div>
                </div>
                {s.remarks ? <div className="note gold">Customer remarks: “{s.remarks}”</div> : null}
                <div className="divider" />
                <div className="row spread">
                  <div className="overline">Measurements · {s.measureMethod === 'saved' ? 'saved' : s.measureMethod === 'home' ? 'home visit' : 'branch visit'}</div>
                  {can('owner', 'manager', 'tailor') && s.member?.id ? (
                    <button className="btn sm secondary no-print" data-testid={`measure-${s.member.name}`} onClick={() => setMeasure({ id: s.member.id, name: s.member.name })}>
                      <Ruler size={14} /> {m ? 'Update' : 'Record'}
                    </button>
                  ) : null}
                </div>
                {m ? <MeasurementGrid m={m} /> : <div className="note">Not measured yet{appt ? ` · visit booked ${dateTime(appt.starts_at)}` : ''}.</div>}
              </div>
            );
          })}
          {o.items.filter((i) => i.kind !== 'thobe').length ? (
            <div className="card table-wrap">
              <table>
                <thead>
                  <tr><th>Item</th><th>Size</th><th>Qty</th><th className="right">Total</th></tr>
                </thead>
                <tbody>
                  {o.items.filter((i) => i.kind !== 'thobe').map((i) => (
                    <tr key={i.id}>
                      <td>{i.kind === 'reward' ? `Reward: ${i.snapshot.product?.name_en}` : i.snapshot.product?.name_en}</td>
                      <td>{i.snapshot.size ?? '—'}</td>
                      <td>{i.qty}</td>
                      <td className="right num">{i.kind === 'reward' ? 'Free' : money(i.line_total)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
        </div>

        <div className="stack lg">
          <div className="card pad stack">
            <div className="overline">Customer</div>
            <Link to={`/customers/${o.customer_id}`} className="strong">{o.customer_name}</Link>
            <div className="secondary">{phone(o.phone)}</div>
            <div className="divider" />
            <div className="overline">Deliver to</div>
            <div>{o.address.label} · {o.address.line1}, {o.address.area}, {o.address.city}</div>
            {o.address.notes ? <div className="small muted">{o.address.notes}</div> : null}
          </div>
          {o.appointments.length ? (
            <div className="card pad stack">
              <div className="overline">Measurement visits</div>
              {o.appointments.map((a) => (
                <div key={a.id} className="row spread">
                  <div>
                    <div className="strong">{a.member_name}</div>
                    <div className="small secondary">{a.kind === 'home' ? `Home · ${a.line1}, ${a.area}` : `Branch · ${a.branch_name}`}</div>
                  </div>
                  <div className="right small">{dateTime(a.starts_at)}<br /><span className={`badge ${a.status === 'done' ? 'ok' : a.status === 'cancelled' ? 'error' : 'outline'}`}>{a.status}</span></div>
                </div>
              ))}
            </div>
          ) : null}
          <div className="card pad stack" style={{ gap: 8 }}>
            <div className="overline">Payment</div>
            {[
              ['Subtotal', money(o.subtotal)],
              ['Delivery', money(o.delivery_fee)],
              ...(o.home_visit_fee ? [['Home visit', money(o.home_visit_fee)]] : []),
              ...(o.discount ? [[discount[0] === 'coupon' ? `Coupon ${discount[1]} (${discount[2]}%)` : `Voucher ${discount[1]} (${discount[2]}%)`, `− ${money(o.discount)}`]] : []),
            ].map(([a, b]) => (
              <div key={a} className="row spread small"><span className="secondary">{a}</span><span className="num">{b}</span></div>
            ))}
            <div className="divider" />
            <div className="row spread"><span className="strong">Total</span><span className="strong num">{money(o.total)}</span></div>
            {o.refunds.map((r) => (
              <div key={r.id} className="row spread small">
                <span className="secondary">Refunded {date(r.created_at)}{r.reference ? ` · ${r.reference}` : ''}{r.staff_name ? ` · ${r.staff_name}` : ''}</span>
                <span className="num">− {money(r.amount)}</span>
              </div>
            ))}
            <div className="small muted">SADAD · {o.payment_status}{o.payment_ref ? ` · ${o.payment_ref}` : ''}</div>
            <div className="small muted">{o.points_awarded ? `${o.points_to_earn} points awarded` : `${o.points_to_earn} points on delivery`}</div>
          </div>
          <div className="card pad">
            <div className="overline" style={{ marginBottom: 10 }}>History</div>
            <div className="timeline">
              {o.events.map((e, i) => (
                <div key={i} className="tl-item">
                  <div className="tl-dot"><span />{i < o.events.length - 1 ? <i /> : null}</div>
                  <div className="tl-body">
                    <div className="strong">{STAGE_LABEL[e.stage] ?? e.stage}</div>
                    <div className="small muted">{dateTime(e.at)}{e.staff_name ? ` · ${e.staff_name}` : ''}{e.note && e.note !== 'saved' ? ` · ${e.note}` : e.note === 'saved' ? ' · saved measurements' : ''}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {measure ? (
        <MeasureModal memberId={measure.id} memberName={measure.name} previous={o.measurements.find((m) => m.member_id === measure.id)} onClose={() => setMeasure(null)} onSaved={refresh} />
      ) : null}
      {refundOpen ? (
        <Modal
          title={`Record a refund on #${o.number}`}
          onClose={() => setRefundOpen(false)}
          footer={
            <>
              <button className="btn secondary" onClick={() => setRefundOpen(false)}>Cancel</button>
              <button className="btn" data-testid="refund-save" disabled={recordRefund.isPending || !(Number(refund.amount) > 0)} onClick={() => recordRefund.mutate()}>Record refund</button>
            </>
          }
        >
          <div className="note">This records a refund you have already made in SADAD. It does not send money. Up to {money(refundable)} is left on this order.</div>
          <Field label="Amount (QAR)"><Input data-testid="refund-amount" type="number" min={0} step="0.01" max={refundable} value={refund.amount} onChange={(e) => setRefund({ ...refund, amount: e.target.value })} /></Field>
          <Field label="SADAD reference" hint="Optional"><Input data-testid="refund-reference" value={refund.reference} onChange={(e) => setRefund({ ...refund, reference: e.target.value })} /></Field>
          <Field label="Note (internal)"><TextArea value={refund.note} onChange={(e) => setRefund({ ...refund, note: e.target.value })} /></Field>
        </Modal>
      ) : null}
      {cancelOpen ? (
        <Modal
          title={`Cancel #${o.number}?`}
          onClose={() => setCancelOpen(false)}
          footer={
            <>
              <button className="btn secondary" onClick={() => setCancelOpen(false)}>Keep order</button>
              <button className="btn danger" disabled={cancel.isPending} onClick={() => cancel.mutate()}>Cancel order</button>
            </>
          }
        >
          <div className="note">The customer is notified, booked visits are cancelled and any points voucher is returned. {o.paid_at ? `Refund ${money(o.total)} manually in SADAD.` : ''}</div>
          <Field label="Reason (internal)">
            <TextArea value={reason} onChange={(e) => setReason(e.target.value)} />
          </Field>
        </Modal>
      ) : null}
    </div>
  );
}
