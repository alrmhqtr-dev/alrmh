import { useLocale } from '@/i18n';
import { Text } from '@/ui/primitives';
import { Header, Screen } from '@/ui/layout';
import { colors } from '@/theme/tokens';

export default function Terms() {
  const { t } = useLocale();
  return (
    <Screen header={<Header title={t('terms.title')} />} contentStyle={{ paddingTop: 8 }}>
      <Text variant="body" color={colors.textSecondary}>
        {t('terms.body')}
      </Text>
    </Screen>
  );
}
