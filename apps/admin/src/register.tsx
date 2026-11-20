import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Banknote } from 'lucide-react';
import { api, errorMessage } from './lib/api';
import { useAuth } from './lib/auth';
import { L, t } from './lib/i18n';
import { dateTime, money } from './lib/format';
import { BranchSelect, Field, Input, Modal, openPrint, useToast } from './ui';

export type RegisterTotals = {
  opening: number;
  cash_sales: number;
  card_sales: number;
  other_sales: number;
  cash_refunds: number;
  card_refunds: number;
  cash_expenses: number;
  cash_supplier: number;
  cash_in: number;
  cash_out: number;
  sales_count: number;
  expected_cash: number;
};
export type RegisterState = { open: false; required: boolean } | { open: true; register: { id: string; branch_id: string; opened_at: string; opening_cash: string; branch_en: string; branch_ar: string }; totals: RegisterTotals };

export const useRegister = () => useQuery({ queryKey: ['register'], queryFn: () => api<RegisterState>('/pos/register'), refetchInterval: 60_000 });

export function OpenRegisterForm({ onDone }: { onDone?: () => void }) {
  const { staff } = useAuth();
  const qc = useQueryClient();
  const toast = useToast();
  const [branch, setBranch] = useState(staff?.branch_id ?? '');
  const [cash, setCash] = useState('0');
  const open = useMutation({
    mutationFn: () => api('/pos/register/open', { body: { branchId: branch || undefined, openingCash: Number(cash) } }),
    onSuccess: () => {
      toast(t('Register open. You can start selling.', 'تم فتح الصندوق. يمكنك البدء بالبيع.'));
      qc.invalidateQueries({ queryKey: ['register'] });
      onDone?.();
    },
    onError: (e) => toast(errorMessage(e), 'error'),
  });
  return (
    <div className="stack">
      <div className="grid k2">
        <Field label={t('Branch', 'الفرع')}>
          <BranchSelect value={branch} onChange={setBranch} all={false} testid="register-branch" />
        </Field>
        <Field label={t('Cash in the drawer', 'النقد في الدرج')} hint={t('Count it before you start.', 'عُدّه قبل أن تبدأ.')}>
          <Input data-testid="register-opening" type="number" inputMode="decimal" min={0} value={cash} onChange={(e) => setCash(e.target.value)} />
        </Field>
      </div>
      <button className="btn" data-testid="register-open" disabled={open.isPending || !(Number(cash) >= 0) || !branch} onClick={() => open.mutate()}>
        <Banknote size={16} /> {t('Open register', 'فتح الصندوق')}
      </button>
    </div>
  );
}

function Row({ label, value, strong }: { label: string; value: number; strong?: boolean }) {
  return (
    <div className={`sum-row ${strong ? 'strong' : ''}`}>
      <span className="secondary">{label}</span>
      <span className="num">{money(value)}</span>
    </div>
  );
}

export function RegisterModal({ onClose }: { onClose: () => void }) {
  const reg = useRegister();
  const qc = useQueryClient();
  const toast = useToast();
  const [move, setMove] = useState<{ kind: 'cash_in' | 'cash_out'; amount: string; note: string } | null>(null);
  const [closing, setClosing] = useState<{ cash: string; card: string; note: string } | null>(null);
  const [closed, setClosed] = useState<any>(null);
  const doMove = useMutation({
    mutationFn: () => api('/pos/register/cash', { body: { kind: move!.kind, amount: Number(move!.amount), note: move!.note } }),
    onSuccess: () => {
      setMove(null);
      qc.invalidateQueries({ queryKey: ['register'] });
      toast(t('Saved.', 'تم الحفظ.'));
    },
    onError: (e) => toast(errorMessage(e), 'error'),
  });
  const doClose = useMutation({
    mutationFn: () => api('/pos/register/close', { body: { countedCash: Number(closing!.cash), countedCard: closing!.card === '' ? null : Number(closing!.card), note: closing!.note } }),
    onSuccess: (r) => {
      setClosed(r);
      setClosing(null);
      qc.invalidateQueries({ queryKey: ['register'] });
    },
    onError: (e) => toast(errorMessage(e), 'error'),
  });
  const s = reg.data;
  return (
    <Modal title={t('Cash register', 'صندوق النقد')} onClose={onClose} wide>
      {closed ? (
        <div className="stack" data-testid="register-closed">
          <div className={`note ${closed.difference === 0 ? '' : 'gold'}`}>
            {closed.difference === 0
              ? t('Closed. The cash matches.', 'تم الإغلاق. النقد مطابق.')
              : closed.difference > 0
                ? t(`Closed. ${money(closed.difference)} more cash than expected.`, `تم الإغلاق. النقد يزيد ${money(closed.difference)} عن المتوقع.`)
                : t(`Closed. ${money(-closed.difference)} less cash than expected.`, `تم الإغلاق. النقد ينقص ${money(-closed.difference)} عن المتوقع.`)}
          </div>
          <Row label={t('Expected cash', 'النقد المتوقع')} value={closed.expected_cash} />
          <Row label={t('Counted cash', 'النقد المعدود')} value={closed.counted_cash} />
          <div className="row">
            <button className="btn secondary" onClick={() => openPrint(`register/${closed.id}`)}>{t('Print summary', 'طباعة الملخص')}</button>
            <button className="btn" onClick={onClose}>{t('Done', 'تم')}</button>
          </div>
        </div>
      ) : !s ? null : !s.open ? (
        <OpenRegisterForm />
      ) : (
        <div className="stack">
          <div className="small secondary">
            {L({ name_en: s.register.branch_en, name_ar: s.register.branch_ar })} · {t('opened', 'فُتح')} {dateTime(s.register.opened_at)} · {s.totals.sales_count} {t('sales', 'عملية بيع')}
          </div>
          <div className="grid k2">
            <div className="card pad stack" style={{ gap: 6 }}>
              <Row label={t('Opening cash', 'النقد الافتتاحي')} value={s.totals.opening} />
              <Row label={t('Cash sales', 'المبيعات النقدية')} value={s.totals.cash_sales} />
              <Row label={t('Cash refunds', 'المردود نقدًا')} value={-s.totals.cash_refunds} />
              <Row label={t('Cash expenses', 'المصاريف النقدية')} value={-s.totals.cash_expenses} />
              <Row label={t('Paid to suppliers', 'مدفوع للموردين')} value={-s.totals.cash_supplier} />
              <Row label={t('Cash in / out', 'إيداع / سحب')} value={s.totals.cash_in - s.totals.cash_out} />
              <div className="divider" />
              <Row label={t('Expected in drawer', 'المتوقع في الدرج')} value={s.totals.expected_cash} strong />
            </div>
            <div className="card pad stack" style={{ gap: 6 }}>
              <Row label={t('Card', 'بطاقة')} value={s.totals.card_sales} />
              <Row label={t('Card refunds', 'المردود للبطاقة')} value={-s.totals.card_refunds} />
              <Row label={t('Bank transfer and cheque', 'تحويل بنكي وشيك')} value={s.totals.other_sales} />
            </div>
          </div>
          {move ? (
            <div className="card pad stack">
              <div className="grid k2">
                <Field label={move.kind === 'cash_in' ? t('Cash added', 'المبلغ المضاف') : t('Cash taken out', 'المبلغ المسحوب')}>
                  <Input type="number" inputMode="decimal" value={move.amount} onChange={(e) => setMove({ ...move, amount: e.target.value })} autoFocus />
                </Field>
                <Field label={t('Reason', 'السبب')}>
                  <Input value={move.note} onChange={(e) => setMove({ ...move, note: e.target.value })} />
                </Field>
              </div>
              <div className="row">
                <button className="btn secondary" onClick={() => setMove(null)}>{t('Cancel', 'إلغاء')}</button>
                <button className="btn" disabled={!(Number(move.amount) > 0) || doMove.isPending} onClick={() => doMove.mutate()}>{t('Save', 'حفظ')}</button>
              </div>
            </div>
          ) : closing ? (
            <div className="card pad stack">
              <div className="grid k2">
                <Field label={t('Cash counted', 'النقد المعدود')}>
                  <Input data-testid="register-counted" type="number" inputMode="decimal" value={closing.cash} onChange={(e) => setClosing({ ...closing, cash: e.target.value })} autoFocus />
                </Field>
                <Field label={t('Card machine total (optional)', 'إجمالي جهاز البطاقة (اختياري)')}>
                  <Input type="number" inputMode="decimal" value={closing.card} onChange={(e) => setClosing({ ...closing, card: e.target.value })} />
                </Field>
              </div>
              <Field label={t('Note', 'ملاحظة')}>
                <Input value={closing.note} onChange={(e) => setClosing({ ...closing, note: e.target.value })} />
              </Field>
              <div className="row">
                <button className="btn secondary" onClick={() => setClosing(null)}>{t('Cancel', 'إلغاء')}</button>
                <button className="btn" data-testid="register-close-confirm" disabled={closing.cash === '' || doClose.isPending} onClick={() => doClose.mutate()}>{t('Close register', 'إغلاق الصندوق')}</button>
              </div>
            </div>
          ) : (
            <div className="row wrap">
              <button className="btn secondary" onClick={() => setMove({ kind: 'cash_in', amount: '', note: '' })}>{t('Add cash', 'إيداع نقدي')}</button>
              <button className="btn secondary" onClick={() => setMove({ kind: 'cash_out', amount: '', note: '' })}>{t('Take cash out', 'سحب نقدي')}</button>
              <div className="grow" />
              <button className="btn danger" data-testid="register-close" onClick={() => setClosing({ cash: '', card: '', note: '' })}>{t('Close register', 'إغلاق الصندوق')}</button>
            </div>
          )}
        </div>
      )}
    </Modal>
  );
}

export function RegisterPill() {
  const reg = useRegister();
  const [open, setOpen] = useState(false);
  const isOpen = reg.data?.open;
  return (
    <>
      <button className={`pill ${isOpen ? 'ok' : 'warn'}`} data-testid="register-pill" onClick={() => setOpen(true)}>
        <Banknote size={15} /> {isOpen ? t('Register open', 'الصندوق مفتوح') : t('Register closed', 'الصندوق مغلق')}
      </button>
      {open ? <RegisterModal onClose={() => setOpen(false)} /> : null}
    </>
  );
}
