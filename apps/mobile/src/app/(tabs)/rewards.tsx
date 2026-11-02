import { RefreshControl, View } from 'react-native';
import { router } from 'expo-router';
import { useQueryClient } from '@tanstack/react-query';
import { ArrowRight, CircleHelp, Clock, Gift, ShoppingBag, Shirt } from 'lucide-react-native';
import { useLocale } from '@/i18n';
import { useSession } from '@/state/session';
import { useCatalogue, useRewards } from '@/api/hooks';
import { Button, Card, Divider, EmptyState, ErrorState, Icon, IconButton, IconTile, Loading, SectionTitle, Text, Touch } from '@/ui/primitives';
import { Screen } from '@/ui/layout';
import { LedgerRow, VoucherCard } from '@/ui/rewards';
import { colors, radius } from '@/theme/tokens';

export default function Rewards() {
  const { t, f } = useLocale();
  const qc = useQueryClient();
  const { signedIn } = useSession();
  const rewards = useRewards();
  const cat = useCatalogue();

  if (!signedIn)
    return (
      <Screen contentStyle={{ paddingTop: 8 }}>
        <Text variant="h1">{t('rewards.title')}</Text>
        <EmptyState icon={Gift} title={t('home.rewardsNewTitle')} body={t('home.rewardsNewBody')}>
          <Button label={t('account.signIn')} onPress={() => router.push('/auth/phone')} />
        </EmptyState>
      </Screen>
    );

  const r = rewards.data;
  return (
    <Screen contentStyle={{ paddingTop: 8, gap: 20 }} refreshControl={<RefreshControl refreshing={false} onRefresh={() => qc.invalidateQueries()} />}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
        <Text variant="h1">{t('rewards.title')}</Text>
        <IconButton icon={CircleHelp} label={t('help.title')} onPress={() => router.push('/account/help')} />
      </View>
      {rewards.isLoading ? (
        <Loading />
      ) : !r ? (
        <ErrorState message={t('err.network')} retryLabel={t('common.retry')} onRetry={() => rewards.refetch()} />
      ) : (
        <>
          <View style={{ backgroundColor: colors.inverse, borderRadius: radius.xl, padding: 20, gap: 16 }}>
            <Text variant="overline" color={colors.gold}>
              {t('rewards.available')}
            </Text>
            <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 8, marginTop: -8 }}>
              <Text variant="display" color={colors.gold} style={{ fontSize: 44, lineHeight: 52 }} testID="rewards-balance">
                {f.num(r.balance)}
              </Text>
              <Text variant="title" color={colors.gold}>
                {t('rewards.pts')}
              </Text>
            </View>
            <View style={{ flexDirection: 'row', gap: 10 }}>
              {[
                [t('rewards.earnedYear'), r.earnedThisYear],
                [t('rewards.redeemed'), r.redeemedThisYear],
              ].map(([label, n]) => (
                <View key={label as string} style={{ flex: 1, backgroundColor: colors.inverseSoft, borderRadius: radius.md, padding: 12, gap: 2 }}>
                  <Text variant="caption" color="rgba(255,255,255,0.6)">
                    {label as string}
                  </Text>
                  <Text variant="bodyStrong" color={colors.gold}>
                    {f.num(n as number)}
                  </Text>
                </View>
              ))}
            </View>
            <Button testID="rewards-redeem" label={t('rewards.redeemCta')} kind="gold" iconEnd={ArrowRight} onPress={() => router.push('/rewards/redeem')} />
          </View>

          {r.expiring ? (
            <Touch
              onPress={() => router.push('/rewards/redeem')}
              style={{ borderWidth: 1, borderColor: colors.error, borderRadius: radius.lg, padding: 16, flexDirection: 'row', alignItems: 'center', gap: 12 }}
            >
              <Icon icon={Clock} color={colors.error} />
              <View style={{ flex: 1 }}>
                <Text variant="bodyStrong" color={colors.error}>
                  {t('rewards.expiringTitle', { pts: f.num(r.expiring.points), days: f.daysUntil(r.expiring.expires_at) })}
                </Text>
                <Text variant="small" color={colors.textSecondary}>
                  {t('rewards.expiringBody', { earned: f.date(r.expiring.earned_at), date: f.date(r.expiring.expires_at) })}
                </Text>
              </View>
              <Text variant="smallStrong">{t('rewards.useNow')}</Text>
            </Touch>
          ) : null}

          {r.vouchers.length ? (
            <View>
              <SectionTitle title={t('rewards.vouchers')} />
              <View style={{ gap: 10 }}>
                {r.vouchers.map((v) => (
                  <VoucherCard key={v.id} v={v} onPress={() => router.push(`/rewards/voucher/${v.id}`)} />
                ))}
              </View>
            </View>
          ) : null}

          <View>
            <SectionTitle title={t('rewards.howEarn')} />
            <Card>
              {[
                { icon: Shirt, title: t('rewards.customThobe'), sub: t('rewards.fixedPerThobe'), value: `+${r.rules.thobe_fixed} ${t('rewards.pts')}` },
                { icon: ShoppingBag, title: t('rewards.accessories'), sub: t('rewards.perQar'), value: t('rewards.perQarValue', { n: Math.round(1 / r.rules.product_per_qar) }) },
                { icon: Clock, title: t('rewards.expiry'), sub: t('rewards.expiryBody', { months: r.rules.expiry_months }), value: '' },
              ].map((row, i) => (
                <View key={row.title}>
                  {i ? <Divider /> : null}
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 14, padding: 14 }}>
                    <IconTile icon={row.icon} />
                    <View style={{ flex: 1 }}>
                      <Text variant="bodyStrong">{row.title}</Text>
                      <Text variant="small" color={colors.textSecondary}>
                        {row.sub}
                      </Text>
                    </View>
                    {row.value ? <Text variant="smallStrong">{row.value}</Text> : null}
                  </View>
                </View>
              ))}
            </Card>
          </View>

          <View>
            <SectionTitle title={t('rewards.recent')} action={t('common.seeAll')} onAction={() => router.push('/rewards/history')} />
            {r.recent.length ? (
              <Card>
                {r.recent.slice(0, 4).map((e, i) => (
                  <View key={e.id}>
                    {i ? <Divider /> : null}
                    <LedgerRow e={e} products={cat.data?.products} />
                  </View>
                ))}
              </Card>
            ) : (
              <Text variant="body" color={colors.textSecondary}>
                {t('rewards.noActivity')}
              </Text>
            )}
          </View>
        </>
      )}
    </Screen>
  );
}
