import { API_URL } from './api';
import { getLang } from './i18n';

export type Templates = { receipt_en: string; receipt_ar: string; ready_en: string; ready_ar: string; balance_en: string; balance_ar: string };

export const receiptUrl = (token: string, lang = getLang()) => `${API_URL}/v1/receipts/${token}${lang === 'en' ? '?lang=en' : ''}`;

/** Fills {name}, {number}, {total}, {balance}, {link}, {branch} in a saved message. */
export function fill(template: string, vars: Record<string, string | number | null | undefined>) {
  return template.replace(/\{(\w+)\}/g, (m, k) => (vars[k] === undefined || vars[k] === null ? m : String(vars[k])));
}

/** Opens WhatsApp (app or web) with the message ready; staff press send. */
export function waLink(phone: string | null | undefined, text: string) {
  const digits = String(phone ?? '').replace(/\D/g, '');
  const to = digits.length === 8 ? `974${digits}` : digits;
  return `https://wa.me/${to}?text=${encodeURIComponent(text)}`;
}
