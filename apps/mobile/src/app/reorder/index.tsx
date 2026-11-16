import { View } from 'react-native';
import { router } from 'expo-router';
import { ChevronRight, Repeat } from 'lucide-react-native';
import { useLocale } from '@/i18n';
import { useOrders } from '@/api/hooks';
import { Button, Card, Divider, EmptyState, ErrorState, Icon, Loading, Text } from '@/ui/primitives';
import { Header, Screen } from '@/ui/layout';
import { ThobeArt } from '@/ui/art';
import { colors } from '@/theme/tokens';

/** Order again: the customer's thobe orders, newest first. Choosing one opens it to repeat or adjust. */
export default function ReorderList() {
  const { t, f } = useLocale();
  const orders = useOrders();
  const list = [...(orders.data?.active ?? []), ...(orders.data?.past ?? [])]
    .filter((o) => o.thobe_count > 0 && o.stage !== 'cancelled')
    .sort((a, b) => b.created_at.localeCompare(a.created_at));

  return (
    <Screen header={<Header title={t('again.title')} />} contentStyle={{ gap: 12, paddingTop: 8 }}>
      {orders.isLoading ? (
        <Loading />
      ) : !orders.data ? (
        <ErrorState message={t('err.network')} retryLabel={t('common.retry')} onRetry={() => orders.refetch()} />
      ) : !list.length ? (
        <EmptyState icon={Repeat} title={t('again.none')} body={t('home.orderAgainEmpty')}>
          <Button label={t('home.newOrder')} onPress={() => router.replace('/book?standalone=1')} />
        </EmptyState>
      ) : (
        <>
          <Text variant="small" color={colors.textSecondary}>
            {t('again.pick')}
          </Text>
          {list.map((o) => {
            const first = o.thobes?.[0];
            return (
              <Card key={o.id} testID={`reorder-${o.number}`} onPress={() => router.push(`/reorder/${o.id}`)} style={{ padding: 0 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 14, padding: 14 }}>
                  <ThobeArt fill={first?.colour?.hex} collar={first?.collar?.shape ?? first?.collar?.id} height={64} />
                  <View style={{ flex: 1, gap: 2 }}>
                    <Text variant="bodyStrong">{f.orderNo(o.number)}</Text>
                    <Text variant="small" color={colors.textSecondary}>
                      {`${f.date(o.created_at)} · ${(o.thobe_count === 1 ? t('again.one') : t('again.thobes', { n: o.thobe_count }))}`}
                    </Text>
                  </View>
                  <Icon icon={ChevronRight} size={18} color={colors.textMuted} flip />
                </View>
                {(o.thobes ?? []).map((l, i) => (
                  <View key={i}>
                    <Divider />
                    <View style={{ flexDirection: 'row', paddingHorizontal: 14, paddingVertical: 10, gap: 10 }}>
                      <Text variant="small" style={{ flex: 1 }}>
                        {`${f.name(l.collar)} · ${f.name(l.fabric)}`}
                      </Text>
                      <Text variant="small" color={colors.textSecondary}>
                        {`${l.member?.name ?? ''} × ${l.qty}`}
                      </Text>
                    </View>
                  </View>
                ))}
              </Card>
            );
          })}
        </>
      )}
    </Screen>
  );
}
