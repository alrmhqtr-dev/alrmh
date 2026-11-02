import { useState } from 'react';
import { View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useQueryClient } from '@tanstack/react-query';
import { Info, Star } from 'lucide-react-native';
import { useLocale } from '@/i18n';
import { api } from '@/api/client';
import { useRewardOptions, type Voucher } from '@/api/hooks';
import { errorText } from '@/lib/errors';
import { Button, Card, Divider, Loading, Note, Text } from '@/ui/primitives';
import { BottomBar, Header, Screen } from '@/ui/layout';
import { colors, fonts, radius } from '@/theme/tokens';

export default function ConfirmRedeem() {
  const { optionId } = useLocalSearchParams<{ optionId: string }>();
  const { t, f } = useLocale();
  const qc = useQueryClient();
  const options = useRewardOptions();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const data = options.data;
  const option = data && [...data.discounts, ...data.products].find((o) => o.id === optionId);

  const redeem = async () => {
    if (!option) return;
    setBusy(true);
    setError(null);
    try {
      const v = await api<Voucher>('/rewards/redeem', { body: { optionId: option.id } });
      await qc.invalidateQueries();
      router.replace(`/rewards/voucher/${v.id}`);
    } catch (e) {
      setError(errorText(t, e));
      setBusy(false);
    }
  };

  if (!data || !option) return <Screen header={<Header close />}><Loading /></Screen>;

  return (
    <Screen
      header={<Header close />}
      footer={
        <BottomBar>
          <View style={{ gap: 6 }}>
            <Button testID="confirm-redeem" label={t('rewards.redeemN', { pts: f.num(option.cost_points) })} onPress={redeem} loading={busy} disabled={option.short > 0} />
            <Button label={t('common.cancel')} kind="ghost" onPress={() => router.back()} />
          </View>
        </BottomBar>
      }
      contentStyle={{ gap: 20, paddingTop: 8 }}
    >
      <View style={{ backgroundColor: colors.gold, borderRadius: radius.xl, paddingVertical: 32, alignItems: 'center', gap: 4 }}>
        {option.kind === 'discount' ? (
          <>
            <Text variant="display" center style={{ fontFamily: fonts.bold, fontSize: 56, lineHeight: 64 }}>{`${option.percent}%`}</Text>
            <Text variant="overline" color={colors.text} center>
              {t('rewards.offNext')}
            </Text>
          </>
        ) : (
          <>
            <Star size={44} color={colors.text} />
            <Text variant="h2" center>
              {f.name(option, 'product_name')}
            </Text>
          </>
        )}
      </View>
      <Text variant="h1">{t('rewards.confirmQ', { pts: f.num(option.cost_points) })}</Text>
      <Card style={{ padding: 16, gap: 10 }}>
        {[
          [t('rewards.current'), f.pts(data.balance)],
          [t('rewards.cost'), `− ${f.pts(option.cost_points)}`],
        ].map(([a, b]) => (
          <View key={a} style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
            <Text variant="body" color={colors.textSecondary}>
              {a}
            </Text>
            <Text variant="bodyStrong">{b}</Text>
          </View>
        ))}
        <Divider />
        <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
          <Text variant="bodyStrong">{t('rewards.newBalance')}</Text>
          <Text variant="price">{f.pts(data.balance - option.cost_points)}</Text>
        </View>
      </Card>
      <Note icon={Info}>{t('rewards.validity', { days: 30 })}</Note>
      {error ? <Note tone="error">{error}</Note> : null}
    </Screen>
  );
}
