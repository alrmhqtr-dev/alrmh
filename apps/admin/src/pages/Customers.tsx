import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { Search } from 'lucide-react';
import { api } from '../lib/api';
import { date, money, num, phone } from '../lib/format';
import { Empty, Loading, PageHead } from '../ui';

type Row = { id: string; name: string | null; phone: string; email: string | null; language: string; created_at: string; orders: number; spent: number; points: number };

export default function Customers() {
  const [q, setQ] = useState('');
  const nav = useNavigate();
  const list = useQuery({ queryKey: ['customers', q], queryFn: () => api<Row[]>(`/customers${q ? `?q=${encodeURIComponent(q)}` : ''}`) });
  return (
    <div className="stack lg">
      <PageHead title="Customers" sub="Find a customer by mobile number or name.">
        <div className="row" style={{ position: 'relative' }}>
          <Search size={16} style={{ position: 'absolute', left: 12, color: 'var(--muted)' }} />
          <input className="input" data-testid="customer-search" placeholder="5555 1234 or name" value={q} onChange={(e) => setQ(e.target.value)} style={{ paddingLeft: 34, width: 260 }} autoFocus />
        </div>
      </PageHead>
      <div className="card table-wrap">
        {!list.data ? (
          <Loading />
        ) : list.data.length ? (
          <table>
            <thead>
              <tr><th>Name</th><th>Mobile</th><th>Language</th><th>Joined</th><th className="right">Orders</th><th className="right">Spent</th><th className="right">Points</th></tr>
            </thead>
            <tbody>
              {list.data.map((c) => (
                <tr key={c.id} className="click" data-testid={`customer-${c.phone}`} onClick={() => nav(`/customers/${c.id}`)}>
                  <td className="strong">{c.name ?? <span className="muted">No name yet</span>}</td>
                  <td className="num">{phone(c.phone)}</td>
                  <td>{c.language === 'ar' ? 'Arabic' : 'English'}</td>
                  <td className="small">{date(c.created_at)}</td>
                  <td className="right num">{c.orders}</td>
                  <td className="right num">{money(c.spent)}</td>
                  <td className="right num">{num(c.points)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <Empty>No customers match “{q}”.</Empty>
        )}
      </div>
    </div>
  );
}
