import { useEffect, useState } from 'react';
import { Linking, Platform, TextInput, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { Check, Lock, MapPin, Plus, ShieldCheck, Star, Tag, Truck, ChevronRight } from 'lucide-react-native';
import { useLocale } from '@/i18n';
import { api } from '@/api/client';
import { useAddresses, type Quote, type Voucher } from '@/api/hooks';
import { errorText } from '@/lib/errors';
import { Button, Card, Divider, ErrorState, Icon, IconTile, Loading, Note, Radio, Text, Touch } from '@/ui/primitives';
import { BottomBar, Header, Screen, Sheet } from '@/ui/layout';
import { colors, fonts, radius, type as typeScale } from '@/theme/tokens';

function appUrl() {
  if (Platform.OS !== 'web') return 'alrmh://';
  return window.location.origin;
}

export default function Checkout() {
  const { t, f, isRTL } = useLocale();
  const params = useLocalSearchParams<{ payment?: string }>();
  const addresses = useAddresses();
  const [addressId, setAddressId] = useState<string | undefined>();
  const [voucherId, setVoucherId] = useState<string | null | undefined>(undefined);
  const [couponInput, setCouponInput] = useState('');
  const [coupon, setCoupon] = useState<string | null>(null);
  const [pickAddress, setPickAddress] = useState(false);
  const [pickVoucher, setPickVoucher] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!addressId && addresses.data?.length) setAddressId((addresses.data.find((a) => a.is_default) ?? addresses.data[0]).id);
  }, [addresses.data, addressId]);

  const quote = useQuery({
    queryKey: ['quote', addressId, voucherId, coupon],
    queryFn: () => api<Quote>('/checkout/quote', { body: { addressId, voucherId, couponCode: coupon } }),
    placeholderData: (prev) => prev,
  });
  const q = quote.data;
  const couponOk = Boolean(q?.coupon && !q.coupon.error);
  const voucherLabel = (v: Voucher) => (v.kind === 'discount' ? t('checkout.voucherPct', { pct: v.percent ?? 0 }) : t('checkout.voucherProduct', { name: f.name(v, 'product_name') }));

  const pay = async () => {
    if (!q) return;
    setBusy(true);
    setError(null);
    try {
      const r = await api<{ paymentUrl: string; orderId: string }>('/orders', {
        body: { addressId: q.address?.id, voucherId: couponOk ? null : (q.appliedVoucher?.id ?? null), couponCode: couponOk ? q.coupon!.code : null, returnUrl: appUrl() },
      });
      if (Platform.OS === 'web') window.location.assign(r.paymentUrl);
      else await Linking.openURL(r.paymentUrl);
    } catch (e) {
      setError(errorText(t, e, 'checkout'));
      setBusy(false);
    }
  };

  if (quote.isLoading || addresses.isLoading) return <Screen header={<Header title={t('checkout.title')} />}><Loading /></Screen>;
  if (!q) return <Screen header={<Header title={t('checkout.title')} />}><ErrorState message={t('err.network')} retryLabel={t('common.retry')} onRetry={() => quote.refetch()} /></Screen>;

  const discountLine = () => {
    if (!q.discountLabel) return null;
    const [kind, code, pct] = q.discountLabel.split(':');
    if (kind === 'reward') return [t('checkout.reward', { name: f.name(q.rewardItem) }), t('common.free')];
    const label = kind === 'coupon' ? t('checkout.couponLine', { code, pct }) : t('checkout.voucherLine', { pct });
    return [label, `− ${f.money(q.discount, true)}`];
  };
  const dl = discountLine();
  const others = q.vouchers.filter((v) => v.id !== q.appliedVoucher?.id).length;

  return (
    <Screen
      header={<Header title={t('checkout.title')} />}
      footer={
        <BottomBar>
          <View style={{ gap: 8 }}>
            <Button testID="checkout-pay" label={t('checkout.pay', { amount: f.moneyNum(q.total, true) })} icon={Lock} onPress={pay} loading={busy} disabled={!q.address || !q.items.length} />
            <View style={{ flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 6 }}>
              <Icon icon={ShieldCheck} size={14} color={colors.textMuted} />
              <Text variant="caption" color={colors.textMuted}>
                {t('checkout.secured')}
              </Text>
            </View>
          </View>
        </BottomBar>
      }
      contentStyle={{ gap: 12, paddingTop: 8 }}
    >
      {params.payment ? <Note tone="error">{params.payment === 'failed' ? t('checkout.failed') : t('checkout.cancelled')}</Note> : null}

      <Text variant="bodyStrong" style={{ marginTop: 4 }}>
        {t('checkout.deliverTo')}
      </Text>
      {q.address ? (
        <Card style={{ padding: 16, flexDirection: 'row', alignItems: 'center', gap: 14 }}>
          <IconTile icon={MapPin} />
          <View style={{ flex: 1 }}>
            <Text variant="bodyStrong">{q.address.label}</Text>
            <Text variant="small" color={colors.textSecondary}>{`${q.address.line1}, ${q.address.area}, ${q.address.city}`}</Text>
          </View>
          <Touch testID="change-address" onPress={() => setPickAddress(true)}>
            <Text variant="smallStrong">{t('common.change')}</Text>
          </Touch>
        </Card>
      ) : (
        <Button testID="add-address" label={t('checkout.addAddress')} kind="secondary" icon={Plus} onPress={() => router.push('/account/add-address')} />
      )}

      <Text variant="bodyStrong" style={{ marginTop: 8 }}>
        {t('checkout.delivery')}
      </Text>
      <Card style={{ padding: 16, flexDirection: 'row', alignItems: 'center', gap: 12 }}>
        <Icon icon={Truck} size={22} />
        <View style={{ flex: 1 }}>
          <Text variant="bodyStrong">{t('checkout.homeDelivery')}</Text>
          <Text variant="small" color={colors.textSecondary}>
            {t('checkout.afterReady')}
          </Text>
        </View>
        <Text variant="smallStrong">{f.money(q.deliveryFee)}</Text>
      </Card>

      {q.vouchers.length ? (
        <>
          <Text variant="bodyStrong" style={{ marginTop: 8 }}>
            {t('checkout.rewards')}
          </Text>
          <Card style={{ opacity: couponOk ? 0.45 : 1 }}>
            {q.appliedVoucher && !couponOk ? (
              <View style={{ padding: 16, flexDirection: 'row', alignItems: 'center', gap: 12 }}>
                <IconTile icon={Tag} gold />
                <View style={{ flex: 1 }}>
                  <Text variant="bodyStrong">{voucherLabel(q.appliedVoucher)}</Text>
                  <Text variant="small" color={colors.textSecondary}>
                    {t('checkout.redeemedFor', { pts: f.num(q.appliedVoucher.cost_points), date: f.day(q.appliedVoucher.expires_at) })}
                  </Text>
                </View>
                <Touch testID="voucher-remove" onPress={() => setVoucherId(null)}>
                  <Text variant="small" color={colors.textSecondary}>
                    {t('common.remove')}
                  </Text>
                </Touch>
              </View>
            ) : (
              <View style={{ padding: 16, flexDirection: 'row', alignItems: 'center', gap: 12 }}>
                <IconTile icon={Tag} />
                <Text variant="body" color={colors.textSecondary} style={{ flex: 1 }}>
                  {t('checkout.noVoucher')}
                </Text>
              </View>
            )}
            {!couponOk && (others > 0 || !q.appliedVoucher) ? (
              <>
                <Divider />
                <Touch onPress={() => setPickVoucher(true)} style={{ paddingHorizontal: 16, paddingVertical: 12, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                  <Text variant="small" color={colors.textSecondary}>
                    {q.appliedVoucher ? t('checkout.moreVouchers', { n: others }) : t('checkout.useVoucher')}
                  </Text>
                  <Icon icon={ChevronRight} size={16} color={colors.textMuted} flip />
                </Touch>
              </>
            ) : null}
          </Card>
        </>
      ) : null}

      <Text variant="bodyStrong" style={{ marginTop: 8 }}>
        {t('checkout.coupon')}
      </Text>
      {couponOk ? (
        <Card selected style={{ padding: 14, flexDirection: 'row', alignItems: 'center', gap: 12 }}>
          <View style={{ width: 40, height: 40, borderRadius: 10, backgroundColor: colors.inverse, alignItems: 'center', justifyContent: 'center' }}>
            <Check size={20} color={colors.textInverse} />
          </View>
          <View style={{ flex: 1 }}>
            <Text variant="bodyStrong">{q.coupon!.code}</Text>
            <Text variant="small" color={colors.textSecondary}>
              {q.coupon!.maxDiscount ? t('checkout.couponDesc', { pct: q.coupon!.percent!, max: q.coupon!.maxDiscount }) : t('checkout.couponDescNoCap', { pct: q.coupon!.percent! })}
            </Text>
          </View>
          <Touch testID="coupon-remove" onPress={() => { setCoupon(null); setCouponInput(''); }}>
            <Text variant="small" color={colors.textSecondary}>
              {t('common.remove')}
            </Text>
          </Touch>
        </Card>
      ) : (
        <View style={{ gap: 8 }}>
          <View style={{ height: 54, borderRadius: 14, borderWidth: 1, borderColor: q.coupon?.error ? colors.error : 'transparent', backgroundColor: colors.subtle, flexDirection: 'row', alignItems: 'center', paddingStart: 16, paddingEnd: 6, gap: 8 }}>
            <TextInput
              testID="coupon-input"
              value={couponInput}
              onChangeText={(v) => setCouponInput(v.toUpperCase())}
              placeholder={t('checkout.couponPh')}
              placeholderTextColor={colors.textMuted}
              autoCapitalize="characters"
              onSubmitEditing={() => couponInput.trim() && setCoupon(couponInput.trim())}
              style={[typeScale.body, { flex: 1, color: colors.text, fontFamily: fonts.medium, textAlign: isRTL ? 'right' : 'left' }, Platform.OS === 'web' ? ({ outlineStyle: 'none' } as any) : null]}
            />
            <Button testID="coupon-apply" label={t('common.apply')} kind="subtle" small onPress={() => couponInput.trim() && setCoupon(couponInput.trim())} disabled={!couponInput.trim()} />
          </View>
          {q.coupon?.error ? (
            <Text variant="small" color={colors.error}>
              {t(`checkout.${q.coupon.error}` as any, { min: q.coupon.min ?? 0 })}
            </Text>
          ) : null}
        </View>
      )}
      {couponOk && q.couponReplacesVoucher ? (
        <Text variant="small" color={colors.textMuted}>
          {t('checkout.oneDiscount')}
        </Text>
      ) : null}

      <Text variant="bodyStrong" style={{ marginTop: 8 }}>
        {t('checkout.payment')}
      </Text>
      <Card selected style={{ padding: 16, flexDirection: 'row', alignItems: 'center', gap: 14 }}>
        <View style={{ width: 64, height: 40, borderRadius: 8, backgroundColor: colors.subtle, alignItems: 'center', justifyContent: 'center' }}>
          <Text variant="caption" style={{ fontFamily: fonts.semibold }}>
            SADAD
          </Text>
        </View>
        <View style={{ flex: 1 }}>
          <Text variant="bodyStrong">{t('checkout.sadad')}</Text>
          <Text variant="small" color={colors.textSecondary}>
            {t('checkout.sadadBody')}
          </Text>
        </View>
        <Radio on />
      </Card>
      <Text variant="caption" color={colors.goldInk}>
        {t('checkout.testMode')}
      </Text>

      <Text variant="bodyStrong" style={{ marginTop: 8 }}>
        {t('checkout.summary')}
      </Text>
      <Card style={{ padding: 16, gap: 10 }}>
        {[
          [t('checkout.subtotalN', { n: q.count }), f.money(q.subtotal, true)],
          [t('checkout.delivery'), f.money(q.deliveryFee, true)],
          ...(q.homeVisitFee ? [[t('checkout.homeVisitFee'), f.money(q.homeVisitFee, true)]] : []),
          ...(dl ? [dl] : []),
        ].map(([a, b]) => (
          <View key={a} style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
            <Text variant="body" color={colors.textSecondary}>
              {a}
            </Text>
            <Text variant="bodyStrong">{b}</Text>
          </View>
        ))}
        <Divider />
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
          <Text variant="bodyStrong">{t('checkout.total')}</Text>
          <Text variant="h2" testID="checkout-total">
            {f.money(q.total, true)}
          </Text>
        </View>
        <View style={{ flexDirection: 'row', gap: 6, alignItems: 'center' }}>
          <Icon icon={Star} size={14} color={colors.textSecondary} />
          <Text variant="small" color={colors.textSecondary}>
            {t('checkout.earn', { pts: q.pointsToEarn })}
          </Text>
        </View>
      </Card>
      {error ? <Note tone="error">{error}</Note> : null}

      <Sheet visible={pickAddress} onClose={() => setPickAddress(false)}>
        <View style={{ gap: 10 }}>
          {(addresses.data ?? []).map((a) => (
            <Card key={a.id} selected={a.id === q.address?.id} onPress={() => { setAddressId(a.id); setPickAddress(false); }} style={{ padding: 14, flexDirection: 'row', alignItems: 'center', gap: 12 }}>
              <View style={{ flex: 1 }}>
                <Text variant="bodyStrong">{a.label}</Text>
                <Text variant="small" color={colors.textSecondary}>{`${a.line1}, ${a.area}`}</Text>
              </View>
              <Radio on={a.id === q.address?.id} />
            </Card>
          ))}
          <Button label={t('addresses.add')} kind="secondary" icon={Plus} onPress={() => { setPickAddress(false); router.push('/account/add-address'); }} />
        </View>
      </Sheet>
      <Sheet visible={pickVoucher} onClose={() => setPickVoucher(false)}>
        <View style={{ gap: 10 }}>
          {q.vouchers.map((v) => (
            <Card key={v.id} selected={v.id === q.appliedVoucher?.id} onPress={() => { setVoucherId(v.id); setPickVoucher(false); }} style={{ padding: 14, flexDirection: 'row', alignItems: 'center', gap: 12 }}>
              <IconTile icon={Tag} gold />
              <View style={{ flex: 1 }}>
                <Text variant="bodyStrong">{voucherLabel(v)}</Text>
                <Text variant="small" color={colors.textSecondary}>
                  {t('rewards.validUntil', { date: f.date(v.expires_at) })}
                </Text>
              </View>
              <Radio on={v.id === q.appliedVoucher?.id} />
            </Card>
          ))}
          <Button label={t('checkout.noVoucher')} kind="ghost" onPress={() => { setVoucherId(null); setPickVoucher(false); }} />
        </View>
      </Sheet>
      <View style={{ height: 8, borderRadius: radius.sm }} />
    </Screen>
  );
}
