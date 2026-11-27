import { mediaUrl } from './lib/api';
import { measureLabel, num } from './lib/format';
import { L, t } from './lib/i18n';

type Style = { id: string; name_en: string; name_ar: string; image_url?: string | null } | null | undefined;
export type PreviewMeasures = Partial<Record<'length_cm' | 'shoulder_cm' | 'chest_cm' | 'waist_cm' | 'sleeve_cm' | 'neck_cm' | 'cuff_cm', number | string | null>>;

/** Where the front view starts, to the right of the back view (both drawn at their own pixel size). */
const FX = 255;

function Measure({ x1, y1, x2, y2, lx, ly, field, value }: { x1: number; y1: number; x2: number; y2: number; lx: number; ly: number; field: string; value: number | string | null | undefined }) {
  const v = value === '' || value === null || value === undefined || !Number.isFinite(Number(value)) ? '—' : num(Number(value));
  const name = measureLabel(field);
  const w = Math.max(name.length * 7.4, String(v).length * 10.5) + 16;
  return (
    <g data-field={field}>
      <line x1={x1} y1={y1} x2={x2} y2={y2} stroke="#1c1c1c" strokeWidth={1.2} strokeDasharray="4 3" />
      <circle cx={x1} cy={y1} r={2.4} fill="#1c1c1c" />
      <circle cx={x2} cy={y2} r={2.4} fill="#1c1c1c" />
      <rect x={lx - w / 2} y={ly - 20} width={w} height={40} rx={9} fill="#fff" stroke="#bdb4a3" />
      <text x={lx} y={ly - 6} textAnchor="middle" fontSize={12} fill="#444">{name}</text>
      <text x={lx} y={ly + 13} textAnchor="middle" fontSize={18} fontWeight={700} fill="#0b0b0b" data-testid={`preview-${field}`}>{v}</text>
    </g>
  );
}

/**
 * The thobe from the back and the front with the chosen collar, cuff and pocket drawn in place and
 * the measurements marked on. Updates as staff type and choose; also used on the printed order.
 */
export function ThobePreview({ m, collar, cuff, pocket, className }: { m?: PreviewMeasures; collar?: Style; cuff?: Style; pocket?: boolean; className?: string }) {
  const parts = [collar ? L(collar) : null, cuff ? L(cuff) : null, pocket ? t('chest pocket', 'جيب صدر') : null].filter(Boolean).join(' · ');
  return (
    <figure className={`thobe-preview ${className ?? ''}`} data-testid="thobe-preview">
      <svg viewBox="-14 -20 572 572" role="img" aria-label={`${t('Thobe preview', 'معاينة الثوب')}${parts ? `: ${parts}` : ''}`}>
        {/* Back */}
        <image href="/thobe/back.png" x={0} y={0} width={250} height={630} />
        {/* Front, then what is chosen for it */}
        <image href="/thobe/front.png" x={FX} y={0} width={300} height={630} />
        {collar?.image_url ? <image data-testid="preview-collar" href={mediaUrl(collar.image_url)} x={FX + 128 - 44} y={-14} width={88} height={88} /> : null}
        {cuff?.image_url ? <image data-testid="preview-cuff" href={mediaUrl(cuff.image_url)} x={FX + 86 - 24} y={172} width={48} height={48} /> : null}
        {pocket ? <image data-testid="preview-pocket" href="/thobe/pocket.png" x={FX + 146} y={88} width={34} height={34} /> : null}

        {m ? (
          <>
            <Measure field="shoulder_cm" value={m.shoulder_cm} x1={33} y1={60} x2={196} y2={60} lx={115} ly={36} />
            <Measure field="sleeve_cm" value={m.sleeve_cm} x1={4} y1={66} x2={4} y2={248} lx={30} ly={300} />
            <Measure field="neck_cm" value={m.neck_cm} x1={FX + 150} y1={30} x2={FX + 190} y2={14} lx={FX + 222} ly={8} />
            <Measure field="chest_cm" value={m.chest_cm} x1={FX + 64} y1={130} x2={FX + 186} y2={130} lx={FX + 124} ly={156} />
            <Measure field="waist_cm" value={m.waist_cm} x1={FX + 62} y1={300} x2={FX + 194} y2={300} lx={FX + 128} ly={300} />
            <Measure field="cuff_cm" value={m.cuff_cm} x1={FX + 70} y1={214} x2={FX + 34} y2={248} lx={FX + 20} ly={266} />
            <Measure field="length_cm" value={m.length_cm} x1={FX + 250} y1={42} x2={FX + 250} y2={527} lx={FX + 250} ly={430} />
          </>
        ) : null}
      </svg>
      {parts ? <figcaption className="small secondary">{parts}</figcaption> : null}
    </figure>
  );
}
