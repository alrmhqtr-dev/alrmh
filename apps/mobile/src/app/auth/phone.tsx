import { useState } from 'react';
import { View } from 'react-native';
import { router } from 'expo-router';
import { useLocale } from '@/i18n';
import { api } from '@/api/client';
import { errorText } from '@/lib/errors';
import { Button, Field, Text } from '@/ui/primitives';
import { BottomBar, Header, Screen } from '@/ui/layout';
import { colors } from '@/theme/tokens';

export function QatarPrefix() {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, direction: 'ltr' }}>
      <View style={{ width: 28, height: 20, borderRadius: 3, overflow: 'hidden', flexDirection: 'row', borderWidth: 1, borderColor: colors.border }}>
        <View style={{ width: 9, backgroundColor: '#FFFFFF' }} />
        <View style={{ flex: 1, backgroundColor: '#8A1538' }} />
      </View>
      <Text variant="body">+974</Text>
      <View style={{ width: 1, height: 24, backgroundColor: colors.border, marginStart: 4 }} />
    </View>
  );
}

export default function PhoneScreen() {
  const { t } = useLocale();
  const [digits, setDigits] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const valid = /^[3567]\d{7}$/.test(digits);

  const submit = async () => {
    if (!valid) return setError(t('phone.invalid'));
    setBusy(true);
    setError(null);
    try {
      const r = await api<{ phone: string; preview: { code: string } | null }>('/auth/otp', { body: { phone: digits }, auth: false });
      router.push({ pathname: '/auth/verify', params: { phone: r.phone, preview: r.preview?.code ?? '' } });
    } catch (e) {
      setError(errorText(t, e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen
      header={<Header />}
      footer={
        <BottomBar>
          <Button testID="phone-send" label={t('phone.cta')} onPress={submit} loading={busy} disabled={digits.length < 8} />
        </BottomBar>
      }
    >
      <Text variant="h1" style={{ marginTop: 8 }}>
        {t('phone.title')}
      </Text>
      <Text variant="body" color={colors.textSecondary} style={{ marginTop: 8 }}>
        {t('phone.body')}
      </Text>
      <View style={{ marginTop: 28, direction: 'ltr' }}>
        <Field
          testID="phone-input"
          label={t('phone.label')}
          prefix={<QatarPrefix />}
          value={digits.replace(/(\d{4})(\d)/, '$1 $2')}
          onChangeText={(v) => {
            setError(null);
            setDigits(v.replace(/\D/g, '').slice(0, 8));
          }}
          placeholder="5555 1234"
          keyboardType="phone-pad"
          autoComplete="tel-national"
          textContentType="telephoneNumber"
          maxLength={9}
          autoFocus
          onSubmitEditing={submit}
          error={error}
          hint={t('phone.hint')}
          style={{ textAlign: 'left' }}
        />
      </View>
      <Text variant="small" color={colors.textMuted} style={{ marginTop: 24 }}>
        {t('phone.terms')}
      </Text>
    </Screen>
  );
}
