import { View } from 'react-native';
import { useIsFocused, useLocalSearchParams } from 'expo-router';
import { Check, Gift, MessageCircle, Package, Shirt } from 'lucide-react-native';
import { useLocale } from '@/i18n';
import { useCatalogue, useOrder } from '@/api/hooks';
import { openWhatsApp } from '@/lib/actions';
import { Button, Card, Divider, ErrorState, IconButton, IconTile, Loading, Overline, Text } from '@/ui/primitives';
import { BottomBar, Header, Screen } from '@/ui/layout';
import { colors, radius } from '@/theme/tokens';

function discountLabel(label: string | null, t: (k: any, p?: any) => string) {
  const [kind, code, pct] = (label ?? '').split(':');
  return kind === 'coupon' ? t('checkout.couponLine', { code, pct }) : t('checkout.voucherLine', { pct });
}

export default function Tracking() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { t, f } = useLocale();
  const order = useOrder(id, useIsFocused());
  const cat = useCatalogue();
  const support = cat.data?.settings.support.whatsapp ?? '';
  const o = order.data;
  const chat = () => openWhatsApp(support, o ? `Order #${o.number}` : undefined);

  if (order.isLoading) return <Screen header={<Header />}><Loading /></Screen>;
  if (!o) return <Screen header={<Header />}><ErrorState message={t('common.error')} retryLabel={t('common.retry')} onRetry={() => order.refetch()} /></Screen>;

  const currentIdx = o.stages.indexOf(o.stage);
  const eventFor = (s: string) => o.events.find((e) => e.stage === s);

  return (
    <Screen
      header={<Header title={f.orderNo(o.number)} right={<IconButton icon={MessageCircle} label="WhatsApp" onPress={chat} />} />}
      footer={
        <BottomBar>
          <Button label={t('track.whatsapp')} kind="secondary" icon={MessageCircle} onPress={chat} />
        </BottomBar>
      }
      contentStyle={{ gap: 16, paddingTop: 8 }}
    >
      <View style={{ backgroundColor: colors.inverse, borderRadius: radius.xl, padding: 20, gap: 6 }}>
        <Overline color="rgba(255,255,255,0.6)">{t('track.current')}</Overline>
        <Text variant="h1" color={colors.textInverse} testID="track-stage">
          {t(`stage.${o.stage}` as any)}
        </Text>
        {o.expected_delivery && o.stage !== 'delivered' ? (
          <Text variant="small" color="rgba(255,255,255,0.7)">
            {t('track.expected', { date: f.weekdayDate(o.expected_delivery) })}
          </Text>
        ) : null}
      </View>

      <Card style={{ padding: 18 }}>
        {o.stages.map((s, i) => {
          const done = i < currentIdx || (i === currentIdx && s === 'delivered');
          const current = i === currentIdx && s !== 'delivered';
          const ev = eventFor(s);
          const sub = current ? t('track.inProgress') : ev ? (s === 'measured' && ev.note === 'saved' ? t('basket.savedMeasurements') : i === 0 ? `${f.day(ev.at)} · ${f.time(ev.at)}` : f.day(ev.at)) : t('common.dash');
          const last = i === o.stages.length - 1;
          return (
            <View key={s} style={{ flexDirection: 'row', gap: 14 }}>
              <View style={{ alignItems: 'center', width: 22 }}>
                <View
                  style={{
                    width: 22,
                    height: 22,
                    borderRadius: 11,
                    backgroundColor: done || current ? colors.inverse : colors.surface,
                    borderWidth: done || current ? 0 : 1.5,
                    borderColor: colors.border,
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  {done ? <Check size={13} color={colors.textInverse} strokeWidth={3} /> : current ? <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: colors.surface }} /> : null}
                </View>
                {!last ? <View style={{ width: 2, flex: 1, minHeight: 22, backgroundColor: i < currentIdx ? colors.inverse : colors.border }} /> : null}
              </View>
              <View style={{ flex: 1, paddingBottom: last ? 0 : 12 }}>
                <Text variant={current ? 'bodyStrong' : 'body'} color={done || current ? colors.text : colors.textMuted}>
                  {t(`stage.${s}` as any)}
                </Text>
                <Text variant="caption" color={colors.textMuted}>
                  {sub}
                </Text>
              </View>
            </View>
          );
        })}
      </Card>

      <Overline style={{ marginTop: 6 }}>{t('track.items')}</Overline>
      <Card>
        {o.items.map((it, i) => {
          const s = it.snapshot;
          const title =
            it.kind === 'thobe' ? t('track.thobeFor', { name: s.member?.name ?? '' }) : it.kind === 'reward' ? t('track.reward', { name: f.name(s.product) }) : f.name(s.product);
          const sub =
            it.kind === 'thobe'
              ? `${f.name(s.thobe.collar)} · ${f.name(s.thobe.fabric)} · ${f.name(s.thobe.colour)}${it.qty > 1 ? ` · ×${it.qty}` : ''}`
              : `${s.size ? t('basket.sizeN', { size: s.size }) + ' · ' : ''}×${it.qty}`;
          return (
            <View key={it.id}>
              {i ? <Divider /> : null}
              <View style={{ flexDirection: 'row', gap: 14, padding: 14, alignItems: 'center' }}>
                <IconTile icon={it.kind === 'thobe' ? Shirt : it.kind === 'reward' ? Gift : Package} />
                <View style={{ flex: 1 }}>
                  <Text variant="bodyStrong">{title}</Text>
                  <Text variant="small" color={colors.textSecondary}>
                    {sub}
                  </Text>
                </View>
              </View>
            </View>
          );
        })}
      </Card>
      <Card style={{ padding: 16, gap: 8 }}>
        {[
          [t('review.subtotal'), f.money(o.subtotal, true)],
          [t('checkout.delivery'), f.money(o.delivery_fee, true)],
          ...(o.home_visit_fee ? [[t('checkout.homeVisitFee'), f.money(o.home_visit_fee, true)]] : []),
          ...(o.discount ? [[discountLabel(o.discount_label, t), `− ${f.money(o.discount, true)}`]] : []),
        ].map(([a, b]) => (
          <View key={a} style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
            <Text variant="small" color={colors.textSecondary}>
              {a}
            </Text>
            <Text variant="smallStrong">{b}</Text>
          </View>
        ))}
        <Divider />
        <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
          <Text variant="bodyStrong">{t('checkout.total')}</Text>
          <Text variant="bodyStrong">{f.money(o.total, true)}</Text>
        </View>
      </Card>
    </Screen>
  );
}
