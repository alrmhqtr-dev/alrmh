import { View } from 'react-native';
import { router } from 'expo-router';
import { Plus, Ruler } from 'lucide-react-native';
import { useLocale } from '@/i18n';
import { useFamily } from '@/api/hooks';
import { measuredWhere, memberSub, memberTitle } from '@/lib/people';
import { Avatar, Button, Card, Icon, Loading, Text } from '@/ui/primitives';
import { Header, Screen } from '@/ui/layout';
import { colors } from '@/theme/tokens';

export default function Family() {
  const { t, f } = useLocale();
  const family = useFamily();
  return (
    <Screen header={<Header title={t('family.title')} />} contentStyle={{ gap: 12, paddingTop: 8 }}>
      <Text variant="small" color={colors.textSecondary}>
        {t('family.body')}
      </Text>
      {family.isLoading ? <Loading /> : null}
      {(family.data ?? []).map((m) => (
        <Card key={m.id} testID={`family-${m.relation}`} onPress={() => router.push(`/account/member/${m.id}`)} style={{ padding: 16 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 14 }}>
            <Avatar name={m.name} dark={m.relation === 'self'} />
            <View style={{ flex: 1, gap: 2 }}>
              <Text variant="bodyStrong">{memberTitle(m, t)}</Text>
              <Text variant="small" color={colors.textSecondary}>
                {memberSub(m, t)}
              </Text>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                <Icon icon={Ruler} size={13} color={m.measured_at ? colors.textMuted : colors.error} />
                <Text variant="caption" color={m.measured_at ? colors.textMuted : colors.error}>
                  {m.measured_at ? t('design.measuredOn', { date: f.date(m.measured_at), where: measuredWhere(m, t, f) }) : t('family.notMeasured')}
                </Text>
              </View>
            </View>
            {!m.measured_at ? <Button label={t('family.book')} small onPress={() => router.push({ pathname: '/book', params: { mode: 'standalone', memberId: m.id } })} /> : null}
          </View>
        </Card>
      ))}
      <Card dashed onPress={() => router.push('/account/add-member')} style={{ height: 64, alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 10 }}>
        <Icon icon={Plus} size={20} />
        <Text variant="bodyStrong">{t('design.addMember')}</Text>
      </Card>
    </Screen>
  );
}
