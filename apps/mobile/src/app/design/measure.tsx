import { useEffect } from 'react';
import { View } from 'react-native';
import { router } from 'expo-router';
import { CalendarCheck, Info, MapPin, Ruler, Store } from 'lucide-react-native';
import { useLocale } from '@/i18n';
import { useBuilder, type MeasureMethod } from '@/state/builder';
import { useCatalogue, useFamily } from '@/api/hooks';
import { measuredWhere } from '@/lib/people';
import { Card, Field, Icon, IconTile, Note, Pill, Radio, Text, Touch } from '@/ui/primitives';
import { DesignStep, useDesignData } from '@/ui/design';
import { colors } from '@/theme/tokens';

export default function MeasureStep() {
  const { t, f } = useLocale();
  const { state, set } = useBuilder();
  const { fabric } = useDesignData();
  const cat = useCatalogue();
  const family = useFamily();
  const member = family.data?.find((m) => m.id === state.memberId);
  const branch = cat.data?.branches[0];
  const manyBranches = (cat.data?.branches.length ?? 0) > 1;
  const fee = cat.data?.settings.home_visit_fee ?? 50;
  const hasSaved = Boolean(member?.measured_at);

  useEffect(() => {
    if (member && !state.method && hasSaved) set({ method: 'saved' });
  }, [member, hasSaved, state.method, set]);

  const choose = (method: MeasureMethod) => {
    if (method === 'saved') return set({ method, appointment: null });
    if (state.appointment?.kind === method) return set({ method });
    router.push({ pathname: '/book', params: { kind: method, memberId: state.memberId ?? '', mode: 'builder' } });
  };

  const ready = state.method === 'saved' ? hasSaved : Boolean(state.method && state.appointment?.kind === state.method);

  const option = (method: MeasureMethod, icon: any, title: string, body: string, pill: string, extra?: React.ReactNode) => {
    const on = state.method === method;
    const disabled = method === 'saved' && !hasSaved;
    return (
      <Card testID={`measure-${method}`} selected={on} disabled={disabled} onPress={() => choose(method)} style={{ padding: 16, gap: 12, opacity: disabled ? 0.5 : 1 }}>
        <View style={{ flexDirection: 'row', gap: 14, alignItems: 'flex-start' }}>
          <IconTile icon={icon} dark={on} />
          <View style={{ flex: 1, gap: 2 }}>
            <Text variant="bodyStrong">{title}</Text>
            <Text variant="small" color={colors.textSecondary}>
              {body}
            </Text>
          </View>
          <Radio on={on} />
        </View>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
          <Pill label={pill} dark={method === 'home'} />
          {extra}
        </View>
        {state.appointment && state.appointment.kind === method ? (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <Icon icon={CalendarCheck} size={16} color={colors.goldInk} />
            <Text variant="smallStrong" color={colors.goldInk} style={{ flex: 1 }}>
              {t('design.bookedFor', { when: f.when(state.appointment.startsAt) })}
            </Text>
            <Touch onPress={() => router.push({ pathname: '/book', params: { kind: method, memberId: state.memberId ?? '', mode: 'builder' } })}>
              <Text variant="smallStrong">{t('common.change')}</Text>
            </Touch>
          </View>
        ) : null}
      </Card>
    );
  };

  return (
    <DesignStep
      step={5}
      label={t('design.measurements')}
      preview={false}
      priceLabel={state.method === 'saved' ? t('basket.savedMeasurements') : f.name(fabric)}
      price={f.money(fabric?.price ?? 0)}
      nextLabel={t('design.review')}
      onNext={() => router.push('/design/review')}
      nextDisabled={!ready}
      testID="measure-next"
    >
      <Text variant="h2">{t('design.howMeasure', { name: member?.name ?? '' })}</Text>
      <View style={{ gap: 12 }}>
        {option(
          'saved',
          Ruler,
          t('design.useSaved'),
          hasSaved ? t('design.useSavedBody', { date: f.date(member!.measured_at!), where: measuredWhere(member!, t, f) }) : t('design.noMeasurements'),
          t('common.free'),
          hasSaved ? (
            <Touch onPress={() => router.push(`/account/member/${member!.id}`)}>
              <Text variant="smallStrong">{t('design.viewMeasurements')}</Text>
            </Touch>
          ) : null,
        )}
        {option('branch', Store, t('design.visitBranch'), t(manyBranches ? 'design.visitBranchBodyAny' : 'design.visitBranchBody', { branch: f.name(branch) }), t('common.free'))}
        {option('home', MapPin, t('design.homeVisit'), t('design.homeVisitBody'), `+ ${f.money(fee)}`)}
      </View>
      {member?.measurement_stale ? <Note icon={Info} tone="gold">{t('design.stale', { months: cat.data?.settings.measurements_valid_months ?? 12 })}</Note> : null}
      <Field
        testID="remarks"
        label={t('design.remarks')}
        right={t('common.optional')}
        value={state.remarks}
        onChangeText={(v) => set({ remarks: v.slice(0, 200) })}
        placeholder={t('design.remarksPh')}
        multiline
        maxLength={200}
        counter={`${state.remarks.length} / 200`}
        hint={t('design.remarksHint')}
      />
      <Note icon={Info}>{t('design.sizeChanged')}</Note>
    </DesignStep>
  );
}
