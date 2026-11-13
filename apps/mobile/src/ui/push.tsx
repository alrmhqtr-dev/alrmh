import { useCallback, useEffect, useState } from 'react';
import { View } from 'react-native';
import { router } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { BellRing, Share } from 'lucide-react-native';
import { useLocale } from '@/i18n';
import { api } from '@/api/client';
import { disablePush, enablePush, pushState, type PushState } from '@/lib/push';
import { Button, Card, IconTile, Note, Text } from './primitives';
import { colors } from '@/theme/tokens';

/**
 * Turn notifications on or off for this phone.
 * `compact` is the prompt after an order: shown only while they could be turned on.
 */
export function PushCard({ compact }: { compact?: boolean }) {
  const { t } = useLocale();
  const key = useQuery({ queryKey: ['push-key'], queryFn: () => api<{ key: string | null }>('/push/key', { auth: false }), staleTime: 60 * 60_000 });
  const [state, setState] = useState<PushState | null>(null);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  const refresh = useCallback(() => {
    pushState().then(setState).catch(() => setState('unsupported'));
  }, []);
  useEffect(refresh, [refresh]);

  if (!key.data?.key || !state || state === 'unsupported') return null;
  if (compact && state !== 'off' && state !== 'install') return null;

  const toggle = async () => {
    setBusy(true);
    setFailed(false);
    try {
      setState(state === 'on' ? await disablePush() : await enablePush(key.data!.key!));
    } catch {
      setFailed(true);
      refresh();
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card testID="push-card" style={{ padding: 16, gap: 12 }}>
      <View style={{ flexDirection: 'row', gap: 14, alignItems: 'flex-start' }}>
        <IconTile icon={state === 'install' ? Share : BellRing} gold={state !== 'on'} dark={state === 'on'} />
        <View style={{ flex: 1, gap: 2 }}>
          <Text variant="bodyStrong">{compact ? t('push.followTitle') : t('push.title')}</Text>
          <Text variant="small" color={colors.textSecondary}>
            {state === 'on' ? t('push.bodyOn') : state === 'install' ? t('push.install') : state === 'denied' ? t('push.denied') : t('push.bodyOff')}
          </Text>
        </View>
      </View>
      {state === 'on' || state === 'off' ? (
        <Button
          testID={state === 'on' ? 'push-off' : 'push-on'}
          label={state === 'on' ? t('push.turnOff') : t('push.turnOn')}
          kind={state === 'on' ? 'secondary' : 'primary'}
          small
          loading={busy}
          onPress={toggle}
          style={{ alignSelf: 'flex-start' }}
        />
      ) : state === 'install' ? (
        <Button testID="push-howto" label={t('push.howTo')} kind="secondary" small onPress={() => router.push('/install')} style={{ alignSelf: 'flex-start' }} />
      ) : null}
      {failed ? <Note tone="error">{t('push.failed')}</Note> : null}
    </Card>
  );
}
