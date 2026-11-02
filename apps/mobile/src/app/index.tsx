import { useEffect, useState } from 'react';
import { View } from 'react-native';
import { Redirect } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useLocale } from '@/i18n';
import { useSession } from '@/state/session';
import { Text } from '@/ui/primitives';
import { Wordmark } from '@/ui/layout';
import { colors } from '@/theme/tokens';

export default function Boot() {
  const locale = useLocale();
  const session = useSession();
  const insets = useSafeAreaInsets();
  const [shown, setShown] = useState(false);

  useEffect(() => {
    const id = setTimeout(() => setShown(true), 900);
    return () => clearTimeout(id);
  }, []);

  if (shown && locale.ready && session.ready) {
    if (!locale.chosen) return <Redirect href="/onboarding/language" />;
    if (!session.signedIn && !session.guest) return <Redirect href="/onboarding/welcome" />;
    return <Redirect href="/home" />;
  }

  return (
    <View style={{ flex: 1, backgroundColor: colors.inverse, alignItems: 'center', justifyContent: 'center' }}>
      <Wordmark inverse />
      <View style={{ position: 'absolute', bottom: insets.bottom + 40 }}>
        <Text variant="small" color="rgba(255,255,255,0.6)" center>
          {locale.t('brand.tagline')}
        </Text>
      </View>
    </View>
  );
}
