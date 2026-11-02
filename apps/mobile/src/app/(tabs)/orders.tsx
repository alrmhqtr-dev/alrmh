import { useState } from 'react';
import { RefreshControl, View } from 'react-native';
import { router } from 'expo-router';
import { useQueryClient } from '@tanstack/react-query';
import { CalendarClock, FileText, Repeat } from 'lucide-react-native';
import { useLocale } from '@/i18n';
import { useSession } from '@/state/session';
import { useAppointments, useOrders, type OrderSummary } from '@/api/hooks';
import { Button, Card, EmptyState, ErrorState, Icon, Loading, Overline, Pill, Text, Touch } from '@/ui/primitives';
import { Screen } from '@/ui/layout';
import { orderLine } from '@/ui/commerce';
import { colors, radius } from '@/theme/tokens';

function OrderRow({ o, past }: { o: OrderSummary; past?: boolean }) {
  const { t, f } = useLocale();
  const today = f.date(o.created_at) === f.date(new Date());
  const when = past
    ? t('orders.deliveredOn', { date: f.date(o.created_at) })
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
  const orders = useOrders();
  const appts = useAppointments();
  const [tab, setTab] = useState<'active' | 'past'>('active');

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
            <Touch testID="reschedule" onPress={() => router.push({ pathname: '/book', params: { kind: appt.kind, mode: 'reschedule', appointmentId: appt.id } })}>
              <Text variant="smallStrong">{t('orders.reschedule')}</Text>
            </Touch>
          </Card>
        </View>
      ) : null}
    </Screen>
  );
}
