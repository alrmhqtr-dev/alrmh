import { useState } from 'react';
import { View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useQueryClient } from '@tanstack/react-query';
import { Info } from 'lucide-react-native';
import { useLocale } from '@/i18n';
import { api } from '@/api/client';
import { useBuilder } from '@/state/builder';
import { errorText } from '@/lib/errors';
import { Button, Chip, Field, Note, Text } from '@/ui/primitives';
import { BottomBar, Header, Screen } from '@/ui/layout';

const RELATIONS = ['father', 'son', 'brother', 'friend', 'other'] as const;

export default function AddMember() {
  const { t } = useLocale();
  const qc = useQueryClient();
  const { return: ret } = useLocalSearchParams<{ return?: string }>();
  const builder = useBuilder();
  const [name, setName] = useState('');
  const [relation, setRelation] = useState<(typeof RELATIONS)[number]>('son');
  const [size, setSize] = useState<'adult' | 'child'>('adult');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = async (book: boolean) => {
    setBusy(true);
    setError(null);
    try {
      const m = await api<{ id: string }>('/family', { body: { name: name.trim(), relation, size } });
      await qc.invalidateQueries({ queryKey: ['family'] });
      await qc.invalidateQueries({ queryKey: ['me'] });
      if (ret === 'builder') {
        builder.set({ memberId: m.id, method: null, appointment: null });
        return router.back();
      }
      if (book) router.replace({ pathname: '/book', params: { mode: 'standalone', memberId: m.id } });
      else router.back();
    } catch (e) {
      setError(errorText(t, e));
      setBusy(false);
    }
  };

  return (
    <Screen
      header={<Header title={t('addMember.title')} />}
      footer={
        <BottomBar>
          <View style={{ gap: 6 }}>
            <Button testID="member-save" label={t('common.save')} onPress={() => save(false)} loading={busy} disabled={!name.trim()} />
            {ret !== 'builder' ? <Button label={t('addMember.saveBook')} kind="ghost" onPress={() => save(true)} disabled={!name.trim() || busy} /> : null}
          </View>
        </BottomBar>
      }
      contentStyle={{ gap: 22, paddingTop: 8 }}
    >
      <Field testID="member-name" label={t('addMember.name')} value={name} onChangeText={setName} autoFocus />
      <View style={{ gap: 10 }}>
        <Text variant="smallStrong">{t('addMember.relation')}</Text>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
          {RELATIONS.map((r) => (
            <Chip key={r} testID={`rel-${r}`} label={t(`rel.${r}`)} selected={relation === r} onPress={() => setRelation(r)} />
          ))}
        </View>
      </View>
      <View style={{ gap: 10 }}>
        <Text variant="smallStrong">{t('addMember.size')}</Text>
        <View style={{ flexDirection: 'row', gap: 8 }}>
          {(['adult', 'child'] as const).map((s) => (
            <Chip key={s} label={t(`size.${s}`)} selected={size === s} onPress={() => setSize(s)} />
          ))}
        </View>
      </View>
      <Note icon={Info}>{t('addMember.note', { name: name.trim() || t('addMember.someone') })}</Note>
      {error ? <Note tone="error">{error}</Note> : null}
    </Screen>
  );
}
