import { RefreshControl, View } from 'react-native';
import { router } from 'expo-router';
import { useQueryClient } from '@tanstack/react-query';
import { Award, Gift, ShoppingBag, Shirt } from 'lucide-react-native';
import { useLocale } from '@/i18n';
import { useSession } from '@/state/session';
import { useRewards } from '@/api/hooks';
import { Button, EmptyState, ErrorState, Icon, Loading, Text } from '@/ui/primitives';
import { Screen } from '@/ui/layout';
import { colors, radius } from '@/theme/tokens';

/** Rewards is one card: the customer's tier, their points (QAR 1 each at checkout) and the way to the next tier. */
export default function Rewards() {
  const { t, f } = useLocale();
  const qc = useQueryClient();
  const { signedIn } = useSession();
  const rewards = useRewards();

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
  const progress = r?.next ? Math.min(1, (r.lifetime - r.tier.min_points) / Math.max(1, r.next.min_points - r.tier.min_points)) : 1;

  return (
    <Screen contentStyle={{ paddingTop: 8, gap: 20 }} refreshControl={<RefreshControl refreshing={false} onRefresh={() => qc.invalidateQueries()} />}>
      <Text variant="h1">{t('rewards.title')}</Text>
      {rewards.isLoading ? (
        <Loading />
      ) : !r ? (
        <ErrorState message={t('err.network')} retryLabel={t('common.retry')} onRetry={() => rewards.refetch()} />
      ) : (
        <View testID="tier-card" style={{ backgroundColor: colors.inverse, borderRadius: radius.xl, padding: 22, gap: 18, overflow: 'hidden' }}>
          <View style={{ position: 'absolute', top: 0, start: 0, end: 0, height: 6, backgroundColor: r.tier.colour }} />
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
            <View style={{ gap: 2 }}>
              <Text variant="overline" color="rgba(255,255,255,0.6)">
                {t('rewards.yourTier')}
              </Text>
              <Text testID="tier-name" variant="h1" color={r.tier.colour} style={{ fontSize: 32, lineHeight: 40 }}>
                {f.name(r.tier)}
              </Text>
            </View>
            <View style={{ width: 56, height: 56, borderRadius: 28, borderWidth: 2, borderColor: r.tier.colour, alignItems: 'center', justifyContent: 'center' }}>
              <Icon icon={Award} size={28} color={r.tier.colour} />
            </View>
          </View>

          <View style={{ gap: 2 }}>
            <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 8 }}>
              <Text testID="rewards-balance" variant="display" color={colors.textInverse} style={{ fontSize: 44, lineHeight: 52 }}>
                {f.num(r.balance)}
              </Text>
              <Text variant="title" color={colors.textInverse}>
                {t('rewards.pts')}
              </Text>
            </View>
            <Text variant="small" color="rgba(255,255,255,0.7)">
              {t('rewards.worth', { amount: f.money(r.balance) })}
            </Text>
          </View>

          <View style={{ gap: 8 }}>
            <View
              accessibilityRole="progressbar"
              accessibilityValue={{ min: 0, max: 100, now: Math.round(progress * 100) }}
              accessibilityLabel={r.next ? t('rewards.toNext', { pts: f.num(r.toNext), tier: f.name(r.next) }) : t('rewards.topTier')}
              style={{ height: 8, borderRadius: 4, backgroundColor: colors.inverseSoft, overflow: 'hidden' }}
            >
              <View style={{ width: `${Math.round(progress * 100)}%`, height: '100%', backgroundColor: r.next?.colour ?? r.tier.colour }} />
            </View>
            <Text testID="tier-next" variant="small" color="rgba(255,255,255,0.8)">
              {r.next ? t('rewards.toNext', { pts: f.num(r.toNext), tier: f.name(r.next) }) : t('rewards.topTier')}
            </Text>
          </View>

          <View style={{ flexDirection: 'row', gap: 10 }}>
            {[
              { icon: Shirt, label: t('rewards.perThobe'), value: r.tier.points_per_thobe },
              { icon: ShoppingBag, label: t('rewards.perProduct'), value: r.tier.points_per_product },
            ].map((x) => (
              <View key={x.label} style={{ flex: 1, backgroundColor: colors.inverseSoft, borderRadius: radius.md, padding: 12, gap: 6 }}>
                <Icon icon={x.icon} size={18} color={colors.textInverse} />
                <Text variant="caption" color="rgba(255,255,255,0.7)">
                  {x.label}
                </Text>
                <Text variant="bodyStrong" color={colors.textInverse}>
                  {`+${f.num(x.value)} ${t('rewards.pts')}`}
                </Text>
              </View>
            ))}
          </View>

          <Text variant="caption" color="rgba(255,255,255,0.6)">
            {t('rewards.cardNote', { months: r.expiryMonths })}
          </Text>
        </View>
      )}
    </Screen>
  );
}
