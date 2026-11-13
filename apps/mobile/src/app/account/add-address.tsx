import { useEffect, useState } from 'react';
import { View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useQueryClient } from '@tanstack/react-query';
import { Trash2 } from 'lucide-react-native';
import { useLocale } from '@/i18n';
import { api } from '@/api/client';
import { useAddresses } from '@/api/hooks';
import { errorText } from '@/lib/errors';
import { Button, Chip, Field, Loading, Note, Text } from '@/ui/primitives';
import { BottomBar, Header, Screen, Sheet } from '@/ui/layout';
import { colors } from '@/theme/tokens';

/** Adds an address, or edits one when opened with ?id=. */
export default function AddAddress() {
  const { t } = useLocale();
  const qc = useQueryClient();
  const { id } = useLocalSearchParams<{ id?: string }>();
  const editing = Boolean(id);
  const addresses = useAddresses();
  const [label, setLabel] = useState(t('address.labelHome'));
  const [line1, setLine1] = useState('');
  const [area, setArea] = useState('');
  const [notes, setNotes] = useState('');
  const [loaded, setLoaded] = useState(!editing);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const valid = label.trim() && line1.trim() && area.trim();

  useEffect(() => {
    const a = editing ? addresses.data?.find((x) => x.id === id) : null;
    if (a && !loaded) {
      setLabel(a.label);
      setLine1(a.line1);
      setArea(a.area);
      setNotes(a.notes ?? '');
      setLoaded(true);
    }
  }, [editing, addresses.data, id, loaded]);

  const refresh = () =>
    Promise.all([qc.invalidateQueries({ queryKey: ['addresses'] }), qc.invalidateQueries({ queryKey: ['me'] }), qc.invalidateQueries({ queryKey: ['quote'] })]);

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      const body = { label: label.trim(), line1: line1.trim(), area: area.trim(), notes: notes.trim() || (editing ? null : undefined) };
      if (editing) await api(`/addresses/${id}`, { method: 'PATCH', body });
      else await api('/addresses', { body });
      await refresh();
      router.back();
    } catch (e) {
      setError(errorText(t, e));
      setBusy(false);
    }
  };

  const remove = async () => {
    setBusy(true);
    setError(null);
    try {
      await api(`/addresses/${id}`, { method: 'DELETE' });
      await refresh();
      setConfirmRemove(false);
      router.back();
    } catch (e) {
      setConfirmRemove(false);
      setError(errorText(t, e));
      setBusy(false);
    }
  };

  if (!loaded) return <Screen header={<Header title={t('address.editTitle')} />}><Loading /></Screen>;
  const labels = [t('address.labelHome'), t('address.labelOffice')];

  return (
    <Screen
      header={<Header title={editing ? t('address.editTitle') : t('address.title')} />}
      footer={
        <BottomBar>
          <View style={{ gap: 6 }}>
            <Button testID="address-save" label={t('common.save')} onPress={save} loading={busy} disabled={!valid} />
            {editing ? <Button testID="address-remove" label={t('address.remove')} kind="ghost" icon={Trash2} onPress={() => setConfirmRemove(true)} disabled={busy} /> : null}
          </View>
        </BottomBar>
      }
      contentStyle={{ gap: 20, paddingTop: 8 }}
    >
      <View style={{ gap: 10 }}>
        <Text variant="smallStrong">{t('address.label')}</Text>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
          {(labels.includes(label) ? labels : [...labels, label]).map((l) => (
            <Chip key={l} label={l} selected={label === l} onPress={() => setLabel(l)} />
          ))}
        </View>
      </View>
      <Field testID="address-line1" label={t('address.line1')} value={line1} onChangeText={setLine1} placeholder={t('address.line1Ph')} autoFocus={!editing} />
      <Field testID="address-area" label={t('address.area')} value={area} onChangeText={setArea} placeholder={t('address.areaPh')} />
      <Field testID="address-notes" label={t('address.notes')} value={notes} onChangeText={setNotes} placeholder={t('address.notesPh')} />
      {error ? <Note tone="error">{error}</Note> : null}
      <Sheet visible={confirmRemove} onClose={() => setConfirmRemove(false)}>
        <Text variant="h2">{t('address.removeQ')}</Text>
        <Text variant="body" color={colors.textSecondary} style={{ marginTop: 8 }}>
          {`${line1}, ${area}`}
        </Text>
        <View style={{ gap: 6, marginTop: 20 }}>
          <Button testID="address-remove-confirm" label={t('address.remove')} kind="danger" loading={busy} onPress={remove} />
          <Button label={t('common.cancel')} kind="ghost" onPress={() => setConfirmRemove(false)} />
        </View>
      </Sheet>
    </Screen>
  );
}
