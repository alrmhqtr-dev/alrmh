import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useSearchParams } from 'react-router-dom';
import { Barcode, History, Plus } from 'lucide-react';
import { api, errorMessage, mediaUrl, shrinkImage, uploadImage } from '../lib/api';
import { useAuth } from '../lib/auth';
import { L, t } from '../lib/i18n';
import { money, num } from '../lib/format';
import { Empty, Field, Input, Loading, Modal, PageHead, SearchBox, Select, TextArea, useToast, confirmSave } from '../ui';
import { ReceiveModal, StockHistory, type ReceiveItem } from './Stock';

export type Product = {
  id: string;
  sku: string;
  category: string;
  name_en: string;
  name_ar: string;
  description_en: string;
  description_ar: string;
  price: number;
  cost: number;
  sizes: string[];
  image_url: string | null;
  active: boolean;
  in_app: boolean;
  track_stock: boolean;
  alert_qty: number;
  brand_id: string | null;
  unit_id: string | null;
  warranty_id: string | null;
  tax_rate_id: string | null;
};
type Cat = { categories: { id: string; name_en: string; name_ar: string; active: boolean }[]; products: Product[] };
const useList = (name: string) => useQuery({ queryKey: ['list', name], queryFn: () => api<any[]>(`/lists/${name}`), staleTime: 60_000 });

export default function Products() {
  const { can } = useAuth();
  const [params, setParams] = useSearchParams();
  const [q, setQ] = useState('');
  const [cat, setCat] = useState('');
  const [edit, setEdit] = useState<Partial<Product> | null>(params.get('new') ? {} : null);
  const [history, setHistory] = useState<Product | null>(null);
  const [receive, setReceive] = useState<ReceiveItem | null>(null);
  const canStock = can('products');
  const data = useQuery({ queryKey: ['catalogue'], queryFn: () => api<Cat>('/catalogue') });
  const stock = useQuery({ queryKey: ['stock', ''], queryFn: () => api<any[]>('/stock') });
  const brands = useList('brands');
  const editable = can('products', 'manage');
  const totals = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of stock.data ?? []) if (r.kind === 'product') m.set(r.id, (m.get(r.id) ?? 0) + r.qty);
    return m;
  }, [stock.data]);
  if (!data.data) return <Loading />;
  const s = q.trim().toLowerCase();
  const rows = data.data.products.filter((p) => (!cat || p.category === cat) && (!s || p.sku.toLowerCase().includes(s) || p.name_en.toLowerCase().includes(s) || p.name_ar.includes(q.trim())));
  const close = () => {
    setEdit(null);
    if (params.get('new')) setParams({});
  };
  return (
    <div className="stack lg">
      <PageHead title={t('Products', 'المنتجات')} sub={t('Everything sold at the counter and in the app shop, with codes, costs and stock.', 'كل ما يُباع في نقطة البيع ومتجر التطبيق، مع الرموز والتكلفة والمخزون.')}>
        <SearchBox value={q} onChange={setQ} placeholder={t('Name or code', 'الاسم أو الرمز')} width={220} testid="products-search" />
        <select className="input" style={{ width: 170 }} value={cat} onChange={(e) => setCat(e.target.value)} aria-label={t('Category', 'القسم')}>
          <option value="">{t('All categories', 'كل الأقسام')}</option>
          {data.data.categories.map((c) => <option key={c.id} value={c.id}>{L(c)}</option>)}
        </select>
        <Link className="btn secondary" to="/labels"><Barcode size={16} /> {t('Labels', 'الملصقات')}</Link>
        {editable ? <button className="btn" data-testid="add-product" onClick={() => setEdit({})}><Plus size={16} /> {t('Add product', 'أضف منتجًا')}</button> : null}
      </PageHead>
      <div className="card table-wrap">
        {rows.length ? (
          <table data-testid="products-table">
            <thead>
              <tr>
                <th style={{ width: 52 }}><span className="sr-only">{t('Photo', 'الصورة')}</span></th>
                <th>{t('Product', 'المنتج')}</th>
                <th>{t('Code', 'الرمز')}</th>
                <th>{t('Category', 'القسم')}</th>
                <th>{t('Brand', 'العلامة')}</th>
                <th className="right">{t('Cost', 'التكلفة')}</th>
                <th className="right">{t('Price', 'السعر')}</th>
                <th className="right">{t('Stock', 'المخزون')}</th>
                <th>{t('Sold in', 'يُباع في')}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((p) => {
                const st = totals.get(p.id);
                return (
                  <tr key={p.id} className={editable ? 'click' : ''} data-testid={`product-${p.sku}`} onClick={() => editable && setEdit(p)}>
                    <td>{p.image_url ? <img src={mediaUrl(p.image_url)} alt="" style={{ width: 40, height: 40, objectFit: 'cover', borderRadius: 8, display: 'block' }} /> : <div style={{ width: 40, height: 40, borderRadius: 8, background: 'var(--subtle)' }} />}</td>
                    <td><div className="strong">{L(p)}</div>{p.sizes.length ? <div className="small muted">{p.sizes.join(' · ')}</div> : null}</td>
                    <td className="small num">{p.sku}</td>
                    <td className="small">{L(data.data!.categories.find((c) => c.id === p.category))}</td>
                    <td className="small">{brands.data?.find((b) => b.id === p.brand_id)?.name ?? '—'}</td>
                    <td className="right num">{money(p.cost)}</td>
                    <td className="right num">{money(p.price)}</td>
                    <td className="right num" style={{ whiteSpace: 'nowrap' }}>
                      {p.track_stock ? (
                        <button className="linklike" title={t('Stock history', 'حركة المخزون')} onClick={(e) => { e.stopPropagation(); setHistory(p); }}>
                          <span className={st !== undefined && st <= p.alert_qty ? 'tone-error strong' : ''}>{num(st ?? 0)}</span> <History size={12} />
                        </button>
                      ) : <span className="muted">—</span>}
                      {canStock ? (
                        <button
                          className="btn sm secondary icon-add"
                          data-testid={`add-stock-${p.sku}`}
                          title={t('Add stock', 'إضافة مخزون')}
                          aria-label={`${t('Add stock', 'إضافة مخزون')} · ${L(p)}`}
                          onClick={(e) => { e.stopPropagation(); setReceive({ kind: 'product', id: p.id, sku: p.sku, name: L(p), size: '', sizes: p.sizes, cost: p.cost, price: p.price, unit: '' } as ReceiveItem); }}
                        >
                          <Plus size={13} />
                        </button>
                      ) : null}
                    </td>
                    <td className="small">
                      {!p.active ? <span className="badge">{t('Hidden', 'مخفي')}</span> : p.in_app ? <span className="badge ok">{t('Counter + app', 'المحل + التطبيق')}</span> : <span className="badge outline">{t('Counter only', 'المحل فقط')}</span>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        ) : (
          <Empty>{t('No products match.', 'لا منتجات مطابقة.')}</Empty>
        )}
      </div>
      {edit ? <ProductModal item={edit} categories={data.data.categories} onClose={close} /> : null}
      {receive ? <ReceiveModal item={receive} onClose={() => setReceive(null)} /> : null}
      {history ? (
        <Modal title={`${L(history)} · ${t('stock history', 'حركة المخزون')}`} onClose={() => setHistory(null)} wide>
          <StockHistory kind="product" id={history.id} />
        </Modal>
      ) : null}
    </div>
  );
}

function ProductModal({ item, categories, onClose }: { item: Partial<Product>; categories: Cat['categories']; onClose: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const brands = useList('brands');
  const units = useList('units');
  const warranties = useList('warranties');
  const taxes = useList('tax-rates');
  const variations = useList('variations');
  const isNew = !item.id;
  const [v, setV] = useState<any>(() => ({
    category: categories.find((c) => c.active)?.id ?? categories[0]?.id ?? '',
    name_en: '',
    name_ar: '',
    description_en: '',
    description_ar: '',
    price: '',
    cost: '',
    sku: '',
    image_url: null,
    active: true,
    in_app: true,
    track_stock: true,
    alert_qty: '',
    brand_id: null,
    unit_id: null,
    warranty_id: null,
    tax_rate_id: null,
    ...item,
    sizes: (item.sizes ?? []).join(', '),
  }));
  const set = (k: string, val: unknown) => setV((s: any) => ({ ...s, [k]: val }));
  const [uploading, setUploading] = useState(false);
  const pickPhoto = async (file: File | undefined) => {
    if (!file) return;
    setUploading(true);
    try {
      set('image_url', (await uploadImage(await shrinkImage(file))).url);
    } catch (e) {
      toast(errorMessage(e), 'error');
    } finally {
      setUploading(false);
    }
  };
  const save = useMutation({
    mutationFn: () => {
      const body: any = { ...v, sizes: String(v.sizes ?? '').split(',').map((s: string) => s.trim()).filter(Boolean) };
      delete body.id;
      for (const k of ['cost', 'alert_qty', 'sku']) if (body[k] === '' || body[k] === null) delete body[k];
      return isNew ? api('/products', { body }) : api(`/products/${item.id}`, { method: 'PATCH', body });
    },
    onSuccess: () => {
      toast(t('Saved.', 'تم الحفظ.'));
      qc.invalidateQueries({ queryKey: ['catalogue'] });
      qc.invalidateQueries({ queryKey: ['pos-items'] });
      onClose();
    },
    onError: (e) => toast(errorMessage(e), 'error'),
  });
  const pick = (list: any[] | undefined, label: (x: any) => string) => (list ?? []).map((x) => <option key={x.id} value={x.id}>{label(x)}</option>);
  return (
    <Modal
      title={isNew ? t('Add product', 'إضافة منتج') : `${t('Edit', 'تعديل')} · ${L(item)}`}
      onClose={onClose}
      wide
      footer={
        <>
          <button className="btn secondary" onClick={onClose}>{t('Cancel', 'إلغاء')}</button>
          <button className="btn" data-testid="product-save" disabled={save.isPending || uploading || !v.name_en || !v.name_ar || v.price === ''} onClick={async () => (isNew || (await confirmSave())) && save.mutate()}>{t('Save', 'حفظ')}</button>
        </>
      }
    >
      <div className="grid k2">
        <Field label={t('Name (English)', 'الاسم (إنجليزي)')}><Input data-testid="p-name-en" dir="ltr" value={v.name_en} onChange={(e) => set('name_en', e.target.value)} /></Field>
        <Field label={t('Name (Arabic)', 'الاسم (عربي)')}><Input data-testid="p-name-ar" dir="rtl" value={v.name_ar} onChange={(e) => set('name_ar', e.target.value)} /></Field>
      </div>
      <div className="grid k3">
        <Field label={t('Code (SKU / barcode)', 'الرمز (SKU / باركود)')} hint={t('Blank: made from the name.', 'فارغ: يُنشأ من الاسم.')}><Input data-testid="p-sku" dir="ltr" value={v.sku ?? ''} onChange={(e) => set('sku', e.target.value.toUpperCase())} /></Field>
        <Field label={t('Category', 'القسم')}>
          <Select value={v.category} onChange={(e) => set('category', e.target.value)}>{categories.map((c) => <option key={c.id} value={c.id}>{L(c)}</option>)}</Select>
        </Field>
        <Field label={t('Brand', 'العلامة التجارية')}>
          <Select value={v.brand_id ?? ''} onChange={(e) => set('brand_id', e.target.value || null)}><option value="">—</option>{pick(brands.data, (b) => b.name)}</Select>
        </Field>
        <Field label={t('Selling price (QAR)', 'سعر البيع (ر.ق)')}><Input data-testid="p-price" type="number" min={0} value={v.price} onChange={(e) => set('price', e.target.value)} /></Field>
        <Field label={t('Cost (QAR)', 'التكلفة (ر.ق)')} hint={t('Updated by each purchase.', 'تتحدث مع كل عملية شراء.')}><Input data-testid="p-cost" type="number" min={0} value={v.cost} onChange={(e) => set('cost', e.target.value)} /></Field>
        <Field label={t('Tax rate', 'معدل الضريبة')}>
          <Select value={v.tax_rate_id ?? ''} onChange={(e) => set('tax_rate_id', e.target.value || null)}><option value="">{t('None', 'بدون')}</option>{pick(taxes.data, (x) => `${x.name} · ${x.percent}%`)}</Select>
        </Field>
        <Field label={t('Unit', 'الوحدة')}>
          <Select value={v.unit_id ?? ''} onChange={(e) => set('unit_id', e.target.value || null)}><option value="">—</option>{pick(units.data, (u) => L(u))}</Select>
        </Field>
        <Field label={t('Warranty', 'الضمان')}>
          <Select value={v.warranty_id ?? ''} onChange={(e) => set('warranty_id', e.target.value || null)}><option value="">—</option>{pick(warranties.data, (w) => w.name)}</Select>
        </Field>
        <Field label={t('Alert when stock is at or below', 'تنبيه عند وصول المخزون إلى')}><Input type="number" min={0} value={v.alert_qty} onChange={(e) => set('alert_qty', e.target.value)} /></Field>
      </div>
      <Field label={t('Sizes', 'المقاسات')} hint={t('Comma separated; stock is kept per size. Or fill from a variation.', 'مفصولة بفواصل؛ يُحسب المخزون لكل مقاس. أو عبّئها من متغير.')}>
        <div className="row" style={{ gap: 8 }}>
          <Input dir="ltr" value={v.sizes} onChange={(e) => set('sizes', e.target.value)} placeholder="52, 54, 56, 58" />
          <select className="input" style={{ width: 200 }} value="" onChange={(e) => { const vt = variations.data?.find((x) => x.id === e.target.value); if (vt) set('sizes', vt.options.join(', ')); }} aria-label={t('Fill from a variation', 'تعبئة من متغير')}>
            <option value="">{t('Fill from a variation…', 'تعبئة من متغير…')}</option>
            {pick(variations.data, (x) => x.name)}
          </select>
        </div>
      </Field>
      <div className="grid k2">
        <Field label={t('Description (English)', 'الوصف (إنجليزي)')}><TextArea dir="ltr" value={v.description_en} onChange={(e) => set('description_en', e.target.value)} /></Field>
        <Field label={t('Description (Arabic)', 'الوصف (عربي)')}><TextArea dir="rtl" value={v.description_ar} onChange={(e) => set('description_ar', e.target.value)} /></Field>
      </div>
      <Field label={t('Photo', 'الصورة')} hint={t('JPEG, PNG or WebP. Square photos look best.', 'JPEG أو PNG أو WebP. الصور المربعة أفضل.')}>
        <div className="row" style={{ gap: 12 }}>
          {v.image_url ? <img data-testid="photo-preview" src={mediaUrl(v.image_url)} alt="" style={{ width: 72, height: 72, objectFit: 'cover', borderRadius: 10, border: '1px solid #e8e2d6' }} /> : <div className="small muted" style={{ width: 72, height: 72, borderRadius: 10, border: '1px dashed #cfc7b8', display: 'grid', placeItems: 'center' }}>{t('No photo', 'بدون صورة')}</div>}
          <input data-testid="photo-input" type="file" aria-label={t('Photo', 'الصورة')} accept="image/jpeg,image/png,image/webp" disabled={uploading} onChange={(e) => { pickPhoto(e.target.files?.[0]); e.target.value = ''; }} />
          {uploading ? <span className="small secondary">{t('Uploading…', 'جارٍ الرفع…')}</span> : null}
          {v.image_url && !uploading ? <button type="button" className="btn sm secondary" onClick={() => set('image_url', null)}>{t('Remove', 'إزالة')}</button> : null}
        </div>
      </Field>
      <div className="row wrap" style={{ gap: 18 }}>
        <label className="check"><input type="checkbox" data-testid="p-track" checked={v.track_stock} onChange={(e) => set('track_stock', e.target.checked)} /> {t('Track stock', 'تتبع المخزون')}</label>
        <label className="check"><input type="checkbox" checked={v.in_app} onChange={(e) => set('in_app', e.target.checked)} /> {t('Show in the app shop', 'إظهار في متجر التطبيق')}</label>
        <label className="check"><input type="checkbox" checked={v.active} onChange={(e) => set('active', e.target.checked)} /> {t('On sale', 'معروض للبيع')}</label>
      </div>
      {isNew && v.track_stock ? <div className="note">{t('Add the opening quantity with a stock adjustment or a purchase after saving.', 'أضف الكمية الافتتاحية بتسوية مخزون أو عملية شراء بعد الحفظ.')}</div> : null}
    </Modal>
  );
}
