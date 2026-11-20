import { useSyncExternalStore } from 'react';

/**
 * Arabic and English for the admin. Each staff member picks a language (Arabic by
 * default); text is written in both languages where it is used: t('Orders', 'الطلبات').
 */
export type Lang = 'ar' | 'en';

const KEY = 'alrmh.admin.lang';
let lang: Lang = (() => {
  try {
    return localStorage.getItem(KEY) === 'en' ? 'en' : 'ar';
  } catch {
    return 'ar';
  }
})();
const listeners = new Set<() => void>();

function apply() {
  document.documentElement.lang = lang;
  document.documentElement.dir = lang === 'ar' ? 'rtl' : 'ltr';
}
apply();

export const getLang = () => lang;
export function setLang(next: Lang) {
  if (next === lang) return;
  lang = next;
  try {
    localStorage.setItem(KEY, next);
  } catch {}
  apply();
  listeners.forEach((f) => f());
}
export function useLang(): Lang {
  return useSyncExternalStore(
    (f) => {
      listeners.add(f);
      return () => listeners.delete(f);
    },
    () => lang,
  );
}

/** The text in the current language. */
export const t = (en: string, ar: string) => (lang === 'ar' ? ar : en);
export const isAr = () => lang === 'ar';

/** A bilingual field from the API: L(branch) reads name_ar or name_en; L(x, 'address') reads address_ar/_en. */
export function L(o: any, field = 'name'): string {
  if (!o) return '';
  const ar = o[`${field}_ar`];
  const en = o[`${field}_en`];
  return (lang === 'ar' ? ar || en : en || ar) ?? '';
}

/** Locale for dates and numbers: Arabic month names, Western digits (as on Qatari receipts). */
export const locale = () => (lang === 'ar' ? 'ar-QA-u-nu-latn' : 'en-GB');
