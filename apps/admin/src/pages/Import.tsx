import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useSearchParams } from 'react-router-dom';
import { Download, Upload } from 'lucide-react';
import { api, errorMessage } from '../lib/api';
import { useAuth, type Perm } from '../lib/auth';
import { t } from '../lib/i18n';
import { BranchSelect, Field, PageHead, Tabs, useToast } from '../ui';

type Kind = 'customers' | 'suppliers' | 'products' | 'opening' | 'sales';
const KINDS: Record<Kind, { path: string; perms: Perm[]; title: [string, string]; help: [string, string]; template: string }> = {
  customers: {
    path: '/import/customers',
    perms: ['contacts'],
    title: ['Customers', 'العملاء'],
    help: ['Columns: name, mobile, email, group, notes. Existing mobiles are skipped. Customers keep their account when they later sign in to the app with that mobile.', 'الأعمدة: name, mobile, email, group, notes. الأرقام الموجودة تُتخطى. يحتفظ العميل بحسابه عند تسجيل دخوله للتطبيق بنفس الرقم.'],
    template: 'name,mobile,email,group,notes\nHamad Al-Kuwari,55551234,,VIP,\n',
  },
  suppliers: {
    path: '/import/suppliers',
    perms: ['purchases'],
    title: ['Suppliers', 'الموردين'],
    help: ['Columns: name, business_name, mobile, email, tax_number, address, opening_balance.', 'الأعمدة: name, business_name, mobile, email, tax_number, address, opening_balance.'],
    template: 'name,business_name,mobile,email,tax_number,address,opening_balance\nAl Noor Textiles,Al Noor Trading,44441234,,,"Souq Waqif, Doha",0\n',
  },
  products: {
    path: '/import/products',
    perms: ['products'],
    title: ['Products', 'المنتجات'],
    help: ['Columns: sku, name_en, name_ar, category, brand, price, cost, sizes (separated by |), alert_qty, track_stock (yes/no), in_app (yes/no). A known sku updates that product.', 'الأعمدة: sku, name_en, name_ar, category, brand, price, cost, sizes (مفصولة بـ |), alert_qty, track_stock (yes/no), in_app (yes/no). الرمز الموجود يُحدّث المنتج.'],
    template: 'sku,name_en,name_ar,category,brand,price,cost,sizes,alert_qty,track_stock,in_app\nGH-WHITE,White ghutra,غترة بيضاء,Ghutra,,95,40,52|56|58,5,yes,yes\n',
  },
  opening: {
    path: '/import/opening-stock',
    perms: ['products'],
    title: ['Opening stock', 'المخزون الافتتاحي'],
    help: ['Columns: sku, size, branch, qty, unit_cost. Use the product or cloth code. Rows without a branch go to the branch chosen below.', 'الأعمدة: sku, size, branch, qty, unit_cost. استخدم رمز المنتج أو القماش. الصفوف بدون فرع تذهب للفرع المختار أدناه.'],
    template: 'sku,size,branch,qty,unit_cost\nGH-WHITE,56,,20,40\nF-JAPANESE-COTTON,,,150,18\n',
  },
  sales: {
    path: '/import/sales',
    perms: ['reports', 'manage'],
    title: ['Past sales (Mada)', 'المبيعات السابقة (مدى)'],
    help: ['Columns: invoice, date, customer, mobile, branch, total, paid, method. Export the sales list from Mada and keep these columns. Imported sales count in reports and the sales chart; they are not shown in the customer app.', 'الأعمدة: invoice, date, customer, mobile, branch, total, paid, method. صدّر قائمة المبيعات من مدى واحتفظ بهذه الأعمدة. تُحتسب في التقارير ومخطط المبيعات ولا تظهر في تطبيق العملاء.'],
    template: 'invoice,date,customer,mobile,branch,total,paid,method\n10234,2026-10-01,Hamad,55551234,,450,450,cash\n',
  },
};

export default function Import() {
  const [params, setParams] = useSearchParams();
  const { can } = useAuth();
  const qc = useQueryClient();
  const toast = useToast();
  const kind = (params.get('tab') as Kind) in KINDS ? (params.get('tab') as Kind) : 'customers';
  const def = KINDS[kind];
  const [csv, setCsv] = useState('');
  const [file, setFile] = useState('');
  const [branch, setBranch] = useState('');
  const [result, setResult] = useState<any>(null);
  const run = useMutation({
    mutationFn: () => api(def.path, { body: { csv, branchId: branch || undefined } }),
    onSuccess: (r) => {
      setResult(r);
      qc.invalidateQueries();
    },
    onError: (e) => toast(errorMessage(e), 'error'),
  });
  const template = () => {
    const url = URL.createObjectURL(new Blob(['﻿' + def.template], { type: 'text/csv' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `alrmh-${kind}-template.csv`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  return (
    <div className="stack lg">
      <PageHead title={t('Import', 'الاستيراد')} sub={t('Bring data over from Mada POS or a spreadsheet, as CSV (Excel: Save as CSV UTF-8).', 'انقل البيانات من مدى أو من جدول بيانات بصيغة CSV (في Excel: حفظ باسم CSV UTF-8).')} />
      <Tabs value={kind} onChange={(k) => { setParams({ tab: k }); setCsv(''); setFile(''); setResult(null); }} options={(Object.keys(KINDS) as Kind[]).filter((k) => can(...KINDS[k].perms)).map((k) => [k, t(...KINDS[k].title)])} />
      <div className="card pad stack" style={{ maxWidth: 820 }}>
        <div className="note">{t(...def.help)}</div>
        <button className="btn secondary" style={{ alignSelf: 'flex-start' }} onClick={template}><Download size={16} /> {t('Download a template', 'تحميل نموذج')}</button>
        {kind === 'opening' ? <Field label={t('Branch', 'الفرع')}><BranchSelect value={branch} onChange={setBranch} all={false} /></Field> : null}
        <Field label={t('CSV file', 'ملف CSV')}>
          <input type="file" aria-label={t('CSV file', 'ملف CSV')} accept=".csv,text/csv" data-testid="import-file" onChange={async (e) => {
            const f = e.target.files?.[0];
            if (!f) return;
            setFile(f.name);
            setCsv(await f.text());
            setResult(null);
          }} />
        </Field>
        {csv ? <div className="small secondary">{file} · {csv.trim().split(/\r?\n/).length - 1} {t('rows', 'صف')}</div> : null}
        <button className="btn" data-testid="import-run" style={{ alignSelf: 'flex-start' }} disabled={!csv || run.isPending || !can(...def.perms)} onClick={() => run.mutate()}><Upload size={16} /> {run.isPending ? t('Importing…', 'جارٍ الاستيراد…') : t('Import', 'استيراد')}</button>
        {result ? (
          <div className={`note ${result.errorCount ? 'gold' : ''}`} data-testid="import-result">
            {t(`Added ${result.added}`, `أُضيف ${result.added}`)}
            {result.updated ? ` · ${t(`updated ${result.updated}`, `حُدّث ${result.updated}`)}` : ''}
            {result.skipped ? ` · ${t(`skipped ${result.skipped} already there`, `تُخطّي ${result.skipped} موجود`)}` : ''}
            {result.errorCount ? ` · ${t(`${result.errorCount} rows with problems`, `${result.errorCount} صف به مشكلة`)}` : ''}
            {result.errors?.length ? (
              <ul style={{ margin: '8px 0 0', paddingInlineStart: 18 }}>
                {result.errors.slice(0, 12).map((e: any, i: number) => <li key={i} className="small">{t('Row', 'الصف')} {e.row}: {e.error.replace(/_/g, ' ')}</li>)}
              </ul>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}
