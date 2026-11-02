import type { ExpoConfig } from 'expo/config';

const baseUrl = process.env.EXPO_BASE_URL ?? '';

const config: ExpoConfig = {
  name: 'AlRmh',
  slug: 'alrmh',
  scheme: 'alrmh',
  version: '0.1.0',
  orientation: 'portrait',
  icon: './assets/icon.png',
  userInterfaceStyle: 'light',
  ios: {
    supportsTablet: false,
    bundleIdentifier: 'qa.alrmh.app',
  },
  android: {
    package: 'qa.alrmh.app',
    adaptiveIcon: {
      backgroundColor: '#0B0B0B',
      foregroundImage: './assets/android-icon-foreground.png',
      backgroundImage: './assets/android-icon-background.png',
      monochromeImage: './assets/android-icon-monochrome.png',
    },
    predictiveBackGestureEnabled: false,
  },
  web: {
    output: 'single',
    bundler: 'metro',
    favicon: './assets/favicon.png',
    name: 'AlRmh — Tailored thobes',
    shortName: 'AlRmh',
    themeColor: '#0B0B0B',
    backgroundColor: '#FFFFFF',
    lang: 'en',
  },
  plugins: ['expo-router', 'expo-font', 'expo-splash-screen', 'expo-secure-store'],
  experiments: {
    typedRoutes: false,
    ...(baseUrl ? { baseUrl } : {}),
  },
};

export default config;
