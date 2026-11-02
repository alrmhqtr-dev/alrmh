import { View } from 'react-native';
import { router } from 'expo-router';
import { Info } from 'lucide-react-native';
import { useLocale } from '@/i18n';
import { useBuilder } from '@/state/builder';
import { Note, Text, Touch } from '@/ui/primitives';
import { Swatch } from '@/ui/art';
import { DesignStep, useDesignData } from '@/ui/design';
import { colors, fonts } from '@/theme/tokens';

export default function ColourStep() {
  const { t, f } = useLocale();
  const { state, set } = useBuilder();
  const { cat, fabric, colour } = useDesignData();
  const allowed = (cat.data?.colours ?? []).filter((c) => fabric?.colour_ids.includes(c.id));

  return (
    <DesignStep
      step={3}
      label={t('design.colour')}
      priceLabel={`${f.name(fabric)} · ${f.name(colour)}`}
      price={f.money(fabric?.price ?? 0)}
      nextLabel={t('design.next', { step: t('design.forWhom') })}
      onNext={() => router.push('/design/for-whom')}
      nextDisabled={!state.colourId}
    >
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
        <Text variant="h2">{t('design.chooseColour')}</Text>
        <Text variant="smallStrong">{f.name(colour)}</Text>
      </View>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', rowGap: 18 }}>
        {allowed.map((c) => {
          const on = state.colourId === c.id;
          return (
            <Touch key={c.id} testID={`colour-${c.id}`} onPress={() => set({ colourId: c.id })} accessibilityState={{ selected: on }} style={{ width: '25%', alignItems: 'center', gap: 6 }}>
              <Swatch hex={c.hex} selected={on} />
              <Text variant="small" center style={{ fontFamily: on ? fonts.semibold : fonts.regular }} color={on ? colors.text : colors.textSecondary}>
                {f.name(c)}
              </Text>
            </Touch>
          );
        })}
      </View>
      <Note icon={Info}>{t('design.colourNote')}</Note>
    </DesignStep>
  );
}
