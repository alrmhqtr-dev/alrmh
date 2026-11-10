import { useState } from 'react';
import { View } from 'react-native';
import { ChevronDown, MessageCircle, Navigation, Phone, Store } from 'lucide-react-native';
import { useLocale, type StringKey } from '@/i18n';
import { useCatalogue } from '@/api/hooks';
import { call, openMaps, openWhatsApp } from '@/lib/actions';
import { Button, Card, Divider, Icon, IconTile, Overline, Text, Touch } from '@/ui/primitives';
import { Header, Screen } from '@/ui/layout';
import { colors } from '@/theme/tokens';

export default function Help() {
  const { t, f } = useLocale();
  const cat = useCatalogue();
  const [open, setOpen] = useState<number | null>(null);
  const support = cat.data?.settings.support;
  const branches = cat.data?.branches ?? [];
  const s = cat.data?.settings;
  const facts = { days: s?.lead_working_days ?? 7, months: s?.points.expiry_months ?? 12, warn: s?.points.warn_days ?? 30 };

  return (
    <Screen header={<Header title={t('help.title')} />} contentStyle={{ gap: 20, paddingTop: 8 }}>
      <Card style={{ padding: 18, gap: 14 }}>
        <View style={{ gap: 4 }}>
          <Text variant="title">{t('help.talk')}</Text>
          <Text variant="small" color={colors.textSecondary}>
            {t('help.talkBody')}
          </Text>
        </View>
        <View style={{ flexDirection: 'row', gap: 10 }}>
          <Button label={t('help.whatsapp')} icon={MessageCircle} style={{ flex: 1 }} onPress={() => support && openWhatsApp(support.whatsapp)} />
          <Button label={t('help.call')} icon={Phone} kind="secondary" style={{ flex: 1 }} onPress={() => support && call(support.phone)} />
        </View>
      </Card>
      {branches.length ? (
        <View style={{ gap: 10 }}>
          <Overline>{branches.length > 1 ? t('help.branches') : t('help.branch')}</Overline>
          {branches.map((branch) => {
            const { lat, lng } = branch;
            return (
              <Card key={branch.id} testID={`help-branch-${branch.id}`} style={{ padding: 16, flexDirection: 'row', alignItems: 'center', gap: 14 }}>
                <IconTile icon={Store} />
                <View style={{ flex: 1 }}>
                  <Text variant="bodyStrong">{f.name(branch)}</Text>
                  <Text variant="small" color={colors.textSecondary}>
                    {f.name(branch, 'hours')}
                  </Text>
                </View>
                {lat != null && lng != null ? <Button label={t('help.directions')} icon={Navigation} kind="subtle" small onPress={() => openMaps(lat, lng)} /> : null}
              </Card>
            );
          })}
        </View>
      ) : null}
      <View style={{ gap: 10 }}>
        <Overline>{t('help.faq')}</Overline>
        <Card>
          {[1, 2, 3, 4].map((i, idx) => (
            <View key={i}>
              {idx ? <Divider /> : null}
              <Touch onPress={() => setOpen(open === i ? null : i)} style={{ padding: 16, gap: 8 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                  <Text variant="bodyStrong" style={{ flex: 1 }}>
                    {t(`help.q${i}` as StringKey)}
                  </Text>
                  <View style={{ transform: [{ rotate: open === i ? '180deg' : '0deg' }] }}>
                    <Icon icon={ChevronDown} size={18} color={colors.textMuted} />
                  </View>
                </View>
                {open === i ? (
                  <Text variant="small" color={colors.textSecondary}>
                    {t(`help.a${i}` as StringKey, facts)}
                  </Text>
                ) : null}
              </Touch>
            </View>
          ))}
        </Card>
      </View>
    </Screen>
  );
}
