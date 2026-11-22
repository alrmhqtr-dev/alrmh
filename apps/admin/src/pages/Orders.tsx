import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { ChevronDown, ChevronRight, CircleCheck, Download } from 'lucide-react';
import { api, downloadCsv, errorMessage } from '../lib/api';
import { useAuth } from '../lib/auth';
import { SHOP_FLOW, STAGES, STAGE_LABEL, THOBE_FLOW, channelLabel, date, stageLabel, dateTime, money, phone, todayQatar } from '../lib/format';
import { t } from '../lib/i18n';
import { Empty, Field, Input, Loading, Modal, PageHead, SearchBox, StageBadge, Tabs, useToast } from '../ui';

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
  channel: string;
  balance: number;
  done_at?: string | null;
};

/** 30/11: the day and month, enough on a one-row card. */
const shortDate = (d: string) => `${Number(d.slice(8, 10))}/${Number(d.slice(5, 7))}`;
const BOARD = ['confirmed', 'measured', 'cutting', 'stitching', 'quality', 'ready', 'out_for_delivery'] as const;
export const nextStage = (stage: string, hasThobes: boolean) => {
  const flow = hasThobes ? THOBE_FLOW : SHOP_FLOW;
  const i = flow.indexOf(stage);
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
    queryFn: () => api<OrderRow[]>(`/orders?${new URLSearchParams({ ...(view === 'list' && stage ? { stage } : {}), ...(q ? { q } : {}), ...(view === 'board' ? { board: '1' } : {}) })}`),
    refetchInterval: 30_000,
  });
  const move = useMutation({
    mutationFn: ({ id, to }: { id: string; to: string; thobes: boolean }) => api(`/orders/${id}/stage`, { body: { stage: to } }),
    onSuccess: (_, v) => {
      toast(t(`Moved to ${stageLabel(v.to, v.thobes)}. The customer was notified.`, `نُقل إلى ${stageLabel(v.to, v.thobes)} وأُبلغ العميل.`));
      qc.invalidateQueries({ queryKey: ['orders'] });
      qc.invalidateQueries({ queryKey: ['overview'] });
    },
    onError: (e) => toast(errorMessage(e), 'error'),
  });
  const today = todayQatar();
  const [showDone, setShowDone] = useState(false);
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
      <PageHead title={t('Workshop orders', 'طلبات الورشة')} sub={t('Move orders through the workshop. Each move notifies the customer.', 'انقل الطلبات بين مراحل الورشة. كل نقل يُبلّغ العميل.')}>
        <SearchBox value={q} onChange={setQ} placeholder={t('Order #, name or phone', 'رقم الطلب أو الاسم أو الجوال')} width={240} testid="orders-search" />
        <Tabs value={view} onChange={setView} options={[['board', t('Board', 'اللوحة')], ['list', t('List', 'القائمة')]]} />
        {can('reports') ? (
          <button className="btn secondary" data-testid="export-orders" onClick={() => setExportOpen(true)}>
            <Download size={16} /> {t('Export', 'تصدير')}
          </button>
        ) : null}
      </PageHead>
      {exportOpen ? (
        <Modal
          title={t('Export paid orders', 'تصدير الطلبات المدفوعة')}
          onClose={() => setExportOpen(false)}
          footer={
            <>
              <button className="btn secondary" onClick={() => setExportOpen(false)}>{t('Cancel', 'إلغاء')}</button>
              <button className="btn" data-testid="export-orders-go" disabled={exporting} onClick={exportCsv}>{t('Download CSV', 'تحميل CSV')}</button>
            </>
          }
        >
          <div className="note">{t('Orders paid between these dates, with totals, discounts and refunds. Opens in Excel or Google Sheets.', 'الطلبات المدفوعة بين هذين التاريخين مع الإجماليات والخصومات والاستردادات. تُفتح في Excel أو Google Sheets.')}</div>
          <div className="grid k2">
            <Field label={t('From', 'من')}><Input type="date" value={range.from} onChange={(e) => setRange({ ...range, from: e.target.value })} /></Field>
            <Field label={t('To', 'إلى')}><Input type="date" value={range.to} onChange={(e) => setRange({ ...range, to: e.target.value })} /></Field>
          </div>
        </Modal>
      ) : null}

      {!orders.data ? (
        <Loading />
      ) : view === 'board' ? (
        <>
          <div className="board">
            {BOARD.map((s) => {
              // Oldest first: the order waiting longest is at the top.
              const list = orders.data.filter((o) => o.stage === s).sort((a, b) => a.created_at.localeCompare(b.created_at));
              return (
                <div key={s} className="col" data-testid={`col-${s}`}>
                  <div className="col-head">
                    <span>{STAGE_LABEL[s]}</span>
                    <span className="badge outline">{list.length}</span>
                  </div>
                  {list.map((o) => {
                    const thobes = o.thobe_count > 0;
                    const next = nextStage(o.stage, thobes);
                    const late = o.expected_delivery && o.expected_delivery < today && o.stage !== 'ready';
                    return (
                      <div key={o.id} className={`ticket row1 ${late ? 'late' : ''}`} data-testid={`ticket-${o.number}`}>
                        <Link to={`/orders/${o.id}`} className="ticket-main" title={`${o.customer_name ?? ''} · ${thobes ? t(`${o.thobe_count} thobes`, `${o.thobe_count} ثوب`) : t(`${o.item_count} items`, `${o.item_count} صنف`)}`}>
                          <span className="strong num">#{o.number}</span>
                          <span className="ticket-name" dir="auto">{o.customer_name ?? t('Walk-in', 'زبون')}</span>
                          {(thobes ? o.thobe_count : o.item_count) > 1 ? <span className="small muted num ltr">×{thobes ? o.thobe_count : o.item_count}</span> : null}
                          {o.expected_delivery ? <span className={`small num ${late ? 'error-text' : 'muted'}`} title={`${t('Due', 'التسليم')} ${date(o.expected_delivery)}`}>{shortDate(o.expected_delivery)}</span> : null}
                        </Link>
                        {next && can('workshop') ? (
                          <button
                            className="ticket-next"
                            data-testid={`advance-${o.number}`}
                            disabled={move.isPending}
                            title={`${t('Move to', 'نقل إلى')} ${stageLabel(next, thobes)}`}
                            aria-label={`${t('Move to', 'نقل إلى')} ${stageLabel(next, thobes)}`}
                            onClick={() => move.mutate({ id: o.id, to: next, thobes })}
                          >
                            {next === 'delivered' ? <CircleCheck size={16} /> : <ChevronRight size={16} className="flip-rtl" />}
                          </button>
                        ) : null}
                      </div>
                    );
                  })}
                  {!list.length ? <div className="small muted" style={{ padding: 6 }}>{t('Nothing here', 'لا شيء هنا')}</div> : null}
                </div>
              );
            })}
          </div>
          {(() => {
            const done = orders.data.filter((o) => o.stage === 'delivered').sort((a, b) => (b.done_at ?? b.created_at).localeCompare(a.done_at ?? a.created_at));
            return (
              <div className="card pad stack" style={{ gap: 8 }} data-testid="done-section">
                <button className="row spread" style={{ background: 'none', border: 0, padding: 0, font: 'inherit', color: 'inherit', cursor: 'pointer' }} aria-expanded={showDone} onClick={() => setShowDone(!showDone)}>
                  <span className="row" style={{ gap: 8 }}>
                    <CircleCheck size={18} className="tone-ok" />
                    <span className="strong">{t('Completed', 'المكتملة')} · {t('Done', 'تم الاستلام')}</span>
                    <span className="badge outline">{done.length}</span>
                  </span>
                  <span className="row small muted" style={{ gap: 4 }}>{t('Last 30 days', 'آخر 30 يومًا')} <ChevronDown size={16} style={{ transform: showDone ? 'rotate(180deg)' : undefined }} /></span>
                </button>
                {showDone ? (
                  done.length ? (
                    <div className="done-list">
                      {done.map((o) => (
                        <Link key={o.id} to={`/orders/${o.id}`} className="ticket row1 done" data-testid={`done-${o.number}`}>
                          <span className="ticket-main">
                            <span className="strong num">#{o.number}</span>
                            <span className="ticket-name" dir="auto">{o.customer_name ?? t('Walk-in', 'زبون')}</span>
                            {(o.thobe_count || o.item_count) > 1 ? <span className="small muted num ltr">×{o.thobe_count || o.item_count}</span> : null}
                            <span className="small muted num">{shortDate(new Date(new Date(o.done_at ?? o.created_at).getTime() + 3 * 3600_000).toISOString().slice(0, 10))}</span>
                          </span>
                        </Link>
                      ))}
                    </div>
                  ) : <div className="small muted">{t('Nothing finished in the last 30 days.', 'لا طلبات مكتملة في آخر 30 يومًا.')}</div>
                ) : null}
              </div>
            );
          })()}
        </>
      ) : (
        <div className="stack">
          <div className="chips">
            {['', ...STAGES, 'cancelled'].map((s) => (
              <button key={s || 'all'} className={`chip ${stage === s ? 'on' : ''}`} onClick={() => setParams(s ? { stage: s } : {})}>
                {s ? STAGE_LABEL[s] : t('All', 'الكل')}
              </button>
            ))}
          </div>
          <div className="card table-wrap">
            {orders.data.length ? (
              <table>
                <thead>
                  <tr>
                    <th>{t('Order', 'الطلب')}</th>
                    <th>{t('Customer', 'العميل')}</th>
                    <th>{t('Channel', 'القناة')}</th>
                    <th>{t('Stage', 'المرحلة')}</th>
                    <th>{t('Placed', 'التاريخ')}</th>
                    <th>{t('Due', 'التسليم')}</th>
                    <th className="right">{t('Total', 'الإجمالي')}</th>
                  </tr>
                </thead>
                <tbody>
                  {orders.data.map((o) => (
                    <tr key={o.id} className="click" onClick={() => nav(`/orders/${o.id}`)}>
                      <td className="strong">#{o.number}</td>
                      <td>
                        <div>{o.customer_name ?? t('Walk-in', 'زبون عابر')}</div>
                        <div className="small muted">{o.phone ? phone(o.phone) : ''}</div>
                      </td>
                      <td className="small">{channelLabel(o.channel)}</td>
                      <td><StageBadge stage={o.stage} thobes={o.thobe_count > 0} /></td>
                      <td className="small">{date(o.created_at)}</td>
                      <td className="small">{date(o.expected_delivery)}</td>
                      <td className="right num">{money(o.total)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <Empty>{t('No orders match.', 'لا طلبات مطابقة.')}</Empty>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
