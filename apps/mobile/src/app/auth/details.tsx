import { useState } from 'react';
import { View } from 'react-native';
import { router } from 'expo-router';
import { useQueryClient } from '@tanstack/react-query';
import { useLocale } from '@/i18n';
import { api } from '@/api/client';
import { useSession } from '@/state/session';
import { errorText } from '@/lib/errors';
import { Button, Field, Text } from '@/ui/primitives';
import { BottomBar, Header, Screen } from '@/ui/layout';
import { colors } from '@/theme/tokens';

export default function Details() {
  const { t, lang } = useLocale();
  const qc = useQueryClient();
  const { returnTo, setReturnTo } = useSession();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const save = async () => {
    if (!name.trim()) return;
    setBusy(true);
    setError(null);
    try {
      await api('/me', { method: 'PATCH', body: { name: name.trim(), email: email.trim() || null, language: lang } });
      await qc.invalidateQueries();
      const to = returnTo ?? '/home';
      setReturnTo(null);
      router.dismissAll?.();
      router.replace(to as any);
    } catch (e) {
      setError(errorText(t, e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen
      header={<Header back={false} />}
      footer={
        <BottomBar>
          <Button testID="details-save" label={t('details.cta')} onPress={save} loading={busy} disabled={!name.trim()} />
        </BottomBar>
      }
    >
      <Text variant="h1" style={{ marginTop: 8 }}>
        {t('details.title')}
      </Text>
      <Text variant="body" color={colors.textSecondary} style={{ marginTop: 8 }}>
        {t('details.body')}
      </Text>
      <View style={{ gap: 20, marginTop: 28 }}>
        <Field testID="details-name" label={t('details.name')} value={name} onChangeText={setName} placeholder={t('details.namePh')} autoComplete="name" textContentType="name" autoFocus />
        <Field
          testID="details-email"
          label={t('details.email')}
          value={email}
          onChangeText={setEmail}
          placeholder="name@email.com"
          keyboardType="email-address"
          autoCapitalize="none"
          autoComplete="email"
          hint={t('details.emailHint')}
          error={error}
        />
      </View>
    </Screen>
  );
}
