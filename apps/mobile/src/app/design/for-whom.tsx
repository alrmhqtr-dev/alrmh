import { useEffect, useState } from 'react';
import { View } from 'react-native';
import { router } from 'expo-router';
import { Plus, Ruler } from 'lucide-react-native';
import { useLocale } from '@/i18n';
import { useBuilder } from '@/state/builder';
import { useSession } from '@/state/session';
import { useFamily } from '@/api/hooks';
import { measuredWhere, memberSub, memberTitle } from '@/lib/people';
import { Avatar, Card, Icon, Loading, Radio, Text } from '@/ui/primitives';
import { SignInGate } from '@/ui/gate';
import { DesignStep, useDesignData } from '@/ui/design';
import { colors } from '@/theme/tokens';

export default function ForWhomStep() {
  const { t, f } = useLocale();
  const { signedIn } = useSession();
  const { state, set } = useBuilder();
  const { fabric } = useDesignData();
  const family = useFamily();
  const [gate, setGate] = useState(!signedIn);

  useEffect(() => {
    if (!state.memberId && family.data?.length) set({ memberId: family.data[0].id });
  }, [family.data, state.memberId, set]);

  const chosen = family.data?.find((m) => m.id === state.memberId);

  return (
    <DesignStep
      step={4}
      label={t('design.forWhom')}
      preview={false}
      priceLabel={chosen ? t('design.forName', { name: chosen.name }) : f.name(fabric)}
      price={f.money(fabric?.price ?? 0)}
      nextLabel={t('design.next', { step: t('design.measurements') })}
      onNext={() => (signedIn ? router.push('/design/measure') : setGate(true))}
      nextDisabled={signedIn && !state.memberId}
    >
      <View style={{ gap: 4 }}>
        <Text variant="h2">{t('design.whoFor')}</Text>
        <Text variant="small" color={colors.textSecondary}>
          {t('design.whoForBody')}
        </Text>
      </View>
      {signedIn && family.isLoading ? <Loading /> : null}
      <View style={{ gap: 10 }}>
        {(family.data ?? []).map((m) => {
          const on = state.memberId === m.id;
          return (
            <Card
              key={m.id}
              testID={`member-${m.relation}`}
              selected={on}
              onPress={() => set({ memberId: m.id, method: null, appointment: null })}
              style={{ padding: 16 }}
            >
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 14 }}>
                <Avatar name={m.name} dark={on} />
                <View style={{ flex: 1, gap: 2 }}>
                  <Text variant="bodyStrong">{memberTitle(m, t)}</Text>
                  <Text variant="small" color={colors.textSecondary}>
                    {memberSub(m, t)}
                  </Text>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                    <Icon icon={Ruler} size={13} color={m.measured_at ? colors.textMuted : colors.error} />
                    <Text variant="caption" color={m.measured_at ? colors.textMuted : colors.error}>
                      {m.measured_at ? t('design.measuredOn', { date: f.date(m.measured_at), where: measuredWhere(m, t, f) }) : t('design.noMeasurements')}
                    </Text>
                  </View>
                </View>
                <Radio on={on} />
              </View>
            </Card>
          );
        })}
        <Card dashed testID="add-member" onPress={() => (signedIn ? router.push('/account/add-member?return=builder') : setGate(true))} style={{ height: 64, alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 10 }}>
          <Icon icon={Plus} size={20} />
          <Text variant="bodyStrong">{t('design.addMember')}</Text>
        </Card>
      </View>
      <SignInGate visible={gate && !signedIn} onClose={() => setGate(false)} returnTo="/design/for-whom" />
    </DesignStep>
  );
}
