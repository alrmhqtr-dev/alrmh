import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
import { Link } from 'react-router-dom';
import { api, errorMessage } from '../lib/api';
import { useAuth } from '../lib/auth';
import { L, t } from '../lib/i18n';
import { money, num } from '../lib/format';
import { Field, Input, Loading, Modal, PageHead, Select, Tabs, useToast } from '../ui';

type Product = { id: string; category: string; name_en: string; name_ar: string; description_en: string; description_ar: string; price: number; sizes: string[]; image_url: string | null; active: boolean };
type Fabric = { id: string; name_en: string; name_ar: string; note_en: string; note_ar: string; price: number; active: boolean; colour_ids: string[]; sku: string; cost: number; track_stock: boolean; alert_qty: number; metres_per_thobe: number; tax_rate_id: string | null };
type Collar = { id: string; name_en: string; name_ar: string; active: boolean; shape: string };
type Colour = { id: string; name_en: string; name_ar: string; hex: string };
type Category = { id: string; name_en: string; name_ar: string; active: boolean; product_count: number };
type Cat = { categories: Category[]; collarShapes: string[]; products: Product[]; fabrics: Fabric[]; collars: Collar[]; colours: Colour[] };
type Kind = 'categories' | 'fabrics' | 'collars' | 'colours';

const noun = (k: Kind) => ({ categories: t('category', 'قسم'), fabrics: t('cloth', 'قماش'), collars: t('collar', 'ياقة'), colours: t('colour', 'لون') })[k];
// The app has four collar drawings; every collar uses one of them.
const shapeLabel = (s: string) => ({ 'classic-qatari': t('Classic (pointed)', 'كلاسيكي (مدبب)'), 'mandarin-band': t('Band', 'ياقة صينية'), 'round-neck': t('Round', 'دائري'), 'wide-collar': t('Wide', 'عريض') })[s] ?? s;

export default function Catalogue() {
  const [tab, setTab] = useState<Kind>('categories');
  const [edit, setEdit] = useState<{ kind: Kind; item: any | null } | null>(null);
  const { can } = useAuth();
  const editable = can('manage') || (tab === 'categories' && can('products'));
  const q = useQuery({ queryKey: ['catalogue'], queryFn: () => api<Cat>('/catalogue') });
  if (!q.data) return <Loading />;
  const c = q.data;
  const colourName = (id: string) => L(c.colours.find((x) => x.id === id)) || id;

  return (
    <div className="stack lg">
      <PageHead title={t('Categories & thobe options', 'أقسام المنتجات وخيارات الثوب')} sub={t('What customers see in the shop and the thobe builder, and what the counter sells. Changes appear in the app straight away.', 'ما يراه العملاء في المتجر ومصمم الثوب وما يُباع في نقطة البيع. تظهر التغييرات في التطبيق فورًا.')}>
        <Tabs value={tab} onChange={setTab} options={[['categories', t('Categories', 'الأقسام')], ['fabrics', t('Cloth', 'الأقمشة')], ['collars', t('Collars', 'الياقات')], ['colours', t('Colours', 'الألوان')]]} />
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
            <thead><tr><th>{t('Cloth', 'القماش')}</th><th>{t('Code', 'الرمز')}</th><th>{t('Colours', 'الألوان')}</th><th className="right">{t('Thobe price', 'سعر الثوب')}</th><th className="right">{t('Metres a thobe', 'متر لكل ثوب')}</th><th>{t('Stock', 'المخزون')}</th><th>{t('Status', 'الحالة')}</th></tr></thead>
            <tbody>
              {c.fabrics.map((f) => (
                <tr key={f.id} className={editable ? 'click' : ''} data-testid={`fabric-${f.id}`} onClick={() => editable && setEdit({ kind: 'fabrics', item: f })}>
                  <td><div className="strong">{L(f)}</div><div className="small muted">{L(f, 'note')}</div></td>
                  <td className="small num">{f.sku}</td>
                  <td>
                    <div className="row" style={{ gap: 3 }} title={f.colour_ids.map(colourName).join(', ')}>
                      {f.colour_ids.map((id) => <span key={id} className="swatch" style={{ background: c.colours.find((x) => x.id === id)?.hex }} />)}
                    </div>
                  </td>
                  <td className="right num">{money(f.price)}</td>
                  <td className="right num">{num(f.metres_per_thobe)}</td>
                  <td className="small">{f.track_stock ? <Link to={`/stock?q=${encodeURIComponent(f.sku)}`} onClick={(e) => e.stopPropagation()}>{t('Tracked', 'متتبع')}</Link> : <span className="muted">{t('Not tracked', 'غير متتبع')}</span>}</td>
                  <td>{f.active ? <span className="badge ok">{t('Live', 'ظاهر')}</span> : <span className="badge">{t('Hidden', 'مخفي')}</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : tab === 'collars' ? (
          <table>
            <thead><tr><th>{t('Collar', 'الياقة')}</th><th>{t('Arabic', 'بالعربية')}</th><th>{t('Drawing in the app', 'الرسم في التطبيق')}</th><th>{t('Status', 'الحالة')}</th></tr></thead>
            <tbody>
              {c.collars.map((x) => (
                <tr key={x.id} className={editable ? 'click' : ''} data-testid={`collar-${x.id}`} onClick={() => editable && setEdit({ kind: 'collars', item: x })}>
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
            <thead><tr><th>{t('Colour', 'اللون')}</th><th>{t('Arabic', 'بالعربية')}</th><th>Hex</th><th>{t('Used by', 'مستخدم في')}</th></tr></thead>
            <tbody>
              {c.colours.map((x) => (
                <tr key={x.id} className={editable ? 'click' : ''} onClick={() => editable && setEdit({ kind: 'colours', item: x })}>
                  <td className="strong"><span className="swatch" style={{ background: x.hex, marginInlineEnd: 8 }} />{x.name_en}</td>
                  <td dir="rtl">{x.name_ar}</td>
                  <td className="num small">{x.hex}</td>
                  <td className="small secondary">{c.fabrics.filter((f) => f.colour_ids.includes(x.id)).length} {t('cloths', 'أقمشة')}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      {edit ? <EditModal kind={edit.kind} item={edit.item} cat={c} onClose={() => setEdit(null)} /> : null}
    </div>
  );
}

function EditModal({ kind, item, cat, onClose }: { kind: Kind; item: any | null; cat: Cat; onClose: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const taxes = useQuery({ queryKey: ['list', 'tax-rates'], queryFn: () => api<{ id: string; name: string; percent: number; active: boolean }[]>('/lists/tax-rates'), enabled: kind === 'fabrics' });
  const [v, setV] = useState<any>(() =>
    item
      ? { ...item }
      : kind === 'fabrics'
        ? { name_en: '', name_ar: '', note_en: '', note_ar: '', price: '', colour_ids: ['pure-white', 'ivory'], active: true, sku: '', cost: '', track_stock: false, alert_qty: '', metres_per_thobe: 3.5, tax_rate_id: null }
        : kind === 'colours'
          ? { name_en: '', name_ar: '', hex: '#FFFFFF' }
          : kind === 'collars'
            ? { name_en: '', name_ar: '', shape: 'classic-qatari', active: true }
            : { name_en: '', name_ar: '', active: true },
  );
  const set = (k: string, val: unknown) => setV((s: any) => ({ ...s, [k]: val }));
  const save = useMutation({
    mutationFn: () => {
      const body: any = { ...v };
      delete body.id;
      delete body.product_count;
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
          <button className="btn" data-testid="catalogue-save" disabled={save.isPending} onClick={() => save.mutate()}>{t('Save', 'حفظ')}</button>
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
            <Field label={t('Thobe price (QAR)', 'سعر الثوب (ر.ق)')} hint={t('The cloth sets the price of a thobe.', 'القماش يحدد سعر الثوب.')}><Input data-testid="price" type="number" min={0} value={v.price} onChange={(e) => set('price', e.target.value)} /></Field>
          </div>
          <div className="grid k3">
            <Field label={t('Code (SKU)', 'الرمز (SKU)')} hint={t('Blank: made from the name.', 'فارغ: يُنشأ من الاسم.')}><Input dir="ltr" value={v.sku ?? ''} onChange={(e) => set('sku', e.target.value)} /></Field>
            <Field label={t('Cost per metre (QAR)', 'تكلفة المتر (ر.ق)')}><Input type="number" min={0} value={v.cost ?? ''} onChange={(e) => set('cost', e.target.value)} /></Field>
            <Field label={t('Metres a thobe', 'أمتار لكل ثوب')} hint={t('Taken from stock for each thobe.', 'تُخصم من المخزون لكل ثوب.')}><Input type="number" min={0} step="0.1" value={v.metres_per_thobe ?? ''} onChange={(e) => set('metres_per_thobe', e.target.value)} /></Field>
            <Field label={t('Alert below (metres)', 'تنبيه أقل من (متر)')}><Input type="number" min={0} value={v.alert_qty ?? ''} onChange={(e) => set('alert_qty', e.target.value)} /></Field>
            <Field label={t('Tax rate', 'معدل الضريبة')}>
              <Select value={v.tax_rate_id ?? ''} onChange={(e) => set('tax_rate_id', e.target.value || null)}>
                <option value="">{t('None', 'بدون')}</option>
                {(taxes.data ?? []).map((x) => <option key={x.id} value={x.id}>{x.name} · {x.percent}%</option>)}
              </Select>
            </Field>
            <label className="check" style={{ alignSelf: 'end', height: 40 }}><input type="checkbox" checked={Boolean(v.track_stock)} onChange={(e) => set('track_stock', e.target.checked)} /> {t('Track stock (metres)', 'تتبع المخزون (بالمتر)')}</label>
          </div>
          <Field label={t('Colours available in this cloth', 'الألوان المتاحة في هذا القماش')}>
            <div className="chips">
              {cat.colours.map((c) => {
                const on = v.colour_ids.includes(c.id);
                return (
                  <button key={c.id} type="button" className={`chip ${on ? 'on' : ''}`} onClick={() => set('colour_ids', on ? v.colour_ids.filter((x: string) => x !== c.id) : [...v.colour_ids, c.id])}>
                    <span className="swatch" style={{ background: c.hex }} />
                    {L(c)}
                  </button>
                );
              })}
            </div>
          </Field>
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
      {kind === 'colours' ? (
        <Field label={t('Colour', 'اللون')}>
          <div className="row">
            <input type="color" value={v.hex} onChange={(e) => set('hex', e.target.value.toUpperCase())} style={{ width: 48, height: 40, border: 0, background: 'none' }} />
            <Input dir="ltr" value={v.hex} onChange={(e) => set('hex', e.target.value)} style={{ width: 140 }} />
          </div>
        </Field>
      ) : null}
      {kind !== 'colours' ? (
        <label className="check">
          <input type="checkbox" checked={v.active} onChange={(e) => set('active', e.target.checked)} /> {t('Show in the app and at the counter', 'إظهار في التطبيق ونقطة البيع')}
        </label>
      ) : null}
    </Modal>
  );
}
