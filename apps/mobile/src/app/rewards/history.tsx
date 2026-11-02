import { useState } from 'react';
import { ScrollView, View } from 'react-native';
import { router } from 'expo-router';
import { Clock } from 'lucide-react-native';
import { useLocale } from '@/i18n';
import { useCatalogue, useRewardHistory, useRewards } from '@/api/hooks';
import { Card, Chip, Divider, Icon, Loading, Overline, Text, Touch } from '@/ui/primitives';
import { Header, Screen } from '@/ui/layout';
import { LedgerRow } from '@/ui/rewards';
import { colors, radius } from '@/theme/tokens';

const FILTERS = ['all', 'earned', 'redeemed', 'expired'] as const;

export default function History() {
  const { t, f } = useLocale();
  const [filter, setFilter] = useState<(typeof FILTERS)[number]>('all');
  const history = useRewardHistory(filter);
  const rewards = useRewards();
  const cat = useCatalogue();
  const exp = rewards.data?.expiring;

  const groups: { month: string; items: NonNullable<typeof history.data> }[] = [];
  for (const e of history.data ?? []) {
    const month = f.monthYearLong(e.created_at);
    const g = groups.find((x) => x.month === month);
    if (g) g.items.push(e);
    else groups.push({ month, items: [e] });
  }

  return (
    <Screen header={<Header title={t('rewards.history')} />} contentStyle={{ gap: 16, paddingTop: 8 }}>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
        {FILTERS.map((k) => (
          <Chip key={k} testID={`hist-${k}`} label={t(`rewards.filter${k[0].toUpperCase()}${k.slice(1)}` as any)} selected={filter === k} onPress={() => setFilter(k)} />
        ))}
      </ScrollView>
      {exp ? (
        <Touch onPress={() => router.push('/rewards/redeem')} style={{ borderWidth: 1, borderColor: colors.error, borderRadius: radius.lg, padding: 14, flexDirection: 'row', alignItems: 'center', gap: 12 }}>
          <Icon icon={Clock} color={colors.error} />
          <View style={{ flex: 1 }}>
            <Text variant="bodyStrong" color={colors.error}>
              {t('rewards.expiringTitle', { pts: f.num(exp.points), days: f.daysUntil(exp.expires_at) })}
            </Text>
            <Text variant="small" color={colors.textSecondary}>
              {t('rewards.expiringBody', { earned: f.date(exp.earned_at), date: f.date(exp.expires_at) })}
            </Text>
          </View>
          <Text variant="smallStrong">{t('rewards.useNow')}</Text>
        </Touch>
      ) : null}
      {history.isLoading ? (
        <Loading />
      ) : groups.length ? (
        groups.map((g) => (
          <View key={g.month} style={{ gap: 8 }}>
            <Overline>{g.month}</Overline>
            <Card>
              {g.items.map((e, i) => (
                <View key={e.id}>
                  {i ? <Divider /> : null}
                  <LedgerRow e={e} products={cat.data?.products} />
                </View>
              ))}
            </Card>
          </View>
        ))
      ) : (
        <Text variant="body" color={colors.textSecondary} center style={{ paddingVertical: 32 }}>
          {t('rewards.noActivity')}
        </Text>
      )}
    </Screen>
  );
}
