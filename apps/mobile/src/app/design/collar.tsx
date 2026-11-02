import { useEffect } from 'react';
import { View } from 'react-native';
import { router } from 'expo-router';
import { useLocale } from '@/i18n';
import { useBuilder } from '@/state/builder';
import { defaultsFor } from '@/lib/actions';
import { Card, SelectedCheck, Text } from '@/ui/primitives';
import { CollarGlyph } from '@/ui/art';
import { DesignStep, useDesignData } from '@/ui/design';
import { colors } from '@/theme/tokens';

export default function CollarStep() {
  const { t, f } = useLocale();
  const { state, set } = useBuilder();
  const { cat } = useDesignData();

  useEffect(() => {
    if (cat.data && !state.collarId) set(defaultsFor(cat.data));
  }, [cat.data, state.collarId, set]);

  const minPrice = Math.min(...(cat.data?.fabrics.map((x) => x.price) ?? [0]));
  const collars = cat.data?.collars ?? [];

  return (
    <DesignStep
      step={1}
      label={t('design.collar')}
      priceLabel={t('design.priceFrom')}
      price={f.money(minPrice)}
      nextLabel={t('design.next', { step: t('design.fabric') })}
      onNext={() => router.push('/design/fabric')}
      nextDisabled={!state.collarId}
    >
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
        <Text variant="h2">{t('design.chooseCollar')}</Text>
        <Text variant="small" color={colors.textSecondary}>
          {t('design.styles', { n: collars.length })}
        </Text>
      </View>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 12 }}>
        {collars.map((c) => {
          const on = state.collarId === c.id;
          return (
            <Card key={c.id} testID={`collar-${c.id}`} selected={on} onPress={() => set({ collarId: c.id })} style={{ width: '47%', flexGrow: 1, height: 112, alignItems: 'center', justifyContent: 'center', gap: 18 }}>
              {on ? (
                <View style={{ position: 'absolute', top: 10, end: 10 }}>
                  <SelectedCheck />
                </View>
              ) : null}
              <CollarGlyph collar={c.id} />
              <Text variant="smallStrong" center>
                {f.name(c)}
              </Text>
            </Card>
          );
        })}
      </View>
    </DesignStep>
  );
}
