import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, errorMessage } from '../lib/api';
import { useAuth } from '../lib/auth';
import { Field, Input, Loading, PageHead, useToast } from '../ui';

type S = {
  delivery_fee: number;
  home_visit_fee: number;
  lead_working_days: number;
  measurements_valid_months: number;
  voucher_valid_days: number;
  points: { thobe_fixed: number; product_per_qar: number; expiry_months: number; warn_days: number };
  support: { whatsapp: string; phone: string };
};

export default function Settings() {
  const { can } = useAuth();
  const editable = can('owner', 'manager');
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
          lead_working_days: Number(s!.lead_working_days),
          measurements_valid_months: Number(s!.measurements_valid_months),
          voucher_valid_days: Number(s!.voucher_valid_days),
          points: { thobe_fixed: Number(s!.points.thobe_fixed), product_per_qar: Number(s!.points.product_per_qar), expiry_months: Number(s!.points.expiry_months), warn_days: Number(s!.points.warn_days) },
          support: s!.support,
        },
      }),
    onSuccess: (next) => {
      toast('Saved. Checkout and rewards use the new values now.');
      qc.setQueryData(['settings'], next);
    },
    onError: (e) => toast(errorMessage(e), 'error'),
  });
  if (!s) return <Loading />;
  const set = (patch: Partial<S>) => setS({ ...s, ...patch });
  const setP = (patch: Partial<S['points']>) => setS({ ...s, points: { ...s.points, ...patch } });
  const perQar = Number(s.points.product_per_qar) > 0 ? Math.round(1 / Number(s.points.product_per_qar)) : 0;

  return (
    <div className="stack lg">
      <PageHead title="Fees & rules" sub="Prices and rules the app applies at checkout and in rewards.">
        {editable ? <button className="btn" data-testid="settings-save" disabled={save.isPending} onClick={() => save.mutate()}>Save changes</button> : null}
      </PageHead>
      <div className="grid k2" style={{ alignItems: 'start' }}>
        <div className="card pad stack lg">
          <h2>Fees & timing</h2>
          <div className="grid k2">
            <Field label="Delivery fee (QAR)"><Input data-testid="delivery-fee" disabled={!editable} type="number" min={0} value={s.delivery_fee} onChange={(e) => set({ delivery_fee: e.target.value as any })} /></Field>
            <Field label="Home visit fee (QAR)"><Input data-testid="home-fee" disabled={!editable} type="number" min={0} value={s.home_visit_fee} onChange={(e) => set({ home_visit_fee: e.target.value as any })} /></Field>
            <Field label="Ready in (working days)" hint="After measurement. Fridays don't count."><Input disabled={!editable} type="number" min={1} value={s.lead_working_days} onChange={(e) => set({ lead_working_days: e.target.value as any })} /></Field>
            <Field label="Re-measure after (months)" hint="Older measurements show a reminder."><Input disabled={!editable} type="number" min={1} value={s.measurements_valid_months} onChange={(e) => set({ measurements_valid_months: e.target.value as any })} /></Field>
          </div>
          <div className="divider" />
          <h3>Customer support</h3>
          <div className="grid k2">
            <Field label="WhatsApp number"><Input disabled={!editable} value={s.support.whatsapp} onChange={(e) => set({ support: { ...s.support, whatsapp: e.target.value } })} /></Field>
            <Field label="Phone number"><Input disabled={!editable} value={s.support.phone} onChange={(e) => set({ support: { ...s.support, phone: e.target.value } })} /></Field>
          </div>
        </div>
        <div className="card pad stack lg">
          <h2>Points rules</h2>
          <div className="grid k2">
            <Field label="Points per custom thobe"><Input data-testid="thobe-points" disabled={!editable} type="number" min={0} value={s.points.thobe_fixed} onChange={(e) => setP({ thobe_fixed: e.target.value as any })} /></Field>
            <Field label="Points per QAR on products" hint={perQar ? `= 1 point per QAR ${perQar}` : 'No points on products'}>
              <Input disabled={!editable} type="number" min={0} step={0.01} value={s.points.product_per_qar} onChange={(e) => setP({ product_per_qar: e.target.value as any })} />
            </Field>
            <Field label="Points expire after (months)"><Input disabled={!editable} type="number" min={1} value={s.points.expiry_months} onChange={(e) => setP({ expiry_months: e.target.value as any })} /></Field>
            <Field label="Warn customers (days before expiry)"><Input disabled={!editable} type="number" min={1} value={s.points.warn_days} onChange={(e) => setP({ warn_days: e.target.value as any })} /></Field>
            <Field label="Vouchers valid for (days)"><Input disabled={!editable} type="number" min={1} value={s.voucher_valid_days} onChange={(e) => set({ voucher_valid_days: e.target.value as any })} /></Field>
          </div>
          <div className="note">Points are credited when an order is delivered. Changes apply to new orders; points already earned keep their dates.</div>
        </div>
      </div>
    </div>
  );
}
