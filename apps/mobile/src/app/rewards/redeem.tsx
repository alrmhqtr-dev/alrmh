import { useState } from 'react';
import { View } from 'react-native';
import { router } from 'expo-router';
import { Info, Star } from 'lucide-react-native';
import { useLocale } from '@/i18n';
import { useCatalogue, useRewardOptions, type RewardOption } from '@/api/hooks';
import { Button, Card, Icon, Loading, Note, Text, Touch } from '@/ui/primitives';
import { Header, Screen } from '@/ui/layout';
import { ProductArt } from '@/ui/art';
import { colors, fonts, radius } from '@/theme/tokens';

export function BalanceBar({ balance }: { balance: number }) {
  const { t, f } = useLocale();
  return (
    <View style={{ backgroundColor: colors.inverse, borderRadius: radius.lg, paddingHorizontal: 16, height: 48, flexDirection: 'row', alignItems: 'center', gap: 10 }}>
      <Icon icon={Star} size={18} color={colors.gold} />
      <Text variant="small" color="rgba(255,255,255,0.7)" style={{ flex: 1 }}>
        {t('rewards.yourBalance')}
      </Text>
      <Text variant="bodyStrong" color={colors.gold}>
        {f.pts(balance)}
      </Text>
    </View>
  );
}

export default function Redeem() {
  const { t, f } = useLocale();
  const options = useRewardOptions();
  const cat = useCatalogue();
  const [tab, setTab] = useState<'discounts' | 'products'>('discounts');
  const data = options.data;

  const discountRow = (o: RewardOption) => {
    const ok = o.short === 0;
    return (
      <Card key={o.id} testID={`option-${o.id}`} style={{ flexDirection: 'row' }}>
        <View style={{ width: 80, backgroundColor: ok ? colors.gold : colors.subtle, alignItems: 'center', justifyContent: 'center', paddingVertical: 18 }}>
          <Text variant="h2" color={ok ? colors.text : colors.textMuted} center style={{ fontFamily: fonts.bold, fontSize: 24, lineHeight: 30 }}>{`${o.percent}%`}</Text>
          <Text variant="overline" color={ok ? colors.text : colors.textMuted} center>
            {t('rewards.off')}
          </Text>
        </View>
        <View style={{ flex: 1, padding: 14, flexDirection: 'row', alignItems: 'center', gap: 10 }}>
          <View style={{ flex: 1, gap: 2 }}>
            <Text variant="bodyStrong" color={ok ? colors.text : colors.textMuted}>
              {t('rewards.pctOffNext', { pct: o.percent ?? 0 })}
            </Text>
            <Text variant="small" color={colors.textSecondary}>
              {f.pts(o.cost_points)}
            </Text>
            {!ok ? (
              <Text variant="caption" color={colors.textMuted}>
                {t('rewards.short', { pts: f.num(o.short) })}
              </Text>
            ) : null}
          </View>
          {ok ? <Button testID={`redeem-${o.id}`} label={t('rewards.redeem')} small onPress={() => router.push(`/rewards/confirm/${o.id}`)} /> : null}
        </View>
      </Card>
    );
  };

  return (
    <Screen header={<Header title={t('rewards.redeemCta')} />} contentStyle={{ gap: 16, paddingTop: 8 }}>
      {!data ? (
        <Loading />
      ) : (
        <>
          <BalanceBar balance={data.balance} />
          <View style={{ flexDirection: 'row', backgroundColor: colors.subtle, borderRadius: radius.md, padding: 4 }}>
            {(['discounts', 'products'] as const).map((k) => (
              <Touch
                key={k}
                testID={`redeem-tab-${k}`}
                onPress={() => setTab(k)}
                style={{ flex: 1, height: 40, borderRadius: 10, alignItems: 'center', justifyContent: 'center', backgroundColor: tab === k ? colors.surface : 'transparent' }}
              >
                <Text variant="smallStrong" color={tab === k ? colors.text : colors.textSecondary} center>
                  {t(k === 'discounts' ? 'rewards.discounts' : 'rewards.products')}
                </Text>
              </Touch>
            ))}
          </View>
          {tab === 'discounts' ? (
            <View style={{ gap: 10 }}>{data.discounts.map(discountRow)}</View>
          ) : (
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 12, rowGap: 18 }}>
              {data.products.map((o) => {
                const ok = o.short === 0;
                return (
                  <View key={o.id} style={{ width: '47%', flexGrow: 1, gap: 6 }}>
                    <ProductArt label={t('shop.render')} uri={cat.data?.products.find((p) => p.id === o.product_id)?.image_url} />
                    <Text variant="smallStrong" numberOfLines={1}>
                      {f.name(o, 'product_name')}
                    </Text>
                    <Text variant="small" color={colors.goldInk}>
                      {f.pts(o.cost_points)}
                    </Text>
                    {ok ? (
                      <Button label={t('rewards.redeem')} small onPress={() => router.push(`/rewards/confirm/${o.id}`)} />
                    ) : (
                      <View style={{ height: 40, borderRadius: 10, backgroundColor: colors.subtle, alignItems: 'center', justifyContent: 'center' }}>
                        <Text variant="smallStrong" color={colors.textMuted} center>
                          {t('rewards.notEnough')}
                        </Text>
                      </View>
                    )}
                  </View>
                );
              })}
            </View>
          )}
          <Note icon={Info}>{t('rewards.adminNote')}</Note>
        </>
      )}
    </Screen>
  );
}
