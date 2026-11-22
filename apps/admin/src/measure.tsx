import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, errorMessage } from './lib/api';
import { useAuth } from './lib/auth';
import { MEASURE_FIELDS, date, measureLabel } from './lib/format';
import { L, t } from './lib/i18n';
import { Field, Input, Modal, Select, TextArea, confirmSave, useToast } from './ui';

export type Measurement = Record<(typeof MEASURE_FIELDS)[number][0], number> & { id?: string; taken_at: string; tailor_name: string; remarks: string | null; method?: string };

export function MeasurementGrid({ m }: { m: Measurement }) {
  return (
    <div className="stack" style={{ gap: 8 }}>
      <div className="mgrid">
        {MEASURE_FIELDS.map(([k]) => (
          <div key={k} className="mcell">
            <div className="k">{measureLabel(k)}</div>
            <div className="v">{Number(m[k])} {t('cm', 'سم')}</div>
          </div>
        ))}
      </div>
      <div className="small muted">
        {t('Taken', 'أُخذت في')} {date(m.taken_at)} {t('by', 'بواسطة')} {m.tailor_name}
        {m.remarks ? <> · <span className="secondary">“{m.remarks}”</span></> : null}
      </div>
    </div>
  );
}

/**
 * Records new measurements, pre-filled from the last ones. With `edit`, corrects that saved
 * measurement instead (asks before saving; the date it was taken stays).
 */
export function MeasureModal({ memberId, memberName, previous, edit, onClose, onSaved }: { memberId: string; memberName: string; previous?: Measurement | null; edit?: Measurement & { id: string }; onClose: () => void; onSaved?: () => void }) {
  previous = edit ?? previous;
  const { staff } = useAuth();
  const qc = useQueryClient();
  const toast = useToast();
  const branches = useQuery({ queryKey: ['branches'], queryFn: () => api<{ id: string; name_en: string; name_ar: string }[]>('/branches') });
  const [values, setValues] = useState<Record<string, string>>(() => Object.fromEntries(MEASURE_FIELDS.map(([k]) => [k, previous ? String(Number(previous[k])) : ''])));
  const [tailor, setTailor] = useState(edit?.tailor_name ?? staff?.name ?? '');
  const [method, setMethod] = useState<'branch' | 'home'>('branch');
  const [branchId, setBranchId] = useState<string>(staff?.branch_id ?? '');
  const [remarks, setRemarks] = useState(previous?.remarks ?? '');
  const save = useMutation({
    mutationFn: () =>
      edit
        ? api(`/measurements/${edit.id}`, { method: 'PATCH', body: { ...Object.fromEntries(MEASURE_FIELDS.map(([k]) => [k, Number(values[k])])), tailorName: tailor, remarks: remarks.trim() || null } })
        : api(`/members/${memberId}/measurements`, {
        body: { ...Object.fromEntries(MEASURE_FIELDS.map(([k]) => [k, Number(values[k])])), tailorName: tailor, method, branchId: method === 'branch' ? branchId || branches.data?.[0]?.id : null, remarks: remarks.trim() || null },
      }),
    onSuccess: () => {
      toast(edit ? t(`${memberName}'s measurements were corrected.`, `تم تصحيح مقاسات ${memberName}.`) : t(`Measurements saved for ${memberName}. The customer can see them in the app.`, `حُفظت مقاسات ${memberName} ويمكن للعميل رؤيتها في التطبيق.`));
      qc.invalidateQueries();
      onSaved?.();
      onClose();
    },
    onError: (e) => toast(errorMessage(e), 'error'),
  });
  const complete = MEASURE_FIELDS.every(([k]) => String(values[k] ?? '').trim() !== '');
  return (
    <Modal
      title={`${edit ? t('Edit measurements', 'تعديل المقاسات') : t('Record measurements', 'تسجيل المقاسات')} · ${memberName}`}
      onClose={onClose}
      wide
      footer={
        <>
          <button className="btn secondary" onClick={onClose}>{t('Cancel', 'إلغاء')}</button>
          <button className="btn" data-testid="measure-save" disabled={!complete || save.isPending} onClick={async () => (!edit || (await confirmSave({ message: t(`Replace ${memberName}'s saved measurements with these?`, `استبدال مقاسات ${memberName} المحفوظة بهذه؟`) }))) && save.mutate()}>
            {edit ? t('Save changes', 'حفظ التعديلات') : t('Save measurements', 'حفظ المقاسات')}
          </button>
        </>
      }
    >
      {edit ? <div className="note">{t('Correcting the measurements taken on', 'تصحيح المقاسات المأخوذة في')} {date(edit.taken_at)}.</div> : previous ? <div className="note">{t('Pre-filled from', 'معبأة من')} {date(previous.taken_at)}. {t('Change only what has changed.', 'غيّر ما تغيّر فقط.')}</div> : null}
      <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(110px, 1fr))' }}>
        {MEASURE_FIELDS.map(([k]) => (
          <Field key={k} label={`${measureLabel(k)} (${t('cm', 'سم')})`}>
            <Input data-testid={`m-${k}`} type="number" inputMode="decimal" step="any" min={0} value={values[k]} onChange={(e) => setValues((v) => ({ ...v, [k]: e.target.value }))} />
          </Field>
        ))}
      </div>
      <div className="grid k3">
        <Field label={t('Tailor', 'الخياط')}>
          <Input value={tailor} onChange={(e) => setTailor(e.target.value)} />
        </Field>
        {edit ? null : <>
        <Field label={t('Where', 'المكان')}>
          <Select value={method} onChange={(e) => setMethod(e.target.value as 'branch' | 'home')}>
            <option value="branch">{t('At the branch', 'في الفرع')}</option>
            <option value="home">{t('Home visit', 'زيارة منزلية')}</option>
          </Select>
        </Field>
        {method === 'branch' ? (
          <Field label={t('Branch', 'الفرع')}>
            <Select value={branchId} onChange={(e) => setBranchId(e.target.value)}>
              {(branches.data ?? []).map((b) => (
                <option key={b.id} value={b.id}>{L(b)}</option>
              ))}
            </Select>
          </Field>
        ) : <div />}
        </>}
      </div>
      <Field label={t('Remarks for the workshop', 'ملاحظات للورشة')} hint={t('Shown to the customer and on the tailor sheet.', 'تظهر للعميل وفي ورقة الخياط.')}>
        <TextArea value={remarks} maxLength={300} onChange={(e) => setRemarks(e.target.value)} placeholder={t('e.g. Prefers a looser fit around the chest', 'مثال: يفضّل قصة أوسع عند الصدر')} />
      </Field>
    </Modal>
  );
}
