import { useEffect, useState } from 'react';
import { ScrollView, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useQueryClient } from '@tanstack/react-query';
import { Info, Star } from 'lucide-react-native';
import { useLocale } from '@/i18n';
import { api } from '@/api/client';
import { useCatalogue, useFamily, useOrder } from '@/api/hooks';
import { errorText } from '@/lib/errors';
import { memberTitle } from '@/lib/people';
import { Button, Card, Chip, Divider, Loading, Note, Pill, Stepper, Text, Touch } from '@/ui/primitives';
import { BottomBar, Header, Screen } from '@/ui/layout';
import { Swatch, ThobeArt } from '@/ui/art';
import { colors, fonts } from '@/theme/tokens';

export default function Reorder() {
  const { orderId } = useLocalSearchParams<{ orderId: string }>();
  const { t, f } = useLocale();
  const qc = useQueryClient();
  const cat = useCatalogue();
  const order = useOrder(orderId);
  const family = useFamily();
  const thobe = order.data?.items.find((i) => i.kind === 'thobe');
  const [fabricId, setFabricId] = useState<string | null>(null);
  const [colourId, setColourId] = useState<string | null>(null);
  const [qty, setQty] = useState(1);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (thobe && !fabricId) {
      setFabricId(thobe.snapshot.thobe.fabric?.id);
      setColourId(thobe.snapshot.thobe.colour?.id);
      setQty(thobe.qty);
    }
  }, [thobe, fabricId]);

  if (order.isLoading || !cat.data) return <Screen header={<Header title={t('again.title')} />}><Loading /></Screen>;
  if (!thobe) return <Screen header={<Header title={t('again.title')} />}><Note>{t('home.orderAgainEmpty')}</Note></Screen>;

  const s = thobe.snapshot;
  const member = family.data?.find((m) => m.id === s.member?.id);
  const fabric = cat.data.fabrics.find((x) => x.id === fabricId);
  const colours = cat.data.colours.filter((c) => fabric?.colour_ids.includes(c.id));
  const colour = cat.data.colours.find((c) => c.id === colourId);
  const pts = cat.data.settings.points.thobe_fixed * qty;

  const add = async () => {
    setBusy(true);
    setError(null);
    try {
      await api('/basket/items', {
        body: { kind: 'thobe', collarId: s.thobe.collar.id, fabricId, colourId, memberId: s.member.id, measureMethod: 'saved', qty, remarks: s.remarks ?? undefined },
      });
      await Promise.all([qc.invalidateQueries({ queryKey: ['basket'] }), qc.invalidateQueries({ queryKey: ['me'] })]);
      router.replace('/basket');
    } catch (e) {
      setError(errorText(t, e));
    } finally {
      setBusy(false);
    }
  };

  const fixed = (label: string, value: string) => (
    <View style={{ flexDirection: 'row', paddingHorizontal: 16, paddingVertical: 13, gap: 12 }}>
      <Text variant="small" color={colors.textSecondary} style={{ width: 104 }}>
        {label}
      </Text>
      <Text variant="smallStrong" style={{ flex: 1 }}>
        {value}
      </Text>
    </View>
  );

  return (
    <Screen
      header={<Header title={t('again.title')} />}
      footer={
        <BottomBar label={`${qty} × ${f.name(fabric)}`} value={f.money((fabric?.price ?? 0) * qty)} sub={`+${pts} ${t('rewards.pts')}`}>
          <Button testID="reorder-add" label={t('review.add')} onPress={add} loading={busy} disabled={!fabricId || !colourId} style={{ minWidth: 170 }} />
        </BottomBar>
      }
      contentStyle={{ gap: 16, paddingTop: 8 }}
    >
      <Text variant="small" color={colors.textSecondary}>
        {t('again.from', { number: f.orderNo(order.data!.number), date: f.date(order.data!.created_at) })}
      </Text>
      <Card>
        <View style={{ flexDirection: 'row', gap: 16, padding: 16, alignItems: 'center' }}>
          <ThobeArt fill={colour?.hex} collar={s.thobe.collar.id} height={90} />
          <View style={{ flex: 1, gap: 4 }}>
            <Text variant="title">{t('review.custom')}</Text>
            <Text variant="small" color={colors.textSecondary}>
              {t('review.forLine', { name: s.member.name, size: t(`size.${member?.size ?? 'adult'}` as any) })}
            </Text>
            <Pill gold icon={Star} label={t('review.earn', { pts })} />
          </View>
        </View>
        <Divider />
        {fixed(t('design.collar'), f.name(s.thobe.collar))}
        <Divider />
        {fixed(t('review.for'), member ? memberTitle(member, t) : s.member.name)}
        <Divider />
        {fixed(t('design.measurements'), member?.measured_at ? t('review.saved', { date: f.date(member.measured_at) }) : t('basket.savedMeasurements'))}
      </Card>

      <Text variant="bodyStrong">{t('design.fabric')}</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
        {cat.data.fabrics.map((x) => (
          <Chip
            key={x.id}
            testID={`refabric-${x.id}`}
            label={f.name(x)}
            selected={fabricId === x.id}
            onPress={() => {
              setFabricId(x.id);
              if (!x.colour_ids.includes(colourId ?? '')) setColourId(x.colour_ids[0]);
            }}
          />
        ))}
      </ScrollView>
      <Text variant="bodyStrong">{t('design.colour')}</Text>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
        {colours.map((c) => (
          <Touch key={c.id} onPress={() => setColourId(c.id)} style={{ alignItems: 'center', width: 72, gap: 4 }}>
            <Swatch hex={c.hex} size={36} selected={colourId === c.id} />
            <Text variant="caption" center style={{ fontFamily: colourId === c.id ? fonts.semibold : fonts.regular }}>
              {f.name(c)}
            </Text>
          </Touch>
        ))}
      </View>
      <Card style={{ padding: 16, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
        <Text variant="bodyStrong">{t('review.quantity')}</Text>
        <Stepper value={qty} onChange={setQty} />
      </Card>
      <Note icon={Info}>{t('again.note')}</Note>
      {error ? <Note tone="error">{error}</Note> : null}
    </Screen>
  );
}
