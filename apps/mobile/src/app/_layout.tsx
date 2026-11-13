import { useEffect, useState } from 'react';
import { AppState, Platform, View } from 'react-native';
import { Stack, usePathname } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import * as SplashScreen from 'expo-splash-screen';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { QueryClient, QueryClientProvider, focusManager } from '@tanstack/react-query';
import { useFonts } from 'expo-font';
import { ReadexPro_400Regular, ReadexPro_500Medium, ReadexPro_600SemiBold, ReadexPro_700Bold } from '@expo-google-fonts/readex-pro';
import { ArefRuqaa_400Regular, ArefRuqaa_700Bold } from '@expo-google-fonts/aref-ruqaa';
import { CormorantGaramond_500Medium } from '@expo-google-fonts/cormorant-garamond';
import { LocaleProvider, useLocale } from '@/i18n';
import { SessionProvider } from '@/state/session';
import { BuilderProvider } from '@/state/builder';
import { colors } from '@/theme/tokens';
import { ApiError } from '@/api/client';
import { CrashScreen, useRememberPath } from '@/ui/crash';

// Any screen that fails to draw shows this instead of a blank page.
export const ErrorBoundary = CrashScreen;

SplashScreen.preventAutoHideAsync().catch(() => {});

function Shell() {
  const { isRTL } = useLocale();
  useRememberPath(usePathname());
  return (
    <View style={{ flex: 1, direction: isRTL ? 'rtl' : 'ltr', backgroundColor: Platform.OS === 'web' ? '#EDEAE4' : colors.canvas }}>
      <View
        style={
          Platform.OS === 'web'
            ? { flex: 1, width: '100%', maxWidth: 480, alignSelf: 'center', backgroundColor: colors.canvas, overflow: 'hidden' }
            : { flex: 1 }
        }
      >
        <StatusBar style="dark" />
        <Stack
          screenOptions={{
            headerShown: false,
            contentStyle: { backgroundColor: colors.canvas },
            animation: Platform.OS === 'android' ? 'fade_from_bottom' : 'default',
          }}
        />
      </View>
    </View>
  );
}

export default function RootLayout() {
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            retry: (count, err) => !(err instanceof ApiError && err.status >= 400 && err.status < 500) && count < 2,
            staleTime: 20_000,
            refetchOnWindowFocus: true,
          },
        },
      }),
  );
  const [loaded] = useFonts({
    ReadexPro_400Regular,
    ReadexPro_500Medium,
    ReadexPro_600SemiBold,
    ReadexPro_700Bold,
    ArefRuqaa_400Regular,
    ArefRuqaa_700Bold,
    CormorantGaramond_500Medium,
  });

  useEffect(() => {
    if (loaded) SplashScreen.hideAsync().catch(() => {});
  }, [loaded]);

  // The browser reports this by itself; on iOS and Android the app has to pass it on,
  // so data refreshes when the customer returns to the app and pauses while it is away.
  useEffect(() => {
    if (Platform.OS === 'web') return;
    const sub = AppState.addEventListener('change', (state) => focusManager.setFocused(state === 'active'));
    return () => sub.remove();
  }, []);

  if (!loaded) return null;

  return (
    <SafeAreaProvider>
      <QueryClientProvider client={client}>
        <LocaleProvider>
          <SessionProvider>
            <BuilderProvider>
              <Shell />
            </BuilderProvider>
          </SessionProvider>
        </LocaleProvider>
      </QueryClientProvider>
    </SafeAreaProvider>
  );
}
