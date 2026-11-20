import { Controller, Get, NotFoundException, Param, Query, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import { db } from '../db.js';
import { round2 } from '../lib.js';
import { toCsv } from '../csv.js';
import { registerTotals } from '../pos.js';
import { AnyStaff, CurrentStaff, ReportsGuard, audit, type StaffUser } from '../staff.js';
import { range, uuidOrNull } from './pos.controller.js';

type Col = { key: string; en: string; ar: string; type?: 'text' | 'money' | 'int' | 'num' | 'date' | 'datetime' | 'percent' };
type Report = { columns: Col[]; rows: Record<string, any>[]; totals?: Record<string, any> };

/** Orders that count as sales: placed (or imported) in the range, not cancelled. */
const SALES = `o.stage not in ('pending_payment','payment_failed','cancelled') and (o.created_at at time zone 'Asia/Qatar')::date between $1::date and $2::date and ($3::uuid is null or o.branch_id = $3)`;
const qDate = (col: string) => `(${col} at time zone 'Asia/Qatar')::date`;
const sum = (rows: any[], key: string) => round2(rows.reduce((a, r) => a + Number(r[key] ?? 0), 0));
const totalsFor = (rows: any[], keys: string[]) => Object.fromEntries(keys.map((k) => [k, sum(rows, k)]));
const METHOD: Record<string, [string, string]> = {
  cash: ['Cash', 'نقدًا'],
  card_machine: ['Card', 'بطاقة'],
  card: ['Card', 'بطاقة'],
  sadad: ['SADAD (online)', 'سداد (أونلاين)'],
  bank_transfer: ['Bank transfer', 'تحويل بنكي'],
  cheque: ['Cheque', 'شيك'],
  none: ['No refund', 'بدون رد'],
};

async function build(name: string, from: string, to: string, branch: string | null): Promise<Report> {
  const p = [from, to, branch];
  switch (name) {
    case 'profit-loss': {
      const s = await db.one(
        `select coalesce(sum(i.unit_price * i.qty),0)::float as gross, coalesce(sum(i.discount),0)::float as line_discounts,
                coalesce(sum(i.unit_cost * (i.qty - i.returned_qty)),0)::float as cogs
           from order_items i join orders o on o.id = i.order_id where ${SALES}`,
        p,
      );
      const o = await db.one(
        `select count(*)::int as n, coalesce(sum(o.total),0)::float as net, coalesce(sum(o.discount),0)::float as order_discounts, coalesce(sum(o.points_used),0)::float as points,
                coalesce(sum(o.delivery_fee + o.home_visit_fee + o.service_charge),0)::float as charges, coalesce(sum(o.tax),0)::float as tax
           from orders o where ${SALES}`,
        p,
      );
      const returns = await db.one(`select coalesce(sum(r.amount),0)::float as v from sales_returns r where ${qDate('r.created_at')} between $1::date and $2::date and ($3::uuid is null or r.branch_id = $3)`, p);
      const expenses = await db.one(`select coalesce(sum(e.amount),0)::float as v from expenses e where e.spent_on between $1::date and $2::date and ($3::uuid is null or e.branch_id = $3)`, p);
      const purchases = await db.one(
        `select coalesce(sum(total) filter (where kind = 'purchase'),0)::float as bought, coalesce(sum(total) filter (where kind = 'return'),0)::float as returned
           from purchases where status = 'received' and purchase_date between $1::date and $2::date and ($3::uuid is null or branch_id = $3)`,
        p,
      );
      const fees = await db.one(
        `select coalesce(sum(amount),0)::float as v from payments p join appointments a on a.id = p.appointment_id
          where p.status = 'paid' and p.order_id is null and ${qDate('p.completed_at')} between $1::date and $2::date and ($3::uuid is null or a.branch_id = $3)`,
        p,
      );
      const grossProfit = round2(o!.net + fees!.v - returns!.v - s!.cogs);
      const rows = [
        ['sales_count', 'Number of sales', 'عدد المبيعات', o!.n, 'int'],
        ['gross', 'Sales before discounts', 'المبيعات قبل الخصم', s!.gross, 'money'],
        ['discounts', 'Discounts', 'الخصومات', -round2(s!.line_discounts + o!.order_discounts), 'money'],
        ['points', 'Points redeemed', 'النقاط المستبدلة', -o!.points, 'money'],
        ['charges', 'Delivery, visit and service charges', 'رسوم التوصيل والزيارة والخدمة', o!.charges, 'money'],
        ['net', 'Net sales', 'صافي المبيعات', o!.net, 'money'],
        ['fees', 'Booking fees', 'رسوم الحجز', fees!.v, 'money'],
        ['returns', 'Sales returns', 'مرتجع المبيعات', -returns!.v, 'money'],
        ['cogs', 'Cost of goods sold', 'تكلفة البضاعة المباعة', -s!.cogs, 'money'],
        ['gross_profit', 'Gross profit', 'إجمالي الربح', grossProfit, 'money'],
        ['expenses', 'Expenses', 'المصاريف', -expenses!.v, 'money'],
        ['net_profit', 'Net profit', 'صافي الربح', round2(grossProfit - expenses!.v), 'money'],
        ['purchases', 'Purchases received', 'المشتريات المستلمة', purchases!.bought, 'money'],
        ['purchase_returns', 'Purchase returns', 'مرتجع المشتريات', purchases!.returned, 'money'],
        ['tax', 'Tax included in sales', 'الضريبة المشمولة في المبيعات', o!.tax, 'money'],
      ].map(([key, en, ar, value, type]) => ({ key, label_en: en, label_ar: ar, value, type }));
      return { columns: [{ key: 'label', en: 'Item', ar: 'البند' }, { key: 'value', en: 'Amount', ar: 'المبلغ', type: 'money' }], rows };
    }
    case 'sales-daily': {
      const rows = await db.many(
        `with d as (select generate_series($1::date, $2::date, interval '1 day')::date as day)
         select d.day,
                (select count(*)::int from orders o where ${SALES.replace(/between \$1::date and \$2::date/, '= d.day')}) as count,
                (select coalesce(sum(o.total),0)::float from orders o where ${SALES.replace(/between \$1::date and \$2::date/, '= d.day')}) as net,
                (select coalesce(sum(o.discount + (select coalesce(sum(i.discount),0) from order_items i where i.order_id = o.id)),0)::float from orders o where ${SALES.replace(/between \$1::date and \$2::date/, '= d.day')}) as discount,
                (select coalesce(sum(p.amount),0)::float from payments p left join orders o on o.id = p.order_id left join appointments a on a.id = p.appointment_id
                  where p.status = 'paid' and ${qDate('p.completed_at')} = d.day and ($3::uuid is null or coalesce(o.branch_id, a.branch_id) = $3)) as received,
                (select coalesce(sum(r.amount),0)::float from sales_returns r where ${qDate('r.created_at')} = d.day and ($3::uuid is null or r.branch_id = $3)) as returns,
                (select coalesce(sum(e.amount),0)::float from expenses e where e.spent_on = d.day and ($3::uuid is null or e.branch_id = $3)) as expenses
           from d order by d.day desc`,
        p,
      );
      return {
        columns: [
          { key: 'day', en: 'Date', ar: 'التاريخ', type: 'date' },
          { key: 'count', en: 'Number of sales', ar: 'عدد المبيعات', type: 'int' },
          { key: 'net', en: 'Net sales', ar: 'صافي المبيعات', type: 'money' },
          { key: 'discount', en: 'Discounts', ar: 'الخصومات', type: 'money' },
          { key: 'received', en: 'Payments received', ar: 'المقبوضات', type: 'money' },
          { key: 'returns', en: 'Returns', ar: 'المرتجعات', type: 'money' },
          { key: 'expenses', en: 'Expenses', ar: 'المصاريف', type: 'money' },
        ],
        rows,
        totals: totalsFor(rows, ['count', 'net', 'discount', 'received', 'returns', 'expenses']),
      };
    }
    case 'sales-by-branch':
    case 'sales-by-channel':
    case 'staff':
    case 'agents':
    case 'groups': {
      const group = {
        'sales-by-branch': { sel: `coalesce(b.name_en, '—') as name_en, coalesce(b.name_ar, '—') as name_ar`, by: 'b.name_en, b.name_ar' },
        'sales-by-channel': { sel: `o.channel as name_en, o.channel as name_ar`, by: 'o.channel' },
        staff: { sel: `coalesce(u.name, 'Customer app') as name_en, coalesce(u.name, 'تطبيق العملاء') as name_ar`, by: 'u.name' },
        agents: { sel: `ag.name as name_en, ag.name as name_ar, max(ag.commission_percent)::float as commission_percent, round(sum(o.total) * max(ag.commission_percent) / 100, 2)::float as commission`, by: 'ag.name' },
        groups: { sel: `coalesce(g.name_en, 'No group') as name_en, coalesce(g.name_ar, 'بدون مجموعة') as name_ar, count(distinct o.customer_id)::int as customers`, by: 'g.name_en, g.name_ar' },
      }[name]!;
      const rows = await db.many(
        `select ${group.sel}, count(*)::int as count, coalesce(sum(o.total),0)::float as net,
                coalesce(sum((select coalesce(sum(amount),0) from payments p where p.order_id = o.id and p.status = 'paid')),0)::float as paid,
                coalesce(sum(greatest(0, o.total - (select coalesce(sum(amount),0) from payments p where p.order_id = o.id and p.status = 'paid'))),0)::float as due
           from orders o left join branches b on b.id = o.branch_id left join staff_users u on u.id = o.placed_by_staff_id
           left join customers c on c.id = o.customer_id left join customer_groups g on g.id = c.group_id
           ${name === 'agents' ? 'join' : 'left join'} agents ag on ag.id = o.agent_id
          where ${SALES} group by ${group.by} order by net desc`,
        p,
      );
      const cols: Col[] = [
        { key: 'name', en: name === 'staff' ? 'Staff' : name === 'agents' ? 'Agent' : name === 'groups' ? 'Customer group' : name === 'sales-by-channel' ? 'Channel' : 'Branch', ar: name === 'staff' ? 'الموظف' : name === 'agents' ? 'الوكيل' : name === 'groups' ? 'مجموعة العملاء' : name === 'sales-by-channel' ? 'القناة' : 'الفرع' },
        ...(name === 'groups' ? [{ key: 'customers', en: 'Customers', ar: 'العملاء', type: 'int' } as Col] : []),
        { key: 'count', en: 'Number of sales', ar: 'عدد المبيعات', type: 'int' },
        { key: 'net', en: 'Net sales', ar: 'صافي المبيعات', type: 'money' },
        { key: 'paid', en: 'Paid', ar: 'المدفوع', type: 'money' },
        { key: 'due', en: 'Due', ar: 'المتبقي', type: 'money' },
        ...(name === 'agents'
          ? ([
              { key: 'commission_percent', en: 'Commission %', ar: 'نسبة العمولة', type: 'percent' },
              { key: 'commission', en: 'Commission', ar: 'العمولة', type: 'money' },
            ] as Col[])
          : []),
      ];
      return { columns: cols, rows, totals: totalsFor(rows, ['count', 'net', 'paid', 'due', ...(name === 'agents' ? ['commission'] : [])]) };
    }
    case 'products': {
      const rows = await db.many(
        `select case i.kind when 'thobe' then coalesce(i.snapshot->'thobe'->'fabric'->>'name_en', 'Thobe') when 'product' then coalesce(i.snapshot->'product'->>'name_en', '—') else 'Imported sale' end as name_en,
                case i.kind when 'thobe' then coalesce(i.snapshot->'thobe'->'fabric'->>'name_ar', 'ثوب') when 'product' then coalesce(i.snapshot->'product'->>'name_ar', '—') else 'مبيعات مستوردة' end as name_ar,
                i.kind, coalesce(i.snapshot->'product'->>'sku', '') as sku,
                sum(i.qty - i.returned_qty)::int as qty, coalesce(sum(i.line_total * (i.qty - i.returned_qty)::numeric / nullif(i.qty,0)),0)::float as revenue,
                coalesce(sum(i.unit_cost * (i.qty - i.returned_qty)),0)::float as cost
           from order_items i join orders o on o.id = i.order_id where ${SALES}
          group by 1,2,3,4 order by revenue desc limit 500`,
        p,
      );
      const out = rows.map((r) => ({ ...r, profit: round2(r.revenue - r.cost), margin: r.revenue > 0 ? round2(((r.revenue - r.cost) / r.revenue) * 100) : 0 }));
      return {
        columns: [
          { key: 'name', en: 'Item', ar: 'الصنف' },
          { key: 'sku', en: 'SKU', ar: 'الرمز' },
          { key: 'qty', en: 'Sold', ar: 'الكمية المباعة', type: 'int' },
          { key: 'revenue', en: 'Revenue', ar: 'الإيراد', type: 'money' },
          { key: 'cost', en: 'Cost', ar: 'التكلفة', type: 'money' },
          { key: 'profit', en: 'Profit', ar: 'الربح', type: 'money' },
          { key: 'margin', en: 'Margin', ar: 'الهامش', type: 'percent' },
        ],
        rows: out,
        totals: totalsFor(out, ['qty', 'revenue', 'cost', 'profit']),
      };
    }
    case 'stock': {
      const rows = await db.many(
        `with items as (
           select 'product' as kind, p.id, p.sku, p.name_en, p.name_ar, s.size, p.cost::float as cost, p.price::float as price, p.alert_qty::float as alert_qty
             from products p cross join lateral unnest(case when cardinality(p.sizes) = 0 then array[''] else p.sizes end) as s(size) where p.track_stock
           union all select 'fabric', f.id, f.sku, f.name_en, f.name_ar, '', f.cost::float, f.price::float, f.alert_qty::float from fabrics f where f.track_stock)
         select i.*, coalesce((select sum(qty) from stock_moves m where m.item_kind = i.kind and m.item_id = i.id and m.size = i.size and ($3::uuid is null or m.branch_id = $3)),0)::float as qty,
                coalesce((select -sum(qty) from stock_moves m where m.item_kind = i.kind and m.item_id = i.id and m.size = i.size and m.reason = 'sale'
                            and ${qDate('m.created_at')} between $1::date and $2::date and ($3::uuid is null or m.branch_id = $3)),0)::float as sold
           from items i order by i.kind desc, i.name_en, i.size`,
        p,
      );
      const out = rows.map((r) => ({ ...r, name_en: r.name_en + (r.size ? ` (${r.size})` : ''), name_ar: r.name_ar + (r.size ? ` (${r.size})` : ''), value: round2(r.qty * r.cost), retail: round2(r.qty * r.price) }));
      return {
        columns: [
          { key: 'sku', en: 'SKU', ar: 'الرمز' },
          { key: 'name', en: 'Item', ar: 'الصنف' },
          { key: 'qty', en: 'In stock', ar: 'المخزون', type: 'num' },
          { key: 'alert_qty', en: 'Alert at', ar: 'حد التنبيه', type: 'num' },
          { key: 'sold', en: 'Sold in period', ar: 'المباع في الفترة', type: 'num' },
          { key: 'cost', en: 'Unit cost', ar: 'تكلفة الوحدة', type: 'money' },
          { key: 'value', en: 'Stock value (cost)', ar: 'قيمة المخزون (تكلفة)', type: 'money' },
          { key: 'retail', en: 'Stock value (price)', ar: 'قيمة المخزون (سعر البيع)', type: 'money' },
        ],
        rows: out,
        totals: totalsFor(out, ['qty', 'sold', 'value', 'retail']),
      };
    }
    case 'purchases':
    case 'suppliers': {
      const rows = await db.many(
        `select s.name as name_en, s.name as name_ar, s.phone,
                count(pu.id) filter (where pu.kind = 'purchase' and pu.status = 'received' and pu.purchase_date between $1::date and $2::date and ($3::uuid is null or pu.branch_id = $3))::int as count,
                coalesce(sum(pu.total) filter (where pu.kind = 'purchase' and pu.status = 'received' and pu.purchase_date between $1::date and $2::date and ($3::uuid is null or pu.branch_id = $3)),0)::float as bought,
                coalesce(sum(pu.total) filter (where pu.kind = 'return' and pu.status = 'received' and pu.purchase_date between $1::date and $2::date and ($3::uuid is null or pu.branch_id = $3)),0)::float as returned,
                coalesce((select sum(amount) from supplier_payments sp where sp.supplier_id = s.id and sp.paid_on between $1::date and $2::date),0)::float as paid,
                (s.opening_balance + coalesce(sum(pu.total) filter (where pu.kind = 'purchase' and pu.status = 'received'),0)
                  - coalesce(sum(pu.total) filter (where pu.kind = 'return' and pu.status = 'received'),0)
                  - coalesce((select sum(amount) from supplier_payments sp where sp.supplier_id = s.id),0))::float as balance
           from suppliers s left join purchases pu on pu.supplier_id = s.id group by s.id order by ${name === 'suppliers' ? 'balance' : 'bought'} desc`,
        p,
      );
      return {
        columns: [
          { key: 'name', en: 'Supplier', ar: 'المورد' },
          { key: 'phone', en: 'Mobile', ar: 'الجوال' },
          { key: 'count', en: 'Purchases', ar: 'المشتريات', type: 'int' },
          { key: 'bought', en: 'Bought', ar: 'قيمة المشتريات', type: 'money' },
          { key: 'returned', en: 'Returned', ar: 'المرتجع', type: 'money' },
          { key: 'paid', en: 'Paid in period', ar: 'المدفوع في الفترة', type: 'money' },
          { key: 'balance', en: 'Owed now', ar: 'الرصيد المستحق الآن', type: 'money' },
        ],
        rows,
        totals: totalsFor(rows, ['count', 'bought', 'returned', 'paid', 'balance']),
      };
    }
    case 'expenses': {
      const rows = await db.many(
        `select coalesce(c.name_en, 'Uncategorised') as name_en, coalesce(c.name_ar, 'بدون فئة') as name_ar, count(*)::int as count, sum(e.amount)::float as total, sum(e.tax)::float as tax
           from expenses e left join expense_categories c on c.id = e.category_id
          where e.spent_on between $1::date and $2::date and ($3::uuid is null or e.branch_id = $3) group by 1,2 order by total desc`,
        p,
      );
      return {
        columns: [
          { key: 'name', en: 'Category', ar: 'الفئة' },
          { key: 'count', en: 'Expenses', ar: 'عدد المصاريف', type: 'int' },
          { key: 'total', en: 'Total', ar: 'الإجمالي', type: 'money' },
          { key: 'tax', en: 'Tax', ar: 'الضريبة', type: 'money' },
        ],
        rows,
        totals: totalsFor(rows, ['count', 'total', 'tax']),
      };
    }
    case 'payments': {
      const rows = await db.many(
        `select x.method, sum(x.received)::float as received, sum(x.refunded)::float as refunded, sum(x.paid_out)::float as paid_out, sum(x.n)::int as count from (
           select p.provider as method, p.amount as received, 0 as refunded, 0 as paid_out, 1 as n from payments p left join orders o on o.id = p.order_id left join appointments a on a.id = p.appointment_id
            where p.status = 'paid' and ${qDate('p.completed_at')} between $1::date and $2::date and ($3::uuid is null or coalesce(o.branch_id, a.branch_id) = $3)
           union all select case r.method when 'card' then 'card_machine' else r.method end, 0, r.amount, 0, 0 from refunds r join orders o on o.id = r.order_id
            where ${qDate('r.created_at')} between $1::date and $2::date and ($3::uuid is null or o.branch_id = $3)
           union all select case e.method when 'card' then 'card_machine' else e.method end, 0, 0, e.amount, 0 from expenses e where e.spent_on between $1::date and $2::date and ($3::uuid is null or e.branch_id = $3)
           union all select case s.method when 'card' then 'card_machine' else s.method end, 0, 0, s.amount, 0 from supplier_payments s where s.paid_on between $1::date and $2::date
         ) x group by x.method order by received desc`,
        p,
      );
      const out = rows.map((r) => ({ ...r, name_en: METHOD[r.method]?.[0] ?? r.method, name_ar: METHOD[r.method]?.[1] ?? r.method, net: round2(r.received - r.refunded - r.paid_out) }));
      return {
        columns: [
          { key: 'name', en: 'Method', ar: 'طريقة الدفع' },
          { key: 'count', en: 'Payments', ar: 'عدد الدفعات', type: 'int' },
          { key: 'received', en: 'Received', ar: 'المقبوض', type: 'money' },
          { key: 'refunded', en: 'Refunded', ar: 'المردود', type: 'money' },
          { key: 'paid_out', en: 'Expenses and suppliers', ar: 'المصاريف والموردون', type: 'money' },
          { key: 'net', en: 'Net', ar: 'الصافي', type: 'money' },
        ],
        rows: out,
        totals: totalsFor(out, ['count', 'received', 'refunded', 'paid_out', 'net']),
      };
    }
    case 'customers': {
      const rows = await db.many(
        `select c.name as name_en, c.name as name_ar, c.phone, count(o.id)::int as count, coalesce(sum(o.total),0)::float as net,
                coalesce(sum(greatest(0, o.total - (select coalesce(sum(amount),0) from payments p where p.order_id = o.id and p.status = 'paid'))),0)::float as due,
                (select coalesce(sum(points),0)::int from points_ledger l where l.customer_id = c.id) as points, max(o.created_at) as last_order
           from customers c join orders o on o.customer_id = c.id and ${SALES}
          where c.deleted_at is null group by c.id order by net desc limit 500`,
        p,
      );
      return {
        columns: [
          { key: 'name', en: 'Customer', ar: 'العميل' },
          { key: 'phone', en: 'Mobile', ar: 'الجوال' },
          { key: 'count', en: 'Orders', ar: 'الطلبات', type: 'int' },
          { key: 'net', en: 'Spent', ar: 'المشتريات', type: 'money' },
          { key: 'due', en: 'Due', ar: 'المتبقي', type: 'money' },
          { key: 'points', en: 'Points', ar: 'النقاط', type: 'int' },
          { key: 'last_order', en: 'Last order', ar: 'آخر طلب', type: 'date' },
        ],
        rows,
        totals: totalsFor(rows, ['count', 'net', 'due']),
      };
    }
    case 'tax': {
      const rows = await db.many(
        `with m as (select to_char(${qDate('o.created_at')}, 'YYYY-MM') as month, coalesce(sum(o.total),0)::float as sales, coalesce(sum(o.tax),0)::float as output_tax
                      from orders o where ${SALES} group by 1)
         select m.*, coalesce((select sum(pu.tax) from purchases pu where pu.kind = 'purchase' and pu.status = 'received' and to_char(pu.purchase_date, 'YYYY-MM') = m.month and ($3::uuid is null or pu.branch_id = $3)),0)::float as input_tax,
                coalesce((select sum(e.tax) from expenses e where to_char(e.spent_on, 'YYYY-MM') = m.month and ($3::uuid is null or e.branch_id = $3)),0)::float as expense_tax
           from m order by m.month desc`,
        p,
      );
      const out = rows.map((r) => ({ ...r, net_tax: round2(r.output_tax - r.input_tax - r.expense_tax) }));
      return {
        columns: [
          { key: 'month', en: 'Month', ar: 'الشهر' },
          { key: 'sales', en: 'Sales', ar: 'المبيعات', type: 'money' },
          { key: 'output_tax', en: 'Tax on sales', ar: 'ضريبة المبيعات', type: 'money' },
          { key: 'input_tax', en: 'Tax on purchases', ar: 'ضريبة المشتريات', type: 'money' },
          { key: 'expense_tax', en: 'Tax on expenses', ar: 'ضريبة المصاريف', type: 'money' },
          { key: 'net_tax', en: 'Net tax', ar: 'صافي الضريبة', type: 'money' },
        ],
        rows: out,
        totals: totalsFor(out, ['sales', 'output_tax', 'input_tax', 'expense_tax', 'net_tax']),
      };
    }
    case 'registers': {
      const regs = await db.many(
        `select r.id, r.opened_at, r.closed_at, r.counted_cash::float as counted_cash, r.expected_cash::float as expected_cash, u.name as staff, b.name_en as branch_en, b.name_ar as branch_ar
           from cash_registers r join staff_users u on u.id = r.staff_id join branches b on b.id = r.branch_id
          where ${qDate('r.opened_at')} between $1::date and $2::date and ($3::uuid is null or r.branch_id = $3) order by r.opened_at desc`,
        p,
      );
      const rows = [];
      for (const r of regs) {
        const t = await registerTotals(r.id);
        const expected = r.closed_at ? r.expected_cash : t.expected_cash;
        rows.push({
          ...r,
          name_en: `${r.staff} · ${r.branch_en}`,
          name_ar: `${r.staff} · ${r.branch_ar}`,
          cash: t.cash_sales,
          card: t.card_sales,
          expected,
          difference: r.closed_at ? round2((r.counted_cash ?? 0) - expected) : null,
        });
      }
      return {
        columns: [
          { key: 'name', en: 'Register', ar: 'الصندوق' },
          { key: 'opened_at', en: 'Opened', ar: 'الفتح', type: 'datetime' },
          { key: 'closed_at', en: 'Closed', ar: 'الإغلاق', type: 'datetime' },
          { key: 'cash', en: 'Cash sales', ar: 'المبيعات النقدية', type: 'money' },
          { key: 'card', en: 'Card sales', ar: 'مبيعات البطاقة', type: 'money' },
          { key: 'expected', en: 'Expected cash', ar: 'النقد المتوقع', type: 'money' },
          { key: 'counted_cash', en: 'Counted cash', ar: 'النقد المعدود', type: 'money' },
          { key: 'difference', en: 'Difference', ar: 'الفرق', type: 'money' },
        ],
        rows,
        totals: totalsFor(rows, ['cash', 'card']),
      };
    }
    case 'adjustments': {
      const rows = await db.many(
        `select a.number as name_en, a.number as name_ar, a.created_at, a.kind, a.reason, b.name_en as branch_en, u.name as staff,
                coalesce((select sum(m.qty * coalesce(m.unit_cost,0)) from stock_moves m where m.ref_type = 'adjustment' and m.ref_id = a.id::text),0)::float as value
           from stock_adjustments a join branches b on b.id = a.branch_id left join staff_users u on u.id = a.staff_id
          where ${qDate('a.created_at')} between $1::date and $2::date and ($3::uuid is null or a.branch_id = $3) order by a.created_at desc`,
        p,
      );
      return {
        columns: [
          { key: 'name', en: 'Adjustment', ar: 'التسوية' },
          { key: 'created_at', en: 'Date', ar: 'التاريخ', type: 'datetime' },
          { key: 'branch_en', en: 'Branch', ar: 'الفرع' },
          { key: 'reason', en: 'Reason', ar: 'السبب' },
          { key: 'staff', en: 'By', ar: 'بواسطة' },
          { key: 'value', en: 'Value (cost)', ar: 'القيمة (تكلفة)', type: 'money' },
        ],
        rows,
        totals: totalsFor(rows, ['value']),
      };
    }
  }
  throw new NotFoundException({ code: 'not_found' });
}

export const REPORTS = ['profit-loss', 'sales-daily', 'sales-by-branch', 'sales-by-channel', 'products', 'stock', 'purchases', 'suppliers', 'expenses', 'payments', 'customers', 'groups', 'agents', 'staff', 'tax', 'registers', 'adjustments'];

@Controller('v1/admin')
export class ReportsController {
  /** The home page: today, this month, 30 days of sales per branch, and what needs attention. */
  @Get('dashboard')
  @UseGuards(AnyStaff)
  async dashboard(@Query('branch') branch?: string) {
    const b = uuidOrNull(branch);
    const today = new Date(Date.now() + 3 * 3600_000).toISOString().slice(0, 10);
    const monthStart = `${today.slice(0, 8)}01`;
    const from30 = new Date(Date.parse(today) - 29 * 864e5).toISOString().slice(0, 10);
    const period = async (from: string) => {
      const p = [from, today, b];
      const [s, recv, exp, ret] = await Promise.all([
        db.one(`select count(*)::int as count, coalesce(sum(o.total),0)::float as net from orders o where ${SALES}`, p),
        db.one(
          `select coalesce(sum(p.amount),0)::float as v from payments p left join orders o on o.id = p.order_id left join appointments a on a.id = p.appointment_id
            where p.status = 'paid' and ${qDate('p.completed_at')} between $1::date and $2::date and ($3::uuid is null or coalesce(o.branch_id, a.branch_id) = $3)`,
          p,
        ),
        db.one(`select coalesce(sum(e.amount),0)::float as v from expenses e where e.spent_on between $1::date and $2::date and ($3::uuid is null or e.branch_id = $3)`, p),
        db.one(`select coalesce(sum(r.amount),0)::float as v from sales_returns r where ${qDate('r.created_at')} between $1::date and $2::date and ($3::uuid is null or r.branch_id = $3)`, p),
      ]);
      return { count: s!.count, net: s!.net, received: recv!.v, expenses: exp!.v, returns: ret!.v };
    };
    const [todayStats, month, series, branches, methods, dues, supplierDue, low, registers, top] = await Promise.all([
      period(today),
      period(monthStart),
      db.many(
        `select o.branch_id, ${qDate('o.created_at')}::text as day, coalesce(sum(o.total),0)::float as net
           from orders o where ${SALES} group by 1,2 order by 2`,
        [from30, today, b],
      ),
      db.many('select id, name_en, name_ar from branches where active order by sort'),
      db.many(
        `select p.provider as method, coalesce(sum(p.amount),0)::float as amount from payments p left join orders o on o.id = p.order_id left join appointments a on a.id = p.appointment_id
          where p.status = 'paid' and ${qDate('p.completed_at')} = $1::date and ($2::uuid is null or coalesce(o.branch_id, a.branch_id) = $2) group by 1 order by 2 desc`,
        [today, b],
      ),
      db.one(
        `select coalesce(sum(greatest(0, o.total - (select coalesce(sum(amount),0) from payments p where p.order_id = o.id and p.status = 'paid'))),0)::float as amount,
                count(*) filter (where o.total > (select coalesce(sum(amount),0) from payments p where p.order_id = o.id and p.status = 'paid'))::int as orders
           from orders o where o.stage not in ('pending_payment','payment_failed','cancelled') and ($1::uuid is null or o.branch_id = $1)`,
        [b],
      ),
      db.one(
        `select coalesce(sum(s.opening_balance),0)
            + coalesce((select sum(total) from purchases where kind = 'purchase' and status = 'received'),0)
            - coalesce((select sum(total) from purchases where kind = 'return' and status = 'received'),0)
            - coalesce((select sum(amount) from supplier_payments),0) as amount from suppliers s`,
      ),
      db.one(
        `with items as (
           select 'product' as kind, p.id, s.size, p.alert_qty from products p cross join lateral unnest(case when cardinality(p.sizes) = 0 then array[''] else p.sizes end) as s(size) where p.track_stock and p.active
           union all select 'fabric', f.id, '', f.alert_qty from fabrics f where f.track_stock and f.active)
         select count(*)::int as n from items i
          where coalesce((select sum(qty) from stock_moves m where m.item_kind = i.kind and m.item_id = i.id and m.size = i.size and ($1::uuid is null or m.branch_id = $1)),0) <= i.alert_qty`,
        [b],
      ),
      db.many(
        `select r.id, r.opened_at, u.name as staff_name, br.name_en as branch_en, br.name_ar as branch_ar from cash_registers r join staff_users u on u.id = r.staff_id join branches br on br.id = r.branch_id
          where r.closed_at is null and ($1::uuid is null or r.branch_id = $1) order by r.opened_at`,
        [b],
      ),
      db.many(
        `select case i.kind when 'thobe' then i.snapshot->'thobe'->'fabric'->>'name_en' else i.snapshot->'product'->>'name_en' end as name_en,
                case i.kind when 'thobe' then i.snapshot->'thobe'->'fabric'->>'name_ar' else i.snapshot->'product'->>'name_ar' end as name_ar,
                i.kind, sum(i.qty)::int as qty, sum(i.line_total)::float as revenue
           from order_items i join orders o on o.id = i.order_id where i.kind in ('thobe','product') and ${SALES} group by 1,2,3 order by revenue desc limit 6`,
        [from30, today, b],
      ),
    ]);
    return {
      today: todayStats,
      month,
      series: { from: from30, to: today, rows: series },
      branches,
      methods,
      dues,
      supplierDue: round2(Number(supplierDue?.amount ?? 0)),
      lowStock: low!.n,
      registers,
      top,
    };
  }

  @Get('reports')
  @UseGuards(ReportsGuard)
  list() {
    return REPORTS;
  }

  @Get('reports/:name')
  @UseGuards(ReportsGuard)
  async report(@CurrentStaff() me: StaffUser, @Param('name') name: string, @Query('from') from: string | undefined, @Query('to') to: string | undefined, @Query('branch') branch: string | undefined, @Query('format') format: string | undefined, @Query('lang') lang: string | undefined, @Res({ passthrough: true }) res: Response) {
    const rg = range(from, to);
    const r = await build(name, rg.from, rg.to, uuidOrNull(branch));
    if (format !== 'csv') return { ...r, range: rg };
    const ar = lang === 'ar';
    const value = (row: any, c: Col) => (c.key === 'name' || c.key === 'label' ? row[`${c.key === 'label' ? 'label' : 'name'}_${ar ? 'ar' : 'en'}`] : row[c.key]);
    await audit(me, 'export', 'report', name, rg);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="alrmh-${name}-${rg.from}-to-${rg.to}.csv"`);
    const rows = r.rows.map((row) => r.columns.map((c) => value(row, c)));
    if (r.totals) rows.push(r.columns.map((c, i) => (i === 0 ? (ar ? 'الإجمالي' : 'Total') : r.totals![c.key] ?? '')));
    return toCsv(r.columns.map((c) => (ar ? c.ar : c.en)), rows);
  }
}
