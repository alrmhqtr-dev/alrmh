export const colors = {
  canvas: '#FFFFFF',
  surface: '#FFFFFF',
  subtle: '#F4F0E8',
  inverse: '#0B0B0B',
  inverseSoft: '#262626',
  text: '#0B0B0B',
  textSecondary: '#4A4A4A',
  textMuted: '#666666',
  textInverse: '#FFFFFF',
  border: '#E8E2D6',
  borderStrong: '#0B0B0B',
  error: '#C62828',
  errorSoft: '#FDECEC',
  gold: '#C9A55C',
  goldSoft: '#F7EFDD',
  goldInk: '#7A5A1C',
} as const;

export const radius = { sm: 8, md: 12, lg: 16, xl: 20, pill: 999 } as const;

export const space = { xs: 4, sm: 8, md: 12, lg: 16, xl: 20, xxl: 24, xxxl: 32 } as const;

export const fonts = {
  regular: 'ReadexPro_400Regular',
  medium: 'ReadexPro_500Medium',
  semibold: 'ReadexPro_600SemiBold',
  bold: 'ReadexPro_700Bold',
  ruqaa: 'ArefRuqaa_400Regular',
  ruqaaBold: 'ArefRuqaa_700Bold',
  garamond: 'CormorantGaramond_500Medium',
} as const;

export const type = {
  display: { fontFamily: fonts.semibold, fontSize: 32, lineHeight: 40, letterSpacing: -0.5 },
  h1: { fontFamily: fonts.semibold, fontSize: 26, lineHeight: 34, letterSpacing: -0.3 },
  h2: { fontFamily: fonts.semibold, fontSize: 20, lineHeight: 28 },
  title: { fontFamily: fonts.medium, fontSize: 17, lineHeight: 24 },
  body: { fontFamily: fonts.regular, fontSize: 15, lineHeight: 22 },
  bodyStrong: { fontFamily: fonts.medium, fontSize: 15, lineHeight: 22 },
  small: { fontFamily: fonts.regular, fontSize: 13, lineHeight: 18 },
  smallStrong: { fontFamily: fonts.medium, fontSize: 13, lineHeight: 18 },
  overline: { fontFamily: fonts.semibold, fontSize: 11, lineHeight: 14, letterSpacing: 1.4, textTransform: 'uppercase' as const },
  button: { fontFamily: fonts.medium, fontSize: 16, lineHeight: 20 },
  price: { fontFamily: fonts.semibold, fontSize: 18, lineHeight: 24 },
  caption: { fontFamily: fonts.regular, fontSize: 11, lineHeight: 14 },
} as const;

export type TypeVariant = keyof typeof type;
