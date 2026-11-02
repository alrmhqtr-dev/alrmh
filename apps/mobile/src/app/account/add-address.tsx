import { useState } from 'react';
import { View } from 'react-native';
import { router } from 'expo-router';
import { useQueryClient } from '@tanstack/react-query';
import { useLocale } from '@/i18n';
import { api } from '@/api/client';
import { errorText } from '@/lib/errors';
import { Button, Chip, Field, Note, Text } from '@/ui/primitives';
import { BottomBar, Header, Screen } from '@/ui/layout';

export default function AddAddress() {
  const { t } = useLocale();
  const qc = useQueryClient();
  const [label, setLabel] = useState(t('address.labelHome'));
  const [line1, setLine1] = useState('');
  const [area, setArea] = useState('');
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const valid = label.trim() && line1.trim() && area.trim();

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      await api('/addresses', { body: { label: label.trim(), line1: line1.trim(), area: area.trim(), notes: notes.trim() || undefined } });
      await Promise.all([qc.invalidateQueries({ queryKey: ['addresses'] }), qc.invalidateQueries({ queryKey: ['me'] }), qc.invalidateQueries({ queryKey: ['quote'] })]);
      router.back();
    } catch (e) {
      setError(errorText(t, e));
      setBusy(false);
    }
  };

  return (
    <Screen
      header={<Header title={t('address.title')} />}
      footer={
        <BottomBar>
          <Button testID="address-save" label={t('common.save')} onPress={save} loading={busy} disabled={!valid} />
        </BottomBar>
      }
      contentStyle={{ gap: 20, paddingTop: 8 }}
    >
      <View style={{ gap: 10 }}>
        <Text variant="smallStrong">{t('address.label')}</Text>
        <View style={{ flexDirection: 'row', gap: 8 }}>
          {[t('address.labelHome'), t('address.labelOffice')].map((l) => (
            <Chip key={l} label={l} selected={label === l} onPress={() => setLabel(l)} />
          ))}
        </View>
      </View>
      <Field testID="address-line1" label={t('address.line1')} value={line1} onChangeText={setLine1} placeholder={t('address.line1Ph')} autoFocus />
      <Field testID="address-area" label={t('address.area')} value={area} onChangeText={setArea} placeholder={t('address.areaPh')} />
      <Field label={t('address.notes')} value={notes} onChangeText={setNotes} placeholder={t('address.notesPh')} />
      {error ? <Note tone="error">{error}</Note> : null}
    </Screen>
  );
}
