import { View } from 'react-native';
import { router } from 'expo-router';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ArrowRight, ShoppingBag, Star } from 'lucide-react-native';
import { useLocale } from '@/i18n';
import { api } from '@/api/client';
import { useBasket, type Basket, type BasketLine } from '@/api/hooks';
import { useSession } from '@/state/session';
import { Button, Card, EmptyState, ErrorState, Icon, Loading, Stepper, Text, Touch } from '@/ui/primitives';
import { BottomBar, Header, Screen } from '@/ui/layout';
import { ProductArt, ThobeArt } from '@/ui/art';
import { colors, radius } from '@/theme/tokens';

export function lineDetails(line: BasketLine, t: any, f: any): string[] {
  if (line.kind === 'product') return line.size ? [t('basket.sizeN', { size: line.size })] : [];
  const method =
    line.measureMethod === 'saved'
      ? t('basket.savedMeasurements')
      : line.appointment
        ? t(line.appointment.kind === 'home' ? 'review.homeVisitWhen' : 'review.branchVisit', { when: f.when(line.appointment.startsAt) })
        : '';
  return [`${line.member?.name} · ${f.name(line.thobe?.collar)}`, `${f.name(line.thobe?.fabric)} · ${f.name(line.thobe?.colour)}`, method];
}

export default function BasketScreen() {
  const { t, f } = useLocale();
  const qc = useQueryClient();
  const { signedIn } = useSession();
  const basket = useBasket();
  const setQty = useMutation({
    mutationFn: ({ id, qty }: { id: string; qty: number }) => api<Basket>(`/basket/items/${id}`, { method: 'PATCH', body: { qty } }),
    onSuccess: (data) => {
      qc.setQueryData(['basket'], data);
      qc.invalidateQueries({ queryKey: ['me'] });
    },
  });

  if (!signedIn)
    return (
      <Screen header={<Header title={t('basket.title')} />}>
        <EmptyState icon={ShoppingBag} title={t('basket.empty')} body={t('account.signInBody')}>
          <Button label={t('account.signIn')} onPress={() => router.push('/auth/phone')} />
        </EmptyState>
      </Screen>
    );

  const data = basket.data;
  return (
    <Screen
      header={<Header title={t('basket.title')} />}
      footer={
        data && data.items.length ? (
          <BottomBar label={data.count === 1 ? t('basket.item1') : t('basket.items', { n: data.count })} value={f.money(data.subtotal)}>
            <Button testID="basket-checkout" label={t('basket.checkout')} iconEnd={ArrowRight} onPress={() => router.push('/checkout')} style={{ minWidth: 180 }} />
          </BottomBar>
        ) : undefined
      }
      contentStyle={{ gap: 12, paddingTop: 8 }}
    >
      {basket.isLoading ? (
        <Loading />
      ) : basket.isError ? (
        <ErrorState message={t('err.network')} retryLabel={t('common.retry')} onRetry={() => basket.refetch()} />
      ) : !data?.items.length ? (
        <EmptyState icon={ShoppingBag} title={t('basket.empty')} body={t('basket.emptyBody')}>
          <Button label={t('orders.design')} onPress={() => router.replace('/shop')} />
        </EmptyState>
      ) : (
        <>
          {data.items.map((line) => (
            <Card key={line.id} testID={`line-${line.kind}`} style={{ padding: 16, flexDirection: 'row', gap: 14 }}>
              <View style={{ width: 72, alignItems: 'center' }}>
                {line.kind === 'thobe' ? <ThobeArt fill={line.thobe?.colour?.hex} collar={line.thobe?.collar?.id} height={84} /> : <ProductArt small style={{ width: 64, backgroundColor: 'transparent' }} />}
              </View>
              <View style={{ flex: 1, gap: 2 }}>
                <Text variant="bodyStrong">{line.kind === 'thobe' ? t('review.custom') : f.name(line.product)}</Text>
                {lineDetails(line, t, f).map((d, i) =>
                  d ? (
                    <Text key={i} variant="small" color={colors.textSecondary}>
                      {d}
                    </Text>
                  ) : null,
                )}
                <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 10 }}>
                  <Text variant="bodyStrong">{f.money(line.lineTotal)}</Text>
                  <Stepper compact value={line.qty} min={0} onChange={(qty) => setQty.mutate({ id: line.id, qty })} />
                </View>
              </View>
            </Card>
          ))}
          <Card style={{ padding: 16, gap: 10 }}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
              <Text variant="body" color={colors.textSecondary}>
                {t('review.subtotal')}
              </Text>
              <Text variant="bodyStrong">{f.money(data.subtotal)}</Text>
            </View>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
              <Text variant="body" color={colors.textSecondary}>
                {t('basket.delivery')}
              </Text>
              <Text variant="bodyStrong">{t('basket.deliveryLater')}</Text>
            </View>
          </Card>
          <View style={{ flexDirection: 'row', gap: 10, alignItems: 'center', backgroundColor: colors.goldSoft, borderRadius: radius.md, padding: 14 }}>
            <Icon icon={Star} size={18} color={colors.goldInk} />
            <Text variant="small" color={colors.goldInk}>
              {t('basket.earns', { pts: data.pointsToEarn })}
            </Text>
          </View>
          <Touch onPress={() => router.push('/shop')} style={{ alignSelf: 'center', padding: 12 }}>
            <Text variant="smallStrong">{t('home.completeLook')}</Text>
          </Touch>
        </>
      )}
    </Screen>
  );
}
