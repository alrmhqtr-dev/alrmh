import { useState } from 'react';
import { View } from 'react-native';
import { router } from 'expo-router';
import { useLocale, type Lang } from '@/i18n';
import { api } from '@/api/client';
import { useSession } from '@/state/session';
import { Button, Card, Radio, Text } from '@/ui/primitives';
import { BottomBar, Header, Screen } from '@/ui/layout';
import { colors } from '@/theme/tokens';

export default function LanguageSetting() {
  const { lang, setLang, t } = useLocale();
  const { signedIn } = useSession();
  const [pick, setPick] = useState<Lang>(lang);

  const row = (value: Lang, glyph: string, title: string, sub: string) => (
    <Card testID={`setlang-${value}`} selected={pick === value} onPress={() => setPick(value)} style={{ padding: 16, flexDirection: 'row', alignItems: 'center', gap: 14 }}>
      <View style={{ width: 48, height: 48, borderRadius: 12, backgroundColor: pick === value ? colors.inverse : colors.subtle, alignItems: 'center', justifyContent: 'center' }}>
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
    </Card>
  );

  return (
    <Screen
      header={<Header title={t('account.title')} />}
      footer={
        <BottomBar>
          <Button
            testID="setlang-apply"
            label={t('common.apply')}
            onPress={async () => {
              await setLang(pick);
              if (signedIn) api('/me', { method: 'PATCH', body: { language: pick } }).catch(() => {});
              router.back();
            }}
          />
        </BottomBar>
      }
      contentStyle={{ gap: 12, paddingTop: 8 }}
    >
      <Text variant="h2" style={{ marginBottom: 8 }}>
        {t('language.title')}
      </Text>
      {row('ar', 'أب', 'العربية', t('language.arSub'))}
      {row('en', 'Aa', 'English', t('language.enSub'))}
    </Screen>
  );
}
