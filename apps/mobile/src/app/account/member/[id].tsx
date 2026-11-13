import { View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { Lock, Ruler } from 'lucide-react-native';
import { useLocale } from '@/i18n';
import { useMember } from '@/api/hooks';
import { measuredWhere, memberTitle } from '@/lib/people';
import { Button, Card, Divider, EmptyState, Icon, Loading, Overline, Text, Touch } from '@/ui/primitives';
import { BottomBar, Header, Screen } from '@/ui/layout';
import { colors, radius } from '@/theme/tokens';

const FIELDS = ['length', 'shoulder', 'chest', 'waist', 'sleeve', 'neck', 'cuff'] as const;

export default function MemberScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { t, f } = useLocale();
  const member = useMember(id);
  const m = member.data;
  const latest = m?.latest;

  return (
    <Screen
      header={
        <Header
          title={m ? memberTitle(m, t) : ''}
          right={
            m && m.relation !== 'self' ? (
              <Touch testID="member-edit" onPress={() => router.push({ pathname: '/account/add-member', params: { id } })} hitSlop={10}>
                <Text variant="smallStrong">{t('common.edit')}</Text>
              </Touch>
            ) : m ? (
              <Touch testID="member-edit-self" onPress={() => router.push('/account/profile')} hitSlop={10}>
                <Text variant="smallStrong">{t('common.edit')}</Text>
              </Touch>
            ) : undefined
          }
        />
      }
      footer={
        <BottomBar>
          <Button testID="member-book" label={t('member.bookNew')} icon={Ruler} onPress={() => router.push({ pathname: '/book', params: { mode: 'standalone', memberId: id } })} />
        </BottomBar>
      }
      contentStyle={{ gap: 14, paddingTop: 8 }}
    >
      {!m ? (
        <Loading />
      ) : !latest ? (
        <EmptyState icon={Ruler} title={t('member.none')} body={t('member.noneBody')} />
      ) : (
        <>
          <View style={{ backgroundColor: colors.inverse, borderRadius: radius.xl, padding: 20, gap: 4 }}>
            <Overline color="rgba(255,255,255,0.6)">{t('member.last')}</Overline>
            <Text variant="h2" color={colors.textInverse}>
              {f.date(latest.taken_at)}
            </Text>
            <Text variant="small" color="rgba(255,255,255,0.6)">
              {t('member.by', { where: measuredWhere(latest, t, f), tailor: latest.tailor_name })}
            </Text>
          </View>
          <Card>
            {FIELDS.map((k, i) => (
              <View key={k}>
                {i ? <Divider /> : null}
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 14 }}>
                  <Text variant="body" color={colors.textSecondary}>
                    {t(`member.${k}`)}
                  </Text>
                  <Text variant="bodyStrong">{t('member.cm', { n: Number((latest as any)[`${k}_cm`]) })}</Text>
                </View>
              </View>
            ))}
          </Card>
          {latest.remarks ? (
            <Card style={{ padding: 16, gap: 6 }}>
              <Overline>{t('member.remarks')}</Overline>
              <Text variant="body">{latest.remarks}</Text>
              <Text variant="caption" color={colors.textMuted}>
                {t('member.recorded', { tailor: latest.tailor_name, date: f.date(latest.taken_at) })}
              </Text>
            </Card>
          ) : null}
          <View style={{ flexDirection: 'row', gap: 10, backgroundColor: colors.subtle, borderRadius: radius.md, padding: 14 }}>
            <Icon icon={Lock} size={16} color={colors.textSecondary} />
            <Text variant="small" color={colors.textSecondary} style={{ flex: 1 }}>
              {t('member.readonly')}
            </Text>
          </View>
        </>
      )}
    </Screen>
  );
}
