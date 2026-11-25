import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { Check, ChevronRight, CircleCheck, Download } from 'lucide-react';
import { api, downloadCsv, errorMessage } from '../lib/api';
import { useAuth } from '../lib/auth';
import { SHOP_FLOW, STAGES, STAGE_LABEL, THOBE_FLOW, channelLabel, date, stageLabel, dateTime, money, phone, todayQatar } from '../lib/format';
import { t } from '../lib/i18n';
import { Empty, Field, Input, Loading, Modal, PageHead, SearchBox, StageBadge, Tabs, confirmSave, useToast } from '../ui';

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

/** The stages an open order can be at, in order. */
const OPEN_STAGES = ['confirmed', 'measured', 'cutting', 'stitching', 'quality', 'ready', 'out_for_delivery'] as const;
export const nextStage = (stage: string, hasThobes: boolean) => {
  const flow = hasThobes ? THOBE_FLOW : SHOP_FLOW;
  const i = flow.indexOf(stage);
  return i >= 0 && i < flow.length - 1 ? flow[i + 1] : null;
};

/** Short names for the stage pills. */
const pillLabel = (s: string, thobes: boolean) =>
  s === 'measured' ? t('Measurements', 'المقاسات') : s === 'quality' ? t('Quality', 'الجودة') : s === 'confirmed' ? t('Confirmed', 'مؤكد') : stageLabel(s, thobes);

/** Every stage of the order's flow: done ones green with a tick, the current one dark, the rest to come. */
function StageTrack({ o }: { o: OrderRow }) {
  const thobes = o.thobe_count > 0;
  const flow = thobes ? THOBE_FLOW : SHOP_FLOW;
  const at = o.stage === 'delivered' ? flow.length : flow.indexOf(o.stage);
  return (
    <ol className="stage-track" aria-label={t('Stages', 'المراحل')}>
      {flow.map((s, i) => {
        const state = i < at ? 'done' : i === at ? 'now' : 'todo';
        return (
          <li key={s} className={`stage-pill ${state}`} data-testid={`stage-${o.number}-${s}`} data-state={state} aria-current={state === 'now' ? 'step' : undefined}>
            {state === 'done' ? <Check size={13} strokeWidth={3} aria-hidden /> : null}
            {pillLabel(s, thobes)}
            {state === 'done' ? <span className="sr-only"> ({t('done', 'تم')})</span> : null}
          </li>
        );
      })}
    </ol>
  );
}

export default function Orders() {
  const [params, setParams] = useSearchParams();
  const [view, setView] = useState<'stages' | 'list'>(['cancelled', 'delivered'].includes(params.get('stage') ?? '') ? 'list' : 'stages');
  const [q, setQ] = useState('');
  const stage = params.get('stage') ?? '';
  const nav = useNavigate();
  const qc = useQueryClient();
  const toast = useToast();
  const { can } = useAuth();
  const orders = useQuery({
    queryKey: ['orders', view === 'list' ? stage : '', view === 'list' ? 'all' : 'open', q],
    queryFn: () => api<OrderRow[]>(`/orders?${new URLSearchParams({ ...(view === 'list' && stage ? { stage } : {}), ...(q ? { q } : {}), ...(view !== 'list' ? { board: '1' } : {}) })}`),
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
  /**
   * Every stage move asks first.
   * Orders only move forward; handing thobes over needs the balance paid.
   */
  const askMove = async (o: OrderRow, to: string) => {
    const thobes = o.thobe_count > 0;
    const flow = thobes ? THOBE_FLOW : SHOP_FLOW;
    const from = flow.indexOf(o.stage);
    const at = flow.indexOf(to);
    if (at < 0) return toast(t(`#${o.number} doesn't go through ${stageLabel(to, thobes)}.`, `الطلب #${o.number} لا يمر بمرحلة ${stageLabel(to, thobes)}.`), 'error');
    if (at <= from) return toast(t('Orders only move forward.', 'تنتقل الطلبات إلى الأمام فقط.'), 'error');
    if (to === 'delivered' && o.balance > 0) return toast(t(`Take the balance of ${money(o.balance)} first.`, `استلم المتبقي ${money(o.balance)} أولًا.`), 'error');
    const skipped = flow.slice(from + 1, at).map((x) => stageLabel(x, thobes));
    const ok = await confirmSave({
      title: t(`Move #${o.number} to ${stageLabel(to, thobes)}?`, `نقل الطلب #${o.number} إلى ${stageLabel(to, thobes)}؟`),
      message:
        (skipped.length ? t(`It also passes through ${skipped.join(', ')}. `, `سيمر أيضًا بمرحلة ${skipped.join('، ')}. `) : '') +
        (o.customer_name ? t(`${o.customer_name} will be notified.`, `سيتم إبلاغ ${o.customer_name}.`) : t('The customer will be notified.', 'سيتم إبلاغ العميل.')),
      ok: t('Move', 'نقل'),
    });
    if (ok) move.mutate({ id: o.id, to, thobes });
  };
  const today = todayQatar();

  /** One row per order: number, customer, due (or done) date, every stage as a pill, and the move to the next stage. */
  const stageTable = (rows: OrderRow[], done?: boolean) => (
    <table className="stage-table">
      <thead>
        <tr>
          <th>{t('Order', 'الطلب')}</th>
          <th>{t('Customer', 'العميل')}</th>
          <th>{done ? t('Done', 'تم الاستلام') : t('Due', 'التسليم')}</th>
          <th>{t('Stages', 'المراحل')}</th>
          {done ? null : <th><span className="sr-only">{t('Next stage', 'المرحلة التالية')}</span></th>}
        </tr>
      </thead>
      <tbody>
        {rows.map((o) => {
          const thobes = o.thobe_count > 0;
          const next = done ? null : nextStage(o.stage, thobes) ?? (thobes && o.stage === 'confirmed' ? 'measured' : null);
          const late = !done && o.expected_delivery && o.expected_delivery < today && o.stage !== 'ready';
          return (
            <tr key={o.id} className={`click ${late ? 'late' : ''}`} data-testid={`${done ? 'done' : 'row'}-${o.number}`} onClick={() => nav(`/orders/${o.id}`)}>
              <td>
                <Link to={`/orders/${o.id}`} className="strong num" onClick={(e) => e.stopPropagation()}>#{o.number}</Link>
                <div className="small muted">{date(o.created_at)}</div>
              </td>
              <td>
                <div><bdi>{o.customer_name ?? t('Walk-in', 'زبون')}</bdi>{(thobes ? o.thobe_count : o.item_count) > 1 ? <span className="small muted num ltr"> ×{thobes ? o.thobe_count : o.item_count}</span> : null}</div>
                <div className="small muted">{o.phone ? phone(o.phone) : ''}</div>
              </td>
              <td className={`small num ${late ? 'error-text strong' : ''}`}>{done ? date(o.done_at ?? o.created_at) : o.expected_delivery ? date(o.expected_delivery) : '—'}</td>
              <td><StageTrack o={o} /></td>
              {done ? null : (
                <td className="right" onClick={(e) => e.stopPropagation()}>
                  {next && can('workshop') ? (
                    <button
                      className="btn sm secondary nowrap"
                      data-testid={`advance-${o.number}`}
                      disabled={move.isPending}
                      aria-label={`${t('Move to', 'نقل إلى')} ${stageLabel(next, thobes)}`}
                      onClick={() => askMove(o, next)}
                    >
                      {next === 'delivered' ? <CircleCheck size={15} /> : null}
                      {pillLabel(next, thobes)}
                      {next === 'delivered' ? null : <ChevronRight size={15} className="flip-rtl" />}
                    </button>
                  ) : null}
                </td>
              )}
            </tr>
          );
        })}
      </tbody>
    </table>
  );

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
        <Tabs value={view} onChange={setView} options={[['stages', t('Stages', 'المراحل')], ['list', t('All orders', 'كل الطلبات')]]} />
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
      ) : view === 'stages' ? (
        (() => {
          // Oldest first: the order waiting longest is at the top.
          const open = orders.data
            .filter((o) => o.stage !== 'delivered' && o.stage !== 'cancelled' && (!stage || o.stage === stage))
            .sort((a, b) => a.created_at.localeCompare(b.created_at));
          const done = orders.data.filter((o) => o.stage === 'delivered').sort((a, b) => (b.done_at ?? b.created_at).localeCompare(a.done_at ?? a.created_at));
          return (
            <div className="stack lg">
              <div className="stack">
                <div className="chips">
                  {['', ...OPEN_STAGES].map((s) => (
                    <button key={s || 'all'} className={`chip ${stage === s ? 'on' : ''}`} data-testid={`stage-filter-${s || 'all'}`} onClick={() => setParams(s ? { stage: s } : {})}>
                      {s ? pillLabel(s, true) : t('All open', 'كل المفتوحة')} <span className="num muted">{orders.data.filter((o) => (s ? o.stage === s : o.stage !== 'delivered' && o.stage !== 'cancelled')).length}</span>
                    </button>
                  ))}
                </div>
                <div className="card table-wrap" data-testid="stage-list">
                  {open.length ? stageTable(open) : <Empty>{t('No open orders here.', 'لا طلبات مفتوحة هنا.')}</Empty>}
                </div>
              </div>
              {stage ? null : (
                <div className="stack" data-testid="done-section">
                  <div className="row" style={{ gap: 8 }}>
                    <CircleCheck size={18} className="tone-ok" />
                    <h2 className="h3" style={{ margin: 0 }}>{t('Completed', 'المكتملة')}</h2>
                    <span className="badge outline num">{done.length}</span>
                    <span className="small muted">{t('Last 30 days', 'آخر 30 يومًا')}</span>
                  </div>
                  <div className="card table-wrap">
                    {done.length ? stageTable(done, true) : <Empty>{t('Nothing finished in the last 30 days.', 'لا طلبات مكتملة في آخر 30 يومًا.')}</Empty>}
                  </div>
                </div>
              )}
            </div>
          );
        })()
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
