import { useState } from 'react';
import { RefreshControl, View } from 'react-native';
import { router, useIsFocused } from 'expo-router';
import { useQueryClient } from '@tanstack/react-query';
import { CalendarClock, FileText, Repeat } from 'lucide-react-native';
import { useLocale } from '@/i18n';
import { useSession } from '@/state/session';
import { api } from '@/api/client';
import { useAppointments, useOrders, type OrderSummary } from '@/api/hooks';
import { errorText } from '@/lib/errors';
import { Button, Card, EmptyState, ErrorState, Icon, Loading, Note, Overline, Pill, Text, Touch } from '@/ui/primitives';
import { Screen, Sheet } from '@/ui/layout';
import { orderLine } from '@/ui/commerce';
import { colors, radius } from '@/theme/tokens';

function OrderRow({ o, past }: { o: OrderSummary; past?: boolean }) {
  const { t, f } = useLocale();
  const today = f.date(o.created_at) === f.date(new Date());
  const when = past
    ? o.stage === 'cancelled'
      ? t('orders.placedOn', { date: f.day(o.created_at) })
      : t('orders.deliveredOn', { date: f.date(o.closed_at ?? o.created_at) })
    : o.expected_delivery && o.stage !== 'confirmed'
      ? t('orders.deliveryOn', { date: f.weekdayDate(o.expected_delivery) })
      : today
        ? t('orders.placedToday')
        : t('orders.placedOn', { date: f.day(o.created_at) });
  return (
    <Card testID={`order-${o.number}`} onPress={() => router.push(`/orders/${o.id}`)} style={{ padding: 16, gap: 10 }}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 }}>
        <View style={{ flex: 1 }}>
          <Text variant="bodyStrong">{f.orderNo(o.number)}</Text>
          <Text variant="small" color={colors.textSecondary}>
            {orderLine(o, t, f)}
          </Text>
        </View>
        <Pill label={t(`stage.${o.stage}` as any)} dark={!past} />
      </View>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
        <Text variant="small" color={colors.textSecondary}>
          {when}
        </Text>
        {past && o.thobe_count ? (
          <Touch onPress={() => router.push(`/reorder/${o.id}`)} style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
            <Icon icon={Repeat} size={14} />
            <Text variant="smallStrong">{t('orders.again')}</Text>
          </Touch>
        ) : (
          <Text variant="smallStrong">{t('home.track')}</Text>
        )}
      </View>
    </Card>
  );
}

export default function Orders() {
  const { t, f } = useLocale();
  const qc = useQueryClient();
  const { signedIn } = useSession();
  const orders = useOrders(useIsFocused());
  const appts = useAppointments();
  const [tab, setTab] = useState<'active' | 'past'>('active');
  const [cancelId, setCancelId] = useState<string | null>(null);
  const [cancelling, setCancelling] = useState(false);
  const [cancelError, setCancelError] = useState<string | null>(null);

  const cancelVisit = async () => {
    if (!cancelId) return;
    setCancelling(true);
    setCancelError(null);
    try {
      await api(`/appointments/${cancelId}`, { method: 'DELETE' });
      await qc.invalidateQueries();
      setCancelId(null);
    } catch (e) {
      setCancelError(errorText(t, e));
    } finally {
      setCancelling(false);
    }
  };

  if (!signedIn)
    return (
      <Screen contentStyle={{ paddingTop: 8 }}>
        <Text variant="h1">{t('orders.title')}</Text>
        <EmptyState icon={FileText} title={t('orders.empty')} body={t('account.signInBody')}>
          <Button label={t('account.signIn')} onPress={() => router.push('/auth/phone')} />
        </EmptyState>
      </Screen>
    );

  const data = orders.data;
  const empty = data && !data.active.length && !data.past.length;
  const list = tab === 'active' ? data?.active : data?.past;
  const appt = appts.data?.[0];

  return (
    <Screen contentStyle={{ paddingTop: 8, gap: 16 }} refreshControl={<RefreshControl refreshing={false} onRefresh={() => qc.invalidateQueries()} />}>
      <Text variant="h1">{t('orders.title')}</Text>
      {orders.isLoading ? (
        <Loading />
      ) : orders.isError ? (
        <ErrorState message={t('err.network')} retryLabel={t('common.retry')} onRetry={() => orders.refetch()} />
      ) : empty ? (
        <EmptyState icon={FileText} title={t('orders.empty')} body={t('orders.emptyBody')}>
          <Button label={t('orders.design')} onPress={() => router.push('/design/collar')} />
          <Button label={t('orders.browse')} kind="secondary" onPress={() => router.push('/shop')} />
        </EmptyState>
      ) : (
        <>
          <View style={{ flexDirection: 'row', backgroundColor: colors.subtle, borderRadius: radius.md, padding: 4 }}>
            {(['active', 'past'] as const).map((k) => (
              <Touch
                key={k}
                testID={`orders-${k}`}
                onPress={() => setTab(k)}
                style={{ flex: 1, height: 40, borderRadius: 10, alignItems: 'center', justifyContent: 'center', backgroundColor: tab === k ? colors.surface : 'transparent' }}
              >
                <Text variant="smallStrong" color={tab === k ? colors.text : colors.textSecondary} center>
                  {k === 'active' ? t('orders.active', { n: data!.active.length }) : t('orders.past')}
                </Text>
              </Touch>
            ))}
          </View>
          {list?.length ? list.map((o) => <OrderRow key={o.id} o={o} past={tab === 'past'} />) : <Text variant="body" color={colors.textSecondary} center style={{ paddingVertical: 24 }}>{t('orders.noPast')}</Text>}
        </>
      )}
      {appt ? (
        <View style={{ gap: 10, marginTop: 8 }}>
          <Overline>{t('orders.upcoming')}</Overline>
          <Card style={{ padding: 16, flexDirection: 'row', gap: 14, alignItems: 'center' }}>
            <Icon icon={CalendarClock} size={22} />
            <View style={{ flex: 1 }}>
              <Text variant="bodyStrong">{t(appt.kind === 'home' ? 'orders.homeVisitFor' : 'orders.branchVisitFor', { name: appt.member_name })}</Text>
              <Text variant="small" color={colors.textSecondary}>
                {`${f.when(appt.starts_at)} · ${appt.kind === 'home' ? appt.area : f.name(appt, 'branch_name')}`}
              </Text>
            </View>
            <View style={{ alignItems: 'flex-end', gap: 10 }}>
              <Touch testID="reschedule" onPress={() => router.push({ pathname: '/book', params: { kind: appt.kind, mode: 'reschedule', appointmentId: appt.id, branchId: appt.branch_id ?? '' } })}>
                <Text variant="smallStrong">{t('orders.reschedule')}</Text>
              </Touch>
              {!appt.order_id ? (
                <Touch testID="cancel-visit" onPress={() => { setCancelError(null); setCancelId(appt.id); }}>
                  <Text variant="small" color={colors.textSecondary}>{t('orders.cancelVisit')}</Text>
                </Touch>
              ) : null}
            </View>
          </Card>
        </View>
      ) : null}
      <Sheet visible={Boolean(cancelId)} onClose={() => setCancelId(null)}>
        <Text variant="h2">{t('orders.cancelVisitQ')}</Text>
        <Text variant="body" color={colors.textSecondary} style={{ marginTop: 8 }}>
          {t('orders.cancelVisitBody')}
        </Text>
        {cancelError ? <View style={{ marginTop: 12 }}><Note tone="error">{cancelError}</Note></View> : null}
        <View style={{ gap: 6, marginTop: 20 }}>
          <Button testID="cancel-visit-confirm" label={t('orders.cancelVisit')} kind="danger" loading={cancelling} onPress={cancelVisit} />
          <Button label={t('orders.keepVisit')} kind="ghost" onPress={() => setCancelId(null)} />
        </View>
      </Sheet>
    </Screen>
  );
}
