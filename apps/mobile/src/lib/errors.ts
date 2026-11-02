import { ApiError } from '@/api/client';
import { en, type StringKey } from '@/i18n/en';

export function errorText(t: (k: StringKey, p?: Record<string, string | number>) => string, err: unknown, prefix?: string) {
  if (err instanceof ApiError) {
    if (err.code === 'network') return t('err.network');
    const scoped = prefix ? (`${prefix}.${err.code}` as StringKey) : null;
    if (scoped && scoped in en) return t(scoped);
    const k = `err.${err.code}` as StringKey;
    if (k in en) return t(k);
  }
  return t('common.error');
}
