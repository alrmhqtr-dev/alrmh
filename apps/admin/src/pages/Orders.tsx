import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { ArrowRight, Download, Search } from 'lucide-react';
import { api, downloadCsv, errorMessage } from '../lib/api';
import { useAuth } from '../lib/auth';
import { STAGES, STAGE_LABEL, date, dateTime, money, phone, todayQatar } from '../lib/format';
import { Empty, Field, Input, Loading, Modal, PageHead, StageBadge, Tabs, useToast } from '../ui';

export type OrderRow = {
  id: string;
  number: string;
  stage: string;
  total: number;
  created_at: string;
  expected_delivery: string | null;
  customer_id: string;
  customer_name: string;
  phone: string;
  thobe_count: number;
  item_count: number;
  next_appointment: string | null;
};

const BOARD = ['confirmed', 'measured', 'cutting', 'stitching', 'ready', 'out_for_delivery'] as const;
export const nextStage = (stage: string, hasThobes: boolean) => {
  const flow = hasThobes ? [...STAGES] : ['confirmed', 'ready', 'out_for_delivery', 'delivered'];
  const i = flow.indexOf(stage as any);
  return i >= 0 && i < flow.length - 1 ? flow[i + 1] : null;
};

export default function Orders() {
  const [params, setParams] = useSearchParams();
  const [view, setView] = useState<'board' | 'list'>(params.get('stage') ? 'list' : 'board');
  const [q, setQ] = useState('');
  const stage = params.get('stage') ?? '';
  const nav = useNavigate();
  const qc = useQueryClient();
  const toast = useToast();
  const { can } = useAuth();
  const orders = useQuery({
    queryKey: ['orders', view === 'list' ? stage : '', q],
    queryFn: () => api<OrderRow[]>(`/orders?${new URLSearchParams({ ...(view === 'list' && stage ? { stage } : {}), ...(q ? { q } : {}) })}`),
    refetchInterval: 30_000,
  });
  const move = useMutation({
    mutationFn: ({ id, to }: { id: string; to: string }) => api(`/orders/${id}/stage`, { body: { stage: to } }),
    onSuccess: (_, v) => {
      toast(`Moved to ${STAGE_LABEL[v.to]}. The customer was notified.`);
      qc.invalidateQueries({ queryKey: ['orders'] });
      qc.invalidateQueries({ queryKey: ['overview'] });
    },
    onError: (e) => toast(errorMessage(e), 'error'),
  });
  const today = todayQatar();
  const [exportOpen, setExportOpen] = useState(false);
  const [range, setRange] = useState({ from: `${today.slice(0, 8)}01`, to: today });
  const [exporting, setExporting] = useState(false);
  const exportCsv = async () => {
    setExporting(true);
    try {
      await downloadCsv(`/export/orders.csv?from=${range.from}&to=${range.to}`, 'alrmh-orders.csv');
      setExportOpen(false);
    } catch (e) {
      toast(errorMessage(e), 'error');
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="stack lg">
      <PageHead title="Orders" sub="Move orders through the workshop. Each move notifies the customer.">
        <div className="row" style={{ position: 'relative' }}>
          <Search size={16} style={{ position: 'absolute', left: 12, color: 'var(--muted)' }} />
          <input className="input" data-testid="orders-search" placeholder="Order #, name or phone" value={q} onChange={(e) => setQ(e.target.value)} style={{ paddingLeft: 34, width: 240 }} />
        </div>
        <Tabs value={view} onChange={setView} options={[['board', 'Board'], ['list', 'List']]} />
        {can('owner', 'manager') ? (
          <button className="btn secondary" data-testid="export-orders" onClick={() => setExportOpen(true)}>
            <Download size={16} /> Export
          </button>
        ) : null}
      </PageHead>
      {exportOpen ? (
        <Modal
          title="Export paid orders"
          onClose={() => setExportOpen(false)}
          footer={
            <>
              <button className="btn secondary" onClick={() => setExportOpen(false)}>Cancel</button>
              <button className="btn" data-testid="export-orders-go" disabled={exporting} onClick={exportCsv}>Download CSV</button>
            </>
          }
        >
          <div className="note">Orders paid between these dates, with totals, discounts and refunds. Opens in Excel or Google Sheets.</div>
          <div className="grid k2">
            <Field label="From"><Input type="date" value={range.from} onChange={(e) => setRange({ ...range, from: e.target.value })} /></Field>
            <Field label="To"><Input type="date" value={range.to} onChange={(e) => setRange({ ...range, to: e.target.value })} /></Field>
          </div>
        </Modal>
      ) : null}

      {!orders.data ? (
        <Loading />
      ) : view === 'board' ? (
        <div className="board">
          {BOARD.map((s) => {
            const list = orders.data.filter((o) => o.stage === s);
            return (
              <div key={s} className="col" data-testid={`col-${s}`}>
                <div className="col-head">
                  <span>{STAGE_LABEL[s]}</span>
                  <span className="badge outline">{list.length}</span>
                </div>
                {list.map((o) => {
                  const next = nextStage(o.stage, o.thobe_count > 0);
                  const late = o.expected_delivery && o.expected_delivery < today;
                  return (
                    <div key={o.id} className={`ticket ${late ? 'late' : ''}`} data-testid={`ticket-${o.number}`}>
                      <Link to={`/orders/${o.id}`} className="stack" style={{ gap: 2 }}>
                        <div className="row spread">
                          <span className="strong">#{o.number}</span>
                          <span className="small muted">{o.thobe_count ? `${o.thobe_count} thobe${o.thobe_count > 1 ? 's' : ''}` : `${o.item_count} items`}</span>
                        </div>
                        <span className="small secondary">{o.customer_name}</span>
                        <span className={`small ${late ? 'error-text' : 'muted'}`}>
                          {o.stage === 'confirmed' && o.next_appointment ? `Measuring ${dateTime(o.next_appointment)}` : o.expected_delivery ? `Due ${date(o.expected_delivery)}` : ''}
                        </span>
                      </Link>
                      {next && can('owner', 'manager', 'tailor') ? (
                        <button className="btn sm secondary" data-testid={`advance-${o.number}`} disabled={move.isPending} onClick={() => move.mutate({ id: o.id, to: next })}>
                          {STAGE_LABEL[next]} <ArrowRight size={14} />
                        </button>
                      ) : null}
                    </div>
                  );
                })}
                {!list.length ? <div className="small muted" style={{ padding: 6 }}>Nothing here</div> : null}
              </div>
            );
          })}
        </div>
      ) : (
        <div className="stack">
          <div className="chips">
            {['', ...STAGES, 'cancelled'].map((s) => (
              <button key={s || 'all'} className={`chip ${stage === s ? 'on' : ''}`} onClick={() => setParams(s ? { stage: s } : {})}>
                {s ? STAGE_LABEL[s] : 'All'}
              </button>
            ))}
          </div>
          <div className="card table-wrap">
            {orders.data.length ? (
              <table>
                <thead>
                  <tr>
                    <th>Order</th>
                    <th>Customer</th>
                    <th>Stage</th>
                    <th>Placed</th>
                    <th>Due</th>
                    <th className="right">Total</th>
                  </tr>
                </thead>
                <tbody>
                  {orders.data.map((o) => (
                    <tr key={o.id} className="click" onClick={() => nav(`/orders/${o.id}`)}>
                      <td className="strong">#{o.number}</td>
                      <td>
                        <div>{o.customer_name}</div>
                        <div className="small muted">{phone(o.phone)}</div>
                      </td>
                      <td><StageBadge stage={o.stage} /></td>
                      <td className="small">{date(o.created_at)}</td>
                      <td className="small">{date(o.expected_delivery)}</td>
                      <td className="right num">{money(o.total)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <Empty>No orders match.</Empty>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
