import { Body, Controller, Get, NotFoundException, Param, Patch, Query, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import { db } from '../db.js';
import { DEFAULT_SETTINGS, fail, getSettings, type Settings } from '../lib.js';
import { config } from '../config.js';
import { AnyStaff, CurrentStaff, Managers, audit, type StaffUser } from '../staff.js';
import { MEDIA_PATH } from './media.controller.js';
import { receiptData, uuidOrNull } from './pos.controller.js';

const KEYS = ['company', 'invoice', 'barcode', 'printing', 'whatsapp', 'pos'] as const;
type Key = (typeof KEYS)[number];

/** Checks each field against the type of its default, with a few fixed choices. */
function cleanSection(key: Key, current: any, patch: any) {
  if (!patch || typeof patch !== 'object') return current;
  const out = { ...current };
  const defaults: any = DEFAULT_SETTINGS[key];
  const choices: Record<string, string[]> = { receipt_paper: ['80mm', '58mm', 'a4'], invoice_paper: ['a4', 'a5'], ticket_paper: ['80mm', 'a4', 'a5'] };
  const ranges: Record<string, [number, number]> = {
    width_mm: [20, 120],
    height_mm: [10, 80],
    per_row: [1, 6],
    receipt_copies: [1, 3],
    ticket_copies: [1, 3],
    min_deposit_percent: [0, 100],
  };
  for (const [k, v] of Object.entries(patch)) {
    if (!(k in defaults)) continue;
    const d = defaults[k];
    if (choices[k]) {
      if (!choices[k].includes(String(v))) fail('invalid_input', { field: k });
      out[k] = String(v);
    } else if (k === 'logo_url') {
      if (v === null || v === '') out[k] = null;
      else if (MEDIA_PATH.test(String(v)) || /^https:\/\/\S+$/.test(String(v))) out[k] = String(v).slice(0, 500);
      else fail('invalid_image');
    } else if (k === 'online_branch_id') {
      out[k] = v ? uuidOrNull(v) ?? fail('invalid_input', { field: k }) : null;
    } else if (typeof d === 'boolean') out[k] = v === true;
    else if (typeof d === 'number') {
      const n = Number(v);
      const [min, max] = ranges[k] ?? [0, 1_000_000];
      if (!Number.isFinite(n) || n < min || n > max) fail('invalid_number', { field: k, min, max });
      out[k] = n;
    } else out[k] = String(v ?? '').slice(0, k.startsWith('terms') || k.startsWith('footer') || ['receipt_en', 'receipt_ar', 'ready_en', 'ready_ar', 'balance_en', 'balance_ar'].includes(k) ? 600 : 160);
  }
  return out;
}

const esc = (s: unknown) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
const qar = (n: number) => Number(n ?? 0).toFixed(2);

@Controller('v1')
export class BusinessController {
  @Get('admin/business')
  @UseGuards(AnyStaff)
  async business() {
    const s = await getSettings();
    return Object.fromEntries(KEYS.map((k) => [k, s[k]]));
  }

  @Patch('admin/business')
  @UseGuards(Managers)
  async update(@CurrentStaff() me: StaffUser, @Body() b: Partial<Record<Key, any>>) {
    const cur = await getSettings();
    const next: Partial<Settings> = {};
    await db.tx(async (c) => {
      for (const k of KEYS) {
        if (b?.[k] === undefined) continue;
        (next as any)[k] = cleanSection(k, cur[k], b[k]);
        await c.query('insert into settings (key, value) values ($1,$2) on conflict (key) do update set value = excluded.value', [k, JSON.stringify((next as any)[k])]);
      }
      await audit(me, 'update', 'business', null, b, c);
    });
    return { ...Object.fromEntries(KEYS.map((k) => [k, cur[k]])), ...next };
  }

  /**
   * A receipt the customer can open from WhatsApp, without signing in. The address
   * carries a long random token, so receipts can't be guessed from the order number.
   */
  @Get('receipts/:token')
  async receipt(@Param('token') token: string, @Query('lang') lang: string | undefined, @Res() res: Response) {
    if (!/^[0-9a-f]{32}$/.test(token)) throw new NotFoundException({ code: 'not_found' });
    let r: any;
    try {
      r = await receiptData({ token });
    } catch {
      return res.status(404).type('html').send('<!doctype html><meta charset="utf-8"><p style="font-family:sans-serif">Receipt not found · الفاتورة غير موجودة</p>');
    }
    const ar = lang !== 'en';
    const t = (en: string, a: string) => (ar ? a : en);
    const name = (x: any) => (ar ? x?.name_ar ?? x?.name_en : x?.name_en ?? x?.name_ar) ?? '';
    const company = r.company;
    const logo = company.logo_url ? (company.logo_url.startsWith('/') ? `${config.apiUrl}${company.logo_url}` : company.logo_url) : null;
    const lines = r.items
      .map((i: any) => {
        const label =
          i.kind === 'thobe'
            ? `${t('Thobe', 'ثوب')}${i.snapshot.thobe?.collar ? ` · ${esc(name(i.snapshot.thobe.collar))}` : ''}${i.snapshot.thobe?.cuff ? ` · ${esc(name(i.snapshot.thobe.cuff))}` : ''} · ${esc(name(i.snapshot.thobe?.fabric))}${i.snapshot.thobe?.metres ? ` · ${i.snapshot.thobe.metres} ${t('m', 'م')}` : ''}${i.snapshot.thobe?.pocket ? ` · ${t('pocket', 'جيب')}` : ''}<br><small>${esc(i.snapshot.member?.name ?? '')}</small>`
            : i.kind === 'product'
              ? `${esc(name(i.snapshot.product))}${i.snapshot.size ? ` · ${esc(i.snapshot.size)}` : ''}`
              : t('Sale', 'مبيعات');
        return `<tr><td>${label}${i.discount > 0 ? `<br><small>${t('Discount', 'خصم')} −${qar(i.discount)}</small>` : ''}</td><td class="n">${i.qty}</td><td class="n">${qar(Number(i.unit_price) * i.qty)}</td></tr>`;
      })
      .join('');
    // With a discount: the original price, the discount (on items and on the sale together), then the total.
    const original = r.items.reduce((a: number, i: any) => a + Number(i.unit_price) * i.qty, 0);
    const discount = r.items.reduce((a: number, i: any) => a + Number(i.discount || 0), 0) + Number(r.discount || 0);
    const row = (label: string, v: number, strong = false) => `<tr class="${strong ? 'b' : ''}"><td colspan="2">${label}</td><td class="n">${qar(v)}</td></tr>`;
    const METHODS: Record<string, [string, string]> = { cash: ['Cash', 'نقدًا'], card_machine: ['Card', 'بطاقة'], sadad: ['SADAD', 'سداد'], bank_transfer: ['Bank transfer', 'تحويل بنكي'], cheque: ['Cheque', 'شيك'] };
    const branch = ar ? r.branch_ar : r.branch_en;
    res.type('html').send(`<!doctype html><html lang="${ar ? 'ar' : 'en'}" dir="${ar ? 'rtl' : 'ltr'}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex"><title>${esc(ar ? company.name_ar : company.name_en)} · ${esc(r.number)}</title><style>
body{margin:0;background:#faf8f4;font-family:-apple-system,system-ui,"Segoe UI",Tahoma,sans-serif;color:#0b0b0b}
.r{max-width:420px;margin:0 auto;background:#fff;padding:24px 20px;min-height:100vh;box-sizing:border-box}
h1{font-size:22px;margin:8px 0 2px;text-align:center}.c{text-align:center;color:#4a4a4a;font-size:13px}
table{width:100%;border-collapse:collapse;margin-top:16px;font-size:14px}td{padding:7px 0;border-bottom:1px solid #eee;vertical-align:top}
.n{text-align:end;white-space:nowrap;font-variant-numeric:tabular-nums}small{color:#8a8a8a}.b td{font-weight:700;font-size:16px;border-bottom:0}
.meta{display:flex;justify-content:space-between;font-size:13px;color:#4a4a4a;margin-top:14px}.foot{margin-top:20px;text-align:center;color:#4a4a4a;font-size:13px;white-space:pre-line}
.badge{display:inline-block;background:#f7efdd;color:#7a5a1c;border-radius:99px;padding:3px 10px;font-size:12px;font-weight:600}
a.sw{display:block;text-align:center;margin-top:16px;color:#4a4a4a;font-size:13px}
</style></head><body><div class="r">
${logo ? `<div style="text-align:center"><img src="${esc(logo)}" alt="" style="max-height:64px"></div>` : ''}
<h1>${esc(ar ? company.name_ar : company.name_en)}</h1>
<div class="c">${esc(branch ?? '')}${company.phone ? ` · ${esc(company.phone)}` : ''}</div>
${company.tax_number ? `<div class="c">${t('Tax number', 'الرقم الضريبي')}: ${esc(company.tax_number)}</div>` : ''}
<div class="meta"><span>${t('Invoice', 'فاتورة')} <b>#${esc(r.number)}</b></span><span>${new Date(r.created_at).toLocaleString(ar ? 'ar-QA' : 'en-GB', { timeZone: 'Asia/Qatar', dateStyle: 'medium', timeStyle: 'short' })}</span></div>
${r.customer_name ? `<div class="meta"><span>${esc(r.customer_name)}</span><span>${esc(r.phone ?? '')}</span></div>` : ''}
${r.stage === 'cancelled' ? `<p class="c"><span class="badge">${t('Cancelled', 'ملغاة')}</span></p>` : ''}
<table><tr><td><small>${t('Item', 'الصنف')}</small></td><td class="n"><small>${t('Qty', 'الكمية')}</small></td><td class="n"><small>${t('QAR', 'ر.ق')}</small></td></tr>${lines}
${discount > 0 ? row(t('Original price', 'السعر الأصلي'), original) : ''}
${discount > 0 ? row(t('Discount', 'الخصم'), -discount) : ''}
${r.service_charge > 0 ? row(t('Service', 'الخدمة'), r.service_charge) : ''}
${r.delivery_fee > 0 ? row(t('Delivery', 'التوصيل'), r.delivery_fee) : ''}
${r.points_used > 0 ? row(t('Points used', 'النقاط المستخدمة'), -r.points_used) : ''}
${row(t('Total', 'الإجمالي'), r.total, true)}
${r.invoice.show_tax && r.tax > 0 ? `<tr><td colspan="2"><small>${t('Includes tax', 'شامل الضريبة')}</small></td><td class="n"><small>${qar(r.tax)}</small></td></tr>` : ''}
${r.payments.map((p: any) => row(`${t('Paid', 'مدفوع')} · ${(METHODS[p.provider] ?? [p.provider, p.provider])[ar ? 1 : 0]}`, p.amount)).join('')}
${r.refunded > 0 ? row(t('Refunded', 'مسترد'), -r.refunded) : ''}
${r.balance > 0 ? row(t('Balance due', 'المبلغ المتبقي'), r.balance, true) : ''}
</table>
${r.expected_delivery && r.thobe_count > 0 ? `<p class="c">${t('Ready by', 'موعد الجاهزية')} ${esc(r.expected_delivery)}</p>` : ''}
${r.invoice.show_points && r.points_to_earn > 0 && r.customer_id ? `<p class="c">${t(`You earn ${r.points_to_earn} points`, `تكسب ${r.points_to_earn} نقطة`)}</p>` : ''}
<div class="foot">${esc(ar ? r.invoice.footer_ar : r.invoice.footer_en)}${(ar ? r.invoice.terms_ar : r.invoice.terms_en) ? `\n\n${esc(ar ? r.invoice.terms_ar : r.invoice.terms_en)}` : ''}</div>
<a class="sw" href="?lang=${ar ? 'en' : 'ar'}">${ar ? 'English' : 'العربية'}</a>
</div></body></html>`);
  }
}
