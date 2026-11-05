import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api';
import { dateTime } from '../lib/format';
import { Empty, Loading, PageHead } from '../ui';

type Entry = { id: number; staff_name: string | null; action: string; entity: string; entity_id: string | null; data: Record<string, unknown> | null; at: string };

const ACTION: Record<string, string> = { create: 'Created', update: 'Updated', stage: 'Moved stage', cancel: 'Cancelled', status: 'Changed status', adjust_points: 'Adjusted points' };

function summary(e: Entry) {
  const d = e.data ?? {};
  if (e.entity === 'order' && e.action === 'stage') return `to ${String(d.stage).replace(/_/g, ' ')}`;
  if (e.action === 'adjust_points') return `${Number(d.points) > 0 ? '+' : ''}${d.points} · ${d.reason}`;
  if (e.action === 'cancel') return d.reason ? String(d.reason) : '';
  const keys = Object.keys(d).filter((k) => d[k] !== undefined);
  return keys.slice(0, 5).join(', ');
}

export default function Audit() {
  const q = useQuery({ queryKey: ['audit'], queryFn: () => api<Entry[]>('/audit?limit=300') });
  return (
    <div className="stack lg">
      <PageHead title="Activity log" sub="Every change made in the admin, newest first." />
      <div className="card table-wrap">
        {!q.data ? (
          <Loading />
        ) : q.data.length ? (
          <table>
            <thead><tr><th>When</th><th>Who</th><th>What</th><th>Item</th><th>Details</th></tr></thead>
            <tbody>
              {q.data.map((e) => (
                <tr key={e.id}>
                  <td className="small" style={{ whiteSpace: 'nowrap' }}>{dateTime(e.at)}</td>
                  <td className="strong">{e.staff_name ?? '—'}</td>
                  <td>{ACTION[e.action] ?? e.action}</td>
                  <td style={{ textTransform: 'capitalize' }}>{e.entity.replace(/_/g, ' ')}</td>
                  <td className="small secondary">{summary(e)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <Empty>No changes yet.</Empty>
        )}
      </div>
    </div>
  );
}
