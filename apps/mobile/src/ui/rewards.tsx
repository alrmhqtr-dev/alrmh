import { View } from 'react-native';
import { Clock, Star, Tag } from 'lucide-react-native';
import { useLocale, type Format } from '@/i18n';
import type { LedgerEntry, Voucher } from '@/api/hooks';
import { Card, IconTile, Text } from './primitives';
import { colors, fonts } from '@/theme/tokens';

export function ledgerTitle(e: LedgerEntry, t: (k: any, p?: any) => string, f: Format, products?: { id: string; name_en: string; name_ar: string }[]) {
  const label = e.label ?? '';
  if (label.startsWith('Order #')) return t('orders.orderN', { number: f.orderNo(label.slice(7)) });
  if (label === 'Loyalty card transfer') return t('rewards.label.loyalty');
  const pct = label.match(/^(\d+)% off voucher$/);
  if (pct) return t('rewards.label.voucher', { pct: pct[1] });
  if (label.startsWith('Reward: ')) {
    const p = products?.find((x) => x.id === label.slice(8));
    return p ? f.name(p) : label.slice(8);
  }
  if (e.kind === 'expire') return t('rewards.expiredPoints');
  return label;
}

export function LedgerRow({ e, products }: { e: LedgerEntry; products?: { id: string; name_en: string; name_ar: string }[] }) {
  const { t, f } = useLocale();
  const sub =
    e.kind === 'earn'
      ? t('rewards.delivered', { date: f.date(e.created_at) })
      : e.kind === 'redeem'
        ? t('rewards.redeemedOn', { date: f.date(e.created_at) })
        : t('rewards.expiredOn', { date: f.date(e.created_at) });
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 14, padding: 14 }}>
      <IconTile icon={e.kind === 'earn' ? Star : e.kind === 'redeem' ? Tag : Clock} gold={e.kind === 'earn'} />
      <View style={{ flex: 1 }}>
        <Text variant="bodyStrong">{ledgerTitle(e, t, f, products)}</Text>
        <Text variant="caption" color={colors.textMuted}>
          {sub}
        </Text>
        {e.kind === 'earn' && e.expires_at ? (
          <Text variant="caption" color={colors.textMuted}>
            {t('rewards.expires', { date: f.date(e.expires_at) })}
          </Text>
        ) : null}
      </View>
      <Text variant="smallStrong" color={e.points > 0 ? colors.goldInk : e.kind === 'expire' ? colors.error : colors.text}>
        {f.signedPts(e.points)}
      </Text>
    </View>
  );
}

export function VoucherCard({ v, onPress }: { v: Voucher; onPress?: () => void }) {
  const { t, f } = useLocale();
  return (
    <Card onPress={onPress} style={{ flexDirection: 'row' }}>
      <View style={{ width: 92, backgroundColor: colors.gold, alignItems: 'center', justifyContent: 'center', paddingVertical: 18 }}>
        {v.kind === 'discount' ? (
          <>
            <Text variant="h1" center style={{ fontFamily: fonts.bold }}>{`${v.percent}%`}</Text>
            <Text variant="overline" color={colors.text} center>
              {t('rewards.off')}
            </Text>
          </>
        ) : (
          <Star size={28} color={colors.text} />
        )}
      </View>
      <View style={{ flex: 1, padding: 16, gap: 2, justifyContent: 'center' }}>
        <Text variant="bodyStrong">{v.kind === 'discount' ? t('rewards.discountVoucher') : f.name(v, 'product_name')}</Text>
        <Text variant="small" color={colors.textSecondary}>
          {t('rewards.code', { code: v.code })}
        </Text>
        <Text variant="caption" color={colors.textMuted}>
          {t('rewards.validUntil', { date: f.date(v.expires_at) })}
        </Text>
      </View>
    </Card>
  );
}
