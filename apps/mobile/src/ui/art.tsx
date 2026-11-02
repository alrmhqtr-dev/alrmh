import { View, type StyleProp, type ViewStyle } from 'react-native';
import Svg, { Circle, Ellipse, Line, Path, Rect } from 'react-native-svg';
import { ImageIcon } from 'lucide-react-native';
import { colors } from '@/theme/tokens';
import { Icon, Text } from './primitives';

function isDark(hex: string) {
  const h = hex.replace('#', '');
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16));
  return 0.299 * r + 0.587 * g + 0.114 * b < 120;
}

function collarPath(collar: string) {
  switch (collar) {
    case 'mandarin-band':
      return 'M47 21 Q60 27 73 21 L73 17 Q60 22 47 17 Z';
    case 'round-neck':
      return 'M47 20 Q60 32 73 20';
    case 'wide-collar':
      return 'M45 18 L55 31 L60 23 L65 31 L75 18 Q60 24 45 18 Z';
    default:
      return 'M47 21 Q60 28 73 21 L74 13 Q60 19 46 13 Z';
  }
}

export function ThobeArt({ fill = '#F3EBDC', collar = 'classic-qatari', height = 200 }: { fill?: string; collar?: string; height?: number }) {
  const dark = isDark(fill);
  const stroke = dark ? '#6E6E6E' : '#B9B1A2';
  const detail = dark ? '#8C8C8C' : '#CFC7B8';
  return (
    <Svg width={height * 0.5} height={height} viewBox="0 0 120 240" accessibilityLabel="Thobe preview">
      <Ellipse cx="60" cy="232" rx="34" ry="3.5" fill="#000" opacity={0.08} />
      <Path
        d="M46 18 L36 25 Q26 30 22 40 L12 120 Q11 124 15 124.5 L23 125 Q26 125 26.5 121 L33 66 L30 226 Q30 229 33 229 L87 229 Q90 229 90 226 L87 66 L93.5 121 Q94 125 97 125 L105 124.5 Q109 124 108 120 L98 40 Q94 30 84 25 L74 18 Q60 26 46 18 Z"
        fill={fill}
        stroke={stroke}
        strokeWidth={1.2}
        strokeLinejoin="round"
      />
      <Line x1="60" y1="25" x2="60" y2="84" stroke={detail} strokeWidth={1} />
      {[36, 48, 60, 72].map((y) => (
        <Circle key={y} cx="60" cy={y} r="1.6" fill={stroke} />
      ))}
      <Rect x="67" y="38" width="11" height="14" rx="1.5" fill="none" stroke={stroke} strokeWidth={1} />
      <Line x1="44" y1="130" x2="43" y2="220" stroke={detail} strokeWidth={0.8} />
      <Line x1="76" y1="130" x2="77" y2="220" stroke={detail} strokeWidth={0.8} />
      <Path d={collarPath(collar)} fill={collar === 'round-neck' ? 'none' : fill} stroke={stroke} strokeWidth={1.2} strokeLinejoin="round" />
    </Svg>
  );
}

export function CollarGlyph({ collar, size = 44 }: { collar: string; size?: number }) {
  const d: Record<string, string> = {
    'classic-qatari': 'M6 6 L22 18 L38 6 M12 6 L22 13 L32 6',
    'mandarin-band': 'M6 6 Q22 10 38 6 L38 10 Q22 14 6 10 Z M22 12 L22 20',
    'round-neck': 'M8 6 Q22 22 36 6 M22 14 L22 22',
    'wide-collar': 'M4 8 L14 16 L22 9 L30 16 L40 8 Q22 4 4 8 Z',
  };
  return (
    <Svg width={size} height={size * 0.55} viewBox="0 0 44 24">
      <Path d={d[collar] ?? d['classic-qatari']} fill="none" stroke={colors.text} strokeWidth={1.8} strokeLinejoin="round" strokeLinecap="round" />
    </Svg>
  );
}

export function ProductArt({ label, style, small }: { label?: string; style?: StyleProp<ViewStyle>; small?: boolean }) {
  return (
    <View style={[{ backgroundColor: colors.subtle, borderRadius: 16, alignItems: 'center', justifyContent: 'center', gap: 6, aspectRatio: 1 }, style]}>
      <Icon icon={ImageIcon} size={small ? 20 : 28} color={colors.textMuted} />
      {label ? (
        <Text variant="caption" color={colors.textMuted} center>
          {label}
        </Text>
      ) : null}
    </View>
  );
}

export function Swatch({ hex, size = 40, selected }: { hex: string; size?: number; selected?: boolean }) {
  return (
    <View
      style={{
        width: size + 8,
        height: size + 8,
        borderRadius: (size + 8) / 2,
        borderWidth: selected ? 2 : 0,
        borderColor: colors.inverse,
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <View style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: hex, borderWidth: 1, borderColor: colors.border }} />
    </View>
  );
}
