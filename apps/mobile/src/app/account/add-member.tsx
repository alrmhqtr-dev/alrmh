import { useEffect, useState } from 'react';
import { View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useQueryClient } from '@tanstack/react-query';
import { Info, Trash2 } from 'lucide-react-native';
import { useLocale } from '@/i18n';
import { api } from '@/api/client';
import { useMember } from '@/api/hooks';
import { useBuilder } from '@/state/builder';
import { errorText } from '@/lib/errors';
import { Button, Chip, Field, Loading, Note, Text } from '@/ui/primitives';
import { BottomBar, Header, Screen, Sheet } from '@/ui/layout';
import { colors } from '@/theme/tokens';

const RELATIONS = ['father', 'son', 'brother', 'friend', 'other'] as const;
type Relation = (typeof RELATIONS)[number];

/** Adds a family member, or edits one when opened with ?id=. */
export default function AddMember() {
  const { t } = useLocale();
  const qc = useQueryClient();
  const { return: ret, id } = useLocalSearchParams<{ return?: string; id?: string }>();
  const editing = Boolean(id);
  const existing = useMember(id ?? '');
  const builder = useBuilder();
  const [name, setName] = useState('');
  const [relation, setRelation] = useState<Relation>('son');
  const [size, setSize] = useState<'adult' | 'child'>('adult');
  const [loaded, setLoaded] = useState(!editing);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmRemove, setConfirmRemove] = useState(false);

  useEffect(() => {
    if (editing && existing.data && !loaded) {
      setName(existing.data.name);
      setRelation((RELATIONS as readonly string[]).includes(existing.data.relation) ? (existing.data.relation as Relation) : 'other');
      setSize(existing.data.size === 'child' ? 'child' : 'adult');
      setLoaded(true);
    }
  }, [editing, existing.data, loaded]);

  const refresh = () => Promise.all([qc.invalidateQueries({ queryKey: ['family'] }), qc.invalidateQueries({ queryKey: ['me'] }), qc.invalidateQueries({ queryKey: ['member'] })]);

  const save = async (book: boolean) => {
    setBusy(true);
    setError(null);
    try {
      if (editing) {
        await api(`/family/${id}`, { method: 'PATCH', body: { name: name.trim(), relation, size } });
        await refresh();
        return router.back();
      }
      const m = await api<{ id: string }>('/family', { body: { name: name.trim(), relation, size } });
      await refresh();
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

  const remove = async () => {
    setBusy(true);
    setError(null);
    try {
      await api(`/family/${id}`, { method: 'DELETE' });
      await refresh();
      setConfirmRemove(false);
      if (router.canDismiss()) router.dismissTo('/account/family');
      else router.replace('/account/family');
    } catch (e) {
      setConfirmRemove(false);
      setError(errorText(t, e));
      setBusy(false);
    }
  };

  if (!loaded) return <Screen header={<Header title={t('addMember.editTitle')} />}><Loading /></Screen>;

  return (
    <Screen
      header={<Header title={editing ? t('addMember.editTitle') : t('addMember.title')} />}
      footer={
        <BottomBar>
          <View style={{ gap: 6 }}>
            <Button testID="member-save" label={t('common.save')} onPress={() => save(false)} loading={busy} disabled={!name.trim()} />
            {!editing && ret !== 'builder' ? <Button label={t('addMember.saveBook')} kind="ghost" onPress={() => save(true)} disabled={!name.trim() || busy} /> : null}
            {editing ? <Button testID="member-remove" label={t('member.remove')} kind="ghost" icon={Trash2} onPress={() => setConfirmRemove(true)} disabled={busy} /> : null}
          </View>
        </BottomBar>
      }
      contentStyle={{ gap: 22, paddingTop: 8 }}
    >
      <Field testID="member-name" label={t('addMember.name')} value={name} onChangeText={setName} autoFocus={!editing} />
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
            <Chip key={s} testID={`size-${s}`} label={t(`size.${s}`)} selected={size === s} onPress={() => setSize(s)} />
          ))}
        </View>
      </View>
      {!editing ? <Note icon={Info}>{t('addMember.note', { name: name.trim() || t('addMember.someone') })}</Note> : null}
      {error ? <Note tone="error">{error}</Note> : null}
      <Sheet visible={confirmRemove} onClose={() => setConfirmRemove(false)}>
        <Text variant="h2">{t('member.removeQ', { name: name.trim() })}</Text>
        <Text variant="body" color={colors.textSecondary} style={{ marginTop: 8 }}>
          {t('member.removeBody')}
        </Text>
        <View style={{ gap: 6, marginTop: 20 }}>
          <Button testID="member-remove-confirm" label={t('member.remove')} kind="danger" loading={busy} onPress={remove} />
          <Button label={t('common.cancel')} kind="ghost" onPress={() => setConfirmRemove(false)} />
        </View>
      </Sheet>
    </Screen>
  );
}
