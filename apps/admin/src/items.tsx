import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from './lib/api';
import { L, t } from './lib/i18n';
import { money } from './lib/format';
import { Input } from './ui';

export type Pickable = { kind: 'product' | 'fabric'; id: string; sku: string; name: string; size: string; cost: number; price: number; unit: string };

/** Every product (each size on its own line) and every cloth, for stock and purchase forms. */
export function usePickables() {
  const cat = useQuery({ queryKey: ['catalogue'], queryFn: () => api<any>('/catalogue') });
  return useMemo<Pickable[]>(() => {
    if (!cat.data) return [];
    const out: Pickable[] = [];
    for (const p of cat.data.products)
      for (const size of p.sizes.length ? p.sizes : [''])
        out.push({ kind: 'product', id: p.id, sku: p.sku, name: L(p) + (size ? ` (${size})` : ''), size, cost: Number(p.cost), price: Number(p.price), unit: '' });
    for (const f of cat.data.fabrics) out.push({ kind: 'fabric', id: f.id, sku: f.sku, name: `${L(f)} · ${t('cloth', 'قماش')}`, size: '', cost: Number(f.cost), price: Number(f.price), unit: t('m', 'م') });
    return out;
  }, [cat.data]);
}

/** Type a name or scan a code; Enter or a click adds the item. */
export function ItemPicker({ onPick, testid }: { onPick: (p: Pickable) => void; testid?: string }) {
  const all = usePickables();
  const [q, setQ] = useState('');
  const s = q.trim().toLowerCase();
  const hits = s ? all.filter((p) => p.sku.toLowerCase().includes(s) || p.name.toLowerCase().includes(s)).slice(0, 8) : [];
  const take = (p: Pickable) => {
    onPick(p);
    setQ('');
  };
  return (
    <div style={{ position: 'relative' }}>
      <Input
        data-testid={testid}
        placeholder={t('Add item: name or code', 'أضف صنفًا: الاسم أو الرمز')}
        value={q}
        onChange={(e) => setQ(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && hits.length) {
            e.preventDefault();
            take(all.find((p) => p.sku.toLowerCase() === s) ?? hits[0]);
          }
        }}
      />
      {hits.length ? (
        <div className="card" style={{ position: 'absolute', insetInlineStart: 0, insetInlineEnd: 0, top: 44, zIndex: 10, maxHeight: 260, overflowY: 'auto' }}>
          {hits.map((p) => (
            <button key={`${p.kind}:${p.id}:${p.size}`} className="btn ghost" style={{ width: '100%', justifyContent: 'space-between' }} onClick={() => take(p)}>
              <span>{p.name}</span>
              <span className="small muted num">{p.sku} · {money(p.cost)}</span>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
