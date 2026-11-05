import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useParams } from 'react-router-dom';
import { Plus, Ruler } from 'lucide-react';
import { api, errorMessage } from '../lib/api';
import { useAuth } from '../lib/auth';
import { RELATION, date, money, num, phone } from '../lib/format';
import { MeasureModal, MeasurementGrid, type Measurement } from '../measure';
import { Empty, Field, Input, Loading, Modal, PageHead, StageBadge, useToast } from '../ui';

type Detail = {
  id: string;
  name: string | null;
  phone: string;
  email: string | null;
  language: string;
  created_at: string;
  balance: number;
  family: { id: string; name: string; relation: string; size: string; latest: Measurement | null; measurement_count: number }[];
  addresses: { id: string; label: string; line1: string; area: string; city: string; notes: string | null; is_default: boolean }[];
  orders: { id: string; number: string; stage: string; total: number; created_at: string }[];
  ledger: { id: string; kind: string; points: number; remaining: number; expires_at: string | null; label: string | null; created_at: string; staff_name: string | null }[];
  vouchers: { id: string; code: string; kind: string; percent: number | null; status: string; expires_at: string }[];
};

export default function CustomerDetail() {
  const { id = '' } = useParams();
  const { can } = useAuth();
  const toast = useToast();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['customer', id], queryFn: () => api<Detail>(`/customers/${id}`) });
  const cat = useQuery({ queryKey: ['catalogue'], queryFn: () => api<{ products: { id: string; name_en: string }[] }>('/catalogue') });
  const label = (l: string | null, kind: string) => {
    if (!l) return kind;
    if (l.startsWith('Reward: ')) return `Reward: ${cat.data?.products.find((p) => p.id === l.slice(8))?.name_en ?? l.slice(8)}`;
    return l;
  };
  const [measure, setMeasure] = useState<{ id: string; name: string; prev: Measurement | null } | null>(null);
  const [adjust, setAdjust] = useState(false);
  const [points, setPoints] = useState('');
  const [reason, setReason] = useState('');
  const adj = useMutation({
    mutationFn: () => api<{ balance: number }>(`/customers/${id}/points`, { body: { points: Number(points), reason } }),
    onSuccess: (r) => {
      toast(`Points updated. New balance ${num(r.balance)}.`);
      setAdjust(false);
      setPoints('');
      setReason('');
      qc.invalidateQueries({ queryKey: ['customer', id] });
    },
    onError: (e) => toast(errorMessage(e), 'error'),
  });

  if (!q.data) return <Loading />;
  const c = q.data;
  return (
    <div className="stack lg">
      <PageHead title={c.name ?? phone(c.phone)} sub={`${phone(c.phone)}${c.email ? ` · ${c.email}` : ''} · ${c.language === 'ar' ? 'Arabic' : 'English'} · joined ${date(c.created_at)}`} />

      <div className="grid" style={{ gridTemplateColumns: 'minmax(0, 2fr) minmax(280px, 1fr)', alignItems: 'start' }}>
        <div className="stack lg">
          <h2>Family & measurements</h2>
          {c.family.map((m) => (
            <div key={m.id} className="card pad stack" data-testid={`member-${m.name}`}>
              <div className="row spread">
                <div>
                  <h3>{m.name}</h3>
                  <div className="small secondary">{RELATION[m.relation]} · {m.size === 'child' ? 'Child' : 'Adult'} · {m.measurement_count} record{m.measurement_count === 1 ? '' : 's'}</div>
                </div>
                {can('owner', 'manager', 'tailor') ? (
                  <button className="btn sm" data-testid={`record-${m.name}`} onClick={() => setMeasure({ id: m.id, name: m.name, prev: m.latest })}>
                    <Ruler size={14} /> {m.latest ? 'New measurements' : 'Record measurements'}
                  </button>
                ) : null}
              </div>
              {m.latest ? <MeasurementGrid m={m.latest} /> : <div className="note">Not measured yet.</div>}
            </div>
          ))}
          {!c.family.length ? <div className="card"><Empty>The customer hasn't finished sign-up yet.</Empty></div> : null}

          <h2>Orders</h2>
          <div className="card table-wrap">
            {c.orders.length ? (
              <table>
                <tbody>
                  {c.orders.map((o) => (
                    <tr key={o.id}>
                      <td><Link className="strong" to={`/orders/${o.id}`}>#{o.number}</Link></td>
                      <td><StageBadge stage={o.stage} /></td>
                      <td className="small">{date(o.created_at)}</td>
                      <td className="right num">{money(o.total)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <Empty>No orders yet.</Empty>
            )}
          </div>
        </div>

        <div className="stack lg">
          <div className="card dark pad stack" style={{ gap: 6 }}>
            <div className="overline" style={{ color: 'var(--gold)' }}>Points balance</div>
            <div style={{ fontSize: 30, fontWeight: 600, color: 'var(--gold)' }} className="num" data-testid="points-balance">{num(c.balance)}</div>
            {can('owner', 'manager') ? (
              <button className="btn gold sm" style={{ alignSelf: 'flex-start' }} data-testid="adjust-points" onClick={() => setAdjust(true)}>
                <Plus size={14} /> Adjust points
              </button>
            ) : null}
          </div>
          <div className="card">
            <div className="overline" style={{ padding: '14px 16px 4px' }}>Points history</div>
            <table>
              <tbody>
                {c.ledger.slice(0, 12).map((e) => (
                  <tr key={e.id}>
                    <td>
                      <div className="small strong">{label(e.label, e.kind)}</div>
                      <div className="small muted">{date(e.created_at)}{e.staff_name ? ` · by ${e.staff_name}` : ''}{e.kind === 'earn' && e.expires_at ? ` · expires ${date(e.expires_at)}` : ''}</div>
                    </td>
                    <td className={`right num small strong ${e.points < 0 ? '' : ''}`} style={{ color: e.points > 0 ? 'var(--gold-ink)' : e.kind === 'expire' ? 'var(--error)' : undefined }}>
                      {e.points > 0 ? '+' : '−'}{num(Math.abs(e.points))}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!c.ledger.length ? <Empty>No points yet.</Empty> : null}
          </div>
          {c.vouchers.length ? (
            <div className="card pad stack" style={{ gap: 8 }}>
              <div className="overline">Vouchers</div>
              {c.vouchers.map((v) => (
                <div key={v.id} className="row spread small">
                  <span className="strong">{v.code}</span>
                  <span>{v.kind === 'discount' ? `${v.percent}% off` : 'Product'}</span>
                  <span className={`badge ${v.status === 'active' ? 'gold' : ''}`}>{v.status}</span>
                </div>
              ))}
            </div>
          ) : null}
          <div className="card pad stack" style={{ gap: 8 }}>
            <div className="overline">Addresses</div>
            {c.addresses.map((a) => (
              <div key={a.id} className="small">
                <span className="strong">{a.label}</span> {a.is_default ? <span className="badge">Default</span> : null}
                <div className="secondary">{a.line1}, {a.area}, {a.city}</div>
                {a.notes ? <div className="muted">{a.notes}</div> : null}
              </div>
            ))}
            {!c.addresses.length ? <div className="small muted">No saved addresses.</div> : null}
          </div>
        </div>
      </div>

      {measure ? <MeasureModal memberId={measure.id} memberName={measure.name} previous={measure.prev} onClose={() => setMeasure(null)} /> : null}
      {adjust ? (
        <Modal
          title="Adjust points"
          onClose={() => setAdjust(false)}
          footer={
            <>
              <button className="btn secondary" onClick={() => setAdjust(false)}>Cancel</button>
              <button className="btn" data-testid="adjust-save" disabled={!Number(points) || !reason.trim() || adj.isPending} onClick={() => adj.mutate()}>Save</button>
            </>
          }
        >
          <div className="note">Use a minus sign to remove points, e.g. −200. Added points expire on the normal schedule. The change and your name are recorded.</div>
          <div className="grid k2">
            <Field label="Points">
              <Input data-testid="adjust-points-input" type="number" value={points} onChange={(e) => setPoints(e.target.value)} placeholder="e.g. 100 or -200" />
            </Field>
            <Field label="Reason">
              <Input data-testid="adjust-reason" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Goodwill for late delivery" />
            </Field>
          </div>
        </Modal>
      ) : null}
    </div>
  );
}
