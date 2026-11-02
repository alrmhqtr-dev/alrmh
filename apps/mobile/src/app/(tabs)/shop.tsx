import { useMemo, useState } from 'react';
import { ScrollView, TextInput, View, Platform } from 'react-native';
import { router } from 'expo-router';
import { ArrowRight, Search, ShoppingBag } from 'lucide-react-native';
import { useLocale } from '@/i18n';
import { useCatalogue } from '@/api/hooks';
import { useBuilder } from '@/state/builder';
import { defaultsFor } from '@/lib/actions';
import { Button, Chip, ErrorState, Icon, Loading, Text, EmptyState } from '@/ui/primitives';
import { BagButton, Screen } from '@/ui/layout';
import { ProductCard } from '@/ui/commerce';
import { ThobeArt } from '@/ui/art';
import { colors, radius, type as typeScale } from '@/theme/tokens';

export default function Shop() {
  const { t, isRTL } = useLocale();
  const cat = useCatalogue();
  const builder = useBuilder();
  const [filter, setFilter] = useState<string>('all');
  const [q, setQ] = useState('');

  const products = useMemo(() => {
    const list = cat.data?.products ?? [];
    const needle = q.trim().toLowerCase();
    return list.filter(
      (p) => (filter === 'all' || filter === 'thobes' || p.category === filter) && (!needle || `${p.name_en} ${p.name_ar} ${p.category}`.toLowerCase().includes(needle)),
    );
  }, [cat.data, filter, q]);

  const startDesign = () => {
    builder.reset(defaultsFor(cat.data));
    router.push('/design/collar');
  };

  const filters = ['all', 'thobes', ...(cat.data?.categories ?? [])];

  return (
    <Screen contentStyle={{ paddingTop: 8, gap: 20 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
        <Text variant="h1">{t('shop.title')}</Text>
        <BagButton />
      </View>
      <View style={{ height: 50, borderRadius: 14, borderWidth: 1, borderColor: colors.border, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 14, gap: 10 }}>
        <Icon icon={Search} size={18} color={colors.textMuted} />
        <TextInput
          testID="shop-search"
          value={q}
          onChangeText={setQ}
          placeholder={t('shop.search')}
          placeholderTextColor={colors.textMuted}
          style={[typeScale.body, { flex: 1, color: colors.text, textAlign: isRTL ? 'right' : 'left' }, Platform.OS === 'web' ? ({ outlineStyle: 'none' } as any) : null]}
        />
      </View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }} style={{ marginHorizontal: -20 }}>
        <View style={{ width: 12 }} />
        {filters.map((key) => (
          <Chip
            key={key}
            testID={`filter-${key}`}
            label={key === 'all' ? t('shop.all') : key === 'thobes' ? t('shop.thobes') : t(`cat.${key}` as any)}
            selected={filter === key}
            onPress={() => setFilter(key)}
          />
        ))}
        <View style={{ width: 12 }} />
      </ScrollView>

      {filter === 'all' || filter === 'thobes' ? (
        <View style={{ backgroundColor: colors.inverse, borderRadius: radius.xl, padding: 20, flexDirection: 'row', alignItems: 'center', overflow: 'hidden', minHeight: 150 }}>
          <View style={{ flex: 1, gap: 8 }}>
            <Text variant="overline" color="rgba(255,255,255,0.6)">
              {t('shop.mtm')}
            </Text>
            <Text variant="h2" color={colors.textInverse}>
              {t('shop.designYours')}
            </Text>
            <Button testID="shop-design" label={t('shop.start')} kind="light" small iconEnd={ArrowRight} onPress={startDesign} style={{ alignSelf: 'flex-start', marginTop: 6 }} />
          </View>
          <View style={{ marginVertical: -20 }}>
            <ThobeArt fill="#F4F2EE" height={150} />
          </View>
        </View>
      ) : null}

      {filter !== 'thobes' ? (
        <View style={{ gap: 14 }}>
          <Text variant="h2">{filter === 'all' ? t('shop.accessories') : t(`cat.${filter}` as any)}</Text>
          {cat.isLoading ? (
            <Loading />
          ) : cat.isError ? (
            <ErrorState message={t('err.network')} retryLabel={t('common.retry')} onRetry={() => cat.refetch()} />
          ) : products.length === 0 ? (
            <EmptyState icon={ShoppingBag} title={t('shop.empty')} />
          ) : (
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 14, rowGap: 22 }}>
              {products.map((p) => (
                <View key={p.id} style={{ width: '47%', flexGrow: 1 }}>
                  <ProductCard product={p} onPress={() => router.push(`/product/${p.id}`)} />
                </View>
              ))}
              {products.length % 2 === 1 ? <View style={{ width: '47%', flexGrow: 1 }} /> : null}
            </View>
          )}
        </View>
      ) : null}
    </Screen>
  );
}
