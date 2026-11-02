import { useState } from 'react';
import { View } from 'react-native';
import { router } from 'expo-router';
import { useQueryClient } from '@tanstack/react-query';
import { Clock, Star } from 'lucide-react-native';
import { useLocale } from '@/i18n';
import { api } from '@/api/client';
import { useBuilder } from '@/state/builder';
import { useCatalogue, useFamily } from '@/api/hooks';
import { errorText } from '@/lib/errors';
import { memberTitle } from '@/lib/people';
import { Button, Card, Divider, Icon, Note, Pill, Stepper, Text, Touch } from '@/ui/primitives';
import { BottomBar, Header, Screen } from '@/ui/layout';
import { ThobeArt } from '@/ui/art';
import { useDesignData } from '@/ui/design';
import { colors } from '@/theme/tokens';

export default function Review() {
  const { t, f } = useLocale();
  const qc = useQueryClient();
  const { state, set, reset } = useBuilder();
  const { collar, fabric, colour } = useDesignData();
  const cat = useCatalogue();
  const family = useFamily();
  const member = family.data?.find((m) => m.id === state.memberId);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const unit = fabric?.price ?? 0;
  const fee = state.method === 'home' ? (cat.data?.settings.home_visit_fee ?? 0) : 0;
  const subtotal = unit * state.qty + fee;
  const pts = (cat.data?.settings.points.thobe_fixed ?? 0) * state.qty;
  const measureText =
    state.method === 'saved' && member?.measured_at
      ? t('review.saved', { date: f.date(member.measured_at) })
      : state.appointment
        ? t(state.appointment.kind === 'home' ? 'review.homeVisitWhen' : 'review.branchVisit', { when: f.when(state.appointment.startsAt) })
        : '—';

  const rows: [string, string, string][] = [
    [t('design.collar'), f.name(collar), '/design/collar'],
    [t('design.fabric'), f.name(fabric), '/design/fabric'],
    [t('design.colour'), f.name(colour), '/design/colour'],
    [t('review.for'), member ? memberTitle(member, t) : '—', '/design/for-whom'],
    [t('design.measurements'), measureText, '/design/measure'],
    [t('review.remarks'), state.remarks.trim() || t('review.none'), '/design/measure'],
  ];

  const add = async () => {
    setBusy(true);
    setError(null);
    try {
      await api('/basket/items', {
        body: {
          kind: 'thobe',
          collarId: state.collarId,
          fabricId: state.fabricId,
          colourId: state.colourId,
          memberId: state.memberId,
          measureMethod: state.method,
          appointmentId: state.appointment?.id,
          remarks: state.remarks.trim() || undefined,
          qty: state.qty,
        },
      });
      await Promise.all([qc.invalidateQueries({ queryKey: ['basket'] }), qc.invalidateQueries({ queryKey: ['me'] })]);
      reset();
      router.dismissAll?.();
      router.replace('/basket');
    } catch (e) {
      setError(errorText(t, e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen
      header={<Header title={t('review.title')} />}
      footer={
        <BottomBar label={state.qty === 1 ? t('review.thobe1') : state.qty === 2 ? t('review.thobes2') : t('review.thobes', { n: state.qty })} value={f.money(subtotal)} sub={`+${pts} ${t('rewards.pts')}`}>
          <Button testID="review-add" label={t('review.add')} onPress={add} loading={busy} style={{ minWidth: 180 }} />
        </BottomBar>
      }
      contentStyle={{ gap: 14, paddingTop: 8 }}
    >
      <Card>
        <View style={{ flexDirection: 'row', gap: 16, padding: 16, alignItems: 'center' }}>
          <ThobeArt fill={colour?.hex} collar={state.collarId ?? undefined} height={90} />
          <View style={{ flex: 1, gap: 4 }}>
            <Text variant="title">{t('review.custom')}</Text>
            {member ? (
              <Text variant="small" color={colors.textSecondary}>
                {t('review.forLine', { name: member.name, size: t(`size.${member.size}` as any) })}
              </Text>
            ) : null}
            <Pill gold icon={Star} label={t('review.earn', { pts })} />
          </View>
        </View>
        {rows.map(([label, value, path]) => (
          <View key={label}>
            <Divider />
            <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 13, gap: 12 }}>
              <Text variant="small" color={colors.textSecondary} style={{ width: 104 }}>
                {label}
              </Text>
              <Text variant="smallStrong" style={{ flex: 1 }}>
                {value}
              </Text>
              <Touch onPress={() => router.push(path as any)} hitSlop={8}>
                <Text variant="small" color={colors.textSecondary}>
                  {t('common.edit')}
                </Text>
              </Touch>
            </View>
          </View>
        ))}
      </Card>
      <Card style={{ padding: 16, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
        <Text variant="bodyStrong">{t('review.quantity')}</Text>
        <Stepper value={state.qty} onChange={(qty) => set({ qty })} />
      </Card>
      <Card style={{ padding: 16, gap: 10 }}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
          <Text variant="body" color={colors.textSecondary}>
            {t('review.thobeTimes', { n: state.qty })}
          </Text>
          <Text variant="bodyStrong">{f.money(unit * state.qty)}</Text>
        </View>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
          <Text variant="body" color={colors.textSecondary}>
            {state.method === 'home' ? t('review.homeVisit') : t('review.measurement')}
          </Text>
          <Text variant="bodyStrong">{fee ? f.money(fee) : t('common.free')}</Text>
        </View>
        <Divider />
        <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
          <Text variant="bodyStrong">{t('review.subtotal')}</Text>
          <Text variant="price">{f.money(subtotal)}</Text>
        </View>
      </Card>
      <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
        <Icon icon={Clock} size={16} color={colors.textMuted} />
        <Text variant="small" color={colors.textMuted}>
          {t('review.ready', { days: cat.data?.settings.lead_working_days ?? 7 })}
        </Text>
      </View>
      {error ? <Note tone="error">{error}</Note> : null}
    </Screen>
  );
}
