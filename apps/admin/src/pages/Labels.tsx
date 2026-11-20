import { useState } from 'react';
import { Printer, Trash2 } from 'lucide-react';
import { Link } from 'react-router-dom';
import { t } from '../lib/i18n';
import { money } from '../lib/format';
import { Empty, Input, PageHead, openPrint } from '../ui';
import { ItemPicker, type Pickable } from '../items';

export const LABELS_KEY = 'alrmh.admin.labels';

/** طباعة الملصقات: pick items and how many labels of each, then print. */
export default function Labels() {
  const [lines, setLines] = useState<(Pickable & { count: string })[]>([]);
  const print = () => {
    localStorage.setItem(LABELS_KEY, JSON.stringify(lines.map((l) => ({ sku: l.sku, name: l.name, price: l.price, size: l.size, count: Math.max(1, Math.min(500, Math.trunc(Number(l.count) || 1))) }))));
    openPrint('labels');
  };
  return (
    <div className="stack lg">
      <PageHead title={t('Print labels', 'طباعة الملصقات')} sub={t('Barcode labels with the product code, scanned at the counter. Size and content are set in barcode settings.', 'ملصقات باركود برمز المنتج تُمسح في نقطة البيع. المقاس والمحتوى من إعدادات الباركود.')}>
        <Link className="btn secondary" to="/settings/barcode">{t('Barcode settings', 'إعدادات الباركود')}</Link>
        <button className="btn" data-testid="print-labels" disabled={!lines.length} onClick={print}><Printer size={16} /> {t('Print', 'طباعة')}</button>
      </PageHead>
      <div className="card pad stack">
        <ItemPicker testid="labels-picker" onPick={(p) => setLines((ls) => (ls.some((l) => l.sku === p.sku && l.size === p.size) ? ls : [...ls, { ...p, count: '1' }]))} />
        {lines.length ? (
          <table>
            <thead><tr><th>{t('Item', 'الصنف')}</th><th>{t('Code', 'الرمز')}</th><th className="right">{t('Price', 'السعر')}</th><th style={{ width: 130 }}>{t('Labels', 'عدد الملصقات')}</th><th style={{ width: 40 }} /></tr></thead>
            <tbody>
              {lines.map((l, i) => (
                <tr key={i}>
                  <td className="strong">{l.name}</td>
                  <td className="num small">{l.sku}</td>
                  <td className="right num">{money(l.price)}</td>
                  <td><Input type="number" min={1} max={500} value={l.count} onChange={(e) => setLines(lines.map((x, k) => (k === i ? { ...x, count: e.target.value } : x)))} /></td>
                  <td><button className="btn sm ghost" onClick={() => setLines(lines.filter((_, k) => k !== i))} aria-label={t('Remove', 'حذف')}><Trash2 size={14} /></button></td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : <Empty>{t('Add the items to label.', 'أضف الأصناف المراد طباعة ملصقاتها.')}</Empty>}
      </div>
    </div>
  );
}
