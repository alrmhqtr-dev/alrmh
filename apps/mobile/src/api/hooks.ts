import { useQuery } from '@tanstack/react-query';
import { api } from './client';
import { useSession } from '@/state/session';

export type Bi = { name_en: string; name_ar: string };
export type Collar = Bi & { id: string; shape?: string };
export type Category = Bi & { id: string };
export type Fabric = Bi & { id: string; note_en: string; note_ar: string; price: number; colour_ids: string[] };
export type Colour = Bi & { id: string; hex: string };
export type Product = Bi & { id: string; category: string; description_en: string; description_ar: string; price: number; sizes: string[]; image_url: string | null };
export type Branch = Bi & { id: string; address_en: string; address_ar: string; phone: string; whatsapp: string; hours_en: string; hours_ar: string; closed_weekdays: number[]; lat: number | null; lng: number | null };
export type Catalogue = {
  collars: Collar[];
  fabrics: Fabric[];
  colours: Colour[];
  categories: Category[];
  products: Product[];
  branches: Branch[];
  settings: {
    delivery_fee: number;
    home_visit_fee: number;
    appointment_fee: number;
    lead_working_days: number;
    measurements_valid_months: number;
    points: { expiry_months: number; warn_days: number };
    support: { whatsapp: string; phone: string };
  };
  tiers: Tier[];
};
/** A loyalty tier. Customers move up by points ever earned; points are worth QAR 1 each at checkout. */
export type Tier = Bi & { id: string; min_points: number; points_per_product: number; points_per_thobe: number; colour: string };
export type Me = {
  id: string;
  phone: string;
  name: string | null;
  email: string | null;
  language: string;
  points: number;
  counts: { family: number; addresses: number; active_orders: number; unread: number; basket: number };
};
export type Member = {
  id: string;
  name: string;
  relation: string;
  size: string;
  measured_at: string | null;
  measured_method: string | null;
  branch_name_en: string | null;
  branch_name_ar: string | null;
  measurement_stale: boolean | null;
  next_appointment: string | null;
};
export type Measurement = {
  id: string;
  taken_at: string;
  method: string;
  tailor_name: string;
  length_cm: number;
  shoulder_cm: number;
  chest_cm: number;
  waist_cm: number;
  sleeve_cm: number;
  neck_cm: number;
  cuff_cm: number;
  remarks: string | null;
  branch_name_en: string | null;
  branch_name_ar: string | null;
};
export type Address = { id: string; label: string; line1: string; area: string; city: string; notes: string | null; is_default: boolean };
export type BasketLine = {
  id: string;
  kind: 'thobe' | 'product';
  qty: number;
  unitPrice: number;
  lineTotal: number;
  points: number;
  product?: Bi & { id: string; category: string; image_url?: string | null };
  size?: string | null;
  thobe?: { collar: Collar; fabric: Fabric; colour: Colour };
  member?: { id: string; name: string; relation: string; size: string };
  measureMethod?: 'saved' | 'branch' | 'home';
  remarks?: string | null;
  appointment?: { id: string; kind: string; startsAt: string; branch_en: string | null; branch_ar: string | null; area: string | null } | null;
};
export type Basket = { items: BasketLine[]; count: number; subtotal: number; pointsToEarn: number };
export type PickupAddress = { pickup: true; branchId: string; id?: undefined; label: string; label_ar: string; line1: string; line1_ar: string; area: string; city: string };

export type Quote = Basket & {
  deliveryFee: number;
  homeVisitFee: number;
  discount: number;
  discountLabel: string | null;
  total: number;
  address: (Address & { pickup?: false }) | PickupAddress | null;
  pickup: boolean;
  coupon: null | { code: string; percent?: number; maxDiscount?: number | null; error?: string; min?: number };
  pointsBalance: number;
  pointsUsed: number;
  tier: Tier;
};
export type OrderSummary = {
  id: string;
  number: string;
  stage: string;
  total: number;
  created_at: string;
  closed_at: string | null;
  expected_delivery: string | null;
  item_count: number;
  thobe_count: number;
  members: string[] | null;
  thobes: ThobeLine[] | null;
};
/** One thobe line of a past order, as re-order shows it. */
export type ThobeLine = { collar: Collar; fabric: Bi & { id: string; price: number }; colour: Colour | null; member: { id: string; name: string }; qty: number };
export type OrderItem = { id: string; kind: 'thobe' | 'product' | 'reward'; snapshot: any; qty: number; unit_price: number; line_total: number };
export type OrderDetail = OrderSummary & {
  subtotal: number;
  delivery_fee: number;
  home_visit_fee: number;
  discount: number;
  discount_label: string | null;
  /** A pickup order (placed in store) carries the branch instead of a home address. */
  address: Address & { pickup?: boolean; label_ar?: string; line1_ar?: string };
  points_to_earn: number;
  points_awarded: boolean;
  points_used: number;
  payment_status: string;
  payment_provider: string | null;
  refunded: number;
  items: OrderItem[];
  events: { stage: string; at: string; note: string | null }[];
  appointments: { id: string; kind: string; starts_at: string; status: string; member_name: string; branch_name_en: string | null; branch_name_ar: string | null; area: string | null }[];
  stages: string[];
};
export type Appointment = {
  id: string;
  kind: 'branch' | 'home';
  starts_at: string;
  status: string;
  order_id: string | null;
  fee: number;
  member_name: string;
  area: string | null;
  branch_id: string | null;
  branch_name_en: string | null;
  branch_name_ar: string | null;
};
export type LedgerEntry = { id: string; kind: 'earn' | 'redeem' | 'expire' | 'adjust' | 'refund'; points: number; remaining?: number; expires_at: string | null; label: string | null; created_at: string };
export type Rewards = { balance: number; tier: Tier; next: Tier | null; lifetime: number; toNext: number; expiryMonths: number };
export type Notification = { id: string; kind: string; title_en: string; title_ar: string; body_en: string; body_ar: string; link: string | null; created_at: string; read_at: string | null };
export type Slots = { closedWeekdays: number[]; days: { date: string; weekday: number; available: boolean; times: { startsAt: string; minute: number; available: boolean }[] }[] };

const authed = () => ({ enabled: useSession().signedIn });

// Short-lived, so a change made in the admin shows the next time a screen opens or the app comes back to the front.
export const useCatalogue = () => useQuery({ queryKey: ['catalogue'], queryFn: () => api<Catalogue>('/catalogue', { auth: false }), staleTime: 30_000 });

/*
 * "live" keeps a screen current while it is open and in front: it asks again
 * every few seconds. React Query pauses these while the app is in the
 * background, and screens pass `useIsFocused()` so hidden screens stay quiet.
 */
const CLOSED_STAGES = ['delivered', 'cancelled'];
export const useMe = (live = false) => useQuery({ queryKey: ['me'], queryFn: () => api<Me>('/me'), ...authed(), refetchInterval: live ? 30_000 : false });
export const useFamily = () => useQuery({ queryKey: ['family'], queryFn: () => api<Member[]>('/family'), ...authed() });
export const useMember = (id: string) =>
  useQuery({ queryKey: ['member', id], queryFn: () => api<{ id: string; name: string; relation: string; size: string; latest: Measurement | null; history: Measurement[] }>(`/family/${id}`), enabled: useSession().signedIn && Boolean(id) });
export const useAddresses = () => useQuery({ queryKey: ['addresses'], queryFn: () => api<Address[]>('/addresses'), ...authed() });
export const useBasket = () => useQuery({ queryKey: ['basket'], queryFn: () => api<Basket>('/basket'), ...authed() });
export const useOrders = (live = false) =>
  useQuery({ queryKey: ['orders'], queryFn: () => api<{ active: OrderSummary[]; past: OrderSummary[] }>('/orders'), ...authed(), refetchInterval: live ? 20_000 : false });
export const useOrder = (id: string, live = false) =>
  useQuery({
    queryKey: ['order', id],
    queryFn: () => api<OrderDetail>(`/orders/${id}`),
    ...authed(),
    // Opening the tracking screen always asks for the current stage, then keeps asking until the order is closed.
    ...(live ? { staleTime: 0 } : {}),
    refetchInterval: (q) => (live && !CLOSED_STAGES.includes(q.state.data?.stage ?? '') ? 10_000 : false),
  });
export const useAppointments = () => useQuery({ queryKey: ['appointments'], queryFn: () => api<Appointment[]>('/appointments'), ...authed() });
export const useRewards = () => useQuery({ queryKey: ['rewards'], queryFn: () => api<Rewards>('/rewards'), ...authed() });
/** The points rates to show: the customer's own tier, or the starting tier for guests. */
export function usePointRates(): Tier | undefined {
  const { signedIn } = useSession();
  const rewards = useRewards();
  const cat = useCatalogue();
  return (signedIn ? rewards.data?.tier : undefined) ?? cat.data?.tiers?.[0];
}
export const useNotifications = () => useQuery({ queryKey: ['notifications'], queryFn: () => api<Notification[]>('/notifications'), ...authed() });
export const useSlots = (kind: 'branch' | 'home', branchId?: string) =>
  useQuery({
    queryKey: ['slots', kind, branchId],
    queryFn: () => api<Slots>(`/slots?kind=${kind}&days=10${branchId ? `&branchId=${branchId}` : ''}`),
    enabled: useSession().signedIn && (kind === 'home' || Boolean(branchId)),
  });
