import { Linking, Platform } from 'react-native';
import { router } from 'expo-router';
import type { Catalogue, OrderDetail } from '@/api/hooks';
import type { BuilderState } from '@/state/builder';

export function defaultsFor(cat: Catalogue | undefined): Partial<BuilderState> {
  if (!cat) return {};
  const fabric = cat.fabrics[0];
  return { collarId: cat.collars[0]?.id ?? null, fabricId: fabric?.id ?? null, colourId: fabric?.colour_ids.includes('ivory') ? 'ivory' : (fabric?.colour_ids[0] ?? null) };
}

export function openWhatsApp(number: string, text?: string) {
  const digits = number.replace(/\D/g, '');
  const url = `https://wa.me/${digits}${text ? `?text=${encodeURIComponent(text)}` : ''}`;
  if (Platform.OS === 'web') globalThis.open?.(url, '_blank');
  else Linking.openURL(url);
}

export function call(number: string) {
  Linking.openURL(`tel:${number}`);
}

export function openMaps(lat: number, lng: number) {
  const url = Platform.OS === 'ios' ? `maps://?daddr=${lat},${lng}` : `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}`;
  if (Platform.OS === 'web') globalThis.open?.(url, '_blank');
  else Linking.openURL(url);
}

export function reorderStateFrom(order: OrderDetail): Partial<BuilderState> | null {
  const thobe = order.items.find((i) => i.kind === 'thobe');
  if (!thobe) return null;
  const s = thobe.snapshot;
  return {
    collarId: s.thobe.collar?.id ?? null,
    fabricId: s.thobe.fabric?.id ?? null,
    colourId: s.thobe.colour?.id ?? null,
    memberId: s.member?.id ?? null,
    method: 'saved',
    qty: thobe.qty,
    remarks: s.remarks ?? '',
    reorderFrom: { orderId: order.id, number: order.number, date: order.created_at },
  };
}

export function go(path: string) {
  router.push(path as any);
}
