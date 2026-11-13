import type { ComponentType, ReactNode } from 'react';
import {
  ActivityIndicator,
  Platform,
  Pressable,
  Text as RNText,
  TextInput,
  View,
  type PressableProps,
  type StyleProp,
  type TextInputProps,
  type TextStyle,
  type ViewStyle,
} from 'react-native';
import { Check, ChevronRight, type LucideProps } from 'lucide-react-native';
import { colors, fonts, radius, type as typeScale, type TypeVariant } from '@/theme/tokens';
import { useLocale } from '@/i18n';

/* ---------- text ---------- */

export function Text({
  variant = 'body',
  color = colors.text,
  style,
  children,
  numberOfLines,
  center,
  selectable,
  testID,
}: {
  testID?: string;
  variant?: TypeVariant;
  color?: string;
  style?: StyleProp<TextStyle>;
  children: ReactNode;
  numberOfLines?: number;
  center?: boolean;
  selectable?: boolean;
}) {
  const { isRTL } = useLocale();
  return (
    <RNText
      testID={testID}
      numberOfLines={numberOfLines}
      selectable={selectable}
      style={[typeScale[variant], { color, writingDirection: isRTL ? 'rtl' : 'ltr', textAlign: center ? 'center' : isRTL ? 'right' : 'left' }, style]}
    >
      {children}
    </RNText>
  );
}

/* ---------- icons ---------- */

export type IconType = ComponentType<LucideProps>;

export function Icon({ icon: I, size = 20, color = colors.text, flip, strokeWidth = 1.75 }: { icon: IconType; size?: number; color?: string; flip?: boolean; strokeWidth?: number }) {
  const { isRTL } = useLocale();
  return (
    <View style={flip && isRTL ? { transform: [{ scaleX: -1 }] } : undefined}>
      <I size={size} color={color} strokeWidth={strokeWidth} />
    </View>
  );
}

export function IconTile({ icon, dark, gold, size = 40 }: { icon: IconType; dark?: boolean; gold?: boolean; size?: number }) {
  const bg = dark ? colors.inverse : gold ? colors.gold : colors.subtle;
  return (
    <View style={{ width: size, height: size, borderRadius: 10, backgroundColor: bg, alignItems: 'center', justifyContent: 'center' }}>
      <Icon icon={icon} size={size * 0.5} color={dark ? colors.textInverse : colors.text} />
    </View>
  );
}

/* ---------- pressable with feedback ---------- */

export function Touch({ style, children, ...rest }: PressableProps & { style?: StyleProp<ViewStyle>; children: ReactNode }) {
  return (
    <Pressable
      android_ripple={{ color: 'rgba(0,0,0,0.06)', borderless: false }}
      style={({ pressed }) => [style as ViewStyle, pressed && Platform.OS !== 'android' ? { opacity: 0.7 } : null, Platform.OS === 'web' ? ({ cursor: 'pointer' } as any) : null]}
      {...rest}
    >
      {children}
    </Pressable>
  );
}

/* ---------- buttons ---------- */

type ButtonKind = 'primary' | 'secondary' | 'subtle' | 'light' | 'gold' | 'ghost' | 'danger';

export function Button({
  label,
  onPress,
  kind = 'primary',
  icon,
  iconEnd,
  disabled,
  loading,
  small,
  style,
  testID,
}: {
  label: string;
  onPress?: () => void;
  kind?: ButtonKind;
  icon?: IconType;
  iconEnd?: IconType;
  disabled?: boolean;
  loading?: boolean;
  small?: boolean;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}) {
  const palette: Record<ButtonKind, { bg: string; fg: string; border?: string }> = {
    primary: { bg: colors.inverse, fg: colors.textInverse },
    secondary: { bg: colors.surface, fg: colors.text, border: colors.borderStrong },
    subtle: { bg: colors.subtle, fg: colors.text },
    light: { bg: colors.surface, fg: colors.text },
    gold: { bg: colors.gold, fg: colors.text },
    ghost: { bg: 'transparent', fg: colors.text },
    danger: { bg: colors.surface, fg: colors.error, border: colors.error },
  };
  const p = palette[kind];
  const off = disabled || loading;
  return (
    <Touch
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={label}
      disabled={off}
      onPress={onPress}
      style={[
        {
          height: small ? 40 : 54,
          borderRadius: small ? 10 : 14,
          paddingHorizontal: small ? 16 : 20,
          backgroundColor: p.bg,
          borderWidth: p.border ? 1 : 0,
          borderColor: p.border,
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 8,
          opacity: disabled ? 0.4 : 1,
          overflow: 'hidden',
        },
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator color={p.fg} />
      ) : (
        <>
          {icon ? <Icon icon={icon} color={p.fg} size={small ? 16 : 20} /> : null}
          <Text variant={small ? 'smallStrong' : 'button'} color={p.fg} center>
            {label}
          </Text>
          {iconEnd ? <Icon icon={iconEnd} color={p.fg} size={small ? 16 : 20} flip /> : null}
        </>
      )}
    </Touch>
  );
}

export function IconButton({ icon, onPress, badge, flip, label, dark }: { icon: IconType; onPress?: () => void; badge?: number; flip?: boolean; label: string; dark?: boolean }) {
  return (
    <Touch
      onPress={onPress}
      accessibilityRole="button"
      // A badge's number is visible, so it is read out too.
      accessibilityLabel={badge ? `${label} ${badge}` : label}
      style={{
        width: 42,
        height: 42,
        borderRadius: 21,
        borderWidth: 1,
        borderColor: dark ? colors.inverseSoft : colors.border,
        backgroundColor: dark ? colors.inverseSoft : colors.surface,
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <Icon icon={icon} flip={flip} color={dark ? colors.textInverse : colors.text} />
      {badge ? (
        <View
          style={{
            position: 'absolute',
            top: -4,
            end: -4,
            minWidth: 20,
            height: 20,
            borderRadius: 10,
            backgroundColor: colors.inverse,
            borderWidth: 2,
            borderColor: colors.surface,
            alignItems: 'center',
            justifyContent: 'center',
            paddingHorizontal: 4,
          }}
        >
          <Text variant="caption" color={colors.textInverse} style={{ fontFamily: fonts.semibold, fontSize: 10, lineHeight: 12 }} center>
            {badge > 9 ? '9+' : String(badge)}
          </Text>
        </View>
      ) : null}
    </Touch>
  );
}

/* ---------- surfaces ---------- */

export function Card({ children, style, selected, onPress, dashed, testID, disabled }: { children: ReactNode; style?: StyleProp<ViewStyle>; selected?: boolean; onPress?: () => void; dashed?: boolean; testID?: string; disabled?: boolean }) {
  const base: ViewStyle = {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: selected ? 1.5 : 1,
    borderColor: selected ? colors.borderStrong : colors.border,
    borderStyle: dashed ? 'dashed' : 'solid',
    overflow: 'hidden',
  };
  // An option that can't be chosen right now still shows, dimmed, and says so to screen readers.
  if (onPress || disabled)
    return (
      <Touch testID={testID} onPress={onPress} disabled={disabled} accessibilityState={{ selected, disabled }} style={[base, style]}>
        {children}
      </Touch>
    );
  return (
    <View testID={testID} style={[base, style]}>
      {children}
    </View>
  );
}

export function Divider({ inset = 0 }: { inset?: number }) {
  return <View style={{ height: 1, backgroundColor: colors.border, marginStart: inset }} />;
}

export function Pill({ label, icon, dark, gold, tone }: { label: string; icon?: IconType; dark?: boolean; gold?: boolean; tone?: 'error' }) {
  const bg = dark ? colors.inverse : tone === 'error' ? colors.errorSoft : gold ? colors.goldSoft : colors.subtle;
  const fg = dark ? colors.textInverse : tone === 'error' ? colors.error : gold ? colors.goldInk : colors.text;
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: bg, borderRadius: radius.pill, paddingHorizontal: 10, height: 22, alignSelf: 'flex-start' }}>
      {icon ? <Icon icon={icon} size={13} color={fg} /> : null}
      <Text variant="caption" color={fg} style={{ fontFamily: fonts.medium }}>
        {label}
      </Text>
    </View>
  );
}

export function Chip({ label, selected, onPress, icon, testID }: { label: string; selected?: boolean; onPress?: () => void; icon?: IconType; testID?: string }) {
  return (
    <Touch
      testID={testID}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected }}
      style={{
        height: 40,
        paddingHorizontal: 16,
        borderRadius: radius.pill,
        borderWidth: 1,
        borderColor: selected ? colors.inverse : colors.border,
        backgroundColor: selected ? colors.inverse : colors.surface,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
      }}
    >
      {icon ? <Icon icon={icon} size={16} color={selected ? colors.textInverse : colors.text} /> : null}
      <Text variant="smallStrong" color={selected ? colors.textInverse : colors.text}>
        {label}
      </Text>
    </Touch>
  );
}

export function Radio({ on }: { on: boolean }) {
  return (
    <View
      style={{
        width: 22,
        height: 22,
        borderRadius: 11,
        borderWidth: on ? 6 : 1.5,
        borderColor: on ? colors.inverse : colors.border,
        backgroundColor: colors.surface,
      }}
    />
  );
}

export function SelectedCheck() {
  return (
    <View style={{ width: 22, height: 22, borderRadius: 11, backgroundColor: colors.inverse, alignItems: 'center', justifyContent: 'center' }}>
      <Check size={14} color={colors.textInverse} strokeWidth={2.5} />
    </View>
  );
}

export function ListRow({
  icon,
  title,
  subtitle,
  onPress,
  right,
  chevron = true,
  danger,
  testID,
}: {
  icon?: IconType;
  title: string;
  subtitle?: string;
  onPress?: () => void;
  right?: ReactNode;
  chevron?: boolean;
  danger?: boolean;
  testID?: string;
}) {
  const content = (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 14, paddingHorizontal: 16, paddingVertical: 14, minHeight: 70 }}>
      {icon ? <IconTile icon={icon} /> : null}
      <View style={{ flex: 1, gap: 2 }}>
        <Text variant="bodyStrong" color={danger ? colors.error : colors.text}>
          {title}
        </Text>
        {subtitle ? (
          <Text variant="small" color={colors.textSecondary}>
            {subtitle}
          </Text>
        ) : null}
      </View>
      {right}
      {chevron && onPress ? <Icon icon={ChevronRight} size={18} color={colors.textMuted} flip /> : null}
    </View>
  );
  return onPress ? (
    <Touch testID={testID} onPress={onPress} accessibilityRole="button">
      {content}
    </Touch>
  ) : (
    content
  );
}

export function SectionTitle({ title, action, onAction }: { title: string; action?: string; onAction?: () => void }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
      <Text variant="h2">{title}</Text>
      {action ? (
        <Touch onPress={onAction} hitSlop={10}>
          <Text variant="smallStrong">{action}</Text>
        </Touch>
      ) : null}
    </View>
  );
}

export function Overline({ children, color = colors.textSecondary, style }: { children: string; color?: string; style?: StyleProp<TextStyle> }) {
  return (
    <Text variant="overline" color={color} style={style}>
      {children}
    </Text>
  );
}

export function Note({ icon, children, tone = 'subtle' }: { icon?: IconType; children: ReactNode; tone?: 'subtle' | 'gold' | 'error' }) {
  const bg = tone === 'gold' ? colors.goldSoft : tone === 'error' ? colors.errorSoft : colors.subtle;
  const fg = tone === 'gold' ? colors.goldInk : tone === 'error' ? colors.error : colors.textSecondary;
  return (
    <View style={{ flexDirection: 'row', gap: 10, backgroundColor: bg, borderRadius: radius.md, padding: 14, alignItems: 'flex-start' }}>
      {icon ? (
        <View style={{ paddingTop: 1 }}>
          <Icon icon={icon} size={18} color={fg} />
        </View>
      ) : null}
      <View style={{ flex: 1 }}>{typeof children === 'string' ? <Text variant="small" color={fg}>{children}</Text> : children}</View>
    </View>
  );
}

/* ---------- inputs ---------- */

export function Field({
  label,
  hint,
  error,
  right,
  prefix,
  multiline,
  counter,
  style,
  onFocus,
  onBlur,
  ...input
}: TextInputProps & { label?: string; hint?: string; error?: string | null; right?: string; prefix?: ReactNode; counter?: string }) {
  const { isRTL } = useLocale();
  return (
    <View style={{ gap: 8 }}>
      {label || right ? (
        <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
          {label ? <Text variant="smallStrong">{label}</Text> : <View />}
          {right ? (
            <Text variant="small" color={colors.textMuted}>
              {right}
            </Text>
          ) : null}
        </View>
      ) : null}
      <View
        style={{
          minHeight: multiline ? 112 : 54,
          borderRadius: 14,
          borderWidth: 1,
          borderColor: error ? colors.error : 'transparent',
          backgroundColor: colors.subtle,
          flexDirection: 'row',
          alignItems: multiline ? 'flex-start' : 'center',
          paddingHorizontal: 16,
          gap: 12,
        }}
      >
        {prefix}
        <TextInput
          accessibilityLabel={label ?? input.placeholder}
          placeholderTextColor={colors.textMuted}
          multiline={multiline}
          style={[
            typeScale.body,
            {
              flex: 1,
              color: colors.text,
              paddingVertical: multiline ? 14 : 0,
              height: multiline ? 84 : 52,
              textAlign: isRTL ? 'right' : 'left',
              writingDirection: isRTL ? 'rtl' : 'ltr',
              textAlignVertical: multiline ? 'top' : 'center',
            },
            Platform.OS === 'web' ? ({ outlineStyle: 'none', borderWidth: 0, backgroundColor: 'transparent', minWidth: 0 } as any) : null,
            style,
          ]}
          onFocus={onFocus}
          onBlur={onBlur}
          {...input}
        />
        {counter ? (
          <Text variant="caption" color={colors.textMuted} style={{ position: 'absolute', bottom: 10, end: 14 }}>
            {counter}
          </Text>
        ) : null}
      </View>
      {error ? (
        <Text variant="small" color={colors.error}>
          {error}
        </Text>
      ) : hint ? (
        <Text variant="caption" color={colors.textMuted}>
          {hint}
        </Text>
      ) : null}
    </View>
  );
}

export function Stepper({ value, onChange, min = 1, max = 20, compact }: { value: number; onChange: (n: number) => void; min?: number; max?: number; compact?: boolean }) {
  const { t } = useLocale();
  const size = compact ? 28 : 36;
  const btn = (label: string, next: number, disabled: boolean) => (
    <Touch
      accessibilityRole="button"
      accessibilityLabel={label === '−' ? t('a11y.decrease') : t('a11y.increase')}
      disabled={disabled}
      onPress={() => onChange(next)}
      style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: compact ? colors.surface : colors.subtle, alignItems: 'center', justifyContent: 'center', opacity: disabled ? 0.35 : 1 }}
    >
      <Text variant={compact ? 'bodyStrong' : 'title'} center>
        {label}
      </Text>
    </Touch>
  );
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: compact ? 6 : 14, backgroundColor: compact ? colors.subtle : 'transparent', borderRadius: radius.pill, padding: compact ? 2 : 0 }}>
      {btn('−', value - 1, value <= min)}
      <Text variant={compact ? 'smallStrong' : 'title'} style={{ minWidth: 16 }} center>
        {String(value)}
      </Text>
      {btn('+', value + 1, value >= max)}
    </View>
  );
}

export function StepProgress({ step, label, stepLabel }: { step: number; label: string; stepLabel: string }) {
  return (
    <View style={{ paddingHorizontal: 20, gap: 8 }}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
        <Text variant="small" color={colors.textSecondary}>
          {stepLabel}
        </Text>
        <Text variant="smallStrong">{label}</Text>
      </View>
      <View style={{ flexDirection: 'row', gap: 6 }}>
        {[1, 2, 3, 4, 5].map((i) => (
          <View key={i} style={{ flex: 1, height: 4, borderRadius: 2, backgroundColor: i <= step ? colors.inverse : colors.border }} />
        ))}
      </View>
    </View>
  );
}

export function Avatar({ name, dark, size = 44 }: { name: string; dark?: boolean; size?: number }) {
  return (
    <View style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: dark ? colors.inverse : colors.subtle, alignItems: 'center', justifyContent: 'center' }}>
      <Text variant="bodyStrong" color={dark ? colors.textInverse : colors.text} center>
        {(name || '?').trim().charAt(0).toUpperCase()}
      </Text>
    </View>
  );
}

export function Loading() {
  return (
    <View style={{ padding: 48, alignItems: 'center' }}>
      <ActivityIndicator color={colors.inverse} />
    </View>
  );
}

export function ErrorState({ message, onRetry, retryLabel }: { message: string; onRetry?: () => void; retryLabel: string }) {
  return (
    <View style={{ padding: 32, alignItems: 'center', gap: 16 }}>
      <Text variant="body" color={colors.textSecondary} center>
        {message}
      </Text>
      {onRetry ? <Button label={retryLabel} kind="secondary" small onPress={onRetry} /> : null}
    </View>
  );
}

export function EmptyState({ icon, title, body, children }: { icon: IconType; title: string; body?: string; children?: ReactNode }) {
  return (
    <View style={{ alignItems: 'center', paddingVertical: 48, paddingHorizontal: 24, gap: 12 }}>
      <View style={{ width: 64, height: 64, borderRadius: 32, backgroundColor: colors.subtle, alignItems: 'center', justifyContent: 'center', marginBottom: 4 }}>
        <Icon icon={icon} size={28} />
      </View>
      <Text variant="h2" center>
        {title}
      </Text>
      {body ? (
        <Text variant="body" color={colors.textSecondary} center>
          {body}
        </Text>
      ) : null}
      {children ? <View style={{ alignSelf: 'stretch', gap: 10, marginTop: 12 }}>{children}</View> : null}
    </View>
  );
}
