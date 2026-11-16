import { RefreshControl, ScrollView, View } from 'react-native';
import { router, useIsFocused } from 'expo-router';
import { useQueryClient } from '@tanstack/react-query';
import { ArrowRight, Award, Bell, CalendarPlus, MessageCircle, Repeat, Ruler, Store, Users } from 'lucide-react-native';
import { useLocale } from '@/i18n';
import { useSession } from '@/state/session';
import { useCatalogue, useFamily, useMe, useOrders, useRewards } from '@/api/hooks';
import { openWhatsApp } from '@/lib/actions';
import { Button, Card, Icon, IconButton, IconTile, SectionTitle, Text, Touch } from '@/ui/primitives';
import { BagButton, Screen } from '@/ui/layout';
import { ActiveOrderCard, ProductCard } from '@/ui/commerce';
import { colors, radius } from '@/theme/tokens';

export default function Home() {
  const { t, f } = useLocale();
  const qc = useQueryClient();
  const { signedIn } = useSession();
  const cat = useCatalogue();
  const focused = useIsFocused();
  const me = useMe(focused);
  const rewards = useRewards();
  const orders = useOrders(focused);
  const family = useFamily();

  const firstName = (me.data?.name ?? '').split(' ')[0];
  const greeting = f.hourOfDay() < 12 ? t('home.morning') : t('home.evening');
  const active = orders.data?.active[0];
  const hasHistory = Boolean(orders.data && (orders.data.active.length || orders.data.past.length));
  const lastThobeOrder = [...(orders.data?.active ?? []), ...(orders.data?.past ?? [])].find((o) => o.thobe_count > 0);
  const showBalance = Boolean(signedIn && rewards.data);
  const support = cat.data?.settings.support.whatsapp ?? '';
  const branch = cat.data?.branches[0];
  const branchCount = cat.data?.branches.length ?? 0;

  const needAuth = (path: string) => (signedIn ? router.push(path as any) : router.push('/auth/phone'));

  return (
    <Screen
      refreshControl={<RefreshControl refreshing={false} onRefresh={() => qc.invalidateQueries()} />}
      contentStyle={{ paddingTop: 8, gap: 24 }}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
        <View style={{ flex: 1 }}>
          <Text variant="small" color={colors.textSecondary}>
            {signedIn ? greeting : t('home.guest')}
          </Text>
          <Text variant="h1" numberOfLines={1}>
            {signedIn ? firstName || ' ' : 'AlRmh'}
          </Text>
        </View>
        <View style={{ flexDirection: 'row', gap: 10 }}>
          <IconButton icon={Bell} label={t('account.notifications')} badge={me.data?.counts.unread} onPress={() => needAuth('/account/notifications')} />
          <BagButton />
        </View>
      </View>

      {showBalance ? (
        <Touch
          testID="home-tier"
          accessibilityRole="button"
          onPress={() => router.push('/rewards')}
          style={{ backgroundColor: colors.inverse, borderRadius: radius.xl, padding: 20, flexDirection: 'row', alignItems: 'center', gap: 14 }}
        >
          <View style={{ width: 44, height: 44, borderRadius: 22, borderWidth: 2, borderColor: rewards.data!.tier.colour, alignItems: 'center', justifyContent: 'center' }}>
            <Icon icon={Award} size={22} color={rewards.data!.tier.colour} />
          </View>
          <View style={{ flex: 1 }}>
            <Text variant="overline" color={rewards.data!.tier.colour}>
              {t('home.tierLine', { tier: f.name(rewards.data!.tier) })}
            </Text>
            <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 6, marginTop: 2 }}>
              <Text variant="h1" color={colors.textInverse}>
                {f.num(rewards.data!.balance)}
              </Text>
              <Text variant="body" color={colors.textInverse}>
                {t('rewards.pts')}
              </Text>
            </View>
            <Text variant="caption" color="rgba(255,255,255,0.7)">
              {rewards.data!.next ? t('rewards.toNext', { pts: f.num(rewards.data!.toNext), tier: f.name(rewards.data!.next) }) : t('rewards.worth', { amount: f.money(rewards.data!.balance) })}
            </Text>
          </View>
          <Icon icon={ArrowRight} size={20} color={colors.textInverse} flip />
        </Touch>
      ) : (
        <View style={{ backgroundColor: colors.inverse, borderRadius: radius.xl, padding: 20, gap: 6 }}>
          <Text variant="overline" color={colors.gold}>
            {t('home.rewardsNew')}
          </Text>
          <Text variant="h2" color={colors.textInverse}>
            {t('home.rewardsNewTitle')}
          </Text>
          <Text variant="small" color="rgba(255,255,255,0.7)">
            {t('home.rewardsNewBody')}
          </Text>
        </View>
      )}

      <View style={{ flexDirection: 'row', gap: 12 }}>
        <Card testID="home-design" onPress={() => needAuth('/book?standalone=1')} style={{ flex: 1, padding: 17, minHeight: 200, gap: 10 }}>
          <IconTile icon={CalendarPlus} dark />
          <Text variant="title">{t('home.newOrder')}</Text>
          <Text variant="small" color={colors.textSecondary}>
            {t('home.newOrderBody', { fee: f.money(cat.data?.settings.appointment_fee ?? 0) })}
          </Text>
        </Card>
        <Card
          testID="home-again"
          onPress={() => (lastThobeOrder ? router.push('/reorder') : signedIn ? router.push('/book?standalone=1') : router.push('/auth/phone'))}
          style={{ flex: 1, padding: 17, minHeight: 200, gap: 10 }}
        >
          <IconTile icon={Repeat} />
          <Text variant="title">{t('home.orderAgain')}</Text>
          <Text variant="small" color={colors.textSecondary}>
            {lastThobeOrder ? t('home.orderAgainBody') : t('home.orderAgainEmpty')}
          </Text>
        </Card>
      </View>

      {active ? (
        <ActiveOrderCard order={active} />
      ) : (
        <Card style={{ padding: 18, gap: 4 }}>
          <Text variant="bodyStrong">{t('home.noActive')}</Text>
          <Text variant="small" color={colors.textSecondary}>
            {t('home.noActiveBody')}
          </Text>
        </Card>
      )}

      <View>
        <SectionTitle title={t('home.quick')} />
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 12 }}>
          {[
            { icon: Ruler, title: t('home.bookMeasure'), sub: t('home.bookMeasureSub'), onPress: () => needAuth('/book?standalone=1&kind=branch'), id: 'quick-book' },
            { icon: Users, title: t('home.family'), sub: family.data?.length === 1 ? t('home.familySub1') : t('home.familySub', { n: family.data?.length ?? 0 }), onPress: () => needAuth('/account/family'), id: 'quick-family' },
            { icon: Store, title: t('home.branch'), sub: branchCount > 1 ? t('home.branchesN', { n: branchCount }) : f.name(branch) || ' ', onPress: () => router.push('/account/help'), id: 'quick-branch' },
            { icon: MessageCircle, title: t('home.help'), sub: t('home.helpSub'), onPress: () => openWhatsApp(support), id: 'quick-help' },
          ].map((q) => (
            <Card key={q.id} testID={q.id} onPress={q.onPress} style={{ width: '47.5%', flexGrow: 1, padding: 15, gap: 8 }}>
              <Icon icon={q.icon} size={22} />
              <Text variant="bodyStrong">{q.title}</Text>
              <Text variant="small" color={colors.textSecondary}>
                {q.sub}
              </Text>
            </Card>
          ))}
        </View>
      </View>

      {cat.data ? (
        <View>
          <SectionTitle title={t('home.completeLook')} action={t('common.seeAll')} onAction={() => router.push('/shop')} />
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 12 }}>
            {cat.data.products.slice(0, 4).map((p) => (
              <View key={p.id} style={{ width: 170 }}>
                <ProductCard product={p} onPress={() => router.push(`/product/${p.id}`)} />
              </View>
            ))}
          </ScrollView>
        </View>
      ) : null}
    </Screen>
  );
}
