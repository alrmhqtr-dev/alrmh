import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
import { Link } from 'react-router-dom';
import { api, errorMessage, mediaUrl, shrinkImage, uploadImage } from '../lib/api';
import { useAuth } from '../lib/auth';
import { L, t } from '../lib/i18n';
import { money, num } from '../lib/format';
import { Field, Input, Loading, Modal, PageHead, Select, Tabs, useConfirm, useToast } from '../ui';
import { ReceiveModal, type ReceiveItem } from './Stock';

type Product = { id: string; category: string; name_en: string; name_ar: string; description_en: string; description_ar: string; price: number; sizes: string[]; image_url: string | null; active: boolean };
type Fabric = { id: string; name_en: string; name_ar: string; note_en: string; note_ar: string; price: number; active: boolean; sku: string; cost: number; track_stock: boolean; alert_qty: number; metres_per_thobe: number; tax_rate_id: string | null };
type Collar = { id: string; name_en: string; name_ar: string; active: boolean; shape: string; image_url: string | null };
type Cuff = { id: string; name_en: string; name_ar: string; active: boolean; image_url: string | null };
type Category = { id: string; name_en: string; name_ar: string; active: boolean; product_count: number };
type Cat = { categories: Category[]; collarShapes: string[]; products: Product[]; fabrics: Fabric[]; collars: Collar[]; cuffs: Cuff[] };
type Kind = 'categories' | 'fabrics' | 'collars' | 'cuffs';

const noun = (k: Kind) => ({ categories: t('category', 'قسم'), fabrics: t('cloth', 'قماش'), collars: t('collar', 'ياقة'), cuffs: t('cuff', 'كبك') })[k];
const Picture = ({ url }: { url: string | null }) =>
  url ? <img src={mediaUrl(url)} alt="" style={{ width: 48, height: 48, objectFit: 'contain', borderRadius: 8, background: 'var(--subtle)', display: 'block' }} /> : <div className="small muted" style={{ width: 48, height: 48, borderRadius: 8, border: '1px dashed var(--border)', display: 'grid', placeItems: 'center' }}>—</div>;
// The app has four collar drawings; every collar uses one of them.
const shapeLabel = (s: string) => ({ 'classic-qatari': t('Classic (pointed)', 'كلاسيكي (مدبب)'), 'mandarin-band': t('Band', 'ياقة صينية'), 'round-neck': t('Round', 'دائري'), 'wide-collar': t('Wide', 'عريض') })[s] ?? s;

export default function Catalogue() {
  const [tab, setTab] = useState<Kind>('categories');
  const [edit, setEdit] = useState<{ kind: Kind; item: any | null } | null>(null);
  const { can } = useAuth();
  const editable = can('manage') || (tab === 'categories' && can('products'));
  const canStock = can('products');
  const [receive, setReceive] = useState<ReceiveItem | null>(null);
  const stock = useQuery({ queryKey: ['stock', ''], queryFn: () => api<any[]>('/stock') });
  /** Metres of each cloth in stock, all branches together. */
  const metres = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of stock.data ?? []) if (r.kind === 'fabric') m.set(r.id, (m.get(r.id) ?? 0) + r.qty);
    return m;
  }, [stock.data]);
  const q = useQuery({ queryKey: ['catalogue'], queryFn: () => api<Cat>('/catalogue') });
  if (!q.data) return <Loading />;
  const c = q.data;

  return (
    <div className="stack lg">
      <PageHead title={t('Categories & thobe options', 'أقسام المنتجات وخيارات الثوب')} sub={t('What customers see in the shop and the thobe builder, and what the counter sells. Changes appear in the app straight away.', 'ما يراه العملاء في المتجر ومصمم الثوب وما يُباع في نقطة البيع. تظهر التغييرات في التطبيق فورًا.')}>
        <Tabs value={tab} onChange={setTab} options={[['categories', t('Categories', 'الأقسام')], ['fabrics', t('Cloth', 'الأقمشة')], ['collars', t('Collars', 'الياقات')], ['cuffs', t('Cuffs', 'الكبك')]]} />
        <Link className="btn secondary" to="/products">{t('Products', 'المنتجات')}</Link>
        {editable ? (
          <button className="btn" data-testid={`add-${tab}`} onClick={() => setEdit({ kind: tab, item: null })}>
            <Plus size={16} /> {t('Add', 'أضف')} {noun(tab)}
          </button>
        ) : null}
      </PageHead>
      <div className="card table-wrap">
        {tab === 'categories' ? (
          <table>
            <thead><tr><th>{t('Category', 'القسم')}</th><th>{t('Arabic', 'بالعربية')}</th><th className="right">{t('Products', 'المنتجات')}</th><th>{t('Status', 'الحالة')}</th></tr></thead>
            <tbody>
              {c.categories.map((x) => (
                <tr key={x.id} className={editable ? 'click' : ''} data-testid={`category-${x.id}`} onClick={() => editable && setEdit({ kind: 'categories', item: x })}>
                  <td className="strong">{x.name_en}</td>
                  <td dir="rtl">{x.name_ar}</td>
                  <td className="right num">{x.product_count}</td>
                  <td>{x.active ? <span className="badge ok">{t('Live', 'ظاهر')}</span> : <span className="badge">{t('Hidden', 'مخفي')}</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : tab === 'fabrics' ? (
          <table>
            <thead><tr><th>{t('Cloth', 'القماش')}</th><th>{t('Code', 'الرمز')}</th><th className="right">{t('Price per metre', 'سعر المتر')}</th><th className="right">{t('Usual metres a thobe', 'الأمتار المعتادة للثوب')}</th><th className="right">{t('Thobe at that length', 'الثوب بهذا الطول')}</th><th>{t('Stock (metres)', 'المخزون (متر)')}</th><th>{t('Status', 'الحالة')}</th></tr></thead>
            <tbody>
              {c.fabrics.map((f) => (
                <tr key={f.id} className={editable ? 'click' : ''} data-testid={`fabric-${f.id}`} onClick={() => editable && setEdit({ kind: 'fabrics', item: f })}>
                  <td><div className="strong">{L(f)}</div><div className="small muted">{L(f, 'note')}</div></td>
                  <td className="small num">{f.sku}</td>
                  <td className="right num">{money(f.price)}</td>
                  <td className="right num">{num(f.metres_per_thobe)}</td>
                  <td className="right num muted">{money(Math.round(f.price * f.metres_per_thobe * 100) / 100)}</td>
                  <td className="small" style={{ whiteSpace: 'nowrap' }}>
                    {f.track_stock ? (
                      <Link to={`/stock?q=${encodeURIComponent(f.sku)}`} onClick={(e) => e.stopPropagation()} className={(metres.get(f.id) ?? 0) <= (f.alert_qty ?? 0) ? 'tone-error strong num' : 'num'}>
                        {num(metres.get(f.id) ?? 0)} {t('m', 'م')}
                      </Link>
                    ) : <span className="muted">{t('Not tracked', 'غير متتبع')}</span>}
                    {canStock ? (
                      <button
                        className="btn sm secondary icon-add"
                        data-testid={`add-stock-${f.sku}`}
                        title={t('Add stock', 'إضافة مخزون')}
                        aria-label={`${t('Add stock', 'إضافة مخزون')} · ${L(f)}`}
                        onClick={(e) => { e.stopPropagation(); setReceive({ kind: 'fabric', id: f.id, sku: f.sku, name: L(f), size: '', cost: f.cost, price: f.price, unit: 'm' } as ReceiveItem); }}
                      >
                        <Plus size={13} />
                      </button>
                    ) : null}
                  </td>
                  <td>{f.active ? <span className="badge ok">{t('Live', 'ظاهر')}</span> : <span className="badge">{t('Hidden', 'مخفي')}</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : tab === 'collars' ? (
          <table>
            <thead><tr><th>{t('Picture', 'الصورة')}</th><th>{t('Collar', 'الياقة')}</th><th>{t('Arabic', 'بالعربية')}</th><th>{t('Drawing in the app', 'الرسم في التطبيق')}</th><th>{t('Status', 'الحالة')}</th></tr></thead>
            <tbody>
              {c.collars.map((x) => (
                <tr key={x.id} className={editable ? 'click' : ''} data-testid={`collar-${x.id}`} onClick={() => editable && setEdit({ kind: 'collars', item: x })}>
                  <td><Picture url={x.image_url} /></td>
                  <td className="strong">{x.name_en}</td>
                  <td dir="rtl">{x.name_ar}</td>
                  <td>{shapeLabel(x.shape)}</td>
                  <td>{x.active ? <span className="badge ok">{t('Live', 'ظاهر')}</span> : <span className="badge">{t('Hidden', 'مخفي')}</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <table>
            <thead><tr><th>{t('Picture', 'الصورة')}</th><th>{t('Cuff', 'الكبك')}</th><th>{t('Arabic', 'بالعربية')}</th><th>{t('Status', 'الحالة')}</th></tr></thead>
            <tbody>
              {c.cuffs.map((x) => (
                <tr key={x.id} className={editable ? 'click' : ''} data-testid={`cuff-${x.id}`} onClick={() => editable && setEdit({ kind: 'cuffs', item: x })}>
                  <td><Picture url={x.image_url} /></td>
                  <td className="strong">{x.name_en}</td>
                  <td dir="rtl">{x.name_ar}</td>
                  <td>{x.active ? <span className="badge ok">{t('Live', 'ظاهر')}</span> : <span className="badge">{t('Hidden', 'مخفي')}</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      {tab === 'collars' || tab === 'cuffs' ? <div className="small muted">{t('Staff choose collars and cuffs by picture at the counter. Upload a clear photo of each style.', 'يختار الموظفون الياقة والكبك بالصورة في نقطة البيع. ارفع صورة واضحة لكل نوع.')}</div> : null}
      {receive ? <ReceiveModal item={receive} onClose={() => setReceive(null)} /> : null}
      {edit ? <EditModal kind={edit.kind} item={edit.item} cat={c} onClose={() => setEdit(null)} /> : null}
    </div>
  );
}

function EditModal({ kind, item, cat, onClose }: { kind: Kind; item: any | null; cat: Cat; onClose: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const confirm = useConfirm();
  const [uploading, setUploading] = useState(false);
  const taxes = useQuery({ queryKey: ['list', 'tax-rates'], queryFn: () => api<{ id: string; name: string; percent: number; active: boolean }[]>('/lists/tax-rates'), enabled: kind === 'fabrics' });
  const [v, setV] = useState<any>(() =>
    item
      ? { ...item }
      : kind === 'fabrics'
        ? { name_en: '', name_ar: '', note_en: '', note_ar: '', price: '', active: true, sku: '', cost: '', track_stock: true, alert_qty: '', metres_per_thobe: 3.5, tax_rate_id: null }
        : kind === 'collars'
          ? { name_en: '', name_ar: '', shape: 'classic-qatari', active: true, image_url: null }
          : kind === 'cuffs'
            ? { name_en: '', name_ar: '', active: true, image_url: null }
            : { name_en: '', name_ar: '', active: true },
  );
  const set = (k: string, val: unknown) => setV((s: any) => ({ ...s, [k]: val }));
  const save = useMutation({
    mutationFn: () => {
      const body: any = { ...v };
      delete body.id;
      delete body.product_count;
      delete body.colour_ids;
      delete body.sort;
      if (kind === 'fabrics') for (const k of ['cost', 'alert_qty']) if (body[k] === '') delete body[k];
      return item ? api(`/${kind}/${item.id}`, { method: 'PATCH', body }) : api(`/${kind}`, { body });
    },
    onSuccess: () => {
      toast(t('Saved. The app shows the change now.', 'تم الحفظ ويظهر التغيير في التطبيق الآن.'));
      qc.invalidateQueries({ queryKey: ['catalogue'] });
      onClose();
    },
    onError: (e) => toast(errorMessage(e), 'error'),
  });
  return (
    <Modal
      title={item ? `${t('Edit', 'تعديل')} ${noun(kind)}` : `${t('New', 'جديد')}: ${noun(kind)}`}
      onClose={onClose}
      wide
      footer={
        <>
          <button className="btn secondary" onClick={onClose}>{t('Cancel', 'إلغاء')}</button>
          <button className="btn" data-testid="catalogue-save" disabled={save.isPending || uploading} onClick={async () => (!item || (await confirm())) && save.mutate()}>{t('Save', 'حفظ')}</button>
        </>
      }
    >
      <div className="grid k2">
        <Field label={t('Name (English)', 'الاسم (إنجليزي)')}><Input data-testid="name-en" dir="ltr" value={v.name_en} onChange={(e) => set('name_en', e.target.value)} /></Field>
        <Field label={t('Name (Arabic)', 'الاسم (عربي)')}><Input data-testid="name-ar" dir="rtl" value={v.name_ar} onChange={(e) => set('name_ar', e.target.value)} /></Field>
      </div>
      {kind === 'fabrics' ? (
        <>
          <div className="grid k3">
            <Field label={t('Note (English)', 'وصف (إنجليزي)')}><Input dir="ltr" value={v.note_en} onChange={(e) => set('note_en', e.target.value)} placeholder="Soft, breathable · all seasons" /></Field>
            <Field label={t('Note (Arabic)', 'وصف (عربي)')}><Input dir="rtl" value={v.note_ar} onChange={(e) => set('note_ar', e.target.value)} /></Field>
            <Field label={t('Price per metre (QAR)', 'سعر المتر (ر.ق)')} hint={t('A thobe costs its metres × this price.', 'سعر الثوب = أمتاره × هذا السعر.')}><Input data-testid="price" type="number" min={0} step="0.01" value={v.price} onChange={(e) => set('price', e.target.value)} /></Field>
          </div>
          <div className="grid k3">
            <Field label={t('Code (SKU)', 'الرمز (SKU)')} hint={t('Blank: made from the name.', 'فارغ: يُنشأ من الاسم.')}><Input dir="ltr" value={v.sku ?? ''} onChange={(e) => set('sku', e.target.value)} /></Field>
            <Field label={t('Cost per metre (QAR)', 'تكلفة المتر (ر.ق)')}><Input type="number" min={0} value={v.cost ?? ''} onChange={(e) => set('cost', e.target.value)} /></Field>
            <Field label={t('Usual metres a thobe', 'الأمتار المعتادة للثوب')} hint={t('Where the length starts at the counter, and the length for app orders.', 'الطول الذي يبدأ به في نقطة البيع، وطول طلبات التطبيق.')}><Input type="number" min={0} step="0.01" value={v.metres_per_thobe ?? ''} onChange={(e) => set('metres_per_thobe', e.target.value)} /></Field>
            <Field label={t('Alert below (metres)', 'تنبيه أقل من (متر)')}><Input type="number" min={0} value={v.alert_qty ?? ''} onChange={(e) => set('alert_qty', e.target.value)} /></Field>
            <Field label={t('Tax rate', 'معدل الضريبة')}>
              <Select value={v.tax_rate_id ?? ''} onChange={(e) => set('tax_rate_id', e.target.value || null)}>
                <option value="">{t('None', 'بدون')}</option>
                {(taxes.data ?? []).map((x) => <option key={x.id} value={x.id}>{x.name} · {x.percent}%</option>)}
              </Select>
            </Field>
            <label className="check" style={{ alignSelf: 'end', height: 40 }}><input type="checkbox" checked={Boolean(v.track_stock)} onChange={(e) => set('track_stock', e.target.checked)} /> {t('Track stock (metres)', 'تتبع المخزون (بالمتر)')}</label>
          </div>
        </>
      ) : null}
      {kind === 'collars' ? (
        <Field label={t('Drawing in the app', 'الرسم في التطبيق')} hint={t('The app has four collar drawings. Pick the closest one.', 'في التطبيق أربعة رسوم للياقات. اختر الأقرب.')}>
          <Select data-testid="collar-shape" value={v.shape} onChange={(e) => set('shape', e.target.value)}>
            {cat.collarShapes.map((s) => <option key={s} value={s}>{shapeLabel(s)}</option>)}
          </Select>
        </Field>
      ) : null}
      {kind === 'categories' && item && !v.active ? <div className="note">{t('A hidden category loses its filter in the shop. Its products still show under All until they are hidden too.', 'القسم المخفي يختفي من فلاتر المتجر، وتبقى منتجاته تحت "الكل" حتى تُخفى أيضًا.')}</div> : null}
      {kind === 'collars' || kind === 'cuffs' ? (
        <Field label={t('Picture', 'الصورة')} hint={t('Shown when staff choose the style. JPEG, PNG or WebP; square works best.', 'تظهر عند اختيار النوع. JPEG أو PNG أو WebP؛ المربعة أفضل.')}>
          <div className="row" style={{ gap: 12 }}>
            <Picture url={v.image_url} />
            <input
              data-testid="style-photo"
              type="file"
              aria-label={t('Picture', 'الصورة')}
              accept="image/jpeg,image/png,image/webp"
              disabled={uploading}
              onChange={async (e) => {
                const f = e.target.files?.[0];
                e.target.value = '';
                if (!f) return;
                setUploading(true);
                try {
                  set('image_url', (await uploadImage(await shrinkImage(f, 800))).url);
                } catch (err) {
                  toast(errorMessage(err), 'error');
                } finally {
                  setUploading(false);
                }
              }}
            />
            {uploading ? <span className="small secondary">{t('Uploading…', 'جارٍ الرفع…')}</span> : null}
            {v.image_url && !uploading ? <button type="button" className="btn sm secondary" onClick={() => set('image_url', null)}>{t('Remove', 'إزالة')}</button> : null}
          </div>
        </Field>
      ) : null}
      <label className="check">
        <input type="checkbox" checked={v.active} onChange={(e) => set('active', e.target.checked)} /> {t('Show in the app and at the counter', 'إظهار في التطبيق ونقطة البيع')}
      </label>
    </Modal>
  );
}
