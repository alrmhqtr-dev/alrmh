import { View } from 'react-native';
import { router } from 'expo-router';
import { Phone, Ruler, Shirt, Star } from 'lucide-react-native';
import { useLocale } from '@/i18n';
import { useSession } from '@/state/session';
import { Button, Icon, Text } from '@/ui/primitives';
import { BottomBar, Screen, Wordmark } from '@/ui/layout';
import { ThobeArt } from '@/ui/art';
import { colors } from '@/theme/tokens';

export default function Welcome() {
  const { t } = useLocale();
  const { browseAsGuest } = useSession();
  const point = (icon: any, text: string) => (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
      <Icon icon={icon} size={18} />
      <Text variant="small" color={colors.textSecondary}>
        {text}
      </Text>
    </View>
  );
  return (
    <Screen
      footer={
        <BottomBar>
          <View style={{ gap: 6 }}>
            <Button testID="welcome-phone" label={t('welcome.cta')} icon={Phone} onPress={() => router.push('/auth/phone')} />
            <Button
              testID="welcome-guest"
              label={t('welcome.guest')}
              kind="ghost"
              onPress={async () => {
                await browseAsGuest();
                router.replace('/home');
              }}
            />
          </View>
        </BottomBar>
      }
    >
      <View style={{ marginTop: 12, backgroundColor: colors.inverse, borderRadius: 24, height: 330, alignItems: 'center', overflow: 'hidden' }}>
        <View style={{ marginTop: 20 }}>
          <Wordmark inverse size={0.42} />
        </View>
        <View style={{ marginTop: -6 }}>
          <ThobeArt fill="#F4F2EE" height={250} />
        </View>
      </View>
      <Text variant="display" style={{ marginTop: 28 }}>
        {t('welcome.title')}
      </Text>
      <Text variant="body" color={colors.textSecondary} style={{ marginTop: 10 }}>
        {t('welcome.body')}
      </Text>
      <View style={{ gap: 12, marginTop: 22 }}>
        {point(Shirt, t('welcome.p1'))}
        {point(Ruler, t('welcome.p2'))}
        {point(Star, t('welcome.p3'))}
      </View>
    </Screen>
  );
}
