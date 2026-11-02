import { useState } from 'react';
import { View } from 'react-native';
import { router } from 'expo-router';
import { useLocale, type Lang } from '@/i18n';
import { Card, Radio, Text } from '@/ui/primitives';
import { BottomBar, Screen, Wordmark } from '@/ui/layout';
import { colors, fonts } from '@/theme/tokens';
import { Button } from '@/ui/primitives';

export default function Language() {
  const { lang, setLang, t } = useLocale();
  const [pick, setPick] = useState<Lang>(lang);

  const option = (value: Lang, glyph: string, title: string, sub: string) => (
    <Card testID={`lang-${value}`} selected={pick === value} onPress={() => setPick(value)} style={{ padding: 16 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 14 }}>
        <View
          style={{
            width: 48,
            height: 48,
            borderRadius: 12,
            backgroundColor: pick === value ? colors.inverse : colors.subtle,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Text variant="title" color={pick === value ? colors.textInverse : colors.text} center>
            {glyph}
          </Text>
        </View>
        <View style={{ flex: 1 }}>
          <Text variant="bodyStrong">{title}</Text>
          <Text variant="small" color={colors.textSecondary}>
            {sub}
          </Text>
        </View>
        <Radio on={pick === value} />
      </View>
    </Card>
  );

  return (
    <Screen
      footer={
        <BottomBar>
          <Button
            testID="lang-continue"
            label={pick === 'ar' ? 'متابعة' : 'Continue'}
            onPress={async () => {
              await setLang(pick);
              router.replace('/onboarding/welcome');
            }}
          />
        </BottomBar>
      }
    >
      <View style={{ paddingTop: 48, alignItems: 'flex-start' }}>
        <Wordmark size={0.62} />
      </View>
      <View style={{ marginTop: 28, gap: 2 }}>
        <Text variant="h1">{pick === 'ar' ? 'اختر لغتك' : 'Choose your language'}</Text>
        <Text variant="h1" style={{ fontFamily: fonts.semibold }}>
          {pick === 'ar' ? 'Choose your language' : 'اختر لغتك'}
        </Text>
      </View>
      <View style={{ gap: 12, marginTop: 28 }}>
        {option('ar', 'أب', 'العربية', 'Arabic')}
        {option('en', 'Aa', 'English', 'الإنجليزية')}
      </View>
      <Text variant="small" color={colors.textMuted} style={{ marginTop: 24 }}>
        {pick === 'ar' ? 'يمكنك تغيير اللغة في أي وقت من الحساب ← اللغة.' : t('lang.hint')}
      </Text>
    </Screen>
  );
}
