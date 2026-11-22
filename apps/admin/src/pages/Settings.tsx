import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, errorMessage } from '../lib/api';
import { L, t } from '../lib/i18n';
import { useAuth } from '../lib/auth';
import { Field, Input, Loading, PageHead, useToast, confirmSave } from '../ui';

type S = {
  delivery_fee: number;
  home_visit_fee: number;
  appointment_fee: number;
  lead_working_days: number;
  measurements_valid_months: number;
  points: { expiry_months: number; warn_days: number };
  support: { whatsapp: string; phone: string };
};

export default function Settings() {
  const { can } = useAuth();
  const editable = can('manage');
  const qc = useQueryClient();
  const toast = useToast();
  const q = useQuery({ queryKey: ['settings'], queryFn: () => api<S>('/settings') });
  const [s, setS] = useState<S | null>(null);
  useEffect(() => {
    if (q.data) setS(q.data);
  }, [q.data]);
  const save = useMutation({
    mutationFn: () =>
      api<S>('/settings', {
        method: 'PATCH',
        body: {
          delivery_fee: Number(s!.delivery_fee),
          home_visit_fee: Number(s!.home_visit_fee),
          appointment_fee: Number(s!.appointment_fee),
          lead_working_days: Number(s!.lead_working_days),
          measurements_valid_months: Number(s!.measurements_valid_months),
          points: { expiry_months: Number(s!.points.expiry_months), warn_days: Number(s!.points.warn_days) },
          support: s!.support,
        },
      }),
    onSuccess: (next) => {
      toast(t('Saved. Checkout and rewards use the new values now.', 'تم الحفظ. يستخدم الدفع والمكافآت القيم الجديدة الآن.'));
      qc.setQueryData(['settings'], next);
    },
    onError: (e) => toast(errorMessage(e), 'error'),
  });
  if (!s) return <Loading />;
  const set = (patch: Partial<S>) => setS({ ...s, ...patch });
  const setP = (patch: Partial<S['points']>) => setS({ ...s, points: { ...s.points, ...patch } });

  return (
    <div className="stack lg">
      <PageHead title={t('Fees & rules', 'الرسوم والقواعد')} sub={t('Prices and rules the app applies at checkout and in rewards.', 'الأسعار والقواعد التي يطبقها التطبيق عند الدفع وفي المكافآت.')}>
        {editable ? <button className="btn" data-testid="settings-save" disabled={save.isPending} onClick={async () => (await confirmSave()) && save.mutate()}>{t('Save changes', 'حفظ التغييرات')}</button> : null}
      </PageHead>
      <div className="grid k2" style={{ alignItems: 'start' }}>
        <div className="card pad stack lg">
          <h2>{t('Fees & timing', 'الرسوم والمواعيد')}</h2>
          <div className="grid k2">
            <Field label={t('Appointment booking fee (QAR)', 'رسوم حجز الموعد (ر.ق)')} hint={t('Paid in the app when a customer books a visit (New order). 0 makes booking free.', 'تُدفع في التطبيق عند حجز زيارة (طلب جديد). 0 يجعل الحجز مجانيًا.')}>
              <Input data-testid="appointment-fee" disabled={!editable} type="number" min={0} value={s.appointment_fee} onChange={(e) => set({ appointment_fee: e.target.value as any })} />
            </Field>
            <Field label={t('Delivery fee (QAR)', 'رسوم التوصيل (ر.ق)')}><Input data-testid="delivery-fee" disabled={!editable} type="number" min={0} value={s.delivery_fee} onChange={(e) => set({ delivery_fee: e.target.value as any })} /></Field>
            <Field label={t('Home visit fee (QAR)', 'رسوم الزيارة المنزلية (ر.ق)')} hint={t('Only for a home visit added while designing a thobe.', 'فقط للزيارة المنزلية المضافة أثناء تصميم الثوب.')}><Input data-testid="home-fee" disabled={!editable} type="number" min={0} value={s.home_visit_fee} onChange={(e) => set({ home_visit_fee: e.target.value as any })} /></Field>
            <Field label={t('Ready in (working days)', 'الجاهزية خلال (أيام عمل)')} hint={t('After measurement. Fridays don\'t count.', 'بعد القياس. لا تُحتسب أيام الجمعة.')}><Input disabled={!editable} type="number" min={1} value={s.lead_working_days} onChange={(e) => set({ lead_working_days: e.target.value as any })} /></Field>
            <Field label={t('Re-measure after (months)', 'إعادة القياس بعد (أشهر)')} hint={t('Older measurements show a reminder.', 'تظهر تذكرة للمقاسات الأقدم.')}><Input disabled={!editable} type="number" min={1} value={s.measurements_valid_months} onChange={(e) => set({ measurements_valid_months: e.target.value as any })} /></Field>
          </div>
          <div className="divider" />
          <h3>{t('Customer support', 'خدمة العملاء')}</h3>
          <div className="grid k2">
            <Field label={t('WhatsApp number', 'رقم واتساب')}><Input disabled={!editable} value={s.support.whatsapp} onChange={(e) => set({ support: { ...s.support, whatsapp: e.target.value } })} /></Field>
            <Field label={t('Phone number', 'رقم الهاتف')}><Input disabled={!editable} value={s.support.phone} onChange={(e) => set({ support: { ...s.support, phone: e.target.value } })} /></Field>
          </div>
        </div>
        <div className="card pad stack lg">
          <h2>{t('Points rules', 'قواعد النقاط')}</h2>
          <div className="grid k2">
            <Field label={t('Points expire after (months)', 'تنتهي النقاط بعد (أشهر)')}><Input disabled={!editable} type="number" min={1} value={s.points.expiry_months} onChange={(e) => setP({ expiry_months: e.target.value as any })} /></Field>
            <Field label={t('Warn customers (days before expiry)', 'تنبيه العملاء (أيام قبل الانتهاء)')}><Input disabled={!editable} type="number" min={1} value={s.points.warn_days} onChange={(e) => setP({ warn_days: e.target.value as any })} /></Field>
          </div>
          <div className="note">{t('Points are credited when an order is delivered and are worth QAR 1 each at checkout. How many points each thobe and product earns is set per tier on the Rewards page.', 'تُضاف النقاط عند تسليم الطلب وقيمة كل نقطة 1 ر.ق عند الدفع. عدد نقاط كل ثوب ومنتج يُحدد لكل فئة في صفحة المكافآت.')}</div>
        </div>
      </div>
    </div>
  );
}
