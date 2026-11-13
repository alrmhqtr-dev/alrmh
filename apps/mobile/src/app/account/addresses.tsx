import { View } from 'react-native';
import { router } from 'expo-router';
import { useQueryClient } from '@tanstack/react-query';
import { ChevronRight, MapPin, Plus } from 'lucide-react-native';
import { useLocale } from '@/i18n';
import { api } from '@/api/client';
import { useAddresses } from '@/api/hooks';
import { Card, Icon, IconTile, Loading, Pill, Text, Touch } from '@/ui/primitives';
import { Header, Screen } from '@/ui/layout';
import { colors } from '@/theme/tokens';

export default function Addresses() {
  const { t } = useLocale();
  const qc = useQueryClient();
  const addresses = useAddresses();
  const refresh = () => Promise.all([qc.invalidateQueries({ queryKey: ['addresses'] }), qc.invalidateQueries({ queryKey: ['me'] })]);

  return (
    <Screen header={<Header title={t('addresses.title')} />} contentStyle={{ gap: 12, paddingTop: 8 }}>
      {addresses.isLoading ? <Loading /> : null}
      {addresses.data && !addresses.data.length ? (
        <Text variant="body" color={colors.textSecondary}>
          {t('addresses.empty')}
        </Text>
      ) : null}
      {(addresses.data ?? []).map((a) => (
        <Card key={a.id} testID={`address-${a.label}`} onPress={() => router.push({ pathname: '/account/add-address', params: { id: a.id } })} style={{ padding: 16, flexDirection: 'row', gap: 14, alignItems: 'flex-start' }}>
          <IconTile icon={MapPin} />
          <View style={{ flex: 1, gap: 4 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <Text variant="bodyStrong">{a.label}</Text>
              {a.is_default ? <Pill label={t('addresses.default')} /> : null}
            </View>
            <Text variant="small" color={colors.textSecondary}>{`${a.line1}, ${a.area}, ${a.city}`}</Text>
            {!a.is_default ? (
              <Touch onPress={async () => { await api(`/addresses/${a.id}`, { method: 'PATCH', body: { isDefault: true } }); refresh(); }} style={{ marginTop: 4 }}>
                <Text variant="smallStrong">{t('addresses.makeDefault')}</Text>
              </Touch>
            ) : null}
          </View>
          <Icon icon={ChevronRight} size={18} color={colors.textMuted} flip />
        </Card>
      ))}
      <Card dashed testID="add-address" onPress={() => router.push('/account/add-address')} style={{ height: 64, alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 10 }}>
        <Icon icon={Plus} size={20} />
        <Text variant="bodyStrong">{t('addresses.add')}</Text>
      </Card>
    </Screen>
  );
}
