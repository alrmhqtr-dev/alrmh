import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, errorMessage } from './lib/api';
import { useAuth } from './lib/auth';
import { MEASURE_FIELDS, date } from './lib/format';
import { Field, Input, Modal, Select, TextArea, useToast } from './ui';

export type Measurement = Record<(typeof MEASURE_FIELDS)[number][0], number> & { taken_at: string; tailor_name: string; remarks: string | null; method?: string };

export function MeasurementGrid({ m }: { m: Measurement }) {
  return (
    <div className="stack" style={{ gap: 8 }}>
      <div className="mgrid">
        {MEASURE_FIELDS.map(([k, label]) => (
          <div key={k} className="mcell">
            <div className="k">{label}</div>
            <div className="v">{Number(m[k])} cm</div>
          </div>
        ))}
      </div>
      <div className="small muted">
        Taken {date(m.taken_at)} by {m.tailor_name}
        {m.remarks ? <> · <span className="secondary">“{m.remarks}”</span></> : null}
      </div>
    </div>
  );
}

export function MeasureModal({ memberId, memberName, previous, onClose, onSaved }: { memberId: string; memberName: string; previous?: Measurement | null; onClose: () => void; onSaved?: () => void }) {
  const { staff } = useAuth();
  const qc = useQueryClient();
  const toast = useToast();
  const branches = useQuery({ queryKey: ['branches'], queryFn: () => api<{ id: string; name_en: string }[]>('/branches') });
  const [values, setValues] = useState<Record<string, string>>(() => Object.fromEntries(MEASURE_FIELDS.map(([k]) => [k, previous ? String(Number(previous[k])) : ''])));
  const [tailor, setTailor] = useState(staff?.name ?? '');
  const [method, setMethod] = useState<'branch' | 'home'>('branch');
  const [branchId, setBranchId] = useState<string>(staff?.branch_id ?? '');
  const [remarks, setRemarks] = useState(previous?.remarks ?? '');
  const save = useMutation({
    mutationFn: () =>
      api(`/members/${memberId}/measurements`, {
        body: { ...Object.fromEntries(MEASURE_FIELDS.map(([k]) => [k, Number(values[k])])), tailorName: tailor, method, branchId: method === 'branch' ? branchId || branches.data?.[0]?.id : null, remarks: remarks.trim() || null },
      }),
    onSuccess: () => {
      toast(`Measurements saved for ${memberName}. The customer can see them in the app.`);
      qc.invalidateQueries();
      onSaved?.();
      onClose();
    },
    onError: (e) => toast(errorMessage(e), 'error'),
  });
  const complete = MEASURE_FIELDS.every(([k]) => Number(values[k]) > 0);
  return (
    <Modal
      title={`Record measurements · ${memberName}`}
      onClose={onClose}
      wide
      footer={
        <>
          <button className="btn secondary" onClick={onClose}>Cancel</button>
          <button className="btn" data-testid="measure-save" disabled={!complete || save.isPending} onClick={() => save.mutate()}>
            Save measurements
          </button>
        </>
      }
    >
      {previous ? <div className="note">Pre-filled from {date(previous.taken_at)}. Change only what has changed.</div> : null}
      <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(110px, 1fr))' }}>
        {MEASURE_FIELDS.map(([k, label]) => (
          <Field key={k} label={`${label} (cm)`}>
            <Input data-testid={`m-${k}`} type="number" inputMode="decimal" step="0.5" min={5} max={260} value={values[k]} onChange={(e) => setValues((v) => ({ ...v, [k]: e.target.value }))} />
          </Field>
        ))}
      </div>
      <div className="grid k3">
        <Field label="Tailor">
          <Input value={tailor} onChange={(e) => setTailor(e.target.value)} />
        </Field>
        <Field label="Where">
          <Select value={method} onChange={(e) => setMethod(e.target.value as 'branch' | 'home')}>
            <option value="branch">At the branch</option>
            <option value="home">Home visit</option>
          </Select>
        </Field>
        {method === 'branch' ? (
          <Field label="Branch">
            <Select value={branchId} onChange={(e) => setBranchId(e.target.value)}>
              {(branches.data ?? []).map((b) => (
                <option key={b.id} value={b.id}>{b.name_en}</option>
              ))}
            </Select>
          </Field>
        ) : <div />}
      </div>
      <Field label="Remarks for the workshop" hint="Shown to the customer and on the tailor sheet.">
        <TextArea value={remarks} maxLength={300} onChange={(e) => setRemarks(e.target.value)} placeholder="e.g. Prefers a looser fit around the chest" />
      </Field>
    </Modal>
  );
}
