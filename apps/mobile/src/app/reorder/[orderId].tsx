import { useEffect, useState } from 'react';
import { ScrollView, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useQueryClient } from '@tanstack/react-query';
import { Info, Pencil, Star } from 'lucide-react-native';
import { useLocale } from '@/i18n';
import { api } from '@/api/client';
import { useCatalogue, useFamily, useOrder, usePointRates } from '@/api/hooks';
import { errorText } from '@/lib/errors';
import { Button, Card, Chip, Divider, Loading, Note, Pill, Stepper, Text, Touch } from '@/ui/primitives';
import { BottomBar, Header, Screen } from '@/ui/layout';
import { ThobeArt } from '@/ui/art';
import { colors } from '@/theme/tokens';

type Line = { key: string; memberId: string; memberName: string; collarId: string; fabricId: string; colourId: string | null; qty: number; editing: boolean };

/**
 * Repeat a past order. Each thobe keeps the person's saved measurements; the
 * customer sets how many, and can change the type (collar) and the cloth.
 * There is no colour choice here.
 */
export default function Reorder() {
  const { orderId } = useLocalSearchParams<{ orderId: string }>();
  const { t, f } = useLocale();
  const qc = useQueryClient();
  const cat = useCatalogue();
  const order = useOrder(orderId);
  const family = useFamily();
  const rates = usePointRates();
  const [lines, setLines] = useState<Line[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (order.data && !lines)
      setLines(
        order.data.items
          .filter((i) => i.kind === 'thobe')
          .map((i) => ({
            key: i.id,
            memberId: i.snapshot.member?.id,
            memberName: i.snapshot.member?.name ?? '',
            collarId: i.snapshot.thobe.collar?.id,
            fabricId: i.snapshot.thobe.fabric?.id,
            colourId: i.snapshot.thobe.colour?.id ?? null,
            qty: i.qty,
            editing: false,
          })),
      );
  }, [order.data, lines]);

  if (order.isLoading || !cat.data || (order.data && !lines)) return <Screen header={<Header title={t('again.title')} />}><Loading /></Screen>;
  if (!order.data || !lines?.length) return <Screen header={<Header title={t('again.title')} />}><Note>{t('home.orderAgainEmpty')}</Note></Screen>;

  const update = (key: string, patch: Partial<Line>) => setLines((ls) => ls!.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  const fabricOf = (l: Line) => cat.data!.fabrics.find((x) => x.id === l.fabricId);
  const collarOf = (l: Line) => cat.data!.collars.find((x) => x.id === l.collarId);
  const chosen = lines.filter((l) => l.qty > 0);
  const count = chosen.reduce((a, l) => a + l.qty, 0);
  const total = chosen.reduce((a, l) => a + (fabricOf(l)?.price ?? 0) * l.qty, 0);
  const pts = (rates?.points_per_thobe ?? 0) * count;
  const unavailable = chosen.some((l) => !fabricOf(l) || !collarOf(l));

  const place = async () => {
    setBusy(true);
    setError(null);
    try {
      for (const l of chosen) {
        // The original colour goes with it only when the cloth is unchanged and still offers it.
        const keepColour = l.colourId && fabricOf(l)?.colour_ids.includes(l.colourId) ? l.colourId : undefined;
        await api('/basket/items', { body: { kind: 'thobe', collarId: l.collarId, fabricId: l.fabricId, colourId: keepColour, memberId: l.memberId, measureMethod: 'saved', qty: l.qty } });
      }
      await Promise.all([qc.invalidateQueries({ queryKey: ['basket'] }), qc.invalidateQueries({ queryKey: ['me'] })]);
      router.replace('/checkout');
    } catch (e) {
      setError(errorText(t, e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen
      header={<Header title={t('again.title')} />}
      footer={
        <BottomBar label={count === 1 ? t('again.one') : t('again.count', { n: count })} value={f.money(total)} sub={`+${pts} ${t('rewards.pts')}`}>
          <Button testID="reorder-place" label={t('again.place')} onPress={place} loading={busy} disabled={!count || unavailable} style={{ minWidth: 170 }} />
        </BottomBar>
      }
      contentStyle={{ gap: 16, paddingTop: 8 }}
    >
      <Text variant="small" color={colors.textSecondary}>
        {t('again.from', { number: f.orderNo(order.data.number), date: f.date(order.data.created_at) })}
      </Text>

      {lines.map((l, idx) => {
        const fabric = fabricOf(l);
        const collar = collarOf(l);
        const member = family.data?.find((m) => m.id === l.memberId);
        return (
          <Card key={l.key} testID={`reorder-line-${idx}`}>
            <View style={{ flexDirection: 'row', gap: 16, padding: 16, alignItems: 'center' }}>
              <ThobeArt fill={cat.data!.colours.find((c) => c.id === l.colourId)?.hex} collar={collar?.shape ?? l.collarId} height={84} />
              <View style={{ flex: 1, gap: 4 }}>
                <Text variant="title">{collar ? f.name(collar) : t('again.unavailable')}</Text>
                <Text variant="small" color={colors.textSecondary}>
                  {fabric ? `${f.name(fabric)} · ${f.money(fabric.price)}` : t('again.unavailable')}
                </Text>
                <Text variant="small" color={colors.textSecondary}>
                  {t('again.forLine', { name: member?.name ?? l.memberName, date: member?.measured_at ? f.date(member.measured_at) : '—' })}
                </Text>
              </View>
            </View>
            <Divider />
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 12 }}>
              <Touch testID={`reorder-edit-${idx}`} accessibilityRole="button" onPress={() => update(l.key, { editing: !l.editing })} style={{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 6 }}>
                <Pencil size={16} color={colors.text} />
                <Text variant="smallStrong">{l.editing ? t('common.done') : t('again.edit')}</Text>
              </Touch>
              <Stepper value={l.qty} onChange={(n) => update(l.key, { qty: n })} min={lines.length > 1 ? 0 : 1} />
            </View>
            {l.editing ? (
              <>
                <Divider />
                <View style={{ padding: 16, gap: 10 }}>
                  <Text variant="smallStrong">{t('again.type')}</Text>
                  <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
                    {cat.data!.collars.map((c) => (
                      <Chip key={c.id} testID={`retype-${idx}-${c.id}`} label={f.name(c)} selected={l.collarId === c.id} onPress={() => update(l.key, { collarId: c.id })} />
                    ))}
                  </ScrollView>
                  <Text variant="smallStrong" style={{ marginTop: 4 }}>
                    {t('again.cloth')}
                  </Text>
                  <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
                    {cat.data!.fabrics.map((x) => (
                      <Chip key={x.id} testID={`refabric-${idx}-${x.id}`} label={`${f.name(x)} · ${f.money(x.price)}`} selected={l.fabricId === x.id} onPress={() => update(l.key, { fabricId: x.id })} />
                    ))}
                  </ScrollView>
                </View>
              </>
            ) : null}
          </Card>
        );
      })}

      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <Pill gold icon={Star} label={t('review.earn', { pts })} />
      </View>
      <Note icon={Info}>{t('again.note')}</Note>
      {error ? <Note tone="error">{error}</Note> : null}
    </Screen>
  );
}
