import { Body, Controller, Get, HttpCode, NotFoundException, Param, Post, Query, UseGuards } from '@nestjs/common';
import { db, type Queryable } from '../db.js';
import { fail, getSettings, need, round2 } from '../lib.js';
import { moveStock, nextNumber, openRegister, requireRegister, stockLevel } from '../pos.js';
import { AnyStaff, CurrentStaff, ExpensesGuard, PurchasesGuard, audit, hasPerm, type StaffUser } from '../staff.js';
import { range, uuidOrNull } from './pos.controller.js';

const METHODS = ['cash', 'card', 'bank_transfer', 'cheque'];
const day = (v: unknown, field: string) => {
  const s = String(v ?? '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s) || Number.isNaN(Date.parse(s))) fail('invalid_date', { field });
  return s;
};
const today = () => new Date(Date.now() + 3 * 3600_000).toISOString().slice(0, 10);

/** Received purchases add to stock and set each item's cost to what was last paid. */
async function receive(purchaseId: string, me: StaffUser, c: Queryable) {
  const p = await db.one('select * from purchases where id = $1', [purchaseId], c);
  const lines = await db.many('select * from purchase_lines where purchase_id = $1', [purchaseId], c);
  const sign = p.kind === 'return' ? -1 : 1;
  for (const l of lines) {
    await moveStock(c, {
      branchId: p.branch_id,
      kind: l.item_kind,
      id: l.item_id,
      size: l.size,
      qty: sign * Number(l.qty),
      reason: p.kind === 'return' ? 'purchase_return' : 'purchase',
      refType: 'purchase',
      refId: purchaseId,
      unitCost: Number(l.unit_cost),
      staffId: me.id,
    });
    if (p.kind === 'purchase') await c.query(`update ${l.item_kind === 'fabric' ? 'fabrics' : 'products'} set cost = $2, track_stock = true where id = $1`, [l.item_id, l.unit_cost]);
  }
  await c.query(`update purchases set status = 'received', received_at = now() where id = $1`, [purchaseId]);
}

@Controller('v1/admin')
export class PurchasesController {
  @Get('purchases')
  @UseGuards(AnyStaff)
  list(@Query('from') from?: string, @Query('to') to?: string, @Query('kind') kind?: string, @Query('supplier') supplier?: string, @Query('status') status?: string) {
    const rg = range(from, to, 90);
    return db.many(
      `select p.id, p.number, p.kind, p.status, p.reference, p.purchase_date, p.total::float as total, p.created_at, s.id as supplier_id, s.name as supplier_name,
              b.name_en as branch_en, b.name_ar as branch_ar, u.name as staff_name, r.number as return_of_number,
              coalesce((select sum(amount) from supplier_payments sp where sp.purchase_id = p.id),0)::float as paid,
              (select count(*)::int from purchase_lines l where l.purchase_id = p.id) as line_count
         from purchases p join suppliers s on s.id = p.supplier_id join branches b on b.id = p.branch_id
         left join staff_users u on u.id = p.staff_id left join purchases r on r.id = p.return_of
        where p.purchase_date between $1::date and $2::date and ($3::text is null or p.kind = $3) and ($4::uuid is null or p.supplier_id = $4)
          and ($5::text is null or p.status = $5)
        order by p.purchase_date desc, p.created_at desc limit 500`,
      [rg.from, rg.to, kind === 'purchase' || kind === 'return' ? kind : null, uuidOrNull(supplier), ['ordered', 'received', 'cancelled'].includes(String(status)) ? status : null],
    );
  }

  @Get('purchases/:id')
  @UseGuards(AnyStaff)
  async one(@Param('id') id: string) {
    const p = await db.one(
      `select p.*, p.subtotal::float as subtotal, p.discount::float as discount, p.tax::float as tax, p.shipping::float as shipping, p.total::float as total,
              s.name as supplier_name, s.phone as supplier_phone, s.business_name, b.name_en as branch_en, b.name_ar as branch_ar, u.name as staff_name, r.number as return_of_number
         from purchases p join suppliers s on s.id = p.supplier_id join branches b on b.id = p.branch_id left join staff_users u on u.id = p.staff_id
         left join purchases r on r.id = p.return_of where p.id = $1`,
      [id],
    );
    if (!p) throw new NotFoundException({ code: 'not_found' });
    const [lines, payments, returns] = await Promise.all([
      db.many(
        `select l.*, l.qty::float as qty, l.unit_cost::float as unit_cost, l.line_total::float as line_total,
                coalesce((select sum(rl.qty) from purchase_lines rl join purchases r on r.id = rl.purchase_id
                           where r.return_of = l.purchase_id and r.status = 'received' and rl.item_kind = l.item_kind and rl.item_id = l.item_id and rl.size = l.size),0)::float as returned
           from purchase_lines l where l.purchase_id = $1 order by l.name`,
        [id],
      ),
      db.many('select sp.*, sp.amount::float as amount, u.name as staff_name from supplier_payments sp left join staff_users u on u.id = sp.staff_id where sp.purchase_id = $1 order by sp.paid_on', [id]),
      db.many(`select id, number, total::float as total, purchase_date from purchases where return_of = $1 order by created_at`, [id]),
    ]);
    const paid = round2(payments.reduce((a, x) => a + x.amount, 0));
    return { ...p, lines, payments, returns, paid, due: round2(Math.max(0, p.total - paid)) };
  }

  @Post('purchases')
  @UseGuards(PurchasesGuard)
  async create(
    @CurrentStaff() me: StaffUser,
    @Body()
    b: {
      supplierId?: string;
      branchId?: string;
      status?: 'ordered' | 'received';
      reference?: string;
      date?: string;
      lines?: { kind: 'product' | 'fabric'; id: string; size?: string | null; qty: number; unitCost: number }[];
      discount?: number;
      tax?: number;
      shipping?: number;
      notes?: string;
      payment?: { amount?: number; method?: string; reference?: string } | null;
    },
  ) {
    const supplier = await db.one('select id from suppliers where id = $1', [uuidOrNull(b?.supplierId)]);
    if (!supplier) fail('supplier_not_found');
    const branch = await db.one('select id from branches where id = $1', [uuidOrNull(b?.branchId)]);
    if (!branch) fail('branch_not_found');
    const lines = Array.isArray(b?.lines) ? b.lines : [];
    if (!lines.length || lines.length > 300) fail('invalid_lines');
    const clean: { kind: string; id: string; size: string; name: string; qty: number; cost: number }[] = [];
    for (const l of lines) {
      const qty = round2(Number(l?.qty));
      const cost = round2(Number(l?.unitCost));
      if (!(qty > 0) || qty > 1_000_000) fail('invalid_qty');
      if (!(cost >= 0) || cost > 1_000_000) fail('invalid_number', { field: 'unitCost' });
      if (l.kind === 'product') {
        const p = await db.one('select id, name_en, sizes from products where id = $1', [l.id]);
        if (!p) fail('product_not_found', { productId: l.id });
        if (p.sizes.length && !p.sizes.includes(l.size)) fail('size_required', { productId: p.id });
        clean.push({ kind: 'product', id: p.id, size: p.sizes.length ? String(l.size) : '', name: p.name_en + (p.sizes.length ? ` (${l.size})` : ''), qty, cost });
      } else if (l.kind === 'fabric') {
        const f = await db.one('select id, name_en from fabrics where id = $1', [l.id]);
        if (!f) fail('fabric_not_found');
        clean.push({ kind: 'fabric', id: f.id, size: '', name: f.name_en, qty, cost });
      } else fail('invalid_kind');
    }
    const money = (v: unknown, field: string) => {
      const n = round2(Number(v ?? 0));
      if (!(n >= 0) || n > 10_000_000) fail('invalid_number', { field });
      return n;
    };
    const subtotal = round2(clean.reduce((a, l) => a + l.qty * l.cost, 0));
    const discount = Math.min(subtotal, money(b.discount, 'discount'));
    const tax = money(b.tax, 'tax');
    const shipping = money(b.shipping, 'shipping');
    const total = round2(subtotal - discount + tax + shipping);
    const status = b.status === 'ordered' ? 'ordered' : 'received';
    const date = b.date ? day(b.date, 'date') : today();
    return db.tx(async (c) => {
      const number = await nextNumber('purchase_number_seq', 'PO-', c);
      const p = await db.one(
        `insert into purchases (number, kind, supplier_id, branch_id, status, reference, purchase_date, subtotal, discount, tax, shipping, total, notes, staff_id)
         values ($1,'purchase',$2,$3,'ordered',$4,$5,$6,$7,$8,$9,$10,$11,$12) returning id`,
        [number, supplier.id, branch.id, b.reference ? String(b.reference).slice(0, 80) : null, date, subtotal, discount, tax, shipping, total, b.notes ? String(b.notes).slice(0, 500) : null, me.id],
        c,
      );
      for (const l of clean)
        await c.query('insert into purchase_lines (purchase_id, item_kind, item_id, size, name, qty, unit_cost, line_total) values ($1,$2,$3,$4,$5,$6,$7,$8)', [p!.id, l.kind, l.id, l.size, l.name, l.qty, l.cost, round2(l.qty * l.cost)]);
      if (status === 'received') await receive(p!.id, me, c);
      if (b.payment && Number(b.payment.amount) > 0) await this.addPayment(me, supplier.id, p!.id, b.payment, c);
      await audit(me, 'create', 'purchase', p!.id, { number, total, status, lines: clean.length }, c);
      return { id: p!.id, number, total };
    });
  }

  @Post('purchases/:id/receive')
  @HttpCode(200)
  @UseGuards(PurchasesGuard)
  async markReceived(@CurrentStaff() me: StaffUser, @Param('id') id: string) {
    return db.tx(async (c) => {
      const p = await db.one('select * from purchases where id = $1 for update', [id], c);
      if (!p) throw new NotFoundException({ code: 'not_found' });
      if (p.status !== 'ordered') fail('purchase_not_open');
      await receive(id, me, c);
      await audit(me, 'receive', 'purchase', id, null, c);
      return { ok: true };
    });
  }

  @Post('purchases/:id/cancel')
  @HttpCode(200)
  @UseGuards(PurchasesGuard)
  async cancel(@CurrentStaff() me: StaffUser, @Param('id') id: string) {
    const r = await db.pool.query(`update purchases set status = 'cancelled' where id = $1 and status = 'ordered'`, [id]);
    if (!r.rowCount) fail('purchase_not_open');
    await audit(me, 'cancel', 'purchase', id);
    return { ok: true };
  }

  /** Goods sent back to the supplier: out of stock, and off what is owed. */
  @Post('purchases/:id/return')
  @UseGuards(PurchasesGuard)
  async returnGoods(@CurrentStaff() me: StaffUser, @Param('id') id: string, @Body() b: { lines?: { lineId: string; qty: number }[]; notes?: string }) {
    const settings = await getSettings();
    return db.tx(async (c) => {
      const p = await db.one('select * from purchases where id = $1 for update', [id], c);
      if (!p) throw new NotFoundException({ code: 'not_found' });
      if (p.kind !== 'purchase' || p.status !== 'received') fail('purchase_not_received');
      const lines = await db.many('select * from purchase_lines where purchase_id = $1', [id], c);
      const picked: { line: any; qty: number }[] = [];
      for (const r of Array.isArray(b?.lines) ? b.lines : []) {
        const line = lines.find((l) => l.id === r.lineId);
        const qty = round2(Number(r?.qty));
        if (!line || !(qty > 0)) fail('invalid_return_qty');
        const already = Number(
          (await db.one(
            `select coalesce(sum(rl.qty),0) as q from purchase_lines rl join purchases r on r.id = rl.purchase_id where r.return_of = $1 and rl.item_kind = $2 and rl.item_id = $3 and rl.size = $4`,
            [id, line.item_kind, line.item_id, line.size],
            c,
          ))!.q,
        );
        if (qty > Number(line.qty) - already) fail('invalid_return_qty');
        if (!settings.pos.allow_negative_stock && (await stockLevel({ kind: line.item_kind, id: line.item_id, size: line.size }, p.branch_id, c)) < qty) fail('out_of_stock', { item: line.name });
        picked.push({ line, qty });
      }
      if (!picked.length) fail('invalid_lines');
      const subtotal = round2(picked.reduce((a, x) => a + x.qty * Number(x.line.unit_cost), 0));
      const number = await nextNumber('purchase_number_seq', 'PR-', c);
      const r = await db.one(
        `insert into purchases (number, kind, supplier_id, branch_id, status, purchase_date, subtotal, total, notes, return_of, staff_id)
         values ($1,'return',$2,$3,'ordered',$4,$5,$5,$6,$7,$8) returning id`,
        [number, p.supplier_id, p.branch_id, today(), subtotal, b.notes ? String(b.notes).slice(0, 500) : null, id, me.id],
        c,
      );
      for (const x of picked)
        await c.query('insert into purchase_lines (purchase_id, item_kind, item_id, size, name, qty, unit_cost, line_total) values ($1,$2,$3,$4,$5,$6,$7,$8)', [
          r!.id,
          x.line.item_kind,
          x.line.item_id,
          x.line.size,
          x.line.name,
          x.qty,
          x.line.unit_cost,
          round2(x.qty * Number(x.line.unit_cost)),
        ]);
      await receive(r!.id, me, c);
      await audit(me, 'return', 'purchase', id, { number, total: subtotal }, c);
      return { id: r!.id, number, total: subtotal };
    });
  }

  /* ---------- paying suppliers ---------- */

  @Post('supplier-payments')
  @UseGuards(PurchasesGuard)
  async pay(@CurrentStaff() me: StaffUser, @Body() b: { supplierId?: string; purchaseId?: string; amount?: number; method?: string; reference?: string; date?: string; note?: string }) {
    const supplier = await db.one('select id from suppliers where id = $1', [uuidOrNull(b?.supplierId)]);
    if (!supplier) fail('supplier_not_found');
    return db.tx(async (c) => {
      const id = await this.addPayment(me, supplier.id, uuidOrNull(b.purchaseId), b, c);
      await audit(me, 'payment', 'supplier', supplier.id, { amount: b.amount, method: b.method, purchase: b.purchaseId ?? null }, c);
      return { id };
    });
  }

  private async addPayment(me: StaffUser, supplierId: string, purchaseId: string | null, b: { amount?: number; method?: string; reference?: string; date?: string; note?: string }, c: Queryable) {
    const amount = round2(Number(b?.amount));
    if (!(amount > 0)) fail('invalid_number', { field: 'amount' });
    if (!METHODS.includes(String(b?.method))) fail('invalid_payment');
    if (purchaseId) {
      const p = await db.one('select supplier_id from purchases where id = $1', [purchaseId], c);
      if (!p || p.supplier_id !== supplierId) fail('purchase_not_found');
    }
    // Cash for a supplier leaves the drawer.
    const register = b.method === 'cash' ? (hasPerm(me, 'pos') ? await openRegister(me.id, c) : null) : null;
    const r = await db.one(
      'insert into supplier_payments (supplier_id, purchase_id, amount, method, reference, paid_on, note, register_id, staff_id) values ($1,$2,$3,$4,$5,$6,$7,$8,$9) returning id',
      [supplierId, purchaseId, amount, b.method, b.reference ? String(b.reference).slice(0, 80) : null, b.date ? day(b.date, 'date') : today(), b.note ? String(b.note).slice(0, 300) : null, register?.id ?? null, me.id],
      c,
    );
    return r!.id as string;
  }

  /* ---------- expenses ---------- */

  @Get('expenses')
  @UseGuards(AnyStaff)
  expenses(@Query('from') from?: string, @Query('to') to?: string, @Query('branch') branch?: string, @Query('category') category?: string) {
    const rg = range(from, to);
    return db.many(
      `select e.*, e.amount::float as amount, e.tax::float as tax, c.name_en as category_en, c.name_ar as category_ar, b.name_en as branch_en, b.name_ar as branch_ar, u.name as staff_name
         from expenses e left join expense_categories c on c.id = e.category_id join branches b on b.id = e.branch_id left join staff_users u on u.id = e.staff_id
        where e.spent_on between $1::date and $2::date and ($3::uuid is null or e.branch_id = $3) and ($4::uuid is null or e.category_id = $4)
        order by e.spent_on desc, e.created_at desc limit 1000`,
      [rg.from, rg.to, uuidOrNull(branch), uuidOrNull(category)],
    );
  }

  @Post('expenses')
  @UseGuards(ExpensesGuard)
  async addExpense(@CurrentStaff() me: StaffUser, @Body() b: { branchId?: string; categoryId?: string; amount?: number; tax?: number; date?: string; method?: string; reference?: string; note?: string }) {
    const branch = await db.one('select id from branches where id = $1', [uuidOrNull(b?.branchId) ?? me.branch_id]);
    if (!branch) fail('branch_not_found');
    const category = b?.categoryId ? await db.one('select id from expense_categories where id = $1', [uuidOrNull(b.categoryId)]) : null;
    if (b?.categoryId && !category) fail('invalid_category');
    const amount = round2(Number(b?.amount));
    if (!(amount > 0) || amount > 10_000_000) fail('invalid_number', { field: 'amount' });
    const tax = round2(Number(b?.tax ?? 0));
    if (!(tax >= 0) || tax > amount) fail('invalid_number', { field: 'tax' });
    if (!METHODS.includes(String(b?.method))) fail('invalid_payment');
    return db.tx(async (c) => {
      // Cash out of the drawer is counted against the open register.
      const register = b.method === 'cash' ? (hasPerm(me, 'pos') ? await requireRegister(me, c) : await openRegister(me.id, c)) : null;
      const number = await nextNumber('expense_number_seq', 'EX-', c);
      const r = await db.one(
        'insert into expenses (number, branch_id, category_id, amount, tax, spent_on, method, reference, note, register_id, staff_id) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) returning id',
        [number, branch.id, category?.id ?? null, amount, tax, b.date ? day(b.date, 'date') : today(), b.method, b.reference ? String(b.reference).slice(0, 80) : null, b.note ? String(b.note).slice(0, 500) : null, register?.id ?? null, me.id],
        c,
      );
      await audit(me, 'create', 'expense', r!.id, { number, amount, method: b.method }, c);
      return { id: r!.id, number };
    });
  }

  @Post('expenses/:id/delete')
  @HttpCode(200)
  @UseGuards(ExpensesGuard)
  async deleteExpense(@CurrentStaff() me: StaffUser, @Param('id') id: string) {
    const e = await db.one('select e.id, e.number, e.amount, r.closed_at from expenses e left join cash_registers r on r.id = e.register_id where e.id = $1', [id]);
    if (!e) throw new NotFoundException({ code: 'not_found' });
    // Once its register is closed and counted, a cash expense stays.
    if (e.closed_at && !hasPerm(me, 'manage')) fail('register_closed_already');
    await db.pool.query('delete from expenses where id = $1', [id]);
    await audit(me, 'delete', 'expense', id, { number: e.number, amount: e.amount });
    return { ok: true };
  }
}
