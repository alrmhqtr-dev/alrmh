import { t } from './lib/i18n';
import type { Perm } from './lib/auth';

export type FieldType = 'text' | 'textarea' | 'number' | 'money' | 'percent' | 'bool' | 'select' | 'tags' | 'datetime' | 'branch' | 'targets';
export type ListField = { key: string; label: () => string; type: FieldType; required?: boolean; options?: () => [string, string][]; hint?: () => string; dir?: 'ltr' };
export type ListColumn = { key: string; label: () => string; type?: 'money' | 'percent' | 'bool' | 'num' | 'tags' | 'bilingual' | 'date' | 'text'; field?: string };
export type ListDef = {
  /** API resource under /lists. */
  resource: string;
  title: () => string;
  sub: () => string;
  perms: Perm[];
  columns: ListColumn[];
  fields: ListField[];
  defaults?: Record<string, unknown>;
  /** Row click opens this page instead of the edit form. */
  link?: (row: any) => string;
};

const activeCol: ListColumn = { key: 'active', label: () => t('Status', 'الحالة'), type: 'bool' };
const activeField: ListField = { key: 'active', label: () => t('In use', 'مفعّل'), type: 'bool' };
const nameEnAr: ListField[] = [
  { key: 'name_en', label: () => t('Name (English)', 'الاسم (إنجليزي)'), type: 'text', required: true, dir: 'ltr' },
  { key: 'name_ar', label: () => t('Name (Arabic)', 'الاسم (عربي)'), type: 'text', required: true },
];

/** The simple lists, each with a table and an add/edit form. */
export const LISTS: Record<string, ListDef> = {
  brands: {
    resource: 'brands',
    title: () => t('Brands', 'العلامات التجارية'),
    sub: () => t('Brands of the products you sell. Discounts can target a brand.', 'العلامات التجارية للمنتجات. يمكن تخصيص خصم لعلامة.'),
    perms: ['products'],
    columns: [{ key: 'name', label: () => t('Brand', 'العلامة') }, { key: 'product_count', label: () => t('Products', 'المنتجات'), type: 'num' }, activeCol],
    fields: [{ key: 'name', label: () => t('Name', 'الاسم'), type: 'text', required: true }, { key: 'description', label: () => t('Description', 'الوصف'), type: 'textarea' }, activeField],
  },
  units: {
    resource: 'units',
    title: () => t('Units', 'الوحدات'),
    sub: () => t('How products are counted and sold: by the piece, the metre, the box.', 'كيف تُعد المنتجات وتُباع: بالقطعة أو المتر أو العلبة.'),
    perms: ['products'],
    columns: [{ key: 'name', label: () => t('Unit', 'الوحدة'), type: 'bilingual' }, { key: 'short_name', label: () => t('Short', 'الاختصار') }, { key: 'allow_decimal', label: () => t('Decimals', 'كسور'), type: 'bool' }, { key: 'product_count', label: () => t('Products', 'المنتجات'), type: 'num' }],
    fields: [...nameEnAr, { key: 'short_name', label: () => t('Short name', 'الاختصار'), type: 'text', required: true, dir: 'ltr' }, { key: 'allow_decimal', label: () => t('Allow decimals (e.g. 2.5 m)', 'السماح بالكسور (مثل 2.5 م)'), type: 'bool' }],
    defaults: { allow_decimal: false },
  },
  warranties: {
    resource: 'warranties',
    title: () => t('Warranties', 'الضمانات'),
    sub: () => t('Warranties shown on the invoice for products that carry one.', 'الضمانات التي تظهر في الفاتورة للمنتجات المضمونة.'),
    perms: ['products'],
    columns: [{ key: 'name', label: () => t('Warranty', 'الضمان') }, { key: 'months', label: () => t('Months', 'الأشهر'), type: 'num' }, { key: 'product_count', label: () => t('Products', 'المنتجات'), type: 'num' }],
    fields: [{ key: 'name', label: () => t('Name', 'الاسم'), type: 'text', required: true }, { key: 'months', label: () => t('Months', 'الأشهر'), type: 'number' }, { key: 'description', label: () => t('Terms', 'الشروط'), type: 'textarea' }],
  },
  variations: {
    resource: 'variations',
    title: () => t('Variations', 'متغيرات (تباين)'),
    sub: () => t('Lists of sizes (or other options). Pick one on a product to fill its sizes; stock is kept per size.', 'قوائم المقاسات أو الخيارات. اخترها في المنتج لتعبئة مقاساته؛ يُحسب المخزون لكل مقاس.'),
    perms: ['products'],
    columns: [{ key: 'name', label: () => t('Variation', 'المتغير') }, { key: 'options', label: () => t('Values', 'القيم'), type: 'tags' }],
    fields: [{ key: 'name', label: () => t('Name', 'الاسم'), type: 'text', required: true }, { key: 'options', label: () => t('Values (comma separated)', 'القيم (مفصولة بفواصل)'), type: 'tags', required: true, dir: 'ltr' }],
  },
  'tax-rates': {
    resource: 'tax-rates',
    title: () => t('Tax rates', 'معدلات الضرائب'),
    sub: () => t('Prices include tax. Pick a rate on a product to show the tax part on invoices and in the tax report.', 'الأسعار شاملة الضريبة. اختر معدلًا في المنتج لإظهار الضريبة في الفواتير وتقرير الضرائب.'),
    perms: ['manage'],
    columns: [{ key: 'name', label: () => t('Name', 'الاسم') }, { key: 'percent', label: () => t('Rate', 'النسبة'), type: 'percent' }, activeCol],
    fields: [{ key: 'name', label: () => t('Name', 'الاسم'), type: 'text', required: true }, { key: 'percent', label: () => t('Rate %', 'النسبة %'), type: 'percent', required: true }, activeField],
  },
  'service-types': {
    resource: 'service-types',
    title: () => t('Service types', 'أنواع الخدمة'),
    sub: () => t('Chosen at the counter. Express adds a charge and shortens the time until thobes are ready.', 'تُختار في نقطة البيع. المستعجل يضيف رسومًا ويقصّر مدة تجهيز الثياب.'),
    perms: ['manage'],
    columns: [{ key: 'name', label: () => t('Service', 'الخدمة'), type: 'bilingual' }, { key: 'charge', label: () => t('Charge', 'الرسوم'), type: 'money' }, { key: 'lead_days', label: () => t('Working days', 'أيام العمل'), type: 'num' }, activeCol],
    fields: [
      ...nameEnAr,
      { key: 'charge_kind', label: () => t('Charge type', 'نوع الرسوم'), type: 'select', options: () => [['fixed', t('Fixed amount', 'مبلغ ثابت')], ['percent', t('Percent of the sale', 'نسبة من الفاتورة')]] },
      { key: 'charge', label: () => t('Charge', 'الرسوم'), type: 'money' },
      { key: 'lead_days', label: () => t('Working days until ready', 'أيام العمل حتى الجاهزية'), type: 'number', hint: () => t('Leave empty for the usual lead time.', 'اتركه فارغًا للمدة المعتادة.') },
      activeField,
    ],
    defaults: { charge_kind: 'fixed', charge: 0 },
  },
  'customer-groups': {
    resource: 'customer-groups',
    title: () => t('Customer groups', 'مجموعات العملاء'),
    sub: () => t('A group can get a discount at the counter and in the app (the bigger of this and any offer applies).', 'يمكن أن تحصل المجموعة على خصم في نقطة البيع والتطبيق (يُطبق الأكبر بينه وبين أي عرض).'),
    perms: ['contacts'],
    columns: [{ key: 'name', label: () => t('Group', 'المجموعة'), type: 'bilingual' }, { key: 'discount_percent', label: () => t('Discount', 'الخصم'), type: 'percent' }, { key: 'customer_count', label: () => t('Customers', 'العملاء'), type: 'num' }, activeCol],
    fields: [...nameEnAr, { key: 'discount_percent', label: () => t('Discount %', 'الخصم %'), type: 'percent' }, activeField],
  },
  'expense-categories': {
    resource: 'expense-categories',
    title: () => t('Expense categories', 'فئات المصاريف'),
    sub: () => t('Used to group expenses in the reports.', 'تُستخدم لتجميع المصاريف في التقارير.'),
    perms: ['expenses', 'manage'],
    columns: [{ key: 'name', label: () => t('Category', 'الفئة'), type: 'bilingual' }, { key: 'expense_count', label: () => t('Expenses', 'المصاريف'), type: 'num' }, activeCol],
    fields: [...nameEnAr, activeField],
  },
  agents: {
    resource: 'agents',
    title: () => t('Agents', 'الوكلاء'),
    sub: () => t('Sales agents who bring customers. Pick one on a sale; the agents report works out their commission.', 'وكلاء المبيعات. اختر الوكيل في الفاتورة؛ يحسب تقرير الوكلاء عمولتهم.'),
    perms: ['staff'],
    columns: [{ key: 'name', label: () => t('Agent', 'الوكيل') }, { key: 'phone', label: () => t('Mobile', 'الجوال') }, { key: 'commission_percent', label: () => t('Commission', 'العمولة'), type: 'percent' }, { key: 'sales_total', label: () => t('Sales', 'المبيعات'), type: 'money' }, activeCol],
    fields: [{ key: 'name', label: () => t('Name', 'الاسم'), type: 'text', required: true }, { key: 'phone', label: () => t('Mobile', 'الجوال'), type: 'text', dir: 'ltr' }, { key: 'email', label: () => t('Email', 'البريد'), type: 'text', dir: 'ltr' }, { key: 'commission_percent', label: () => t('Commission %', 'العمولة %'), type: 'percent' }, activeField],
  },
  suppliers: {
    resource: 'suppliers',
    title: () => t('Suppliers', 'الموردين'),
    sub: () => t('Who you buy cloth and products from, and what you owe them.', 'من تشتري منهم الأقمشة والمنتجات، وما هو مستحق لهم.'),
    perms: ['purchases'],
    columns: [{ key: 'name', label: () => t('Supplier', 'المورد') }, { key: 'business_name', label: () => t('Business', 'النشاط') }, { key: 'phone', label: () => t('Mobile', 'الجوال') }, { key: 'purchase_count', label: () => t('Purchases', 'المشتريات'), type: 'num' }, { key: 'balance', label: () => t('Owed', 'المستحق'), type: 'money' }, activeCol],
    fields: [
      { key: 'name', label: () => t('Name', 'الاسم'), type: 'text', required: true },
      { key: 'business_name', label: () => t('Business name', 'اسم النشاط'), type: 'text' },
      { key: 'phone', label: () => t('Mobile', 'الجوال'), type: 'text', dir: 'ltr' },
      { key: 'email', label: () => t('Email', 'البريد'), type: 'text', dir: 'ltr' },
      { key: 'tax_number', label: () => t('Tax number', 'الرقم الضريبي'), type: 'text', dir: 'ltr' },
      { key: 'opening_balance', label: () => t('Opening balance (owed to them)', 'الرصيد الافتتاحي (مستحق لهم)'), type: 'money' },
      { key: 'address', label: () => t('Address', 'العنوان'), type: 'textarea' },
      { key: 'notes', label: () => t('Notes', 'ملاحظات'), type: 'textarea' },
      activeField,
    ],
    link: (r) => `/suppliers/${r.id}`,
  },
  discounts: {
    resource: 'discounts',
    title: () => t('Discounts', 'خصومات'),
    sub: () => t('Automatic offers. They apply at the counter and in the app by themselves; the biggest one wins (they don’t add up).', 'عروض تلقائية تُطبق في نقطة البيع والتطبيق؛ يُطبق الأكبر فقط (لا تُجمع).'),
    perms: ['manage'],
    columns: [
      { key: 'name', label: () => t('Offer', 'العرض') },
      { key: 'applies_to', label: () => t('On', 'على') },
      { key: 'amount', label: () => t('Discount', 'الخصم') },
      { key: 'channel', label: () => t('Where', 'أين') },
      { key: 'ends_at', label: () => t('Ends', 'ينتهي'), type: 'date' },
      activeCol,
    ],
    fields: [
      { key: 'name', label: () => t('Name', 'الاسم'), type: 'text', required: true },
      { key: 'applies_to', label: () => t('Applies to', 'يُطبق على'), type: 'select', required: true, options: () => [['all', t('Everything', 'كل شيء')], ['category', t('Categories', 'أقسام')], ['product', t('Products', 'منتجات')], ['brand', t('Brands', 'علامات تجارية')], ['fabric', t('Thobe cloth', 'أقمشة الثياب')]] },
      { key: 'target_ids', label: () => t('Which ones', 'أيها'), type: 'targets' },
      { key: 'kind', label: () => t('Type', 'النوع'), type: 'select', required: true, options: () => [['percent', t('Percent', 'نسبة')], ['fixed', t('Amount off each item', 'مبلغ عن كل قطعة')]] },
      { key: 'amount', label: () => t('Amount', 'القيمة'), type: 'money', required: true },
      { key: 'channel', label: () => t('Where', 'أين'), type: 'select', options: () => [['all', t('Counter and app', 'نقطة البيع والتطبيق')], ['pos', t('Counter only', 'نقطة البيع فقط')], ['app', t('App only', 'التطبيق فقط')]] },
      { key: 'branch_id', label: () => t('Branch', 'الفرع'), type: 'branch' },
      { key: 'starts_at', label: () => t('Starts', 'يبدأ'), type: 'datetime' },
      { key: 'ends_at', label: () => t('Ends', 'ينتهي'), type: 'datetime' },
      { key: 'priority', label: () => t('Priority', 'الأولوية'), type: 'number' },
      activeField,
    ],
    defaults: { applies_to: 'all', kind: 'percent', channel: 'all', priority: 0, target_ids: [] },
  },
};
