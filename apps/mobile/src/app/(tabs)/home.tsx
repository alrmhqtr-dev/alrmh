import { RefreshControl, ScrollView, View } from 'react-native';
import { router } from 'expo-router';
import { useQueryClient } from '@tanstack/react-query';
import { ArrowRight, Bell, Clock, MessageCircle, Repeat, Ruler, Scissors, Store, Users } from 'lucide-react-native';
import { useLocale } from '@/i18n';
import { useSession } from '@/state/session';
import { useBuilder } from '@/state/builder';
import { useCatalogue, useFamily, useMe, useOrders, useRewards } from '@/api/hooks';
import { defaultsFor, openWhatsApp } from '@/lib/actions';
import { Button, Card, Icon, IconButton, IconTile, SectionTitle, Text, Touch } from '@/ui/primitives';
import { BagButton, Screen } from '@/ui/layout';
import { ActiveOrderCard, ProductCard } from '@/ui/commerce';
import { colors, radius } from '@/theme/tokens';

export default function Home() {
  const { t, f } = useLocale();
  const qc = useQueryClient();
  const { signedIn } = useSession();
  const builder = useBuilder();
  const cat = useCatalogue();
  const me = useMe();
  const rewards = useRewards();
  const orders = useOrders();
  const family = useFamily();

  const firstName = (me.data?.name ?? '').split(' ')[0];
  const greeting = f.hourOfDay() < 12 ? t('home.morning') : t('home.evening');
  const active = orders.data?.active[0];
  const hasHistory = Boolean(orders.data && (orders.data.active.length || orders.data.past.length));
  const lastThobeOrder = [...(orders.data?.active ?? []), ...(orders.data?.past ?? [])].find((o) => o.thobe_count > 0);
  const showBalance = signedIn && rewards.data && (rewards.data.balance > 0 || hasHistory);
  const support = cat.data?.settings.support.whatsapp ?? '';
  const branch = cat.data?.branches[0];

  const startDesign = () => {
    builder.reset(defaultsFor(cat.data));
    router.push('/design/collar');
  };
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
        <View style={{ backgroundColor: colors.inverse, borderRadius: radius.xl, padding: 20, gap: 16 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
            <View>
              <Text variant="overline" color={colors.gold}>
                {t('home.rewardsBalance')}
              </Text>
              <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 6, marginTop: 4 }}>
                <Text variant="display" color={colors.gold}>
                  {f.num(rewards.data!.balance)}
                </Text>
                <Text variant="body" color={colors.gold}>
                  {t('rewards.pts')}
                </Text>
              </View>
            </View>
            <Button testID="home-redeem" label={t('home.redeem')} kind="gold" small iconEnd={ArrowRight} onPress={() => router.push('/rewards/redeem')} />
          </View>
          {rewards.data!.expiring ? (
            <Touch onPress={() => router.push('/rewards/redeem')} style={{ backgroundColor: colors.surface, borderRadius: radius.md, padding: 12, flexDirection: 'row', gap: 10, alignItems: 'center' }}>
              <Icon icon={Clock} size={18} color={colors.error} />
              <Text variant="small" color={colors.error} style={{ flex: 1 }}>
                {t('home.expiring', {
                  pts: f.num(rewards.data!.expiring.points),
                  days: f.daysUntil(rewards.data!.expiring.expires_at),
                  date: f.day(rewards.data!.expiring.expires_at),
                })}
              </Text>
            </Touch>
          ) : null}
        </View>
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
        <Card testID="home-design" onPress={startDesign} style={{ flex: 1, padding: 17, minHeight: 200, gap: 10 }}>
          <IconTile icon={Scissors} dark />
          <Text variant="title">{t('home.designNew')}</Text>
          <Text variant="small" color={colors.textSecondary}>
            {t('home.designNewBody')}
          </Text>
        </Card>
        <Card
          testID="home-again"
          onPress={() => (lastThobeOrder ? router.push(`/reorder/${lastThobeOrder.id}`) : signedIn ? startDesign() : router.push('/auth/phone'))}
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
            { icon: Store, title: t('home.branch'), sub: f.name(branch) || ' ', onPress: () => router.push('/account/help'), id: 'quick-branch' },
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
