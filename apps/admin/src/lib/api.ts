import { t } from './i18n';
export const API_URL = (import.meta.env.VITE_API_URL ?? 'http://localhost:4000').replace(/\/$/, '');

let token: string | null = localStorage.getItem('alrmh.admin.token');
let onUnauthorized: (() => void) | null = null;

export const getToken = () => token;
export function setToken(t: string | null) {
  token = t;
  if (t) localStorage.setItem('alrmh.admin.token', t);
  else localStorage.removeItem('alrmh.admin.token');
}
export function setUnauthorizedHandler(fn: () => void) {
  onUnauthorized = fn;
}

export class ApiError extends Error {
  constructor(public code: string, public status: number, public data: Record<string, any> = {}) {
    super(code);
  }
}

export async function api<T = any>(path: string, opts: { method?: string; body?: unknown } = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${API_URL}/v1/admin${path}`, {
      method: opts.method ?? (opts.body !== undefined ? 'POST' : 'GET'),
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    });
  } catch {
    throw new ApiError('network', 0);
  }
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) {
    if (res.status === 401 && token) onUnauthorized?.();
    throw new ApiError(data?.code ?? `http_${res.status}`, res.status, data ?? {});
  }
  return data as T;
}

/** Photos uploaded here are stored as a path on the API; anything else is already a full address. */
export const mediaUrl = (url: string | null | undefined) => (!url ? '' : url.startsWith('/') ? `${API_URL}${url}` : url);

/** Sends a photo as the request body and returns where it now lives. */
export async function uploadImage(blob: Blob): Promise<{ id: string; url: string }> {
  let res: Response;
  try {
    res = await fetch(`${API_URL}/v1/admin/media`, { method: 'POST', headers: { 'Content-Type': blob.type, ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: blob });
  } catch {
    throw new ApiError('network', 0);
  }
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) {
    if (res.status === 401 && token) onUnauthorized?.();
    throw new ApiError(data?.code ?? `http_${res.status}`, res.status, data ?? {});
  }
  return data;
}

/**
 * Phone photos are far larger than the app needs. Anything big is redrawn at
 * 1400 px on its longer side and saved as JPEG before it is uploaded.
 */
export async function shrinkImage(file: File, maxSide = 1400): Promise<Blob> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
  if (scale === 1 && file.size <= 400_000) return file;
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#FFFFFF';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new ApiError('invalid_image', 0))), 'image/jpeg', 0.86));
}

/** Downloads a CSV the API builds (the request needs the sign-in token, so a plain link would not work). */
export async function downloadCsv(path: string, fallbackName: string) {
  let res: Response;
  try {
    res = await fetch(`${API_URL}/v1/admin${path}`, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
  } catch {
    throw new ApiError('network', 0);
  }
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    if (res.status === 401 && token) onUnauthorized?.();
    throw new ApiError(data?.code ?? `http_${res.status}`, res.status, data ?? {});
  }
  const name = /filename="([^"]+)"/.exec(res.headers.get('Content-Disposition') ?? '')?.[1] ?? fallbackName;
  const url = URL.createObjectURL(await res.blob());
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

const MESSAGES: Record<string, [string, string]> = {
  network: ["Can't reach the AlRmh API. Check the connection.", 'تعذّر الاتصال بالخادم. تحقق من الاتصال.'],
  invalid_login: ['Wrong email or password.', 'البريد الإلكتروني أو كلمة المرور غير صحيحة.'],
  invalid_name: ['Enter a name of 2 to 60 characters.', 'أدخل اسمًا من 2 إلى 60 حرفًا.'],
  wrong_password: ["That isn't your current password.", 'هذه ليست كلمة المرور الحالية.'],
  same_password: ['Choose a password different from the current one.', 'اختر كلمة مرور مختلفة عن الحالية.'],
  refund_too_large: ['That is more than is left to refund on this order.', 'المبلغ أكبر من المتبقي للاسترداد في هذا الطلب.'],
  not_paid: ['This order was never paid, so there is nothing to refund.', 'لم يُدفع هذا الطلب، فلا يوجد ما يُسترد.'],
  no_fee_due: ['There is no fee to collect for this visit.', 'لا توجد رسوم مستحقة لهذه الزيارة.'],
  slot_taken: ['That time is full.', 'هذا الوقت ممتلئ.'],
  slot_in_past: ['That time has passed.', 'هذا الوقت قد مضى.'],
  account_locked: ['Too many wrong passwords. This account is locked for 15 minutes.', 'محاولات خاطئة كثيرة. الحساب مقفل لمدة 15 دقيقة.'],
  too_many_requests: ['Too many tries. Wait a few minutes and try again.', 'محاولات كثيرة. انتظر بضع دقائق ثم حاول مجددًا.'],
  invalid_date: ['Check the date.', 'تحقق من التاريخ.'],
  invalid_input: ['Check the values and try again.', 'تحقق من القيم وحاول مجددًا.'],
  forbidden: ["Your role can't do this.", 'صلاحياتك لا تسمح بذلك.'],
  stage_not_forward: ['Orders can only move forward.', 'لا يمكن نقل الطلب إلا إلى المرحلة التالية.'],
  cannot_cancel: ["This order can't be cancelled at its current stage.", 'لا يمكن إلغاء الطلب في مرحلته الحالية.'],
  not_enough_points: ["The customer doesn't have enough points.", 'رصيد نقاط العميل غير كافٍ.'],
  invalid_measurement: ['Each measurement must be a number in cm.', 'يجب أن يكون كل مقاس رقمًا بالسنتيمتر.'],
  code_taken: ['That coupon code already exists.', 'رمز القسيمة موجود مسبقًا.'],
  invalid_code: ['Use 3–20 letters or numbers for the code.', 'استخدم من 3 إلى 20 حرفًا أو رقمًا.'],
  email_taken: ['A staff member with that email already exists.', 'يوجد موظف بهذا البريد الإلكتروني.'],
  password_too_short: ['Passwords need at least 10 characters.', 'كلمة المرور 10 أحرف على الأقل.'],
  invalid_hex: ['Use a colour like #F3EBDC.', 'استخدم لونًا مثل ‎#F3EBDC.'],
  invalid_image: ['Use a JPEG, PNG or WebP photo.', 'استخدم صورة JPEG أو PNG أو WebP.'],
  too_large: ['That photo is too large (2 MB at most).', 'الصورة كبيرة جدًا (2 ميجابايت كحد أقصى).'],
  invalid_category: ['Pick a category.', 'اختر فئة.'],
  close_before_open: ['Closing time must be after opening time.', 'وقت الإغلاق يجب أن يكون بعد وقت الفتح.'],
  colours_required: ['Pick at least one colour for this fabric.', 'اختر لونًا واحدًا على الأقل لهذا القماش.'],
  cannot_demote_self: ["You can't remove your own owner access.", 'لا يمكنك إزالة صلاحية المالك عن نفسك.'],
  missing_field: ['Fill in the required fields.', 'املأ الحقول المطلوبة.'],
  invalid_email: ['Check the email address.', 'تحقق من البريد الإلكتروني.'],
  starting_tier: ['The starting tier stays at 0 points and can’t be removed.', 'الفئة الأولى تبدأ من 0 نقطة ولا يمكن حذفها.'],
  tier_threshold_taken: ['Another tier already starts at that number of points.', 'توجد فئة أخرى تبدأ بنفس عدد النقاط.'],
  invalid_colour: ['Use a colour like #C9A35A.', 'استخدم لونًا مثل ‎#C9A35A.'],
  payment_not_confirmed: ['Confirm the payment was taken on the card machine.', 'أكّد أن الدفع تم عبر جهاز البطاقة.'],
  invalid_lines: ['Add at least one item.', 'أضف صنفًا واحدًا على الأقل.'],
  invalid_qty: ['Check the quantity.', 'تحقق من الكمية.'],
  invalid_thobe_options: ['That type or cloth is no longer available.', 'هذا النوع أو القماش لم يعد متاحًا.'],
  member_not_found: ['Choose who the thobes are for.', 'اختر صاحب الثياب.'],
  address_not_found: ['Choose a delivery address.', 'اختر عنوان التوصيل.'],
  register_closed: ['Open your cash register first.', 'افتح صندوق النقد أولًا.'],
  register_already_open: ['Your register is already open.', 'صندوقك مفتوح بالفعل.'],
  not_enough_cash: ["There isn't that much cash in the register.", 'لا يوجد هذا المبلغ في الصندوق.'],
  payment_short: ['Take the full amount, or choose a customer to leave a balance.', 'استلم المبلغ كاملًا، أو اختر عميلًا لترك مبلغ متبقٍ.'],
  overpaid: ['More was entered than is due. Change can only be given from cash.', 'المبلغ المدخل أكبر من المستحق. الباقي يُعاد من النقد فقط.'],
  deposit_too_small: ['The deposit is below the minimum.', 'العربون أقل من الحد الأدنى.'],
  invalid_payment: ['Choose how the customer paid.', 'اختر طريقة الدفع.'],
  forbidden_discount: ["Your role can't change prices or give discounts.", 'صلاحياتك لا تسمح بتغيير الأسعار أو منح خصم.'],
  customer_required: ['Choose a customer first (thobes need measurements).', 'اختر العميل أولًا (الثياب تحتاج مقاسات).'],
  customer_not_found: ['That customer no longer exists.', 'هذا العميل غير موجود.'],
  product_not_found: ['That product is no longer available.', 'هذا المنتج لم يعد متاحًا.'],
  size_required: ['Pick a size.', 'اختر المقاس.'],
  basket_empty: ['Add items to the sale first.', 'أضف أصنافًا إلى الفاتورة أولًا.'],
  balance_due: ['Take the balance before handing over the order.', 'استلم المبلغ المتبقي قبل تسليم الطلب.'],
  more_than_due: ['That is more than is due.', 'المبلغ أكبر من المستحق.'],
  cannot_pay: ["This order can't take payments.", 'لا يمكن استلام دفعات لهذا الطلب.'],
  return_not_delivered: ['Only handed-over orders can be returned. Cancel open orders instead.', 'الإرجاع للطلبات المسلّمة فقط. ألغِ الطلبات المفتوحة بدلًا من ذلك.'],
  invalid_return_qty: ['Check the quantities to return.', 'تحقق من كميات الإرجاع.'],
  draft_converted: ['This was already turned into a sale.', 'تم تحويلها إلى فاتورة مسبقًا.'],
  cannot_delete: ["This can't be deleted.", 'لا يمكن حذفه.'],
  in_use: ['Still in use. Turn it off instead of deleting it.', 'ما زال مستخدمًا. أوقفه بدلًا من حذفه.'],
  sku_taken: ['Another item already has that code.', 'يوجد صنف آخر بنفس الرمز.'],
  invalid_sku: ['Codes use letters, numbers, - _ and . only.', 'الرمز يتكون من حروف وأرقام و - _ . فقط.'],
  supplier_not_found: ['Choose a supplier.', 'اختر المورد.'],
  branch_not_found: ['Choose a branch.', 'اختر الفرع.'],
  purchase_not_open: ['Only ordered purchases can be received or cancelled.', 'يمكن استلام أو إلغاء المشتريات المطلوبة فقط.'],
  purchase_not_received: ['Only received purchases can be returned.', 'يمكن إرجاع المشتريات المستلمة فقط.'],
  invalid_branches: ['Choose two different branches.', 'اختر فرعين مختلفين.'],
  role_builtin: ["Built-in roles can't be deleted.", 'لا يمكن حذف الأدوار الأساسية.'],
  role_in_use: ['Move staff to another role first.', 'انقل الموظفين إلى دور آخر أولًا.'],
  owner_role_fixed: ['The owner role always has every permission.', 'دور المالك يملك كل الصلاحيات دائمًا.'],
  invalid_role: ['Choose a role.', 'اختر الدور.'],
  invalid_phone: ['Enter a Qatar mobile number (8 digits).', 'أدخل رقم جوال قطري (8 أرقام).'],
  invalid_group: ['Choose a customer group.', 'اختر مجموعة العملاء.'],
  too_many_rows: ['That file has too many rows. Split it and import in parts.', 'الملف يحتوي صفوفًا كثيرة. قسّمه واستورده على أجزاء.'],
  register_closed_already: ['Its register is closed, so only a manager can delete it.', 'الصندوق مغلق، لذا يحذفه المدير فقط.'],
  service_type_not_found: ['That service type is no longer available.', 'نوع الخدمة لم يعد متاحًا.'],
  thobes_collected: ['Thobes are collected from the branch, not delivered.', 'الثياب تُستلم من الفرع ولا تُوصّل.'],
  invalid_points: ['Check the points.', 'تحقق من النقاط.'],
  invalid_language: ['Choose Arabic or English.', 'اختر العربية أو الإنجليزية.'],
};

export function errorMessage(err: unknown) {
  if (err instanceof ApiError) {
    const field = err.data.field ? String(err.data.field).replace(/_/g, ' ') : '';
    if (err.code === 'missing_field' && field) return t(`Fill in ${field}.`, `املأ الحقل: ${field}.`);
    if (err.code === 'invalid_number' && field) return t(`Check ${field}.`, `تحقق من: ${field}.`);
    if (err.code === 'out_of_stock')
      return err.data.item
        ? t(`Not enough ${err.data.item}${err.data.size ? ` (${err.data.size})` : ''} in stock${err.data.available != null ? ` (${err.data.available} left)` : ''}.`, `الكمية غير كافية من ${err.data.item}${err.data.size ? ` (${err.data.size})` : ''}${err.data.available != null ? ` (المتبقي ${err.data.available})` : ''}.`)
        : t('Out of stock.', 'نفدت الكمية.');
    const m = MESSAGES[err.code];
    return m ? t(m[0], m[1]) : t(`Something went wrong (${err.code}).`, `حدث خطأ (${err.code}).`);
  }
  return t('Something went wrong.', 'حدث خطأ.');
}
