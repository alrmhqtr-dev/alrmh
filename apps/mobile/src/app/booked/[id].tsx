import { useEffect } from 'react';
import { View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useQueryClient } from '@tanstack/react-query';
import { CalendarCheck, CreditCard, Ruler, Scissors, Truck } from 'lucide-react-native';
import { useLocale } from '@/i18n';
import { useAppointments } from '@/api/hooks';
import { Button, Card, Divider, Icon, Loading, Text } from '@/ui/primitives';
import { BottomBar, Header, Screen } from '@/ui/layout';
import { colors } from '@/theme/tokens';

/** Where the customer lands after paying the booking fee for a new order. */
export default function Booked() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { t, f } = useLocale();
  const qc = useQueryClient();
  const appts = useAppointments();
  const a = appts.data?.find((x) => x.id === id);

  useEffect(() => {
    qc.invalidateQueries();
  }, [qc]);

  const steps = [
    { icon: Ruler, text: t('booked.step1') },
    { icon: Scissors, text: t('booked.step2') },
    { icon: CreditCard, text: t('booked.step3') },
    { icon: Truck, text: t('booked.step4') },
  ];

  return (
    <Screen
      header={<Header back={false} />}
      footer={
        <BottomBar>
          <View style={{ gap: 8 }}>
            <Button testID="booked-orders" label={t('booked.viewOrders')} onPress={() => router.replace('/orders')} />
            <Button label={t('placed.home')} kind="ghost" onPress={() => router.replace('/home')} />
          </View>
        </BottomBar>
      }
      contentStyle={{ gap: 20, paddingTop: 12 }}
    >
      <View style={{ alignItems: 'center', gap: 10 }}>
        <View style={{ width: 72, height: 72, borderRadius: 36, backgroundColor: colors.inverse, alignItems: 'center', justifyContent: 'center' }}>
          <Icon icon={CalendarCheck} size={32} color={colors.textInverse} />
        </View>
        <Text testID="booked-title" variant="h1" center>
          {t('booked.title')}
        </Text>
        {appts.isLoading ? (
          <Loading />
        ) : a ? (
          <Text variant="body" color={colors.textSecondary} center>
            {`${f.when(a.starts_at)} · ${a.kind === 'home' ? t('design.homeVisit') : f.name(a, 'branch_name')}`}
          </Text>
        ) : null}
        {a?.fee ? (
          <Text variant="small" color={colors.textSecondary} center>
            {t('booked.paid', { amount: f.money(a.fee, true) })}
          </Text>
        ) : null}
      </View>

      <Card>
        <View style={{ padding: 16 }}>
          <Text variant="bodyStrong">{t('booked.next')}</Text>
        </View>
        {steps.map((s, i) => (
          <View key={i}>
            <Divider />
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 14, padding: 16 }}>
              <Icon icon={s.icon} size={20} />
              <Text variant="body" style={{ flex: 1 }}>
                {s.text}
              </Text>
            </View>
          </View>
        ))}
      </Card>
    </Screen>
  );
}
