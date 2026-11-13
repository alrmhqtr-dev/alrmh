import { Controller, Get, NotFoundException, Param } from '@nestjs/common';
import { db } from '../db.js';
import { getSettings } from '../lib.js';

export const COLLAR_SHAPES = ['classic-qatari', 'mandarin-band', 'round-neck', 'wide-collar'] as const;

@Controller('v1')
export class CatalogueController {
  @Get('catalogue')
  async catalogue() {
    const [collars, fabrics, colours, fabricColours, products, branches, settings, categories] = await Promise.all([
      db.many('select id, name_en, name_ar, shape from collars where active order by sort'),
      db.many('select id, name_en, name_ar, note_en, note_ar, price from fabrics where active order by sort'),
      db.many('select id, name_en, name_ar, hex from colours order by sort'),
      db.many('select fabric_id, colour_id from fabric_colours'),
      db.many('select id, category, name_en, name_ar, description_en, description_ar, price, sizes, image_url from products where active order by sort'),
      db.many(
        `select id, name_en, name_ar, address_en, address_ar, phone, whatsapp, hours_en, hours_ar, closed_weekdays, lat, lng
           from branches where active order by sort`,
      ),
      getSettings(),
      db.many('select id, name_en, name_ar from categories where active order by sort, name_en'),
    ]);
    return {
      collars,
      fabrics: fabrics.map((f) => ({ ...f, colour_ids: fabricColours.filter((x) => x.fabric_id === f.id).map((x) => x.colour_id) })),
      colours,
      categories,
      products,
      branches,
      settings: {
        delivery_fee: settings.delivery_fee,
        home_visit_fee: settings.home_visit_fee,
        lead_working_days: settings.lead_working_days,
        measurements_valid_months: settings.measurements_valid_months,
        points: settings.points,
        support: settings.support,
      },
    };
  }

  @Get('products/:id')
  async product(@Param('id') id: string) {
    const p = await db.one(
      'select id, category, name_en, name_ar, description_en, description_ar, price, sizes, image_url from products where id = $1 and active',
      [id],
    );
    if (!p) throw new NotFoundException({ code: 'not_found' });
    return p;
  }
}
