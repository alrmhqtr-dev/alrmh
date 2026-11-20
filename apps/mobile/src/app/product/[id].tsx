import { useState } from 'react';
import { View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useQueryClient } from '@tanstack/react-query';
import { Star } from 'lucide-react-native';
import { useLocale } from '@/i18n';
import { api } from '@/api/client';
import { useCatalogue, usePointRates } from '@/api/hooks';
import { useSession } from '@/state/session';
import { errorText } from '@/lib/errors';
import { Button, Chip, ErrorState, Loading, Note, Pill, Stepper, Text } from '@/ui/primitives';
import { BottomBar, Header, Screen } from '@/ui/layout';
import { SignInGate } from '@/ui/gate';
import { ProductArt } from '@/ui/art';
import { colors } from '@/theme/tokens';

export default function ProductScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { t, f } = useLocale();
  const qc = useQueryClient();
  const { signedIn } = useSession();
  const cat = useCatalogue();
  const rates = usePointRates();
  const product = cat.data?.products.find((p) => p.id === id);
  const [size, setSize] = useState<string | null>(null);
  const [qty, setQty] = useState(1);
  const [gate, setGate] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ tone: 'gold' | 'error'; text: string } | null>(null);

  if (cat.isLoading) return <Screen header={<Header bag />}><Loading /></Screen>;
  if (!product) return <Screen header={<Header bag />}><ErrorState message={t('common.error')} retryLabel={t('common.retry')} onRetry={() => cat.refetch()} /></Screen>;

  const pts = (rates?.points_per_product ?? 0) * qty;
  const unit = product.sale_price ?? product.price;
  const soldOut = product.in_stock === false || Boolean(size && product.sold_out_sizes?.includes(size));
  const add = async () => {
    if (!signedIn) return setGate(true);
    if (product.sizes.length && !size) return setMsg({ tone: 'error', text: t('product.pickSize') });
    setBusy(true);
    setMsg(null);
    try {
      await api('/basket/items', { body: { kind: 'product', productId: product.id, size, qty } });
      await qc.invalidateQueries({ queryKey: ['me'] });
      await qc.invalidateQueries({ queryKey: ['basket'] });
      setMsg({ tone: 'gold', text: t('product.added') });
    } catch (e) {
      setMsg({ tone: 'error', text: errorText(t, e) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen
      header={<Header bag />}
      footer={
        <BottomBar label={t('common.qty', { n: qty })} value={f.money(unit * qty)}>
          <Button testID="product-add" label={soldOut ? t('product.soldOut') : t('product.add')} onPress={add} loading={busy} disabled={soldOut} style={{ minWidth: 190 }} />
        </BottomBar>
      }
      contentStyle={{ gap: 16 }}
    >
      <ProductArt label={t('product.renderFromClient')} uri={product.image_url} style={{ borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, aspectRatio: 0.95 }} />
      <View style={{ gap: 6 }}>
        <Text variant="overline">{f.name(cat.data?.categories.find((c) => c.id === product.category)) || product.category}</Text>
        <Text variant="h1">{f.name(product)}</Text>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
          <Text variant="price">{f.money(unit)}</Text>
          {product.sale_price != null ? (
            <Text variant="small" color={colors.textMuted} style={{ textDecorationLine: 'line-through' }}>
              {f.money(product.price)}
            </Text>
          ) : null}
          <Pill gold icon={Star} label={t('product.earn', { pts })} />
        </View>
      </View>
      {product.sizes.length ? (
        <View style={{ gap: 10 }}>
          <Text variant="overline">{t('product.size')}</Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
            {product.sizes.map((s) => (
              <Chip
                key={s}
                testID={`size-${s}`}
                label={product.sold_out_sizes?.includes(s) ? `${s} · ${t('product.soldOut')}` : s}
                selected={size === s}
                onPress={() => { setSize(s); setMsg(null); }}
              />
            ))}
          </View>
        </View>
      ) : null}
      <Text variant="body" color={colors.textSecondary}>
        {f.name(product, 'description')}
      </Text>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
        <Text variant="bodyStrong">{t('review.quantity')}</Text>
        <Stepper value={qty} onChange={setQty} />
      </View>
      {msg ? <Note tone={msg.tone}>{msg.text}</Note> : null}
      <SignInGate visible={gate} onClose={() => setGate(false)} returnTo={`/product/${product.id}`} />
    </Screen>
  );
}
