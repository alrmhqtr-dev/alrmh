import { useEffect } from 'react';
import { View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useQueryClient } from '@tanstack/react-query';
import { Check, Ruler, Scissors, Star, Truck } from 'lucide-react-native';
import { useLocale } from '@/i18n';
import { useOrder } from '@/api/hooks';
import { Button, Card, Divider, IconTile, Loading, Text } from '@/ui/primitives';
import { BottomBar, Screen } from '@/ui/layout';
import { PushCard } from '@/ui/push';
import { colors } from '@/theme/tokens';

export default function OrderPlaced() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { t, f } = useLocale();
  const qc = useQueryClient();
  const order = useOrder(id);

  useEffect(() => {
    qc.invalidateQueries({ queryKey: ['basket'] });
    qc.invalidateQueries({ queryKey: ['me'] });
    qc.invalidateQueries({ queryKey: ['orders'] });
    qc.invalidateQueries({ queryKey: ['rewards'] });
  }, [qc]);

  const o = order.data;
  const appt = o?.appointments[0];
  const hasThobe = o?.items.some((i) => i.kind === 'thobe');
  const rows = o
    ? [
        ...(hasThobe ? [{ icon: Ruler, title: t('placed.measure'), body: appt ? t('placed.measureBooked', { when: f.when(appt.starts_at) }) : t('placed.measureSaved') }] : []),
        ...(hasThobe ? [{ icon: Scissors, title: t('placed.tailoring'), body: t('placed.tailoringBody') }] : []),
        { icon: Truck, title: t('placed.delivery'), body: t('placed.deliveryTo', { address: `${o.address.line1}, ${o.address.area}` }) },
        { icon: Star, title: t('placed.points', { pts: o.points_to_earn }), body: t('placed.pointsBody'), gold: true },
      ]
    : [];

  return (
    <Screen
      footer={
        <BottomBar>
          <View style={{ gap: 6 }}>
            <Button testID="placed-track" label={t('placed.track')} onPress={() => router.replace(`/orders/${id}`)} disabled={!o} />
            <Button label={t('placed.home')} kind="ghost" onPress={() => router.replace('/home')} />
          </View>
        </BottomBar>
      }
      contentStyle={{ paddingTop: 48, gap: 20 }}
    >
      {!o ? (
        <Loading />
      ) : (
        <>
          <View style={{ alignItems: 'center', gap: 12 }}>
            <View style={{ width: 72, height: 72, borderRadius: 36, backgroundColor: colors.inverse, alignItems: 'center', justifyContent: 'center' }}>
              <Check size={36} color={colors.textInverse} strokeWidth={2.5} />
            </View>
            <Text variant="h1" center>
              {t('placed.title')}
            </Text>
            <Text variant="body" color={colors.textSecondary} center>
              {t('placed.sub', { number: f.orderNo(o.number), amount: f.moneyNum(o.total, true) })}
            </Text>
          </View>
          <Card>
            {rows.map((r, i) => (
              <View key={r.title}>
                {i ? <Divider /> : null}
                <View style={{ flexDirection: 'row', gap: 14, padding: 16, alignItems: 'center' }}>
                  <IconTile icon={r.icon} gold={r.gold} />
                  <View style={{ flex: 1 }}>
                    <Text variant="bodyStrong">{r.title}</Text>
                    <Text variant="small" color={colors.textSecondary}>
                      {r.body}
                    </Text>
                  </View>
                </View>
              </View>
            ))}
          </Card>
          <PushCard compact />
        </>
      )}
    </Screen>
  );
}
