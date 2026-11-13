import { useEffect } from 'react';
import { View } from 'react-native';
import { router } from 'expo-router';
import { useQueryClient } from '@tanstack/react-query';
import { Bell, CalendarCheck, CalendarClock, Clock, Scissors, Star } from 'lucide-react-native';
import { useLocale } from '@/i18n';
import { api } from '@/api/client';
import { useNotifications } from '@/api/hooks';
import { Card, Divider, EmptyState, IconTile, Loading, Text, Touch } from '@/ui/primitives';
import { Header, Screen } from '@/ui/layout';
import { PushCard } from '@/ui/push';
import { colors } from '@/theme/tokens';

export default function Notifications() {
  const { t, f } = useLocale();
  const qc = useQueryClient();
  const list = useNotifications();

  useEffect(() => {
    if (list.data?.some((n) => !n.read_at)) api('/notifications/read-all', { method: 'POST' }).then(() => qc.invalidateQueries({ queryKey: ['me'] }));
  }, [list.data, qc]);

  const ago = (iso: string) => {
    const h = Math.floor((Date.now() - new Date(iso).getTime()) / 3_600_000);
    if (h < 1) return t('time.now');
    if (h < 24) return t('time.hours', { n: h });
    const d = Math.floor(h / 24);
    if (d === 1) return t('time.yesterday');
    if (d < 7) return t('time.days', { n: d });
    return f.day(iso);
  };

  return (
    <Screen header={<Header title={t('notifications.title')} />} contentStyle={{ paddingTop: 8, gap: 14 }}>
      <PushCard />
      {list.isLoading ? (
        <Loading />
      ) : !list.data?.length ? (
        <EmptyState icon={Bell} title={t('notifications.empty')} />
      ) : (
        <Card>
          {list.data.map((n, i) => (
            <View key={n.id}>
              {i ? <Divider /> : null}
              <Touch onPress={() => n.link && router.push(n.link as any)} style={{ flexDirection: 'row', gap: 14, padding: 16, backgroundColor: n.read_at ? colors.surface : colors.goldSoft }}>
                <IconTile icon={n.kind === 'points' ? (n.title_en.includes('expire') ? Clock : Star) : n.kind === 'appointment' ? CalendarCheck : n.kind === 'reminder' ? CalendarClock : n.kind === 'measurement' ? CalendarCheck : Scissors} gold={n.kind === 'points'} />
                <View style={{ flex: 1, gap: 2 }}>
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 8 }}>
                    <Text variant="bodyStrong" style={{ flex: 1 }}>
                      {f.name(n, 'title')}
                    </Text>
                    <Text variant="caption" color={colors.textMuted}>
                      {ago(n.created_at)}
                    </Text>
                  </View>
                  <Text variant="small" color={colors.textSecondary}>
                    {f.name(n, 'body')}
                  </Text>
                </View>
              </Touch>
            </View>
          ))}
        </Card>
      )}
    </Screen>
  );
}
