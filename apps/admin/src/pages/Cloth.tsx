import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useSearchParams } from 'react-router-dom';
import { History, Plus } from 'lucide-react';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { L, t } from '../lib/i18n';
import { money, num } from '../lib/format';
import { Empty, Loading, Modal, PageHead, SearchBox } from '../ui';
import { EditModal, type Cat, type Fabric } from './Catalogue';
import { ReceiveModal, StockHistory, type ReceiveItem } from './Stock';

/** The cloth list: every cloth with the metres left, and a + to add what arrived (the same as on Products). */
export default function Cloth() {
  const { can } = useAuth();
  const [params, setParams] = useSearchParams();
  const [q, setQ] = useState('');
  const [edit, setEdit] = useState<{ item: Fabric | null } | null>(params.get('new') ? { item: null } : null);
  const [history, setHistory] = useState<Fabric | null>(null);
  const [receive, setReceive] = useState<ReceiveItem | null>(null);
  const editable = can('manage');
  const canStock = can('products');
  const data = useQuery({ queryKey: ['catalogue'], queryFn: () => api<Cat>('/catalogue') });
  const stock = useQuery({ queryKey: ['stock', ''], queryFn: () => api<any[]>('/stock') });
  /** Metres of each cloth in stock: all branches together, and branch by branch. */
  const { totals, byBranch } = useMemo(() => {
    const totals = new Map<string, number>();
    const byBranch = new Map<string, { name: string; qty: number }[]>();
    for (const r of stock.data ?? []) {
      if (r.kind !== 'fabric') continue;
      totals.set(r.id, (totals.get(r.id) ?? 0) + r.qty);
      const name = L(r, 'branch') || r.branch_name || '';
      if (name) byBranch.set(r.id, [...(byBranch.get(r.id) ?? []), { name, qty: r.qty }]);
    }
    return { totals, byBranch };
  }, [stock.data]);
  if (!data.data) return <Loading />;
  const s = q.trim().toLowerCase();
  const rows = data.data.fabrics.filter((f) => !s || f.sku.toLowerCase().includes(s) || f.name_en.toLowerCase().includes(s) || f.name_ar.includes(q.trim()));
  const close = () => {
    setEdit(null);
    if (params.get('new')) setParams({});
  };
  return (
    <div className="stack lg">
      <PageHead title={t('Cloth', 'الأقمشة')} sub={t('Every cloth with the metres left in stock. Use + to add cloth that has arrived.', 'كل قماش مع الأمتار المتبقية في المخزون. استخدم + لإضافة القماش الواصل.')}>
        <SearchBox value={q} onChange={setQ} placeholder={t('Name or code', 'الاسم أو الرمز')} width={220} testid="cloth-search" />
        {editable ? <button className="btn" data-testid="add-cloth" onClick={() => setEdit({ item: null })}><Plus size={16} /> {t('Add cloth', 'أضف قماشًا')}</button> : null}
      </PageHead>
      <div className="card table-wrap">
        {rows.length ? (
          <table data-testid="cloth-table">
            <thead>
              <tr>
                <th>{t('Cloth', 'القماش')}</th>
                <th>{t('Code', 'الرمز')}</th>
                <th className="right">{t('Cost per metre', 'تكلفة المتر')}</th>
                <th className="right">{t('Price per metre', 'سعر المتر')}</th>
                <th className="right">{t('Usual metres a thobe', 'الأمتار المعتادة للثوب')}</th>
                <th className="right">{t('Stock (metres)', 'المخزون (متر)')}</th>
                <th>{t('Status', 'الحالة')}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((f) => {
                const st = totals.get(f.id) ?? 0;
                const branches = byBranch.get(f.id) ?? [];
                return (
                  <tr key={f.id} className={editable ? 'click' : ''} data-testid={`cloth-${f.sku}`} onClick={() => editable && setEdit({ item: f })}>
                    <td><div className="strong">{L(f)}</div>{L(f, 'note') ? <div className="small muted">{L(f, 'note')}</div> : null}</td>
                    <td className="small num">{f.sku}</td>
                    <td className="right num">{money(f.cost)}</td>
                    <td className="right num">{money(f.price)}</td>
                    <td className="right num">{num(f.metres_per_thobe)}</td>
                    <td className="right num" style={{ whiteSpace: 'nowrap' }}>
                      {f.track_stock ? (
                        <button className="linklike" data-testid={`cloth-stock-${f.sku}`} title={t('Stock history', 'حركة المخزون')} onClick={(e) => { e.stopPropagation(); setHistory(f); }}>
                          <span className={st <= (f.alert_qty ?? 0) ? 'tone-error strong' : ''}>{num(st)} {t('m', 'م')}</span> <History size={12} />
                        </button>
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
                      {f.track_stock && branches.length > 1 ? <div className="small muted">{branches.map((b) => `${b.name} ${num(b.qty)}`).join(' · ')}</div> : null}
                    </td>
                    <td>{f.active ? <span className="badge ok">{t('Live', 'ظاهر')}</span> : <span className="badge">{t('Hidden', 'مخفي')}</span>}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        ) : (
          <Empty>{t('No cloth matches.', 'لا أقمشة مطابقة.')}</Empty>
        )}
      </div>
      {edit ? <EditModal kind="fabrics" item={edit.item} cat={data.data} onClose={close} /> : null}
      {receive ? <ReceiveModal item={receive} onClose={() => setReceive(null)} /> : null}
      {history ? (
        <Modal title={`${L(history)} · ${t('stock history', 'حركة المخزون')}`} onClose={() => setHistory(null)} wide>
          <StockHistory kind="fabric" id={history.id} />
        </Modal>
      ) : null}
    </div>
  );
}
