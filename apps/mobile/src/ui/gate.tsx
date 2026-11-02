import { View } from 'react-native';
import { router } from 'expo-router';
import { Phone } from 'lucide-react-native';
import { useLocale } from '@/i18n';
import { useSession } from '@/state/session';
import { Button, Text } from './primitives';
import { Sheet } from './layout';
import { colors } from '@/theme/tokens';

export function SignInGate({ visible, onClose, returnTo }: { visible: boolean; onClose: () => void; returnTo: string }) {
  const { t } = useLocale();
  const { setReturnTo } = useSession();
  return (
    <Sheet visible={visible} onClose={onClose}>
      <View style={{ gap: 8, paddingBottom: 8 }}>
        <Text variant="h2">{t('gate.title')}</Text>
        <Text variant="body" color={colors.textSecondary}>
          {t('gate.body')}
        </Text>
      </View>
      <View style={{ gap: 6, marginTop: 16 }}>
        <Button
          testID="gate-continue"
          label={t('gate.cta')}
          icon={Phone}
          onPress={() => {
            setReturnTo(returnTo);
            onClose();
            router.push('/auth/phone');
          }}
        />
        <Button label={t('common.notNow')} kind="ghost" onPress={onClose} />
      </View>
    </Sheet>
  );
}

