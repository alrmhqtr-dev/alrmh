import { useQuery } from '@tanstack/react-query';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { api } from '../lib/api';
import { t } from '../lib/i18n';
import { Empty, Loading } from '../ui';
import { MeasureModal, type Measurement } from '../measure';

/**
 * A person's measurements in a tab of their own (opened from orders, customers, the tailor and home visits):
 * record new ones, or with ?edit=1 correct the latest. The tab closes itself once they're saved; the page
 * it came from refreshes when it's looked at again.
 */
export default function MeasurePage() {
  const { memberId } = useParams();
  const [params] = useSearchParams();
  const nav = useNavigate();
  const m = useQuery({ queryKey: ['member', memberId], queryFn: () => api<{ id: string; name: string; customer_id: string; latest: (Measurement & { id: string }) | null }>(`/members/${memberId}`) });
  if (m.isLoading) return <Loading />;
  if (!m.data) return <Empty>{t('Person not found.', 'الشخص غير موجود.')}</Empty>;
  const leave = () => {
    window.close();
    // Opened directly rather than as a new tab: go to the customer instead.
    setTimeout(() => nav(`/customers/${m.data!.customer_id}`), 150);
  };
  const edit = params.get('edit') === '1' && m.data.latest ? m.data.latest : undefined;
  return <MeasureModal memberId={m.data.id} memberName={m.data.name} previous={m.data.latest} edit={edit} onClose={leave} />;
}
