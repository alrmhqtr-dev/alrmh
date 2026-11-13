import type { ReactNode } from 'react';
import { KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, View, type StyleProp, type ViewStyle } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { ArrowLeft, ChevronLeft, ShoppingBag, X } from 'lucide-react-native';
import { colors, fonts } from '@/theme/tokens';
import { useLocale } from '@/i18n';
import { useMe } from '@/api/hooks';
import { useSession } from '@/state/session';
import { IconButton, Text } from './primitives';

const android = Platform.OS === 'android';

export function goBack(fallback = '/home') {
  if (router.canGoBack()) router.back();
  else router.replace(fallback as any);
}

export function Header({
  title,
  back = true,
  close,
  right,
  bag,
  onBack,
}: {
  title?: string;
  back?: boolean;
  close?: boolean;
  right?: ReactNode;
  bag?: boolean;
  onBack?: () => void;
}) {
  const { t } = useLocale();
  const insets = useSafeAreaInsets();
  return (
    <View style={{ paddingTop: insets.top + 6, paddingHorizontal: 20, paddingBottom: 10, flexDirection: 'row', alignItems: 'center', backgroundColor: colors.canvas }}>
      <View style={{ width: 42 }}>
        {back || close ? (
          <IconButton
            icon={close ? X : android ? ArrowLeft : ChevronLeft}
            flip={!close}
            label={close ? t('common.close') : t('a11y.back')}
            onPress={onBack ?? (() => goBack())}
          />
        ) : null}
      </View>
      <View style={{ flex: 1, paddingHorizontal: 8 }}>
        {title ? (
          <Text variant="title" center numberOfLines={1}>
            {title}
          </Text>
        ) : null}
      </View>
      <View style={{ minWidth: 42, alignItems: 'flex-end' }}>{right ?? (bag ? <BagButton /> : null)}</View>
    </View>
  );
}

export function BagButton() {
  const { t } = useLocale();
  const { signedIn } = useSession();
  const me = useMe();
  return <IconButton icon={ShoppingBag} label={t('a11y.basket')} badge={signedIn ? me.data?.counts.basket : undefined} onPress={() => router.push('/basket')} />;
}

export function Screen({
  header,
  footer,
  children,
  scroll = true,
  padded = true,
  contentStyle,
  bg = colors.canvas,
  refreshControl,
}: {
  header?: ReactNode;
  footer?: ReactNode;
  children: ReactNode;
  scroll?: boolean;
  padded?: boolean;
  contentStyle?: StyleProp<ViewStyle>;
  bg?: string;
  refreshControl?: any;
}) {
  const insets = useSafeAreaInsets();
  const pad: ViewStyle = padded ? { paddingHorizontal: 20 } : {};
  return (
    <KeyboardAvoidingView role="main" style={{ flex: 1, backgroundColor: bg }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      {header ?? <View style={{ height: insets.top }} />}
      {scroll ? (
        <ScrollView
          style={{ flex: 1 }}
          contentContainerStyle={[pad, { paddingBottom: footer ? 24 : 32 + insets.bottom }, contentStyle]}
          keyboardShouldPersistTaps="handled"
          refreshControl={refreshControl}
          focusable={Platform.OS === 'web'}
        >
          {children}
        </ScrollView>
      ) : (
        <View style={[{ flex: 1 }, pad, contentStyle]}>{children}</View>
      )}
      {footer}
    </KeyboardAvoidingView>
  );
}

export function BottomBar({ children, label, value, sub }: { children: ReactNode; label?: string; value?: string; sub?: string }) {
  const insets = useSafeAreaInsets();
  return (
    <View
      style={{
        borderTopWidth: 1,
        borderTopColor: colors.border,
        backgroundColor: colors.canvas,
        paddingHorizontal: 20,
        paddingTop: 15,
        paddingBottom: Math.max(insets.bottom, 12) + 8,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 16,
      }}
    >
      {label || value ? (
        <View style={{ flexShrink: 1 }}>
          {label ? (
            <Text variant="caption" color={colors.textSecondary} numberOfLines={1}>
              {label}
            </Text>
          ) : null}
          {value ? <Text variant="price">{value}</Text> : null}
          {sub ? (
            <Text variant="caption" color={colors.textSecondary}>
              {sub}
            </Text>
          ) : null}
        </View>
      ) : null}
      <View style={{ flex: 1, alignItems: label || value ? 'flex-end' : 'stretch' }}>{children}</View>
    </View>
  );
}

export function Sheet({ visible, onClose, children }: { visible: boolean; onClose: () => void; children: ReactNode }) {
  const insets = useSafeAreaInsets();
  const { t } = useLocale();
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={{ flex: 1, justifyContent: 'flex-end', alignItems: 'center' }}>
        <Pressable accessibilityLabel={t('common.close')} onPress={onClose} style={{ position: 'absolute', top: 0, bottom: 0, left: 0, right: 0, backgroundColor: 'rgba(11,11,11,0.45)' }} />
        <View
          role="dialog"
          aria-modal
          style={{
            width: '100%',
            maxWidth: 480,
            backgroundColor: colors.canvas,
            borderTopLeftRadius: 24,
            borderTopRightRadius: 24,
            paddingHorizontal: 20,
            paddingTop: 10,
            paddingBottom: Math.max(insets.bottom, 16) + 8,
          }}
        >
          <View style={{ alignSelf: 'center', width: 36, height: 4, borderRadius: 2, backgroundColor: colors.border, marginBottom: 16 }} />
          {children}
        </View>
      </View>
    </Modal>
  );
}

export function Wordmark({ size = 1, inverse }: { size?: number; inverse?: boolean }) {
  const fg = inverse ? colors.textInverse : colors.text;
  return (
    <View style={{ alignItems: 'center' }}>
      <Text style={{ fontFamily: fonts.ruqaa, fontSize: 64 * size, lineHeight: 94 * size, color: fg }} center>
        الرمح
      </Text>
      <Text style={{ fontFamily: fonts.garamond, fontSize: 16 * size, lineHeight: 22 * size, letterSpacing: 6 * size, color: fg, marginTop: 8 * size }} center>
        ALRMH
      </Text>
    </View>
  );
}
