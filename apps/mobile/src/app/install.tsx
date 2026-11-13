import { useEffect, useState } from 'react';
import { Image, Platform, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { BellRing, CircleCheck, Compass, Copy, Download, EllipsisVertical, Globe, House, Share, SquarePlus } from 'lucide-react-native';
import { useLocale, type StringKey } from '@/i18n';
import { appAddress, installInfo, onInstallChange, promptInstall } from '@/lib/install';
import { Button, Card, Chip, Icon, Note, Text, Touch } from '@/ui/primitives';
import { Header, Screen } from '@/ui/layout';
import { colors } from '@/theme/tokens';

const appIcon = require('../../assets/icon.png');

const STEPS: Record<'ios' | 'android', { icon: any; key: StringKey }[]> = {
  ios: [
    { icon: Compass, key: 'install.ios1' },
    { icon: Share, key: 'install.ios2' },
    { icon: SquarePlus, key: 'install.ios3' },
    { icon: CircleCheck, key: 'install.ios4' },
    { icon: House, key: 'install.ios5' },
  ],
  android: [
    { icon: Globe, key: 'install.android1' },
    { icon: EllipsisVertical, key: 'install.android2' },
    { icon: Download, key: 'install.android3' },
    { icon: CircleCheck, key: 'install.android4' },
    { icon: House, key: 'install.android5' },
  ],
};

export default function Install() {
  const { t, lang, setLang } = useLocale();
  const [info, setInfo] = useState(installInfo);
  const [tab, setTab] = useState<'ios' | 'android'>(info.device === 'android' ? 'android' : 'ios');
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const address = appAddress();

  useEffect(() => onInstallChange(() => setInfo(installInfo())), []);

  // A shared link can choose the language: /install?lang=ar or /install?lang=en.
  const params = useLocalSearchParams<{ lang?: string }>();
  useEffect(() => {
    if ((params.lang === 'ar' || params.lang === 'en') && params.lang !== lang) setLang(params.lang);
    // Only when the link is opened, so the switch at the top still works afterwards.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params.lang]);

  const install = async () => {
    setBusy(true);
    try {
      await promptInstall();
    } finally {
      setBusy(false);
      setInfo(installInfo());
    }
  };

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(`https://${address}`);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch {
      setCopied(false);
    }
  };

  const languageSwitch = (
    <Touch testID="install-language" accessibilityRole="button" onPress={() => setLang(lang === 'ar' ? 'en' : 'ar')} style={{ paddingVertical: 8, paddingHorizontal: 4 }}>
      <Text variant="smallStrong">{lang === 'ar' ? 'English' : 'العربية'}</Text>
    </Touch>
  );

  const step = (i: number, s: { icon: any; key: StringKey }) => (
    <View key={s.key} style={{ flexDirection: 'row', gap: 14, alignItems: 'flex-start', paddingVertical: 12 }}>
      <View style={{ width: 28, height: 28, borderRadius: 14, backgroundColor: colors.inverse, alignItems: 'center', justifyContent: 'center', marginTop: 2 }}>
        <Text variant="smallStrong" color={colors.textInverse} center>
          {String(i + 1)}
        </Text>
      </View>
      <View style={{ flex: 1, gap: 2 }}>
        <Text variant="body">{t(s.key, { address })}</Text>
      </View>
      <View style={{ width: 36, height: 36, borderRadius: 10, backgroundColor: colors.subtle, alignItems: 'center', justifyContent: 'center' }}>
        <Icon icon={s.icon} size={18} />
      </View>
    </View>
  );

  return (
    <Screen header={<Header back={router.canGoBack()} onBack={() => router.back()} right={languageSwitch} />} contentStyle={{ paddingTop: 4, gap: 20 }}>
      <View style={{ backgroundColor: colors.subtle, borderRadius: 24, paddingVertical: 28, alignItems: 'center', gap: 10 }}>
        <Image
          source={appIcon}
          accessibilityIgnoresInvertColors
          style={{ width: 88, height: 88, borderRadius: 20, boxShadow: '0 6px 18px rgba(11,11,11,0.18)' } as any}
        />
        <Text variant="smallStrong">{lang === 'ar' ? 'الرمح' : 'AlRmh'}</Text>
      </View>

      <View style={{ gap: 8 }}>
        <Text variant="h1">
          {t('install.title')}
        </Text>
        <Text variant="body" color={colors.textSecondary}>
          {t('install.body')}
        </Text>
      </View>

      {info.installed ? (
        <Card testID="install-done" style={{ padding: 16, gap: 12 }}>
          <View style={{ flexDirection: 'row', gap: 12, alignItems: 'center' }}>
            <Icon icon={CircleCheck} size={22} />
            <Text variant="bodyStrong" style={{ flex: 1 }}>
              {t('install.installed')}
            </Text>
          </View>
          <Button testID="install-open" label={t('install.open')} onPress={() => router.replace('/')} />
        </Card>
      ) : (
        <>
          {info.canPrompt ? (
            <Button testID="install-button" label={t('install.button')} icon={Download} loading={busy} onPress={install} />
          ) : null}

          {info.inAppBrowser ? <Note tone="gold">{t(info.device === 'android' ? 'install.inAppAndroid' : 'install.inAppIos')}</Note> : null}

          {info.device === 'desktop' ? (
            <Card style={{ padding: 16, gap: 10 }}>
              <Text variant="bodyStrong">{t('install.desktopTitle')}</Text>
              <Text variant="small" color={colors.textSecondary}>
                {t('install.desktopBody')}
              </Text>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: colors.subtle, borderRadius: 12, paddingStart: 14, paddingEnd: 6, height: 48 }}>
                <Text variant="bodyStrong" style={{ flex: 1, writingDirection: 'ltr' }} numberOfLines={1}>
                  {address}
                </Text>
                {Platform.OS === 'web' && typeof navigator !== 'undefined' && navigator.clipboard ? (
                  <Button testID="install-copy" small kind="secondary" icon={Copy} label={copied ? t('install.copied') : t('install.copy')} onPress={copy} />
                ) : null}
              </View>
            </Card>
          ) : null}

          <View style={{ gap: 12 }}>
            <View style={{ flexDirection: 'row', gap: 8 }}>
              <Chip testID="install-tab-ios" label={t('install.iphone')} selected={tab === 'ios'} onPress={() => setTab('ios')} />
              <Chip testID="install-tab-android" label={t('install.android')} selected={tab === 'android'} onPress={() => setTab('android')} />
            </View>
            <Card testID={`install-steps-${tab}`} style={{ paddingHorizontal: 16, paddingVertical: 4 }}>
              {STEPS[tab].map((s, i) => step(i, s))}
            </Card>
            <Text variant="small" color={colors.textMuted}>
              {t(tab === 'ios' ? 'install.iosNote' : 'install.androidNote')}
            </Text>
          </View>

          <Note icon={BellRing}>{t('install.notifications')}</Note>

          <Button testID="install-skip" kind="ghost" label={t('install.skip')} onPress={() => router.replace('/')} />
        </>
      )}
    </Screen>
  );
}

