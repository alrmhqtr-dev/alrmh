import { View } from 'react-native';
import { router } from 'expo-router';
import { Scissors, Star, Truck } from 'lucide-react-native';
import { useLocale, type Format } from '@/i18n';
import { usePointRates, type OrderSummary, type Product } from '@/api/hooks';
import { Card, Icon, Pill, Text, Touch } from '@/ui/primitives';
import { ProductArt } from '@/ui/art';
import { colors } from '@/theme/tokens';

export function ProductCard({ product, onPress }: { product: Product; onPress: () => void }) {
  const { f, t } = useLocale();
  const pts = usePointRates()?.points_per_product ?? 0;
  return (
    <Touch testID={`product-${product.id}`} onPress={onPress} style={{ flex: 1, gap: 8 }}>
      <ProductArt label={t('shop.render')} uri={product.image_url} />
      <Text variant="smallStrong" numberOfLines={1}>
        {f.name(product)}
      </Text>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 4 }}>
        <Text variant="bodyStrong">{f.money(product.price)}</Text>
        <Pill gold icon={Star} label={`+${pts} ${t('rewards.pts')}`} />
      </View>
    </Touch>
  );
}

export function StageSegments({ stages, current }: { stages: string[]; current: string }) {
  const idx = stages.indexOf(current);
  return (
    <View style={{ flexDirection: 'row', gap: 4 }}>
      {stages.map((s, i) => (
        <View key={s} style={{ flex: 1, height: 4, borderRadius: 2, backgroundColor: i <= idx ? colors.inverse : colors.border }} />
      ))}
    </View>
  );
}

/** Thobes: made to measure and collected from the branch. */
export const THOBE_STAGES = ['measured', 'cutting', 'stitching', 'quality', 'ready', 'delivered'];
/** Shop-only orders: packed and delivered. */
export const PRODUCT_STAGES = ['confirmed', 'ready', 'out_for_delivery', 'delivered'];

/** The label for a stage, worded for the kind of order ("Ready for pickup" vs "Packed"). */
export function stageKey(stage: string, thobes: boolean): any {
  const flow = thobes ? THOBE_STAGES : PRODUCT_STAGES;
  return flow.includes(stage) ? `stage.${thobes ? 'thobe' : 'shop'}.${stage}` : `stage.${stage}`;
}

export function orderLine(o: OrderSummary, t: (k: any, p?: any) => string, f: Format) {
  const names = (o.members ?? []).filter(Boolean).join(t('common.listSep'));
  if (o.thobe_count > 0 && o.thobe_count === o.item_count) return o.thobe_count === 1 ? t('orders.thobe1', { names }) : o.thobe_count === 2 ? t('orders.thobes2', { names }) : t('orders.thobes', { n: o.thobe_count, names });
  return t('orders.items', { n: o.item_count, amount: f.moneyNum(o.total, true) });
}

export function ActiveOrderCard({ order }: { order: OrderSummary }) {
  const { t, f } = useLocale();
  const thobes = order.thobe_count > 0;
  const stages = thobes ? THOBE_STAGES : PRODUCT_STAGES;
  return (
    <Card testID="active-order" onPress={() => router.push(`/orders/${order.id}`)} style={{ padding: 18, gap: 14 }}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 }}>
        <View style={{ flex: 1 }}>
          <Text variant="bodyStrong">{t('orders.orderN', { number: f.orderNo(order.number) })}</Text>
          <Text variant="small" color={colors.textSecondary} numberOfLines={1}>
            {orderLine(order, t, f)}
          </Text>
        </View>
        <Pill dark icon={Scissors} label={t(stageKey(order.stage, thobes))} />
      </View>
      <StageSegments stages={stages} current={order.stage} />
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, flex: 1 }}>
          <Icon icon={Truck} size={18} color={colors.textSecondary} />
          <Text variant="small" color={colors.textSecondary} numberOfLines={1}>
            {order.expected_delivery ? t(thobes ? 'home.readyBy' : 'home.expected', { date: f.weekdayDate(order.expected_delivery) }) : t(stageKey(order.stage, thobes))}
          </Text>
        </View>
        <Text variant="smallStrong">{t('home.track')}</Text>
      </View>
    </Card>
  );
}

