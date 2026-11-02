import { useState } from 'react';
import { View } from 'react-native';
import { router } from 'expo-router';
import { Info } from 'lucide-react-native';
import { useLocale } from '@/i18n';
import { useBuilder } from '@/state/builder';
import { Card, Icon, Radio, Text, Touch } from '@/ui/primitives';
import { Sheet } from '@/ui/layout';
import { DesignStep, useDesignData } from '@/ui/design';
import { colors, radius } from '@/theme/tokens';

export default function FabricStep() {
  const { t, f } = useLocale();
  const { state, set } = useBuilder();
  const { cat, fabric } = useDesignData();
  const [about, setAbout] = useState(false);
  const fabrics = cat.data?.fabrics ?? [];

  const pick = (id: string) => {
    const next = fabrics.find((x) => x.id === id)!;
    const colourOk = state.colourId && next.colour_ids.includes(state.colourId);
    set({ fabricId: id, colourId: colourOk ? state.colourId : next.colour_ids.includes('ivory') ? 'ivory' : next.colour_ids[0] });
  };

  return (
    <DesignStep
      step={2}
      label={t('design.fabric')}
      priceLabel={f.name(fabric)}
      price={f.money(fabric?.price ?? 0)}
      nextLabel={t('design.next', { step: t('design.colour') })}
      onNext={() => router.push('/design/colour')}
      nextDisabled={!state.fabricId}
    >
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
        <Text variant="h2">{t('design.chooseFabric')}</Text>
        <Touch onPress={() => setAbout(true)} style={{ flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: colors.subtle, borderRadius: radius.pill, paddingHorizontal: 10, height: 28 }}>
          <Icon icon={Info} size={14} />
          <Text variant="caption" style={{ fontSize: 12 }}>
            {t('design.aboutFabrics')}
          </Text>
        </Touch>
      </View>
      <View style={{ gap: 10 }}>
        {fabrics.map((x) => {
          const on = state.fabricId === x.id;
          return (
            <Card key={x.id} testID={`fabric-${x.id}`} selected={on} onPress={() => pick(x.id)} style={{ paddingHorizontal: 16, paddingVertical: 14 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 14 }}>
                <View style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: colors.subtle }} />
                <View style={{ flex: 1 }}>
                  <Text variant="bodyStrong">{f.name(x)}</Text>
                  <Text variant="small" color={colors.textSecondary}>
                    {f.name(x, 'note')}
                  </Text>
                </View>
                <Text variant="smallStrong">{f.money(x.price)}</Text>
                <Radio on={on} />
              </View>
            </Card>
          );
        })}
      </View>
      <Sheet visible={about} onClose={() => setAbout(false)}>
        <Text variant="h2" style={{ marginBottom: 12 }}>
          {t('design.aboutFabrics')}
        </Text>
        <View style={{ gap: 12 }}>
          {fabrics.map((x) => (
            <View key={x.id} style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 12 }}>
              <View style={{ flex: 1 }}>
                <Text variant="bodyStrong">{f.name(x)}</Text>
                <Text variant="small" color={colors.textSecondary}>
                  {f.name(x, 'note')}
                </Text>
              </View>
              <Text variant="smallStrong">{f.money(x.price)}</Text>
            </View>
          ))}
        </View>
      </Sheet>
    </DesignStep>
  );
}
