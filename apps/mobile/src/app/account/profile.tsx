import { useEffect, useState } from 'react';
import { View } from 'react-native';
import { useQueryClient } from '@tanstack/react-query';
import { useLocale } from '@/i18n';
import { api } from '@/api/client';
import { useMe } from '@/api/hooks';
import { errorText } from '@/lib/errors';
import { Button, Field, Loading, Note } from '@/ui/primitives';
import { BottomBar, Header, Screen } from '@/ui/layout';

export default function Profile() {
  const { t, f } = useLocale();
  const qc = useQueryClient();
  const me = useMe();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ tone: 'gold' | 'error'; text: string } | null>(null);

  useEffect(() => {
    if (me.data && !loaded) {
      setName(me.data.name ?? '');
      setEmail(me.data.email ?? '');
      setLoaded(true);
    }
  }, [me.data, loaded]);

  const save = async () => {
    setBusy(true);
    setMsg(null);
    try {
      await api('/me', { method: 'PATCH', body: { name: name.trim(), email: email.trim() || null } });
      await Promise.all([qc.invalidateQueries({ queryKey: ['me'] }), qc.invalidateQueries({ queryKey: ['family'] })]);
      setMsg({ tone: 'gold', text: t('profile.saved') });
    } catch (e) {
      setMsg({ tone: 'error', text: errorText(t, e) });
    } finally {
      setBusy(false);
    }
  };

  if (!loaded) return <Screen header={<Header title={t('profile.title')} />}><Loading /></Screen>;

  return (
    <Screen
      header={<Header title={t('profile.title')} />}
      footer={
        <BottomBar>
          <Button testID="profile-save" label={t('common.save')} onPress={save} loading={busy} disabled={!name.trim()} />
        </BottomBar>
      }
      contentStyle={{ gap: 20, paddingTop: 8 }}
    >
      <Field testID="profile-name" label={t('details.name')} value={name} onChangeText={(v) => { setName(v); setMsg(null); }} autoComplete="name" textContentType="name" />
      <Field
        testID="profile-email"
        label={t('details.email')}
        value={email}
        onChangeText={(v) => { setEmail(v); setMsg(null); }}
        keyboardType="email-address"
        autoCapitalize="none"
        autoComplete="email"
      />
      <View style={{ direction: 'ltr' }}>
        <Field label={t('profile.mobile')} value={f.phone(me.data?.phone ?? '')} editable={false} hint={t('profile.mobileHint')} />
      </View>
      {msg ? <Note tone={msg.tone}>{msg.text}</Note> : null}
    </Screen>
  );
}
