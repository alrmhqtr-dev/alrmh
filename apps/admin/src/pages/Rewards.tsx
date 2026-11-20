import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Trash2 } from 'lucide-react';
import { api, errorMessage } from '../lib/api';
import { L, t } from '../lib/i18n';
import { useAuth } from '../lib/auth';
import { date, money, num } from '../lib/format';
import { Field, Input, Loading, Modal, PageHead, useToast } from '../ui';

type Tier = { id: string; name_en: string; name_ar: string; min_points: number; points_per_product: number; points_per_thobe: number; colour: string; customers: number };
type Coupon = { code: string; percent: number; max_discount: number | null; starts_at: string | null; expires_at: string | null; active: boolean; uses: number; per_customer_limit: number | null; max_uses: number | null; min_subtotal: number | null };

export default function Rewards() {
  const { can } = useAuth();
  const editable = can('manage');
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
      toast(t('Tier saved. New orders earn at these rates.', 'تم حفظ الفئة. الطلبات الجديدة تكسب بهذه المعدلات.'));
      qc.invalidateQueries({ queryKey: ['tiers'] });
      setTier(null);
    },
    onError: (e) => toast(errorMessage(e), 'error'),
  });
  const deleteTier = useMutation({
    mutationFn: (id: string) => api(`/tiers/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      toast(t('Tier removed.', 'تم حذف الفئة.'));
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
      toast(t('Coupon saved.', 'تم حفظ القسيمة.'));
      qc.invalidateQueries({ queryKey: ['coupons'] });
      setCp(null);
    },
    onError: (e) => toast(errorMessage(e), 'error'),
  });

  if (!tiers.data || !coupons.data) return <Loading />;
  const now = new Date().toISOString();

  return (
    <div className="stack lg">
      <PageHead title={t('Rewards & coupons', 'المكافآت والقسائم')} sub={t('Loyalty tiers and the coupon codes that work at checkout. Points are worth QAR 1 each when customers pay.', 'فئات الولاء ورموز القسائم الصالحة عند الدفع. قيمة النقطة 1 ر.ق عند الدفع.')} />

      <div className="card">
        <div className="row spread" style={{ padding: '16px 18px 6px' }}>
          <h2>{t('Tiers', 'الفئات')}</h2>
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
          <thead><tr><th>{t('Tier', 'الفئة')}</th><th className="right">{t('Reached at', 'تُبلغ عند')}</th><th className="right">{t('Per thobe', 'لكل ثوب')}</th><th className="right">{t('Per product', 'لكل منتج')}</th><th className="right">{t('Customers', 'العملاء')}</th></tr></thead>
          <tbody>
            {tiers.data.map((tr) => (
              <tr key={tr.id} className={editable ? 'click' : ''} data-testid={`tier-${tr.id}`} onClick={() => editable && setTier(tr)}>
                <td className="strong">
                  <span style={{ display: 'inline-block', width: 10, height: 10, borderRadius: 5, background: tr.colour, marginInlineEnd: 8 }} />
                  {L(tr)}
                </td>
                <td className="right num">{tr.min_points ? `${num(tr.min_points)} ${t('pts', 'نقطة')}` : t('Everyone starts here', 'يبدأ منها الجميع')}</td>
                <td className="right num">{num(tr.points_per_thobe)} {t('pts', 'نقطة')}</td>
                <td className="right num">{num(tr.points_per_product)} {t('pts', 'نقطة')}</td>
                <td className="right num">{num(tr.customers)}</td>
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
          <h2>{t('Coupon codes', 'رموز القسائم')}</h2>
          {editable ? <button className="btn sm" data-testid="add-coupon" onClick={() => setCp({ isNew: true, code: '', percent: 10, max_discount: null, expires_at: '', active: true, per_customer_limit: 1, max_uses: null, min_subtotal: null })}><Plus size={14} /> {t('Add coupon', 'إضافة قسيمة')}</button> : null}
        </div>
        <table>
          <thead><tr><th>{t('Code', 'الرمز')}</th><th>{t('Discount', 'الخصم')}</th><th>{t('Limits', 'الحدود')}</th><th>{t('Expires', 'تنتهي')}</th><th className="right">{t('Uses', 'الاستخدامات')}</th><th>{t('Status', 'الحالة')}</th></tr></thead>
          <tbody>
            {coupons.data.map((c) => {
              const expired = c.expires_at && c.expires_at < now;
              return (
                <tr key={c.code} className={editable ? 'click' : ''} data-testid={`coupon-${c.code}`} onClick={() => editable && setCp({ ...c, expires_at: c.expires_at?.slice(0, 10) ?? '' })}>
                  <td className="strong num">{c.code}</td>
                  <td>{c.percent}%{c.max_discount ? ` up to ${money(c.max_discount)}` : ''}</td>
                  <td className="small">
                    {[c.per_customer_limit ? `${c.per_customer_limit} ${t('per customer', 'لكل عميل')}` : null, c.max_uses ? `${num(c.max_uses)} ${t('in total', 'إجمالًا')}` : null, c.min_subtotal ? `${t('min', 'حد أدنى')} ${money(c.min_subtotal)}` : null].filter(Boolean).join(' · ') || t('No limits', 'بلا حدود')}
                  </td>
                  <td className="small">{c.expires_at ? date(c.expires_at) : t('No end date', 'بلا تاريخ انتهاء')}</td>
                  <td className="right num">{c.uses}{c.max_uses ? ` / ${num(c.max_uses)}` : ''}</td>
                  <td>{!c.active ? <span className="badge">{t('Off', 'متوقفة')}</span> : expired ? <span className="badge error">{t('Expired', 'منتهية')}</span> : <span className="badge ok">{t('Live', 'فعّالة')}</span>}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {tier ? (
        <Modal
          title={tier.isNew ? t('New tier', 'فئة جديدة') : `${t('Edit', 'تعديل')} ${L(tier)}`}
          onClose={() => setTier(null)}
          footer={
            <>
              {!tier.isNew && tier.min_points !== 0 ? (
                <button className="btn ghost" style={{ marginInlineEnd: 'auto', color: 'var(--error)' }} data-testid="tier-delete" disabled={deleteTier.isPending} onClick={() => confirm(t(`Remove the ${tier.name_en} tier? Customers in it move to the tier below.`, `حذف فئة ${L(tier)}؟ ينتقل عملاؤها إلى الفئة الأدنى.`)) && deleteTier.mutate(tier.id!)}>
                  <Trash2 size={14} /> Remove
                </button>
              ) : null}
              <button className="btn secondary" onClick={() => setTier(null)}>{t('Cancel', 'إلغاء')}</button>
              <button className="btn" data-testid="tier-save" disabled={saveTier.isPending} onClick={() => saveTier.mutate()}>{t('Save', 'حفظ')}</button>
            </>
          }
        >
          <div className="grid k2">
            <Field label={t('Name (English)', 'الاسم (إنجليزي)')}><Input data-testid="tier-name-en" value={tier.name_en ?? ''} onChange={(e) => setTier({ ...tier, name_en: e.target.value })} /></Field>
            <Field label={t('Name (Arabic)', 'الاسم (عربي)')}><Input data-testid="tier-name-ar" dir="rtl" value={tier.name_ar ?? ''} onChange={(e) => setTier({ ...tier, name_ar: e.target.value })} /></Field>
            <Field label={t('Reached at (points ever earned)', 'تُبلغ عند (إجمالي النقاط المكتسبة)')} hint={tier.min_points === 0 && !tier.isNew ? 'The starting tier stays at 0.' : 'No two tiers can share a threshold.'}>
              <Input data-testid="tier-min" type="number" min={0} disabled={!tier.isNew && tier.min_points === 0} value={tier.min_points ?? ''} onChange={(e) => setTier({ ...tier, min_points: e.target.value as any })} />
            </Field>
            <Field label={t('Card colour', 'لون البطاقة')}><Input data-testid="tier-colour" type="color" value={tier.colour ?? '#B8B8B8'} onChange={(e) => setTier({ ...tier, colour: e.target.value.toUpperCase() })} /></Field>
            <Field label={t('Points per thobe', 'نقاط لكل ثوب')}><Input data-testid="tier-thobe" type="number" min={0} value={tier.points_per_thobe ?? ''} onChange={(e) => setTier({ ...tier, points_per_thobe: e.target.value as any })} /></Field>
            <Field label={t('Points per product', 'نقاط لكل منتج')}><Input data-testid="tier-product" type="number" min={0} value={tier.points_per_product ?? ''} onChange={(e) => setTier({ ...tier, points_per_product: e.target.value as any })} /></Field>
          </div>
        </Modal>
      ) : null}

      {cp ? (
        <Modal title={cp.isNew ? 'New coupon' : `Edit ${cp.code}`} onClose={() => setCp(null)} footer={<><button className="btn secondary" onClick={() => setCp(null)}>{t('Cancel', 'إلغاء')}</button><button className="btn" data-testid="coupon-save" disabled={saveCp.isPending} onClick={() => saveCp.mutate()}>{t('Save', 'حفظ')}</button></>}>
          <div className="grid k2">
            <Field label={t('Code', 'الرمز')} hint={t('Letters and numbers, 3–20', 'حروف وأرقام، 3–20')}>
              <Input data-testid="coupon-code" disabled={!cp.isNew} value={cp.code ?? ''} onChange={(e) => setCp({ ...cp, code: e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '') })} />
            </Field>
            <Field label={t('Discount (%)', 'الخصم (%)')}><Input data-testid="coupon-percent" type="number" min={1} max={100} value={cp.percent ?? ''} onChange={(e) => setCp({ ...cp, percent: e.target.value as any })} /></Field>
            <Field label={t('Maximum discount (QAR)', 'الحد الأقصى للخصم (ر.ق)')} hint={t('Blank for no cap', 'فارغ بلا حد')}><Input type="number" min={0} value={cp.max_discount ?? ''} onChange={(e) => setCp({ ...cp, max_discount: (e.target.value || null) as any })} /></Field>
            <Field label={t('Expires on', 'تنتهي في')} hint={t('Blank for no end date', 'فارغ بلا تاريخ انتهاء')}><Input type="date" value={cp.expires_at ?? ''} onChange={(e) => setCp({ ...cp, expires_at: e.target.value })} /></Field>
            <Field label={t('Uses per customer', 'الاستخدام لكل عميل')} hint={t('Blank for no limit', 'فارغ بلا حد')}><Input data-testid="coupon-per-customer" type="number" min={1} value={cp.per_customer_limit ?? ''} onChange={(e) => setCp({ ...cp, per_customer_limit: (e.target.value || null) as any })} /></Field>
            <Field label={t('Total uses', 'إجمالي الاستخدامات')} hint={t('Blank for no limit', 'فارغ بلا حد')}><Input data-testid="coupon-max-uses" type="number" min={1} value={cp.max_uses ?? ''} onChange={(e) => setCp({ ...cp, max_uses: (e.target.value || null) as any })} /></Field>
            <Field label={t('Minimum subtotal (QAR)', 'الحد الأدنى للمجموع (ر.ق)')} hint={t('Blank for none', 'فارغ بلا شرط')}><Input data-testid="coupon-min" type="number" min={0} value={cp.min_subtotal ?? ''} onChange={(e) => setCp({ ...cp, min_subtotal: (e.target.value || null) as any })} /></Field>
          </div>
          <label className="check"><input type="checkbox" checked={cp.active} onChange={(e) => setCp({ ...cp, active: e.target.checked })} /> {t('Active', 'مفعّل')}</label>
        </Modal>
      ) : null}
    </div>
  );
}
