import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { Plus, Trash2 } from 'lucide-react';
import { api, errorMessage } from './lib/api';
import { RELATION, money, num } from './lib/format';
import { L, t } from './lib/i18n';
import { Field, Input, Modal, Select, useToast } from './ui';

type Catalogue = {
  collars: { id: string; name_en: string; name_ar: string; active: boolean }[];
  fabrics: { id: string; name_en: string; name_ar: string; price: number; active: boolean }[];
};
type Customer = {
  id: string;
  name: string | null;
  family: { id: string; name: string; relation: string; latest: unknown | null }[];
  addresses: { id: string; label: string; line1: string; area: string; is_default: boolean }[];
  tier: { tier: { name_en: string; name_ar: string; points_per_thobe: number } };
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
  const branches = useQuery({ queryKey: ['branches'], queryFn: () => api<{ id: string; name_en: string; name_ar: string; active: boolean }[]>('/branches') });
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
      toast(t(`Order #${r.number} placed. It's in the customer's app now.`, `تم تسجيل الطلب #${r.number} ويظهر في تطبيق العميل الآن.`));
      qc.invalidateQueries();
      onClose();
      navigate(`/orders/${r.orderId}`);
    },
    onError: (e) => toast(errorMessage(e), 'error'),
  });

  return (
    <Modal
      wide
      title={`${t('New order', 'طلب جديد')}${cust.data?.name ? ` · ${cust.data.name}` : ''}`}
      onClose={onClose}
      footer={
        <>
          <button className="btn secondary" onClick={onClose}>{t('Cancel', 'إلغاء')}</button>
          <button className="btn" data-testid="place-order" disabled={!complete || !paid || place.isPending} onClick={() => place.mutate()}>
            {t('Place order', 'تسجيل الطلب')} · {money(total)}
          </button>
        </>
      }
    >
      <div className="grid k2">
        <Field label={t('Thobes for', 'الثياب لـ')}>
          <Select data-testid="po-member" value={memberId_} onChange={(e) => setMember(e.target.value)}>
            {(cust.data?.family ?? []).map((m) => (
              <option key={m.id} value={m.id}>
                {m.name} ({RELATION[m.relation]})
              </option>
            ))}
          </Select>
        </Field>
        <Field label={t('Tier', 'الفئة')}>
          <Input disabled value={cust.data ? `${L(cust.data.tier.tier)} · ${cust.data.tier.tier.points_per_thobe} ${t('pts per thobe', 'نقطة لكل ثوب')}` : ''} />
        </Field>
      </div>
      {member_ && !member_.latest ? <div className="note">{t(`No measurements saved for ${member_.name} yet. Record them first so the workshop has them.`, `لا توجد مقاسات محفوظة لـ ${member_.name}. سجّلها أولًا لتصل للورشة.`)}</div> : null}

      <div className="stack" style={{ gap: 8 }}>
        {lines.map((l, i) => (
          <div key={i} className="row" style={{ gap: 8, alignItems: 'flex-end' }}>
            <div style={{ flex: 2 }}>
              <Field label={i ? '' : t('Type', 'النوع')}>
                <Select data-testid={`po-type-${i}`} value={l.collarId} onChange={(e) => set(i, { collarId: e.target.value })}>
                  <option value="">{t('Choose…', 'اختر…')}</option>
                  {collars.map((c) => <option key={c.id} value={c.id}>{L(c)}</option>)}
                </Select>
              </Field>
            </div>
            <div style={{ flex: 2 }}>
              <Field label={i ? '' : t('Cloth', 'القماش')}>
                <Select data-testid={`po-cloth-${i}`} value={l.fabricId} onChange={(e) => set(i, { fabricId: e.target.value })}>
                  <option value="">{t('Choose…', 'اختر…')}</option>
                  {fabrics.map((f) => <option key={f.id} value={f.id}>{L(f)} · {money(f.price)}</option>)}
                </Select>
              </Field>
            </div>
            <div style={{ width: 90 }}>
              <Field label={i ? '' : t('Thobes', 'الثياب')}>
                <Input data-testid={`po-qty-${i}`} type="number" min={1} max={20} value={l.qty} onChange={(e) => set(i, { qty: e.target.value as any })} />
              </Field>
            </div>
            {lines.length > 1 ? (
              <button className="btn ghost icon-btn" aria-label={t('Remove line', 'حذف السطر')} onClick={() => setLines((ls) => ls.filter((_, k) => k !== i))}>
                <Trash2 size={16} />
              </button>
            ) : null}
          </div>
        ))}
        {lines.length < 10 ? (
          <button className="btn sm secondary" style={{ alignSelf: 'flex-start' }} data-testid="po-add-line" onClick={() => setLines((ls) => [...ls, { collarId: '', fabricId: '', qty: 1 }])}>
            <Plus size={14} /> {t('Another type or cloth', 'نوع أو قماش آخر')}
          </button>
        ) : null}
      </div>

      <Field label={t('Collect from', 'الاستلام من')} hint={t("Thobes are collected from the branch when they're ready.", 'تُستلم الثياب من الفرع عند جاهزيتها.')}>
        <Select data-testid="po-branch" value={branchId_} onChange={(e) => setBranch(e.target.value)}>
          {(branches.data ?? []).filter((b) => b.active).map((b) => <option key={b.id} value={b.id}>{L(b)}</option>)}
        </Select>
      </Field>

      <div className="card pad" style={{ background: 'var(--subtle)' }}>
        <div className="row spread"><span className="secondary">{num(thobes)} {t('thobes', 'ثوب')}</span><span className="num">{money(subtotal)}</span></div>
        <div className="row spread strong"><span>{t('Total', 'الإجمالي')}</span><span className="num" data-testid="po-total">{money(total)}</span></div>
        <div className="small muted">{t(`Earns ${num(pts)} points when collected.`, `يكسب ${num(pts)} نقطة عند الاستلام.`)}</div>
      </div>

      <label className="check">
        <input type="checkbox" data-testid="po-paid" checked={paid} onChange={(e) => setPaid(e.target.checked)} /> {t(`${money(total)} was paid on the card machine`, `تم دفع ${money(total)} عبر جهاز البطاقة`)}
      </label>
    </Modal>
  );
}
