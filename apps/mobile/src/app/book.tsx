import { useEffect, useMemo, useState } from 'react';
import { ScrollView, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useQueryClient } from '@tanstack/react-query';
import { CalendarCheck, Info, MapPin, Plus, Store } from 'lucide-react-native';
import { useLocale } from '@/i18n';
import { api } from '@/api/client';
import { useAddresses, useCatalogue, useFamily, useSlots } from '@/api/hooks';
import { useBuilder } from '@/state/builder';
import { errorText } from '@/lib/errors';
import { memberTitle } from '@/lib/people';
import { Button, Card, Chip, EmptyState, IconTile, Loading, Note, Radio, Text, Touch } from '@/ui/primitives';
import { BottomBar, Header, Screen, Sheet, goBack } from '@/ui/layout';
import { colors, radius } from '@/theme/tokens';

export default function Book() {
  const params = useLocalSearchParams<{ kind?: string; memberId?: string; mode?: string; appointmentId?: string; standalone?: string; startsAt?: string; branchId?: string }>();
  const mode = params.mode ?? (params.standalone ? 'standalone' : 'builder');
  const { t, f } = useLocale();
  const qc = useQueryClient();
  const builder = useBuilder();
  const cat = useCatalogue();
  const family = useFamily();
  const addresses = useAddresses();
  const [kind, setKind] = useState<'branch' | 'home'>(params.kind === 'home' ? 'home' : 'branch');
  const [memberId, setMemberId] = useState<string | undefined>(params.memberId || undefined);
  const branches = cat.data?.branches ?? [];
  const [branchId, setBranchId] = useState<string | undefined>(params.branchId || undefined);
  // A visit being rescheduled stays at its branch; otherwise the customer picks one when there are several.
  const branch = branches.find((b) => b.id === branchId) ?? branches[0];
  const canPickBranch = branches.length > 1 && mode !== 'reschedule';
  const [addressId, setAddressId] = useState<string | null>(null);
  const [pickAddress, setPickAddress] = useState(false);
  const slots = useSlots(kind, branch?.id);
  const [date, setDate] = useState<string | null>(null);
  const [time, setTime] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  useEffect(() => {
    if (!memberId && family.data?.length) setMemberId(family.data[0].id);
  }, [family.data, memberId]);
  useEffect(() => {
    if (!addressId && addresses.data?.length) setAddressId((addresses.data.find((a) => a.is_default) ?? addresses.data[0]).id);
  }, [addresses.data, addressId]);
  useEffect(() => {
    const first = slots.data?.days.find((d) => d.available);
    if (first && (!date || !slots.data?.days.some((d) => d.date === date))) setDate(first.date);
    setTime(null);
  }, [slots.data]); // eslint-disable-line react-hooks/exhaustive-deps

  const day = useMemo(() => slots.data?.days.find((d) => d.date === date), [slots.data, date]);
  const address = addresses.data?.find((a) => a.id === addressId);
  const fee = cat.data?.settings.home_visit_fee ?? 50;

  const confirm = async () => {
    if (!time) return;
    setBusy(true);
    setError(null);
    try {
      if (mode === 'reschedule' && params.appointmentId) {
        await api(`/appointments/${params.appointmentId}`, { method: 'PATCH', body: { startsAt: time } });
        await qc.invalidateQueries();
        return goBack('/orders');
      }
      const appt = await api<{ id: string; kind: 'branch' | 'home'; starts_at: string }>('/appointments', {
        body: { kind, branchId: kind === 'branch' ? branch?.id : undefined, addressId: kind === 'home' ? addressId : undefined, memberId, startsAt: time, standalone: mode === 'standalone' },
      });
      if (mode === 'builder') {
        builder.set({ method: kind, appointment: { id: appt.id, kind, startsAt: appt.starts_at } });
        return goBack('/design/measure');
      }
      await qc.invalidateQueries();
      setDone(appt.starts_at);
    } catch (e) {
      setError(errorText(t, e, 'book'));
      qc.invalidateQueries({ queryKey: ['slots'] });
    } finally {
      setBusy(false);
    }
  };

  if (done)
    return (
      <Screen header={<Header back={false} />} footer={<BottomBar><Button label={t('placed.home')} onPress={() => router.replace('/home')} /></BottomBar>}>
        <EmptyState icon={CalendarCheck} title={t('book.booked')} body={f.when(done)} />
      </Screen>
    );

  return (
    <Screen
      header={<Header title={kind === 'home' ? t('book.homeTitle') : t('book.branchTitle')} />}
      footer={
        <BottomBar>
          <Button testID="book-confirm" label={time ? t('book.confirm', { when: f.when(time) }) : t('book.pickTime')} disabled={!time || (kind === 'home' && !addressId)} loading={busy} onPress={confirm} />
        </BottomBar>
      }
      contentStyle={{ gap: 22, paddingTop: 8 }}
    >
      {mode === 'standalone' ? (
        <View style={{ gap: 10 }}>
          <View style={{ flexDirection: 'row', gap: 8 }}>
            <Chip testID="kind-branch" icon={Store} label={t('design.visitBranch')} selected={kind === 'branch'} onPress={() => setKind('branch')} />
            <Chip testID="kind-home" icon={MapPin} label={t('design.homeVisit')} selected={kind === 'home'} onPress={() => setKind('home')} />
          </View>
          <Text variant="bodyStrong" style={{ marginTop: 6 }}>
            {t('book.who')}
          </Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
            {(family.data ?? []).map((m) => (
              <Chip key={m.id} label={memberTitle(m, t)} selected={memberId === m.id} onPress={() => setMemberId(m.id)} />
            ))}
          </View>
        </View>
      ) : null}

      <View style={{ gap: 10 }}>
        <Text variant="bodyStrong">{kind === 'home' ? t('book.home') : t('book.branch')}</Text>
        {kind === 'branch' ? (
          (canPickBranch ? branches : branch ? [branch] : []).map((b) => {
            const on = b.id === branch?.id;
            return (
              <Card
                key={b.id}
                testID={`branch-${b.id}`}
                selected={on}
                onPress={canPickBranch ? () => { setBranchId(b.id); setDate(null); setTime(null); } : undefined}
                style={{ padding: 14, flexDirection: 'row', alignItems: 'center', gap: 14 }}
              >
                <IconTile icon={Store} dark={on && canPickBranch} />
                <View style={{ flex: 1 }}>
                  <Text variant="bodyStrong">{f.name(b)}</Text>
                  <Text variant="small" color={colors.textSecondary}>
                    {f.name(b, 'address')}
                  </Text>
                </View>
                {canPickBranch ? <Radio on={on} /> : null}
              </Card>
            );
          })
        ) : address ? (
          <Card selected style={{ padding: 14, flexDirection: 'row', alignItems: 'center', gap: 14 }}>
            <IconTile icon={MapPin} />
            <View style={{ flex: 1 }}>
              <Text variant="bodyStrong">{address.label}</Text>
              <Text variant="small" color={colors.textSecondary}>
                {`${address.line1}, ${address.area}`}
              </Text>
            </View>
            <Touch onPress={() => setPickAddress(true)}>
              <Text variant="smallStrong">{t('common.change')}</Text>
            </Touch>
          </Card>
        ) : addresses.isLoading ? (
          <Loading />
        ) : (
          <Button label={t('book.addAddress')} kind="secondary" icon={Plus} onPress={() => router.push('/account/add-address')} />
        )}
      </View>

      <View style={{ gap: 10 }}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
          <Text variant="bodyStrong">{t('book.pickDate')}</Text>
          {date ? <Text variant="smallStrong">{f.monthYear(date)}</Text> : null}
        </View>
        {slots.isLoading ? (
          <Loading />
        ) : (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
            {(slots.data?.days ?? []).map((d) => {
              const on = d.date === date;
              return (
                <Touch
                  key={d.date}
                  testID={`date-${d.date}`}
                  disabled={!d.available}
                  onPress={() => {
                    setDate(d.date);
                    setTime(null);
                  }}
                  style={{
                    width: 64,
                    height: 66,
                    borderRadius: radius.md,
                    borderWidth: 1,
                    borderColor: on ? colors.inverse : colors.border,
                    backgroundColor: on ? colors.inverse : colors.surface,
                    alignItems: 'center',
                    justifyContent: 'center',
                    opacity: d.available ? 1 : 0.4,
                  }}
                >
                  <Text variant="caption" color={on ? 'rgba(255,255,255,0.7)' : colors.textMuted} center>
                    {f.weekdayShort(d.date)}
                  </Text>
                  <Text variant="h2" color={on ? colors.textInverse : colors.text} center>
                    {String(f.dayNum(d.date))}
                  </Text>
                </Touch>
              );
            })}
          </ScrollView>
        )}
        {slots.data?.closedWeekdays.length ? (
          <Text variant="caption" color={colors.textMuted}>
            {t('book.closedDays', { days: f.closedDays(slots.data.closedWeekdays) })}
          </Text>
        ) : null}
      </View>

      {day ? (
        <View style={{ gap: 10 }}>
          <Text variant="bodyStrong">{t('book.times')}</Text>
          {day.times.some((x) => x.available) ? (
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
              {day.times.map((slot) => {
                const on = slot.startsAt === time;
                return (
                  <Touch
                    key={slot.startsAt}
                    testID={`time-${slot.minute}`}
                    disabled={!slot.available}
                    onPress={() => setTime(slot.startsAt)}
                    style={{
                      width: '31.5%',
                      height: 46,
                      borderRadius: radius.md,
                      borderWidth: 1,
                      borderColor: on ? colors.inverse : colors.border,
                      backgroundColor: on ? colors.inverse : slot.available ? colors.surface : colors.subtle,
                      alignItems: 'center',
                      justifyContent: 'center',
                    }}
                  >
                    <Text
                      variant="smallStrong"
                      color={on ? colors.textInverse : slot.available ? colors.text : colors.textMuted}
                      style={slot.available ? undefined : { textDecorationLine: 'line-through' }}
                      center
                    >
                      {f.time(slot.startsAt)}
                    </Text>
                  </Touch>
                );
              })}
            </View>
          ) : (
            <Note>{t('book.noTimes')}</Note>
          )}
        </View>
      ) : null}

      {kind === 'home' ? <Note icon={Info} tone="gold">{mode === 'standalone' ? t('book.homeFeeStandalone', { fee }) : t('book.homeFee', { fee })}</Note> : null}
      {error ? <Note tone="error">{error}</Note> : null}

      <Sheet visible={pickAddress} onClose={() => setPickAddress(false)}>
        <View style={{ gap: 10 }}>
          {(addresses.data ?? []).map((a) => (
            <Card
              key={a.id}
              selected={a.id === addressId}
              onPress={() => {
                setAddressId(a.id);
                setPickAddress(false);
              }}
              style={{ padding: 14, flexDirection: 'row', alignItems: 'center', gap: 12 }}
            >
              <View style={{ flex: 1 }}>
                <Text variant="bodyStrong">{a.label}</Text>
                <Text variant="small" color={colors.textSecondary}>{`${a.line1}, ${a.area}`}</Text>
              </View>
              <Radio on={a.id === addressId} />
            </Card>
          ))}
          <Button
            label={t('addresses.add')}
            kind="secondary"
            icon={Plus}
            onPress={() => {
              setPickAddress(false);
              router.push('/account/add-address');
            }}
          />
        </View>
      </Sheet>
    </Screen>
  );
}
