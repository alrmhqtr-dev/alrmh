import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { db } from './db.js';
import { migrate } from './migrate.js';
import { DEFAULT_SETTINGS, qatarDateString } from './lib.js';

const collars = [
  ['classic-qatari', 'Classic Qatari', 'قطرية كلاسيكية'],
  ['mandarin-band', 'Mandarin band', 'ياقة صينية'],
  ['round-neck', 'Round neck', 'رقبة دائرية'],
  ['wide-collar', 'Wide collar', 'ياقة عريضة'],
];

const fabrics = [
  ['japanese-cotton', 'Japanese cotton', 'قطن ياباني', 'Soft, breathable · all seasons', 'ناعم وجيد التهوية · كل المواسم', 320],
  ['swiss-voile', 'Swiss voile', 'فوال سويسري', 'Very light · summer', 'خفيف جداً · صيفي', 380],
  ['linen-blend', 'Linen blend', 'مزيج كتان', 'Textured, cool · summer', 'ملمس بارز وبارد · صيفي', 350],
  ['korean-poly-cotton', 'Korean poly-cotton', 'بولي قطن كوري', 'Easy care · everyday', 'سهل العناية · يومي', 260],
  ['winter-wool', 'Winter wool blend', 'مزيج صوف شتوي', 'Warm, heavier · winter', 'دافئ وأثقل · شتوي', 420],
];

const colours = [
  ['pure-white', 'Pure white', 'أبيض ناصع', '#FFFFFF'],
  ['ivory', 'Ivory', 'عاجي', '#F3EBDC'],
  ['pearl-grey', 'Pearl grey', 'رمادي لؤلؤي', '#D9D8D3'],
  ['sand', 'Sand', 'رملي', '#D8C3A0'],
  ['stone', 'Stone', 'حجري', '#B7AE9E'],
  ['navy', 'Navy', 'كحلي', '#1F2A44'],
  ['brown', 'Brown', 'بني', '#6B4E37'],
  ['charcoal', 'Charcoal', 'فحمي', '#3A3A3A'],
];

const fabricColours: Record<string, string[]> = {
  'japanese-cotton': ['pure-white', 'ivory', 'pearl-grey', 'sand', 'stone', 'navy', 'brown', 'charcoal'],
  'swiss-voile': ['pure-white', 'ivory', 'pearl-grey', 'sand'],
  'linen-blend': ['pure-white', 'ivory', 'sand', 'stone'],
  'korean-poly-cotton': ['pure-white', 'ivory', 'pearl-grey', 'sand', 'stone', 'navy'],
  'winter-wool': ['pearl-grey', 'stone', 'navy', 'brown', 'charcoal'],
};

const products = [
  ['white-ghutra', 'ghutra', 'Premium white ghutra', 'غترة بيضاء فاخرة', 'Lightweight, breathable cotton with a soft, crisp finish.', 'قطن خفيف وجيد التهوية بلمسة ناعمة ومتماسكة.', 95, ['52', '56', '58', '60']],
  ['red-shmagh', 'ghutra', 'Red & white shmagh', 'شماغ أحمر وأبيض', 'Classic red and white pattern in soft woven cotton.', 'نقشة كلاسيكية بالأحمر والأبيض من قطن منسوج ناعم.', 110, ['52', '56', '58', '60']],
  ['black-agal', 'agal', 'Classic black agal', 'عقال أسود كلاسيكي', 'Hand-finished black agal that holds its shape.', 'عقال أسود مشغول يدوياً يحافظ على شكله.', 120, ['S', 'M', 'L']],
  ['leather-sandals', 'sandals', 'Leather sandals', 'نعال جلد', 'Full-grain leather with a cushioned sole.', 'جلد طبيعي بنعل مريح.', 260, ['40', '41', '42', '43', '44', '45']],
  ['oud-50', 'fragrance', 'Oud perfume 50 ml', 'عطر عود 50 مل', 'A warm oud blend that lasts all day.', 'مزيج عود دافئ يدوم طوال اليوم.', 180, []],
  ['cufflinks', 'accessories', 'Cufflink set', 'طقم أزرار أكمام', 'Polished cufflinks with a matching collar stud.', 'أزرار أكمام لامعة مع زر ياقة مطابق.', 75, []],
  ['sandals-embossed-brown', 'sandals', 'Embossed brown sandals', 'نعال بني منقوش', 'Dark brown leather with an embossed pattern and a cushioned sole.', 'جلد بني داكن بنقشة بارزة ونعل مريح.', 290, ['40', '41', '42', '43', '44', '45']],
  ['sandals-woven-burgundy', 'sandals', 'Woven burgundy sandals', 'نعال عنابي منسوج', 'Hand-woven burgundy leather strap on a tan leather footbed.', 'حزام من الجلد العنابي المنسوج يدوياً على قاعدة من الجلد البني الفاتح.', 320, ['40', '41', '42', '43', '44', '45']],
  ['sandals-beige-buckle', 'sandals', 'Beige buckle sandals', 'نعال بيج بإبزيم', 'Soft beige leather with a side buckle.', 'جلد بيج ناعم بإبزيم جانبي.', 280, ['40', '41', '42', '43', '44', '45']],
  ['sandals-blue', 'sandals', 'Blue leather sandals', 'نعال جلد أزرق', 'Pebbled blue leather with a cushioned sole.', 'جلد أزرق محبب بنعل مريح.', 270, ['40', '41', '42', '43', '44', '45']],
  ['card-holder-black', 'accessories', 'Leather card holder, black', 'حافظة بطاقات جلدية سوداء', 'Slim card holder in textured leather, gift boxed.', 'حافظة بطاقات رفيعة من جلد محبب، تأتي في علبة هدية.', 165, []],
  ['card-holder-lime', 'accessories', 'Leather card holder, lime', 'حافظة بطاقات جلدية خضراء', 'Slim card holder in textured leather with a lime front, gift boxed.', 'حافظة بطاقات رفيعة من جلد محبب بواجهة خضراء ليمونية، تأتي في علبة هدية.', 165, []],
  ['card-holder-red', 'accessories', 'Leather card holder, red', 'حافظة بطاقات جلدية حمراء', 'Slim card holder in textured leather with a red front, gift boxed.', 'حافظة بطاقات رفيعة من جلد محبب بواجهة حمراء، تأتي في علبة هدية.', 165, []],
];

export async function seed({ demo = false } = {}) {
  await migrate();
  await db.tx(async (c) => {
    for (const [key, value] of Object.entries(DEFAULT_SETTINGS)) {
      await c.query('insert into settings (key, value) values ($1, $2) on conflict (key) do nothing', [key, JSON.stringify(value)]);
    }
    const branch = await c.query('select id from branches limit 1');
    if (!branch.rowCount) {
      await c.query(
        `insert into branches (name_en, name_ar, address_en, address_ar, phone, whatsapp, hours_en, hours_ar, lat, lng)
         values ('Al Aziziyah', 'العزيزية', 'Al Aziziyah, Doha', 'العزيزية، الدوحة', '+97444440000', '+97455550000',
                 'Sat–Thu · 9 AM – 10 PM', 'السبت–الخميس · 9 ص – 10 م', 25.2425, 51.4520)`,
      );
    }
    for (const [i, [id, en, ar]] of collars.entries()) {
      await c.query('insert into collars (id, name_en, name_ar, sort, shape) values ($1,$2,$3,$4,$1) on conflict (id) do nothing', [id, en, ar, i]);
    }
    for (const [i, f] of fabrics.entries()) {
      await c.query('insert into fabrics (id, name_en, name_ar, note_en, note_ar, price, sort) values ($1,$2,$3,$4,$5,$6,$7) on conflict (id) do nothing', [...f, i]);
    }
    for (const [i, col] of colours.entries()) {
      await c.query('insert into colours (id, name_en, name_ar, hex, sort) values ($1,$2,$3,$4,$5) on conflict (id) do nothing', [...col, i]);
    }
    for (const [fabric, list] of Object.entries(fabricColours)) {
      for (const colour of list) await c.query('insert into fabric_colours values ($1,$2) on conflict do nothing', [fabric, colour]);
    }
    for (const [i, p] of products.entries()) {
      await c.query(
        `insert into products (id, category, name_en, name_ar, description_en, description_ar, price, sizes, sort) values ($1,$2,$3,$4,$5,$6,$7,$8,$9) on conflict (id) do nothing`,
        [...p, i],
      );
    }
  });
  await seedProductPhotos();
  if (demo) {
    // Sample coupons are demo data: a real launch must not start with a live 20% code.
    await db.pool.query(`insert into coupons (code, percent, max_discount, expires_at) values ('EID20', 20, 100, now() + interval '1 year') on conflict do nothing`);
    await db.pool.query(`insert into coupons (code, percent, max_discount, expires_at) values ('SUMMER24', 15, null, '2024-09-30') on conflict do nothing`);
    await seedDemoCustomer();
  }
}

/*
 * Photos for the sample products, from apps/api/seed/products/<product id>.jpg
 * (or .jpeg, .png, .webp): square photos, about 1000 px, under 2 MB.
 * Each product gets its photo once: only while it has none, so a photo uploaded
 * in the admin is never replaced, and never again after that, so a photo someone
 * removed in the admin stays removed. The settings key records which were done.
 */
const photoDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'seed', 'products');

const PHOTO_TYPES = [['jpg', 'image/jpeg'], ['jpeg', 'image/jpeg'], ['png', 'image/png'], ['webp', 'image/webp']] as const;

async function seedProductPhotos() {
  for (const product of products) {
    const id = product[0] as string;
    const found = PHOTO_TYPES.map(([ext, type]) => [join(photoDir, `${id}.${ext}`), type] as const).find(([f]) => existsSync(f));
    if (!found) continue;
    const [file, type] = found;
    await db.tx(async (c) => {
      await c.query(`insert into settings (key, value) values ('seed.product_photos', '[]') on conflict (key) do nothing`);
      const done = (await c.query(`select value from settings where key = 'seed.product_photos' for update`)).rows[0].value as string[];
      if (done.includes(id)) return;
      const p = await c.query('select image_url from products where id = $1', [id]);
      if (p.rowCount && !p.rows[0].image_url) {
        const bytes = readFileSync(file);
        const m = await c.query('insert into media (content_type, bytes, size) values ($1, $2, $3) returning id', [type, bytes, bytes.length]);
        await c.query('update products set image_url = $2 where id = $1', [id, `/v1/media/${m.rows[0].id}`]);
      }
      if (p.rowCount) await c.query(`update settings set value = $1 where key = 'seed.product_photos'`, [JSON.stringify([...done, id])]);
    });
  }
}

const DEMO_PHONE = '+97455551234';

async function seedDemoCustomer() {
  const exists = await db.one('select id from customers where phone = $1', [DEMO_PHONE]);
  if (exists) return;
  await db.tx(async (c) => {
    const branch = (await c.query('select id from branches order by sort limit 1')).rows[0];
    const cust = (await c.query(`insert into customers (phone, name, email, language) values ($1, 'Hamad Al-Kuwari', 'hamad@example.com', 'en') returning id`, [DEMO_PHONE])).rows[0];
    const member = async (name: string, relation: string, size: string) =>
      (await c.query('insert into family_members (customer_id, name, relation, size) values ($1,$2,$3,$4) returning id', [cust.id, name, relation, size])).rows[0].id;
    const hamad = await member('Hamad', 'self', 'adult');
    const ali = await member('Ali', 'father', 'adult');
    const khalifa = await member('Khalifa', 'son', 'child');
    void ali;
    await c.query(
      `insert into measurements (member_id, taken_at, method, branch_id, tailor_name, length_cm, shoulder_cm, chest_cm, waist_cm, sleeve_cm, neck_cm, cuff_cm, remarks)
       values ($1, now() - interval '80 days', 'branch', $2, 'Yousef', 148, 47, 112, 104, 62, 41, 24, 'Prefers a looser fit around the chest. Sleeves 1 cm shorter than standard.')`,
      [hamad, branch.id],
    );
    await c.query(
      `insert into measurements (member_id, taken_at, method, tailor_name, length_cm, shoulder_cm, chest_cm, waist_cm, sleeve_cm, neck_cm, cuff_cm)
       values ($1, now() - interval '150 days', 'home', 'Yousef', 118, 36, 78, 70, 48, 32, 19)`,
      [khalifa],
    );
    const home = (
      await c.query(
        `insert into addresses (customer_id, label, line1, area, is_default) values ($1, 'Home', 'Villa 12, Street 840', 'Al Waab', true) returning id`,
        [cust.id],
      )
    ).rows[0].id;
    await c.query(`insert into addresses (customer_id, label, line1, area) values ($1, 'Office', 'Tower 3, West Bay', 'West Bay')`, [cust.id]);

    const order = async (number: string, daysAgo: number, stage: string, thobes: { member: string; name: string; collar: string; fabric: string; price: number }[], stages: [string, number][], points: number) => {
      const total = thobes.reduce((a, t) => a + t.price, 0);
      const b = (await c.query('select id, name_en, name_ar, address_en, address_ar from branches where active order by sort limit 1')).rows[0];
      const pickup = { pickup: true, branchId: b.id, label: b.name_en, label_ar: b.name_ar, line1: b.address_en, line1_ar: b.address_ar, area: '', city: 'Doha' };
      const o = (
        await c.query(
          `insert into orders (number, customer_id, stage, subtotal, delivery_fee, total, address, points_to_earn, points_awarded, expected_delivery, created_at, paid_at)
           values ($1,$2,$3,$4,0,$5,$6,$7,$8,$9, now() - ($10 || ' days')::interval, now() - ($10 || ' days')::interval) returning id`,
          [number, cust.id, stage, total, total, pickup, points, stage === 'delivered', qatarDateString(new Date(Date.now() + (stage === 'delivered' ? -daysAgo + 9 : 3) * 864e5)), String(daysAgo)],
        )
      ).rows[0].id;
      for (const t of thobes) {
        await c.query(`insert into order_items (order_id, kind, snapshot, qty, unit_price, line_total) values ($1,'thobe',$2,1,$3,$3)`, [
          o,
          {
            thobe: {
              collar: collars.map(([id, name_en, name_ar]) => ({ id, name_en, name_ar })).find((x) => x.id === t.collar),
              fabric: fabrics.map(([id, name_en, name_ar, , , price]) => ({ id, name_en, name_ar, price })).find((x) => x.id === t.fabric),
              colour: { id: 'ivory', name_en: 'Ivory', name_ar: 'عاجي', hex: '#F3EBDC' },
            },
            member: { id: t.member, name: t.name },
            measureMethod: 'saved',
            points: 15,
          },
          t.price,
        ]);
      }
      await c.query(`insert into payments (order_id, amount, status, provider_ref, completed_at) values ($1, $2, 'paid', 'SEED', now())`, [o, total]);
      for (const [s, ago] of stages) await c.query(`insert into order_events (order_id, stage, at, note) values ($1,$2, now() - ($3 || ' hours')::interval, $4)`, [o, s, String(ago), s === 'measured' ? 'saved' : null]);
      return o;
    };
    const o1 = await order('AR-09918', 367 - 18 + 18, 'delivered', [{ member: hamad, name: 'Hamad', collar: 'classic-qatari', fabric: 'japanese-cotton', price: 320 }], [['measured', 8800], ['cutting', 8760], ['stitching', 8700], ['quality', 8660], ['ready', 8650], ['delivered', 8630]], 15);
    const o2 = await order('AR-10311', 92, 'delivered', [{ member: hamad, name: 'Hamad', collar: 'classic-qatari', fabric: 'japanese-cotton', price: 320 }], [['measured', 2200], ['cutting', 2150], ['stitching', 2100], ['quality', 2030], ['ready', 2010], ['delivered', 1980]], 15);
    const o3 = await order('AR-10482', 6, 'stitching', [
      { member: hamad, name: 'Hamad', collar: 'classic-qatari', fabric: 'japanese-cotton', price: 320 },
      { member: khalifa, name: 'Khalifa', collar: 'mandarin-band', fabric: 'linen-blend', price: 350 },
    ], [['measured', 144], ['cutting', 96], ['stitching', 30]], 40);
    void home;
    const earn = async (orderId: string, pts: number, label: string, daysAgo: number, remaining = pts) =>
      c.query(
        `insert into points_ledger (customer_id, kind, points, remaining, expires_at, order_id, label, created_at)
         values ($1,'earn',$2,$3, now() - ($4 || ' days')::interval + interval '12 months', $5, $6, now() - ($4 || ' days')::interval)`,
        [cust.id, pts, remaining, String(daysAgo), orderId, label],
      );
    // 320 points earned in all (Gold), 165 spent at checkout: 155 to use.
    await earn(o1, 15, 'Order #AR-09918', 347);
    await earn(o1, 290, 'Loyalty card transfer', 200, 125);
    await earn(o2, 15, 'Order #AR-10311', 82);
    await c.query(`insert into points_ledger (customer_id, kind, points, order_id, label, created_at) values ($1,'redeem',-165,$2,'Order #AR-10482', now() - interval '6 days')`, [cust.id, o3]);
    await c.query(
      `insert into notifications (customer_id, kind, title_en, title_ar, body_en, body_ar, link, created_at) values
       ($1,'points','You''re now Gold','أصبحت في الفئة ذهبي','Every thobe now earns 20 points and every product 15.','كل ثوب يمنحك الآن 20 نقطة وكل منتج 15 نقاط.','/rewards', now() - interval '2 hours'),
       ($1,'order','Sewing','الخياطة','#AR-10482 · Your thobes are being sewn.','#AR-10482 · ثيابك قيد الخياطة.','/orders', now() - interval '30 hours')`,
      [cust.id],
    );
  });
  console.log(`seeded demo customer ${DEMO_PHONE}`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  seed({ demo: process.env.SEED_DEMO === 'true' })
    .then(() => db.pool.end())
    .catch((e) => {
      console.error(e);
      process.exit(1);
    });
}
