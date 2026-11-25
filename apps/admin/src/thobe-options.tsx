import { Minus, Plus, Shirt } from 'lucide-react';
import { mediaUrl } from './lib/api';
import { money, num } from './lib/format';
import { L, t } from './lib/i18n';
import { Field, TextArea } from './ui';

export type Style = { id: string; name_en: string; name_ar: string; image_url?: string | null };
export type Cloth = { id: string; name_en: string; name_ar: string; price: number; metres_per_thobe: number; stock?: number | null };

/** Cloth lengths: 0.5 to 20 m, to the centimetre; the buttons move half a metre. */
export const METRE_STEP = 0.5;
export const MIN_METRES = 0.5;
export const MAX_METRES = 20;
export const roundMetres = (m: number) => Math.round(m * 100) / 100;
export const validMetres = (v: string | number) => {
  const m = Number(v);
  return Number.isFinite(m) && m >= MIN_METRES && m <= MAX_METRES && roundMetres(m) === m;
};
/** One thobe: metres × the cloth's price per metre. */
export const thobePrice = (cloth: Cloth | undefined, metres: string | number) => (cloth && validMetres(metres) ? Math.round(cloth.price * Number(metres) * 100) / 100 : 0);

/** Collars or cuffs as pictures to tap. A style without a picture shows its name on a plain tile. */
export function StylePicker({ label, items, value, onChange, testid }: { label: string; items: Style[]; value: string; onChange: (id: string) => void; testid: string }) {
  return (
    <Field label={label}>
      <div className="style-grid" role="radiogroup" aria-label={label}>
        {items.map((s) => (
          <button
            key={s.id}
            type="button"
            role="radio"
            aria-checked={value === s.id}
            className={`style-tile ${value === s.id ? 'on' : ''}`}
            data-testid={`${testid}-${s.id}`}
            onClick={() => onChange(s.id)}
          >
            {s.image_url ? <img src={mediaUrl(s.image_url)} alt="" /> : <span className="ph"><Shirt size={26} strokeWidth={1.4} /></span>}
            <span className="small">{L(s)}</span>
          </button>
        ))}
      </div>
    </Field>
  );
}

/** Metres of cloth for one thobe: − and + move 0.5 m, or type the length (two decimals). */
export function MetresInput({ value, onChange, testid, label }: { value: string; onChange: (v: string) => void; testid: string; label?: string }) {
  const n = Number(value) || 0;
  const step = (d: number) => onChange(roundMetres(Math.min(MAX_METRES, Math.max(MIN_METRES, n + d))).toFixed(2));
  const ok = validMetres(value);
  return (
    <Field label={label ?? t('Cloth length (m)', 'طول القماش (م)')} error={value !== '' && !ok ? t('0.5 to 20 m, up to 2 decimals.', 'من 0.5 إلى 20 م، حتى رقمين عشريين.') : null}>
      <div className="metres">
        <button type="button" className="btn sm secondary" aria-label={t('Half a metre less', 'نصف متر أقل')} data-testid={`${testid}-less`} onClick={() => step(-METRE_STEP)} disabled={n <= MIN_METRES}><Minus size={14} /></button>
        <input
          className="input num"
          dir="ltr"
          data-testid={testid}
          type="number"
          inputMode="decimal"
          step="0.01"
          min={MIN_METRES}
          max={MAX_METRES}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onBlur={() => validMetres(value) && onChange(Number(value).toFixed(2))}
          aria-label={label ?? t('Cloth length in metres', 'طول القماش بالمتر')}
        />
        <button type="button" className="btn sm secondary" aria-label={t('Half a metre more', 'نصف متر أكثر')} data-testid={`${testid}-more`} onClick={() => step(METRE_STEP)} disabled={n >= MAX_METRES}><Plus size={14} /></button>
      </div>
    </Field>
  );
}

/** The cloth list: name, price per metre and metres in stock. */
export function ClothSelect({ cloths, value, onChange, testid }: { cloths: Cloth[]; value: string; onChange: (c: Cloth | undefined) => void; testid: string }) {
  return (
    <Field label={t('Cloth', 'القماش')}>
      <select className="input" data-testid={testid} value={value} onChange={(e) => onChange(cloths.find((c) => c.id === e.target.value))}>
        <option value="">{t('Choose…', 'اختر…')}</option>
        {cloths.map((f) => (
          <option key={f.id} value={f.id}>
            {L(f)} · {money(f.price)}/{t('m', 'م')}{f.stock != null ? ` · ${num(f.stock)} ${t('m in stock', 'م في المخزون')}` : ''}
          </option>
        ))}
      </select>
    </Field>
  );
}

/** A style chosen by picture, with a remarks box for the tailor about it. */
export function StyleWithNote({ label, items, value, onChange, testid, note, onNote }: { label: string; items: Style[]; value: string; onChange: (id: string) => void; testid: string; note: string; onNote: (v: string) => void }) {
  return (
    <div className="style-with-note">
      <StylePicker label={label} items={items} value={value} onChange={onChange} testid={testid} />
      <TextArea
        className="input"
        rows={2}
        maxLength={300}
        data-testid={`${testid}-note`}
        aria-label={t(`${label} remarks`, `ملاحظات ${label}`)}
        placeholder={t(`${label} remarks`, `ملاحظات ${label}`)}
        value={note}
        onChange={(e) => onNote(e.target.value)}
      />
    </div>
  );
}
