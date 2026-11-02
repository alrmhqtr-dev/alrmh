import { View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { Check, Star } from 'lucide-react-native';
import { useLocale } from '@/i18n';
import { useVoucher } from '@/api/hooks';
import { Button, Loading, Text } from '@/ui/primitives';
import { BottomBar, Screen } from '@/ui/layout';
import { colors, fonts, radius } from '@/theme/tokens';

export default function VoucherReady() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { t, f } = useLocale();
  const v = useVoucher(id);

  return (
    <Screen
      footer={
        <BottomBar>
          <View style={{ gap: 6 }}>
            <Button testID="voucher-shop" label={t('rewards.shopNow')} onPress={() => router.replace('/shop')} />
            <Button label={t('rewards.back')} kind="ghost" onPress={() => router.replace('/rewards')} />
          </View>
        </BottomBar>
      }
      contentStyle={{ paddingTop: 56, gap: 24, alignItems: 'stretch' }}
    >
      {!v.data ? (
        <Loading />
      ) : (
        <>
          <View style={{ alignItems: 'center', gap: 12 }}>
            <View style={{ width: 72, height: 72, borderRadius: 36, backgroundColor: colors.inverse, alignItems: 'center', justifyContent: 'center' }}>
              <Check size={36} color={colors.textInverse} strokeWidth={2.5} />
            </View>
            <Text variant="h1" center>
              {t('rewards.voucherReady')}
            </Text>
            <Text variant="body" color={colors.textSecondary} center>
              {t('rewards.voucherReadyBody')}
            </Text>
          </View>
          <View style={{ borderRadius: radius.xl, borderWidth: 1.5, borderColor: colors.gold, borderStyle: 'dashed', padding: 24, alignItems: 'center', gap: 8, backgroundColor: colors.goldSoft }}>
            {v.data.kind === 'discount' ? (
              <Text variant="display" center style={{ fontFamily: fonts.bold }}>{`${v.data.percent}% ${t('rewards.off')}`}</Text>
            ) : (
              <>
                <Star size={32} color={colors.goldInk} />
                <Text variant="h2" center>
                  {f.name(v.data, 'product_name')}
                </Text>
              </>
            )}
            <Text variant="h2" color={colors.goldInk} center selectable testID="voucher-code" style={{ letterSpacing: 2 }}>
              {v.data.code}
            </Text>
            <Text variant="small" color={colors.textSecondary} center>
              {t('rewards.validOne', { date: f.date(v.data.expires_at) })}
            </Text>
          </View>
        </>
      )}
    </Screen>
  );
}
