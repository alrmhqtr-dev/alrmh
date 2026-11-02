import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { Platform } from 'react-native';
import { en, type StringKey } from './en';
import { ar } from './ar';
import { storage } from '@/lib/storage';

export type Lang = 'en' | 'ar';
type Params = Record<string, string | number>;

const QATAR_OFFSET = 3 * 60 * 60_000;
const MONTHS = {
  en: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'],
  ar: ['يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو', 'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر'],
};
const MONTHS_LONG_EN = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const DAYS = {
  en: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'],
  ar: ['الأحد', 'الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'],
};
const DAYS_SHORT_AR = ['أحد', 'اثنين', 'ثلاثاء', 'أربعاء', 'خميس', 'جمعة', 'سبت'];
const DAYS_PLURAL = { en: ['Sundays', 'Mondays', 'Tuesdays', 'Wednesdays', 'Thursdays', 'Fridays', 'Saturdays'], ar: DAYS.ar };

function qatar(d: Date | string) {
  const date = typeof d === 'string' ? (/^\d{4}-\d{2}-\d{2}$/.test(d) ? new Date(d + 'T00:00:00+03:00') : new Date(d)) : d;
  const q = new Date(date.getTime() + QATAR_OFFSET);
  return { y: q.getUTCFullYear(), m: q.getUTCMonth(), d: q.getUTCDate(), wd: q.getUTCDay(), h: q.getUTCHours(), min: q.getUTCMinutes() };
}

const group = (n: number) => Math.round(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');

export function makeFormat(lang: Lang) {
  const moneyNum = (n: number, decimals: boolean) =>
    decimals ? Number(n).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',') : Number.isInteger(Number(n)) ? group(n) : Number(n).toFixed(2);
  return {
    num: (n: number) => group(n),
    orderNo: (n: string) => `\u2066#${n}\u2069`,
    money: (n: number, decimals = false) => (lang === 'ar' ? `${moneyNum(n, decimals)} ر.ق` : `QAR ${moneyNum(n, decimals)}`),
    moneyNum: (n: number, decimals = false) => moneyNum(n, decimals),
    pts: (n: number) => (lang === 'ar' ? `${group(n)} نقطة` : `${group(n)} pts`),
    signedPts: (n: number) => {
      const s = n >= 0 ? '+ ' : '− ';
      return lang === 'ar' ? `${s}${group(Math.abs(n))} نقطة` : `${s}${group(Math.abs(n))} pts`;
    },
    day: (d: Date | string) => {
      const q = qatar(d);
      return `${q.d} ${MONTHS[lang][q.m]}`;
    },
    date: (d: Date | string) => {
      const q = qatar(d);
      return `${q.d} ${MONTHS[lang][q.m]} ${q.y}`;
    },
    weekdayDate: (d: Date | string) => {
      const q = qatar(d);
      return lang === 'ar' ? `${DAYS.ar[q.wd]} ${q.d} ${MONTHS.ar[q.m]}` : `${DAYS.en[q.wd]}, ${q.d} ${MONTHS.en[q.m]}`;
    },
    weekdayShort: (d: Date | string) => {
      const q = qatar(d);
      return lang === 'ar' ? DAYS_SHORT_AR[q.wd] : DAYS.en[q.wd].toUpperCase();
    },
    dayNum: (d: Date | string) => qatar(d).d,
    monthYear: (d: Date | string) => {
      const q = qatar(d);
      return lang === 'ar' ? `${MONTHS.ar[q.m]} ${q.y}` : `${MONTHS.en[q.m]} ${q.y}`;
    },
    monthYearLong: (d: Date | string) => {
      const q = qatar(d);
      return lang === 'ar' ? `${MONTHS.ar[q.m]} ${q.y}` : `${MONTHS_LONG_EN[q.m]} ${q.y}`;
    },
    time: (d: Date | string) => {
      const q = qatar(d);
      const h12 = q.h % 12 === 0 ? 12 : q.h % 12;
      const mm = String(q.min).padStart(2, '0');
      return lang === 'ar' ? `${h12}:${mm} ${q.h < 12 ? 'ص' : 'م'}` : `${h12}:${mm} ${q.h < 12 ? 'AM' : 'PM'}`;
    },
    when: (d: Date | string) => {
      const q = qatar(d);
      const h12 = q.h % 12 === 0 ? 12 : q.h % 12;
      const t = `${h12}:${String(q.min).padStart(2, '0')} ${lang === 'ar' ? (q.h < 12 ? 'ص' : 'م') : q.h < 12 ? 'AM' : 'PM'}`;
      return lang === 'ar' ? `${DAYS.ar[q.wd]} ${q.d} ${MONTHS.ar[q.m]} · ${t}` : `${DAYS.en[q.wd]} ${q.d} ${MONTHS.en[q.m]} · ${t}`;
    },
    closedDays: (weekdays: number[]) => weekdays.map((w) => DAYS_PLURAL[lang][w]).join(lang === 'ar' ? ' و' : ', '),
    daysUntil: (d: Date | string) => Math.max(0, Math.ceil((new Date(d).getTime() - Date.now()) / 864e5)),
    hourOfDay: () => qatar(new Date()).h,
    phone: (p: string) => {
      const local = p.replace('+974', '');
      return `\u2066+974 ${local.slice(0, 4)} ${local.slice(4)}\u2069`;
    },
    name: <T extends Record<string, any>>(obj: T | null | undefined, key = 'name') => (obj ? (obj[`${key}_${lang}`] ?? obj[`${key}_en`] ?? '') : ''),
  };
}

export type Format = ReturnType<typeof makeFormat>;

type Ctx = {
  lang: Lang;
  isRTL: boolean;
  ready: boolean;
  chosen: boolean;
  setLang: (l: Lang) => Promise<void>;
  t: (key: StringKey, params?: Params) => string;
  f: Format;
};

const LocaleContext = createContext<Ctx | null>(null);

export function LocaleProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>('en');
  const [chosen, setChosen] = useState(false);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    storage.get('alrmh.lang').then((v) => {
      if (v === 'ar' || v === 'en') {
        setLangState(v);
        setChosen(true);
      }
      setReady(true);
    });
  }, []);

  useEffect(() => {
    if (Platform.OS === 'web' && typeof document !== 'undefined') {
      document.documentElement.lang = lang;
      document.documentElement.dir = lang === 'ar' ? 'rtl' : 'ltr';
    }
  }, [lang]);

  const setLang = useCallback(async (l: Lang) => {
    setLangState(l);
    setChosen(true);
    await storage.set('alrmh.lang', l);
  }, []);

  const value = useMemo<Ctx>(() => {
    const dict = lang === 'ar' ? ar : en;
    const t = (key: StringKey, params?: Params) => {
      let s: string = dict[key] ?? en[key] ?? key;
      if (params) for (const [k, v] of Object.entries(params)) s = s.split(`{${k}}`).join(String(v));
      return s;
    };
    return { lang, isRTL: lang === 'ar', ready, chosen, setLang, t, f: makeFormat(lang) };
  }, [lang, ready, chosen, setLang]);

  return <LocaleContext.Provider value={value}>{children}</LocaleContext.Provider>;
}

export function useLocale() {
  const ctx = useContext(LocaleContext);
  if (!ctx) throw new Error('LocaleProvider missing');
  return ctx;
}

export type { StringKey };
