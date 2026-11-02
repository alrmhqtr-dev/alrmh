import type { Format, StringKey } from '@/i18n';
import type { Member } from '@/api/hooks';

type T = (k: StringKey, p?: Record<string, string | number>) => string;

export function memberTitle(m: Pick<Member, 'name' | 'relation'>, t: T) {
  return m.relation === 'self' ? t('family.meSuffix', { name: m.name }) : m.name;
}

export function memberSub(m: Pick<Member, 'relation' | 'size'>, t: T) {
  const size = t(`size.${m.size}` as StringKey);
  return m.relation === 'self' ? size : `${t(`rel.${m.relation}` as StringKey)} · ${size}`;
}

export function measuredWhere(m: { measured_method?: string | null; method?: string | null; branch_name_en?: string | null; branch_name_ar?: string | null }, t: T, f: Format) {
  const method = m.measured_method ?? m.method;
  if (method === 'home') return t('family.homeVisit');
  return f.name(m, 'branch_name') || t('family.homeVisit');
}
