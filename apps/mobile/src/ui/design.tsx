import type { ReactNode } from 'react';
import { View } from 'react-native';
import { router } from 'expo-router';
import { ArrowRight } from 'lucide-react-native';
import { useLocale } from '@/i18n';
import { useCatalogue } from '@/api/hooks';
import { useBuilder } from '@/state/builder';
import { Button, Card, StepProgress, Text } from './primitives';
import { BottomBar, Header, Screen } from './layout';
import { ThobeArt } from './art';
import { colors } from '@/theme/tokens';

export const STEP_ROUTES = ['/design/collar', '/design/fabric', '/design/colour', '/design/for-whom', '/design/measure'] as const;

export function useDesignData() {
  const cat = useCatalogue();
  const { state } = useBuilder();
  const collar = cat.data?.collars.find((c) => c.id === state.collarId) ?? null;
  const fabric = cat.data?.fabrics.find((x) => x.id === state.fabricId) ?? null;
  const colour = cat.data?.colours.find((c) => c.id === state.colourId) ?? null;
  return { cat, collar, fabric, colour };
}

export function ThobePreview({ height = 200 }: { height?: number }) {
  const { t } = useLocale();
  const { state } = useBuilder();
  const { colour, collar } = useDesignData();
  return (
    <Card style={{ height: height + 16, alignItems: 'center', justifyContent: 'flex-end', paddingBottom: 4 }}>
      <Text variant="caption" color={colors.textSecondary} style={{ position: 'absolute', top: 14, start: 18 }}>
        {t('design.preview')}
      </Text>
      <ThobeArt fill={colour?.hex ?? '#FFFFFF'} collar={collar?.shape ?? state.collarId ?? undefined} height={height - 24} />
    </Card>
  );
}

export function DesignStep({
  step,
  label,
  children,
  preview = true,
  priceLabel,
  price,
  nextLabel,
  onNext,
  nextDisabled,
  testID,
}: {
  step: number;
  label: string;
  children: ReactNode;
  preview?: boolean;
  priceLabel: string;
  price: string;
  nextLabel: string;
  onNext: () => void;
  nextDisabled?: boolean;
  testID?: string;
}) {
  const { t } = useLocale();
  return (
    <Screen
      header={
        <View style={{ backgroundColor: colors.canvas, paddingBottom: 12 }}>
          <Header title={t('design.title')} close={step === 1} bag onBack={step === 1 ? () => (router.canGoBack() ? router.back() : router.replace('/home')) : undefined} />
          <StepProgress step={step} label={label} stepLabel={t('design.step', { n: step })} />
        </View>
      }
      footer={
        <BottomBar label={priceLabel} value={price}>
          <Button testID={testID ?? 'design-next'} label={nextLabel} iconEnd={ArrowRight} onPress={onNext} disabled={nextDisabled} style={{ minWidth: 180 }} />
        </BottomBar>
      }
      contentStyle={{ gap: 20, paddingTop: 8 }}
    >
      {preview ? <ThobePreview /> : null}
      {children}
    </Screen>
  );
}
