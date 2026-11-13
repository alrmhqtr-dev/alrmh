import { useState } from 'react';
import { View } from 'react-native';
import { router } from 'expo-router';
import { useQueryClient } from '@tanstack/react-query';
import { Bell, FileText, Globe, LogOut, MapPin, MessageCircle, ScrollText, Trash2, User, Users } from 'lucide-react-native';
import { useLocale } from '@/i18n';
import { api } from '@/api/client';
import { useSession } from '@/state/session';
import { useMe } from '@/api/hooks';
import { errorText } from '@/lib/errors';
import { Avatar, Button, Card, Divider, EmptyState, ListRow, Loading, Note, Overline, Text } from '@/ui/primitives';
import { Screen, Sheet } from '@/ui/layout';
import { colors } from '@/theme/tokens';

export default function Account() {
  const { t, f, lang } = useLocale();
  const qc = useQueryClient();
  const { signedIn, signOut } = useSession();
  const me = useMe();
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const group = (title: string, rows: React.ReactNode[]) => (
    <View style={{ gap: 10 }}>
      <Overline>{title}</Overline>
      <Card>
        {rows.map((r, i) => (
          <View key={i}>
            {i ? <Divider /> : null}
            {r}
          </View>
        ))}
      </Card>
    </View>
  );

  const prefs = group(t('account.preferences'), [
    <ListRow key="lang" icon={Globe} title={t('account.language')} subtitle={lang === 'ar' ? 'العربية' : 'English'} onPress={() => router.push('/account/language')} testID="row-language" />,
  ]);
  const support = group(t('account.support'), [
    <ListRow key="help" icon={MessageCircle} title={t('account.help')} subtitle={t('account.helpSub')} onPress={() => router.push('/account/help')} />,
    <ListRow key="terms" icon={ScrollText} title={t('account.terms')} onPress={() => router.push('/account/terms')} />,
  ]);

  if (!signedIn)
    return (
      <Screen contentStyle={{ paddingTop: 8, gap: 20 }}>
        <Text variant="h1">{t('account.title')}</Text>
        <EmptyState icon={User} title={t('account.signIn')} body={t('account.signInBody')}>
          <Button testID="account-signin" label={t('welcome.cta')} onPress={() => router.push('/auth/phone')} />
        </EmptyState>
        {prefs}
        {support}
      </Screen>
    );

  const m = me.data;
  return (
    <Screen contentStyle={{ paddingTop: 8, gap: 20 }}>
      <Text variant="h1">{t('account.title')}</Text>
      {!m ? (
        <Loading />
      ) : (
        <>
          <Card testID="profile-card" onPress={() => router.push('/account/profile')} style={{ padding: 18, flexDirection: 'row', alignItems: 'center', gap: 14 }}>
            <Avatar name={m.name ?? '?'} dark size={56} />
            <View style={{ flex: 1 }}>
              <Text variant="title">{m.name}</Text>
              <Text variant="small" color={colors.textSecondary}>
                {f.phone(m.phone)}
              </Text>
            </View>
            <Text variant="smallStrong">{t('common.edit')}</Text>
          </Card>
          {group(t('account.tailoring'), [
            <ListRow key="fam" icon={Users} title={t('account.family')} subtitle={t('account.familySub', { n: m.counts.family })} onPress={() => router.push('/account/family')} testID="row-family" />,
            <ListRow key="addr" icon={MapPin} title={t('account.addresses')} subtitle={t('account.addressesSub', { n: m.counts.addresses })} onPress={() => router.push('/account/addresses')} />,
            <ListRow key="ord" icon={FileText} title={t('account.orders')} subtitle={t('account.ordersSub', { n: m.counts.active_orders })} onPress={() => router.push('/orders')} />,
          ])}
          {group(t('account.preferences'), [
            <ListRow key="notif" icon={Bell} title={t('account.notifications')} subtitle={t('account.notificationsSub')} onPress={() => router.push('/account/notifications')} />,
            <ListRow key="lang" icon={Globe} title={t('account.language')} subtitle={lang === 'ar' ? 'العربية' : 'English'} onPress={() => router.push('/account/language')} testID="row-language" />,
          ])}
          {support}
          <Button testID="logout" label={t('account.logout')} kind="secondary" icon={LogOut} onPress={signOut} />
          <Button label={t('account.delete')} kind="ghost" icon={Trash2} onPress={() => { setDeleteError(null); setConfirmDelete(true); }} />
        </>
      )}
      <Sheet visible={confirmDelete} onClose={() => setConfirmDelete(false)}>
        <Text variant="h2">{t('account.delete')}</Text>
        <Text variant="body" color={colors.textSecondary} style={{ marginTop: 8 }}>
          {t('account.deleteQ')}
        </Text>
        {deleteError ? <View style={{ marginTop: 12 }}><Note tone="error">{deleteError}</Note></View> : null}
        <View style={{ gap: 6, marginTop: 20 }}>
          <Button
            testID="delete-confirm"
            label={t('account.deleteCta')}
            kind="danger"
            loading={deleting}
            onPress={async () => {
              setDeleting(true);
              setDeleteError(null);
              try {
                await api('/me', { method: 'DELETE' });
              } catch (e) {
                // Still signed in and nothing was deleted: say why instead of pretending it worked.
                setDeleteError(errorText(t, e));
                setDeleting(false);
                return;
              }
              setDeleting(false);
              setConfirmDelete(false);
              qc.clear();
              await signOut();
              router.replace('/onboarding/welcome');
            }}
          />
          <Button label={t('common.cancel')} kind="ghost" onPress={() => setConfirmDelete(false)} />
        </View>
      </Sheet>
    </Screen>
  );
}
