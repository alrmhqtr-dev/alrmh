import { Platform, Pressable, Text, View } from 'react-native';
import type { ErrorBoundaryProps } from 'expo-router';

/*
 * Shown instead of a blank screen when a screen fails to draw. It replaces the
 * whole app, including the language setting, so it speaks both languages and
 * uses nothing but plain components.
 */
// The last address the app showed. The crash screen replaces the navigator, which
// resets the address, so Try again on the web uses this to reopen the same screen.
let lastPath = '/';
export function useRememberPath(path: string) {
  lastPath = path;
}

export function CrashScreen({ error, retry }: ErrorBoundaryProps) {
  console.error('screen failed', error);
  const again = () => {
    if (Platform.OS === 'web') globalThis.location?.assign(lastPath);
    else retry();
  };
  const home = () => {
    if (Platform.OS === 'web') globalThis.location?.assign('/home');
    else retry();
  };
  const button = (label: string, onPress: () => void, primary: boolean, testID: string) => (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      style={{ height: 52, borderRadius: 14, alignItems: 'center', justifyContent: 'center', backgroundColor: primary ? '#0B0B0B' : '#FFFFFF', borderWidth: primary ? 0 : 1, borderColor: '#E8E2D6' }}
    >
      <Text style={{ color: primary ? '#FFFFFF' : '#0B0B0B', fontSize: 16, fontWeight: '600' }}>{label}</Text>
    </Pressable>
  );
  return (
    <View testID="crash-screen" accessibilityRole="alert" style={{ flex: 1, backgroundColor: '#FFFFFF', justifyContent: 'center', padding: 28, gap: 28 }}>
      <View style={{ gap: 8 }}>
        <Text style={{ fontSize: 22, fontWeight: '600', color: '#0B0B0B' }}>Something went wrong</Text>
        <Text style={{ fontSize: 15, color: '#4A4A4A' }}>Your basket and orders are safe. Try again, or go back to the home screen.</Text>
      </View>
      <View style={{ gap: 8 }}>
        <Text style={{ fontSize: 22, fontWeight: '600', color: '#0B0B0B', writingDirection: 'rtl', textAlign: 'right' }}>حدث خطأ ما</Text>
        <Text style={{ fontSize: 15, color: '#4A4A4A', writingDirection: 'rtl', textAlign: 'right' }}>سلتك وطلباتك محفوظة. حاول مجدداً أو عد إلى الشاشة الرئيسية.</Text>
      </View>
      <View style={{ gap: 10 }}>
        {button('Try again · حاول مجدداً', again, true, 'crash-retry')}
        {button('Home · الرئيسية', home, false, 'crash-home')}
      </View>
    </View>
  );
}
