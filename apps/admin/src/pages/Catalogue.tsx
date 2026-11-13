import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
import { api, errorMessage, mediaUrl, shrinkImage, uploadImage } from '../lib/api';
import { useAuth } from '../lib/auth';
import { money } from '../lib/format';
import { Field, Input, Loading, Modal, PageHead, Select, Tabs, TextArea, useToast } from '../ui';

type Product = { id: string; category: string; name_en: string; name_ar: string; description_en: string; description_ar: string; price: number; sizes: string[]; image_url: string | null; active: boolean };
type Fabric = { id: string; name_en: string; name_ar: string; note_en: string; note_ar: string; price: number; active: boolean; colour_ids: string[] };
type Collar = { id: string; name_en: string; name_ar: string; active: boolean; shape: string };
type Colour = { id: string; name_en: string; name_ar: string; hex: string };
type Category = { id: string; name_en: string; name_ar: string; active: boolean; product_count: number };
type Cat = { categories: Category[]; collarShapes: string[]; products: Product[]; fabrics: Fabric[]; collars: Collar[]; colours: Colour[] };
type Kind = 'products' | 'categories' | 'fabrics' | 'collars' | 'colours';

const NOUN: Record<Kind, string> = { products: 'product', categories: 'category', fabrics: 'fabric', collars: 'collar', colours: 'colour' };
// The app has four collar drawings; every collar uses one of them.
const SHAPE_LABEL: Record<string, string> = { 'classic-qatari': 'Classic (pointed)', 'mandarin-band': 'Band', 'round-neck': 'Round', 'wide-collar': 'Wide' };

export default function Catalogue() {
  const [tab, setTab] = useState<Kind>('products');
  const [edit, setEdit] = useState<{ kind: Kind; item: any | null } | null>(null);
  const { can } = useAuth();
  const editable = can('owner', 'manager');
  const q = useQuery({ queryKey: ['catalogue'], queryFn: () => api<Cat>('/catalogue') });
  if (!q.data) return <Loading />;
  const c = q.data;
  const colourName = (id: string) => c.colours.find((x) => x.id === id)?.name_en ?? id;
  const categoryName = (id: string) => c.categories.find((x) => x.id === id)?.name_en ?? id;

  return (
    <div className="stack lg">
      <PageHead title="Catalogue" sub="What customers see in the shop and the thobe builder. Changes appear in the app straight away.">
        <Tabs value={tab} onChange={setTab} options={[['products', 'Products'], ['categories', 'Categories'], ['fabrics', 'Fabrics'], ['collars', 'Collars'], ['colours', 'Colours']]} />
        {editable ? (
          <button className="btn" data-testid={`add-${tab}`} onClick={() => setEdit({ kind: tab, item: null })}>
            <Plus size={16} /> Add {NOUN[tab]}
          </button>
        ) : null}
      </PageHead>
      <div className="card table-wrap">
        {tab === 'products' ? (
          <table>
            <thead><tr><th style={{ width: 56 }}>Photo</th><th>Product</th><th>Arabic</th><th>Category</th><th>Sizes</th><th className="right">Price</th><th>Status</th></tr></thead>
            <tbody>
              {c.products.map((p) => (
                <tr key={p.id} className={editable ? 'click' : ''} data-testid={`product-${p.id}`} onClick={() => editable && setEdit({ kind: 'products', item: p })}>
                  <td>{p.image_url ? <img src={mediaUrl(p.image_url)} alt="" style={{ width: 40, height: 40, objectFit: 'cover', borderRadius: 8, display: 'block' }} /> : <span className="small muted">None</span>}</td>
                  <td className="strong">{p.name_en}</td>
                  <td dir="rtl" style={{ textAlign: 'left' }}>{p.name_ar}</td>
                  <td>{categoryName(p.category)}</td>
                  <td className="small">{p.sizes.join(', ') || '—'}</td>
                  <td className="right num">{money(p.price)}</td>
                  <td>{p.active ? <span className="badge ok">Live</span> : <span className="badge">Hidden</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : tab === 'categories' ? (
          <table>
            <thead><tr><th>Category</th><th>Arabic</th><th className="right">Products</th><th>Status</th></tr></thead>
            <tbody>
              {c.categories.map((x) => (
                <tr key={x.id} className={editable ? 'click' : ''} data-testid={`category-${x.id}`} onClick={() => editable && setEdit({ kind: 'categories', item: x })}>
                  <td className="strong">{x.name_en}</td>
                  <td dir="rtl" style={{ textAlign: 'left' }}>{x.name_ar}</td>
                  <td className="right num">{x.product_count}</td>
                  <td>{x.active ? <span className="badge ok">Live</span> : <span className="badge">Hidden</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : tab === 'fabrics' ? (
          <table>
            <thead><tr><th>Fabric</th><th>Note</th><th>Colours</th><th className="right">Thobe price</th><th>Status</th></tr></thead>
            <tbody>
              {c.fabrics.map((f) => (
                <tr key={f.id} className={editable ? 'click' : ''} data-testid={`fabric-${f.id}`} onClick={() => editable && setEdit({ kind: 'fabrics', item: f })}>
                  <td><div className="strong">{f.name_en}</div><div className="small muted" dir="rtl" style={{ textAlign: 'left' }}>{f.name_ar}</div></td>
                  <td className="small secondary">{f.note_en}</td>
                  <td>
                    <div className="row" style={{ gap: 3 }} title={f.colour_ids.map(colourName).join(', ')}>
                      {f.colour_ids.map((id) => <span key={id} className="swatch" style={{ background: c.colours.find((x) => x.id === id)?.hex }} />)}
                    </div>
                  </td>
                  <td className="right num">{money(f.price)}</td>
                  <td>{f.active ? <span className="badge ok">Live</span> : <span className="badge">Hidden</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : tab === 'collars' ? (
          <table>
            <thead><tr><th>Collar</th><th>Arabic</th><th>Drawing in the app</th><th>Status</th></tr></thead>
            <tbody>
              {c.collars.map((x) => (
                <tr key={x.id} className={editable ? 'click' : ''} data-testid={`collar-${x.id}`} onClick={() => editable && setEdit({ kind: 'collars', item: x })}>
                  <td className="strong">{x.name_en}</td>
                  <td dir="rtl" style={{ textAlign: 'left' }}>{x.name_ar}</td>
                  <td>{SHAPE_LABEL[x.shape] ?? x.shape}</td>
                  <td>{x.active ? <span className="badge ok">Live</span> : <span className="badge">Hidden</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <table>
            <thead><tr><th>Colour</th><th>Arabic</th><th>Hex</th><th>Used by</th></tr></thead>
            <tbody>
              {c.colours.map((x) => (
                <tr key={x.id} className={editable ? 'click' : ''} onClick={() => editable && setEdit({ kind: 'colours', item: x })}>
                  <td className="strong"><span className="swatch" style={{ background: x.hex, marginRight: 8 }} />{x.name_en}</td>
                  <td dir="rtl" style={{ textAlign: 'left' }}>{x.name_ar}</td>
                  <td className="num small">{x.hex}</td>
                  <td className="small secondary">{c.fabrics.filter((f) => f.colour_ids.includes(x.id)).length} fabrics</td>
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
  const [v, setV] = useState<any>(() =>
    item
      ? { ...item, sizes: item.sizes ? item.sizes.join(', ') : undefined }
      : kind === 'products'
        ? { category: cat.categories.find((x) => x.active)?.id ?? cat.categories[0]?.id ?? '', name_en: '', name_ar: '', description_en: '', description_ar: '', price: '', sizes: '', image_url: null, active: true }
        : kind === 'fabrics'
          ? { name_en: '', name_ar: '', note_en: '', note_ar: '', price: '', colour_ids: ['pure-white', 'ivory'], active: true }
          : kind === 'colours'
            ? { name_en: '', name_ar: '', hex: '#FFFFFF' }
            : kind === 'collars'
              ? { name_en: '', name_ar: '', shape: 'classic-qatari', active: true }
              : { name_en: '', name_ar: '', active: true },
  );
  const set = (k: string, val: unknown) => setV((s: any) => ({ ...s, [k]: val }));
  const [uploading, setUploading] = useState(false);
  const pickPhoto = async (file: File | undefined) => {
    if (!file) return;
    setUploading(true);
    try {
      const saved = await uploadImage(await shrinkImage(file));
      set('image_url', saved.url);
    } catch (e) {
      toast(errorMessage(e), 'error');
    } finally {
      setUploading(false);
    }
  };
  const save = useMutation({
    mutationFn: () => {
      const body: any = { ...v };
      delete body.id;
      delete body.product_count;
      if (kind === 'products') body.sizes = String(v.sizes ?? '').split(',').map((s: string) => s.trim()).filter(Boolean);
      return item ? api(`/${kind}/${item.id}`, { method: 'PATCH', body }) : api(`/${kind}`, { body });
    },
    onSuccess: () => {
      toast('Saved. The app shows the change now.');
      qc.invalidateQueries({ queryKey: ['catalogue'] });
      onClose();
    },
    onError: (e) => toast(errorMessage(e), 'error'),
  });
  const noun = NOUN[kind];
  return (
    <Modal
      title={item ? `Edit ${noun}` : `New ${noun}`}
      onClose={onClose}
      wide
      footer={
        <>
          <button className="btn secondary" onClick={onClose}>Cancel</button>
          <button className="btn" data-testid="catalogue-save" disabled={save.isPending || uploading} onClick={() => save.mutate()}>Save</button>
        </>
      }
    >
      <div className="grid k2">
        <Field label="Name (English)"><Input data-testid="name-en" value={v.name_en} onChange={(e) => set('name_en', e.target.value)} /></Field>
        <Field label="Name (Arabic)"><Input data-testid="name-ar" dir="rtl" value={v.name_ar} onChange={(e) => set('name_ar', e.target.value)} /></Field>
      </div>
      {kind === 'products' ? (
        <>
          <div className="grid k3">
            <Field label="Category">
              <Select value={v.category} onChange={(e) => set('category', e.target.value)}>
                {cat.categories.map((c) => <option key={c.id} value={c.id}>{c.name_en}{c.active ? '' : ' (hidden)'}</option>)}
              </Select>
            </Field>
            <Field label="Price (QAR)"><Input data-testid="price" type="number" min={0} value={v.price} onChange={(e) => set('price', e.target.value)} /></Field>
            <Field label="Sizes" hint="Comma separated, blank for none"><Input value={v.sizes} onChange={(e) => set('sizes', e.target.value)} placeholder="52, 56, 58" /></Field>
          </div>
          <div className="grid k2">
            <Field label="Description (English)"><TextArea value={v.description_en} onChange={(e) => set('description_en', e.target.value)} /></Field>
            <Field label="Description (Arabic)"><TextArea dir="rtl" value={v.description_ar} onChange={(e) => set('description_ar', e.target.value)} /></Field>
          </div>
          <Field label="Photo" hint="JPEG, PNG or WebP. Large photos are made smaller before they are saved. Square photos look best.">
            <div className="row" style={{ gap: 12, alignItems: 'center' }}>
              {v.image_url ? (
                <img data-testid="photo-preview" src={mediaUrl(v.image_url)} alt="" style={{ width: 72, height: 72, objectFit: 'cover', borderRadius: 10, border: '1px solid #e8e2d6' }} />
              ) : (
                <div className="small muted" style={{ width: 72, height: 72, borderRadius: 10, border: '1px dashed #cfc7b8', display: 'grid', placeItems: 'center' }}>No photo</div>
              )}
              <input data-testid="photo-input" type="file" accept="image/jpeg,image/png,image/webp" disabled={uploading} onChange={(e) => { pickPhoto(e.target.files?.[0]); e.target.value = ''; }} />
              {uploading ? <span className="small secondary">Uploading…</span> : null}
              {v.image_url && !uploading ? <button type="button" className="btn sm secondary" onClick={() => set('image_url', null)}>Remove</button> : null}
            </div>
          </Field>
        </>
      ) : null}
      {kind === 'fabrics' ? (
        <>
          <div className="grid k3">
            <Field label="Note (English)"><Input value={v.note_en} onChange={(e) => set('note_en', e.target.value)} placeholder="Soft, breathable · all seasons" /></Field>
            <Field label="Note (Arabic)"><Input dir="rtl" value={v.note_ar} onChange={(e) => set('note_ar', e.target.value)} /></Field>
            <Field label="Thobe price (QAR)" hint="Fabric sets the price of a thobe."><Input data-testid="price" type="number" min={0} value={v.price} onChange={(e) => set('price', e.target.value)} /></Field>
          </div>
          <Field label="Colours available in this fabric">
            <div className="chips">
              {cat.colours.map((c) => {
                const on = v.colour_ids.includes(c.id);
                return (
                  <button key={c.id} type="button" className={`chip ${on ? 'on' : ''}`} onClick={() => set('colour_ids', on ? v.colour_ids.filter((x: string) => x !== c.id) : [...v.colour_ids, c.id])}>
                    <span className="swatch" style={{ background: c.hex }} />
                    {c.name_en}
                  </button>
                );
              })}
            </div>
          </Field>
        </>
      ) : null}
      {kind === 'collars' ? (
        <Field label="Drawing in the app" hint="The app has four collar drawings. Pick the closest one.">
          <Select data-testid="collar-shape" value={v.shape} onChange={(e) => set('shape', e.target.value)}>
            {cat.collarShapes.map((s) => <option key={s} value={s}>{SHAPE_LABEL[s] ?? s}</option>)}
          </Select>
        </Field>
      ) : null}
      {kind === 'categories' && item && !v.active ? <div className="note">A hidden category loses its filter in the shop. Its products still show under All until they are hidden too.</div> : null}
      {kind === 'colours' ? (
        <Field label="Colour">
          <div className="row">
            <input type="color" value={v.hex} onChange={(e) => set('hex', e.target.value.toUpperCase())} style={{ width: 48, height: 40, border: 0, background: 'none' }} />
            <Input value={v.hex} onChange={(e) => set('hex', e.target.value)} style={{ width: 140 }} />
          </div>
        </Field>
      ) : null}
      {kind !== 'colours' ? (
        <label className="check">
          <input type="checkbox" checked={v.active} onChange={(e) => set('active', e.target.checked)} /> Show in the app
        </label>
      ) : null}
    </Modal>
  );
}
