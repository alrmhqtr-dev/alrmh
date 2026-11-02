import { useEffect, useRef, useState } from 'react';
import { Platform, Pressable, TextInput, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { Clock } from 'lucide-react-native';
import { useLocale } from '@/i18n';
import { api } from '@/api/client';
import { useSession } from '@/state/session';
import { errorText } from '@/lib/errors';
import { Button, Icon, Note, Text, Touch } from '@/ui/primitives';
import { BottomBar, Header, Screen } from '@/ui/layout';
import { colors, fonts } from '@/theme/tokens';

const RESEND = 45;

export default function Verify() {
  const { t, f } = useLocale();
  const { phone, preview } = useLocalSearchParams<{ phone: string; preview?: string }>();
  const { signIn, returnTo, setReturnTo } = useSession();
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [left, setLeft] = useState(RESEND);
  const [previewCode, setPreviewCode] = useState(preview ?? '');
  const input = useRef<any>(null);

  useEffect(() => {
    const id = setInterval(() => setLeft((s) => Math.max(0, s - 1)), 1000);
    return () => clearInterval(id);
  }, []);

  const verify = async (value = code) => {
    if (value.length !== 6 || busy) return;
    setBusy(true);
    setError(null);
    try {
      const r = await api<{ token: string; isNew: boolean }>('/auth/verify', { body: { phone, code: value }, auth: false });
      await signIn(r.token);
      if (r.isNew) router.replace('/auth/details');
      else {
        const to = returnTo ?? '/home';
        setReturnTo(null);
        router.dismissAll?.();
        router.replace(to as any);
      }
    } catch (e) {
      setError(errorText(t, e, 'otp'));
      setCode('');
    } finally {
      setBusy(false);
    }
  };

  const resend = async () => {
    try {
      const r = await api<{ preview: { code: string } | null }>('/auth/otp', { body: { phone }, auth: false });
      setPreviewCode(r.preview?.code ?? '');
      setLeft(RESEND);
      setError(null);
    } catch (e) {
      setError(errorText(t, e));
    }
  };

  return (
    <Screen
      header={<Header />}
      footer={
        <BottomBar>
          <Button testID="otp-verify" label={t('otp.cta')} onPress={() => verify()} loading={busy} disabled={code.length !== 6} />
        </BottomBar>
      }
    >
      <Text variant="h1" style={{ marginTop: 8 }}>
        {t('otp.title')}
      </Text>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 8 }}>
        <Text variant="body" color={colors.textSecondary}>
          {t('otp.sentTo', { phone: f.phone(phone ?? '') })}
        </Text>
        <Touch onPress={() => router.back()} hitSlop={8}>
          <Text variant="bodyStrong">{t('common.edit')}</Text>
        </Touch>
      </View>

      <Pressable onPress={() => input.current?.focus()} style={{ marginTop: 28, flexDirection: 'row', gap: 8, direction: 'ltr' }}>
        {Array.from({ length: 6 }).map((_, i) => {
          const active = i === code.length;
          return (
            <View
              key={i}
              style={{
                flex: 1,
                height: 56,
                borderRadius: 12,
                borderWidth: active ? 1.5 : 1,
                borderColor: error ? colors.error : active ? colors.borderStrong : colors.border,
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <Text variant="h2" center>
                {code[i] ?? ''}
              </Text>
            </View>
          );
        })}
        <TextInput
          testID="otp-input"
          ref={input}
          value={code}
          onChangeText={(v) => {
            const next = v.replace(/\D/g, '').slice(0, 6);
            setCode(next);
            setError(null);
            if (next.length === 6) verify(next);
          }}
          keyboardType="number-pad"
          autoComplete={Platform.OS === 'android' ? 'sms-otp' : 'one-time-code'}
          textContentType="oneTimeCode"
          autoFocus
          maxLength={6}
          caretHidden
          style={{ position: 'absolute', opacity: 0.01, width: '100%', height: 56, fontFamily: fonts.regular }}
        />
      </Pressable>

      {error ? (
        <Text variant="small" color={colors.error} style={{ marginTop: 12 }}>
          {error}
        </Text>
      ) : null}

      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 20 }}>
        <Icon icon={Clock} size={16} color={colors.textMuted} />
        {left > 0 ? (
          <Text variant="small" color={colors.textMuted}>
            {t('otp.resendIn', { time: `0:${String(left).padStart(2, '0')}` })}
          </Text>
        ) : (
          <Touch onPress={resend}>
            <Text variant="smallStrong">{t('otp.resend')}</Text>
          </Touch>
        )}
      </View>

      {previewCode ? (
        <View style={{ marginTop: 24 }}>
          <Note tone="gold">{t('otp.preview', { code: previewCode })}</Note>
        </View>
      ) : null}
    </Screen>
  );
}
