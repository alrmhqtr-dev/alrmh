import { View } from 'react-native';
import { Tabs, router, usePathname } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { FileText, Gift, House, ShoppingBag, User } from 'lucide-react-native';
import { useLocale } from '@/i18n';
import { Icon, Text, Touch } from '@/ui/primitives';
import { colors, fonts } from '@/theme/tokens';

const TABS = [
  { name: 'home', icon: House, key: 'tabs.home' },
  { name: 'shop', icon: ShoppingBag, key: 'tabs.shop' },
  { name: 'orders', icon: FileText, key: 'tabs.orders' },
  { name: 'rewards', icon: Gift, key: 'tabs.rewards' },
  { name: 'account', icon: User, key: 'tabs.account' },
] as const;

function TabBar() {
  const { t } = useLocale();
  const pathname = usePathname();
  const insets = useSafeAreaInsets();
  return (
    <View
      style={{
        flexDirection: 'row',
        borderTopWidth: 1,
        borderTopColor: colors.border,
        backgroundColor: colors.canvas,
        paddingTop: 9,
        paddingBottom: Math.max(insets.bottom, 10),
        paddingHorizontal: 8,
      }}
    >
      {TABS.map((tab) => {
        const focused = pathname === `/${tab.name}` || pathname.startsWith(`/${tab.name}/`);
        return (
          <Touch
            key={tab.name}
            testID={`tab-${tab.name}`}
            accessibilityRole="tab"
            accessibilityState={{ selected: focused }}
            onPress={() => {
              if (!focused) router.navigate(`/${tab.name}` as any);
            }}
            style={{ flex: 1, alignItems: 'center', gap: 4, paddingVertical: 2 }}
          >
            <Icon icon={tab.icon} size={24} color={focused ? colors.text : colors.textMuted} strokeWidth={focused ? 2 : 1.6} />
            <Text variant="caption" color={focused ? colors.text : colors.textMuted} style={{ fontFamily: focused ? fonts.semibold : fonts.regular, fontSize: 12 }} center>
              {t(tab.key)}
            </Text>
          </Touch>
        );
      })}
    </View>
  );
}

export default function TabsLayout() {
  return (
    <Tabs tabBar={() => <TabBar />} screenOptions={{ headerShown: false, sceneStyle: { backgroundColor: colors.canvas } }}>
      {TABS.map((tab) => (
        <Tabs.Screen key={tab.name} name={tab.name} />
      ))}
    </Tabs>
  );
}
