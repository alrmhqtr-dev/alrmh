import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api';
import { dateTime } from '../lib/format';
import { t } from '../lib/i18n';
import { Empty, Loading, PageHead } from '../ui';

type Entry = { id: number; staff_name: string | null; action: string; entity: string; entity_id: string | null; data: Record<string, unknown> | null; at: string };

const ACTION: Record<string, [string, string]> = {
  create: ['Created', 'إنشاء'],
  update: ['Updated', 'تعديل'],
  delete: ['Deleted', 'حذف'],
  stage: ['Moved stage', 'نقل مرحلة'],
  cancel: ['Cancelled', 'إلغاء'],
  status: ['Changed status', 'تغيير الحالة'],
  adjust_points: ['Adjusted points', 'تعديل النقاط'],
  sale: ['Sale', 'بيع'],
  payment: ['Payment', 'دفعة'],
  refund: ['Refund', 'استرداد'],
  return: ['Return', 'إرجاع'],
  open: ['Opened', 'فتح'],
  close: ['Closed', 'إغلاق'],
  cash_in: ['Cash in', 'إيداع'],
  cash_out: ['Cash out', 'سحب'],
  export: ['Exported', 'تصدير'],
  import: ['Imported', 'استيراد'],
  receive: ['Received', 'استلام'],
};

function summary(e: Entry) {
  const d = e.data ?? {};
  if (e.entity === 'order' && e.action === 'stage') return `→ ${String(d.stage).replace(/_/g, ' ')}`;
  if (e.action === 'adjust_points') return `${Number(d.points) > 0 ? '+' : ''}${d.points} · ${d.reason}`;
  if (e.action === 'cancel') return d.reason ? String(d.reason) : '';
  const keys = Object.keys(d).filter((k) => d[k] !== undefined);
  return keys.slice(0, 5).join(', ');
}

export default function Audit() {
  const q = useQuery({ queryKey: ['audit'], queryFn: () => api<Entry[]>('/audit?limit=300') });
  return (
    <div className="stack lg">
      <PageHead title={t('Activity log', 'سجل النشاط')} sub={t('Every change made in the admin and at the counter, newest first.', 'كل تغيير في الإدارة ونقطة البيع، الأحدث أولًا.')} />
      <div className="card table-wrap">
        {!q.data ? (
          <Loading />
        ) : q.data.length ? (
          <table>
            <thead><tr><th>{t('When', 'الوقت')}</th><th>{t('Who', 'الموظف')}</th><th>{t('What', 'الإجراء')}</th><th>{t('Item', 'العنصر')}</th><th>{t('Details', 'التفاصيل')}</th></tr></thead>
            <tbody>
              {q.data.map((e) => (
                <tr key={e.id}>
                  <td className="small" style={{ whiteSpace: 'nowrap' }}>{dateTime(e.at)}</td>
                  <td className="strong">{e.staff_name ?? '—'}</td>
                  <td>{ACTION[e.action] ? t(...ACTION[e.action]) : e.action}</td>
                  <td style={{ textTransform: 'capitalize' }}>{e.entity.replace(/_/g, ' ')}</td>
                  <td className="small secondary">{summary(e)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <Empty>{t('No changes yet.', 'لا تغييرات بعد.')}</Empty>
        )}
      </div>
    </div>
  );
}
