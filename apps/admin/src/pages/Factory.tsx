import { useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate } from 'react-router-dom';
import { Camera, Printer, Trash2 } from 'lucide-react';
import { api, errorMessage, mediaUrl, shrinkImage, uploadImage } from '../lib/api';
import { useAuth } from '../lib/auth';
import { t } from '../lib/i18n';
import { THOBE_FLOW, date, dateTime, money, phone, stageLabel, todayQatar } from '../lib/format';
import { Empty, Field, Input, Loading, Modal, PageHead, SearchBox, StageBadge, openPrint, useToast } from '../ui';

/** مصنع الأثواب › الفواتير: every thobe order the workshop has to make, with its ticket. */
export function FactoryInvoices() {
  const nav = useNavigate();
  const [q, setQ] = useState('');
  const [stage, setStage] = useState('open');
  const list = useQuery({ queryKey: ['factory', q], queryFn: () => api<any[]>(`/orders?kind=thobe${q ? `&q=${encodeURIComponent(q)}` : ''}`), refetchInterval: 30_000 });
  const rows = (list.data ?? []).filter((o) => (stage === 'open' ? !['delivered', 'cancelled'].includes(o.stage) : stage ? o.stage === stage : true));
  const today = todayQatar();
  return (
    <div className="stack lg">
      <PageHead title={t('Thobe factory · invoices', 'مصنع الأثواب · الفواتير')} sub={t('Thobe orders for the workshop. Print the ticket that travels with the cloth.', 'طلبات الثياب للورشة. اطبع الورقة التي ترافق القماش.')}>
        <SearchBox value={q} onChange={setQ} placeholder={t('Order #, name or mobile', 'رقم الطلب أو الاسم أو الجوال')} />
      </PageHead>
      <div className="chips">
        {[['open', t('In the workshop', 'في الورشة')], ...THOBE_FLOW.map((s) => [s, stageLabel(s, true)]), ['', t('All', 'الكل')]].map(([v, label]) => (
          <button key={v || 'all'} className={`chip ${stage === v ? 'on' : ''}`} onClick={() => setStage(v)}>{label}</button>
        ))}
      </div>
      <div className="card table-wrap">
        {!list.data ? <Loading /> : rows.length ? (
          <table>
            <thead><tr><th>#</th><th>{t('Customer', 'العميل')}</th><th>{t('Thobes', 'الثياب')}</th><th>{t('Stage', 'المرحلة')}</th><th>{t('Placed', 'التاريخ')}</th><th>{t('Due', 'التسليم')}</th><th className="right">{t('Balance', 'المتبقي')}</th><th><span className="sr-only">{t('Actions', 'إجراءات')}</span></th></tr></thead>
            <tbody>
              {rows.map((o) => (
                <tr key={o.id} className="click" onClick={() => nav(`/orders/${o.id}`)}>
                  <td className="strong">#{o.number}</td>
                  <td>{o.customer_name}<div className="small muted num">{phone(o.phone)}</div></td>
                  <td className="num">{o.thobe_count}</td>
                  <td><StageBadge stage={o.stage} thobes /></td>
                  <td className="small">{date(o.created_at)}</td>
                  <td className={`small ${o.expected_delivery && o.expected_delivery < today && !['delivered', 'cancelled', 'ready'].includes(o.stage) ? 'tone-error strong' : ''}`}>{date(o.expected_delivery)}</td>
                  <td className={`right num ${o.balance ? 'tone-gold' : 'muted'}`}>{o.balance ? money(o.balance) : '—'}</td>
                  <td className="right" onClick={(e) => e.stopPropagation()}>
                    <button className="btn sm secondary" onClick={() => openPrint(`ticket/${o.id}`)}><Printer size={14} /> {t('Ticket', 'ورقة الخياط')}</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : <Empty>{t('No thobe orders here.', 'لا طلبات ثياب هنا.')}</Empty>}
      </div>
    </div>
  );
}

/** Photos for a thobe order: a style the customer showed, or the finished thobe. */
export function PhotoUploader({ orderId, onDone }: { orderId: string; onDone?: () => void }) {
  const toast = useToast();
  const file = useRef<HTMLInputElement>(null);
  const [caption, setCaption] = useState('');
  const [busy, setBusy] = useState(false);
  const pick = async (f: File | undefined) => {
    if (!f) return;
    setBusy(true);
    try {
      const up = await uploadImage(await shrinkImage(f));
      await api(`/orders/${orderId}/photos`, { body: { url: up.url, caption } });
      setCaption('');
      toast(t('Photo added.', 'تمت إضافة الصورة.'));
      onDone?.();
    } catch (e) {
      toast(errorMessage(e), 'error');
    } finally {
      setBusy(false);
      if (file.current) file.current.value = '';
    }
  };
  return (
    <div className="row wrap">
      <Input placeholder={t('Caption (optional)', 'وصف (اختياري)')} value={caption} onChange={(e) => setCaption(e.target.value)} style={{ maxWidth: 260 }} />
      <input ref={file} type="file" accept="image/jpeg,image/png,image/webp" capture="environment" hidden onChange={(e) => pick(e.target.files?.[0])} />
      <button className="btn secondary" disabled={busy} onClick={() => file.current?.click()}><Camera size={16} /> {busy ? t('Uploading…', 'جارٍ الرفع…') : t('Add photo', 'إضافة صورة')}</button>
    </div>
  );
}

export function ThobePhotos() {
  const qc = useQueryClient();
  const toast = useToast();
  const { can } = useAuth();
  const [q, setQ] = useState('');
  const [view, setView] = useState<any>(null);
  const [addFor, setAddFor] = useState('');
  const orders = useQuery({ queryKey: ['factory', addFor], queryFn: () => api<any[]>(`/orders?kind=thobe&q=${encodeURIComponent(addFor)}`), enabled: addFor.length >= 3 });
  const list = useQuery({ queryKey: ['photos', q], queryFn: () => api<any[]>(`/thobe-photos${q ? `?q=${encodeURIComponent(q)}` : ''}`) });
  const del = useMutation({
    mutationFn: (id: string) => api(`/thobe-photos/${id}/delete`, { method: 'POST' }),
    onSuccess: () => {
      setView(null);
      qc.invalidateQueries({ queryKey: ['photos'] });
    },
    onError: (e) => toast(errorMessage(e), 'error'),
  });
  const target = orders.data?.find((o) => o.number.toLowerCase() === addFor.toLowerCase() || o.number.toLowerCase() === `ar-${addFor}`.toLowerCase());
  return (
    <div className="stack lg">
      <PageHead title={t('Thobe photos', 'صور الأثواب')} sub={t('Styles customers asked for and finished thobes, linked to their orders.', 'التصاميم التي طلبها العملاء والثياب الجاهزة، مرتبطة بطلباتها.')}>
        <SearchBox value={q} onChange={setQ} placeholder={t('Order #, name or caption', 'رقم الطلب أو الاسم أو الوصف')} />
      </PageHead>
      {can('workshop') ? (
        <div className="card pad stack">
          <Field label={t('Add a photo to order', 'إضافة صورة لطلب')} hint={t('Type the order number, e.g. AR-10530.', 'اكتب رقم الطلب، مثل AR-10530.')}>
            <Input value={addFor} onChange={(e) => setAddFor(e.target.value.trim())} placeholder="AR-…" dir="ltr" style={{ maxWidth: 220 }} />
          </Field>
          {target ? (
            <div className="stack" style={{ gap: 6 }}>
              <div className="small secondary">#{target.number} · {target.customer_name}</div>
              <PhotoUploader orderId={target.id} onDone={() => qc.invalidateQueries({ queryKey: ['photos'] })} />
            </div>
          ) : addFor.length >= 3 && orders.data ? <div className="small muted">{t('No thobe order with that number.', 'لا يوجد طلب ثياب بهذا الرقم.')}</div> : null}
        </div>
      ) : null}
      {!list.data ? <Loading /> : list.data.length ? (
        <div className="tiles" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))' }}>
          {list.data.map((p) => (
            <button key={p.id} className="card" style={{ padding: 0, overflow: 'hidden', cursor: 'pointer', textAlign: 'start', font: 'inherit' }} onClick={() => setView(p)}>
              <img src={mediaUrl(p.url)} alt={p.caption ?? ''} style={{ width: '100%', height: 180, objectFit: 'cover', display: 'block' }} />
              <div style={{ padding: 10 }}>
                <div className="strong small">#{p.number}</div>
                <div className="small muted">{p.customer_name}{p.caption ? ` · ${p.caption}` : ''}</div>
              </div>
            </button>
          ))}
        </div>
      ) : <Empty>{t('No photos yet.', 'لا صور بعد.')}</Empty>}
      {view ? (
        <Modal title={`#${view.number}`} onClose={() => setView(null)} wide footer={
          <>
            {can('workshop') ? <button className="btn danger" onClick={() => confirm(t('Delete this photo?', 'حذف الصورة؟')) && del.mutate(view.id)}><Trash2 size={15} /> {t('Delete', 'حذف')}</button> : null}
            <Link className="btn" to={`/orders/${view.order_id}`}>{t('Open order', 'فتح الطلب')}</Link>
          </>
        }>
          <img src={mediaUrl(view.url)} alt={view.caption ?? ''} style={{ width: '100%', borderRadius: 12 }} />
          <div className="small secondary">{view.caption} · {view.staff_name} · {dateTime(view.created_at)}</div>
        </Modal>
      ) : null}
    </div>
  );
}
