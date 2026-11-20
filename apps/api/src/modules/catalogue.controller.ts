import { Controller, Get, NotFoundException, Param } from '@nestjs/common';
import { db } from '../db.js';
import { getSettings, listTiers, round2 } from '../lib.js';
import { activeDiscounts, onlineBranchId, unitDiscount } from '../pos.js';

/** What the app shows for a product: its price after automatic discounts, and whether it can be bought. */
async function shopView(products: any[]) {
  const rules = await activeDiscounts('app', null);
  const branch = await onlineBranchId();
  const tracked = products.filter((p) => p.track_stock);
  const stock = tracked.length && branch
    ? await db.many(`select item_id, size, sum(qty)::float as qty from stock_moves where item_kind = 'product' and branch_id = $1 and item_id = any($2::text[]) group by 1,2`, [branch, tracked.map((p) => p.id)])
    : [];
  return products.map(({ track_stock, brand_id, ...p }) => {
    const off = unitDiscount({ kind: 'product', id: p.id, category: p.category, brand_id, price: Number(p.price) }, rules);
    const level = (size: string) => stock.find((s) => s.item_id === p.id && s.size === size)?.qty ?? 0;
    const soldOut = track_stock ? (p.sizes.length ? p.sizes.filter((s: string) => level(s) <= 0) : level('') <= 0 ? [''] : []) : [];
    return {
      ...p,
      sale_price: off.amount > 0 ? round2(Number(p.price) - off.amount) : null,
      in_stock: !track_stock || (p.sizes.length ? soldOut.length < p.sizes.length : soldOut.length === 0),
      sold_out_sizes: p.sizes.length ? soldOut : [],
    };
  });
}

export const COLLAR_SHAPES = ['classic-qatari', 'mandarin-band', 'round-neck', 'wide-collar'] as const;

@Controller('v1')
export class CatalogueController {
  @Get('catalogue')
  async catalogue() {
    const [collars, fabrics, colours, fabricColours, products, branches, settings, categories, tiers] = await Promise.all([
      db.many('select id, name_en, name_ar, shape from collars where active order by sort'),
      db.many('select id, name_en, name_ar, note_en, note_ar, price from fabrics where active order by sort'),
      db.many('select id, name_en, name_ar, hex from colours order by sort'),
      db.many('select fabric_id, colour_id from fabric_colours'),
      db.many('select id, category, name_en, name_ar, description_en, description_ar, price, sizes, image_url, track_stock, brand_id from products where active and in_app order by sort'),
      db.many(
        `select id, name_en, name_ar, address_en, address_ar, phone, whatsapp, hours_en, hours_ar, closed_weekdays, lat, lng
           from branches where active order by sort`,
      ),
      getSettings(),
      db.many('select id, name_en, name_ar from categories where active order by sort, name_en'),
      listTiers(),
    ]);
    return {
      collars,
      fabrics: fabrics.map((f) => ({ ...f, colour_ids: fabricColours.filter((x) => x.fabric_id === f.id).map((x) => x.colour_id) })),
      colours,
      categories,
      products: await shopView(products),
      branches,
      settings: {
        delivery_fee: settings.delivery_fee,
        home_visit_fee: settings.home_visit_fee,
        appointment_fee: settings.appointment_fee,
        lead_working_days: settings.lead_working_days,
        measurements_valid_months: settings.measurements_valid_months,
        points: settings.points,
        support: settings.support,
      },
      tiers,
    };
  }

  @Get('products/:id')
  async product(@Param('id') id: string) {
    const p = await db.one(
      'select id, category, name_en, name_ar, description_en, description_ar, price, sizes, image_url, track_stock, brand_id from products where id = $1 and active and in_app',
      [id],
    );
    if (!p) throw new NotFoundException({ code: 'not_found' });
    return (await shopView([p]))[0];
  }
}
