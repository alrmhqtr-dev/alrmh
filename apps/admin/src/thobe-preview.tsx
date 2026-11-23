import { mediaUrl } from './lib/api';
import { L, t } from './lib/i18n';

type Style = { id: string; name_en: string; name_ar: string; image_url?: string | null } | null | undefined;

/** Where the front view starts, to the right of the back view (both drawn at their own pixel size). */
const FX = 255;

/**
 * The thobe from the back and the front with the chosen collar, cuff and pocket drawn in place.
 * Updates as staff choose.
 */
export function ThobePreview({ collar, cuff, pocket, className }: { collar?: Style; cuff?: Style; pocket?: boolean; className?: string }) {
  const parts = [collar ? L(collar) : null, cuff ? L(cuff) : null, pocket ? t('chest pocket', 'جيب صدر') : null].filter(Boolean).join(' · ');
  return (
    <figure className={`thobe-preview ${className ?? ''}`} data-testid="thobe-preview">
      <svg viewBox="0 -16 555 646" role="img" aria-label={`${t('Thobe preview', 'معاينة الثوب')}${parts ? `: ${parts}` : ''}`}>
        {/* Back */}
        <image href="/thobe/back.png" x={0} y={0} width={250} height={630} />
        {/* Front, then what is chosen for it */}
        <image href="/thobe/front.png" x={FX} y={0} width={300} height={630} />
        {collar?.image_url ? <image data-testid="preview-collar" href={mediaUrl(collar.image_url)} x={FX + 128 - 44} y={-14} width={88} height={88} /> : null}
        {cuff?.image_url ? <image data-testid="preview-cuff" href={mediaUrl(cuff.image_url)} x={FX + 86 - 24} y={172} width={48} height={48} /> : null}
        {pocket ? <image data-testid="preview-pocket" href="/thobe/pocket.png" x={FX + 146} y={88} width={34} height={34} /> : null}

      </svg>
      {parts ? <figcaption className="small secondary">{parts}</figcaption> : null}
    </figure>
  );
}
