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

const MESSAGES: Record<string, string> = {
  network: "Can't reach the AlRmh API. Check the connection.",
  invalid_login: 'Wrong email or password.',
  wrong_password: "That isn't your current password.",
  same_password: 'Choose a password different from the current one.',
  refund_too_large: 'That is more than is left to refund on this order.',
  not_paid: 'This order was never paid, so there is nothing to refund.',
  no_fee_due: 'There is no fee to collect for this visit.',
  slot_taken: 'That time is full.',
  slot_in_past: 'That time has passed.',
  account_locked: 'Too many wrong passwords. This account is locked for 15 minutes.',
  too_many_requests: 'Too many tries. Wait a few minutes and try again.',
  invalid_date: 'Check the date.',
  invalid_input: 'Check the values and try again.',
  forbidden: "Your role can't do this.",
  stage_not_forward: 'Orders can only move forward.',
  cannot_cancel: "This order can't be cancelled at its current stage.",
  not_enough_points: "The customer doesn't have enough points.",
  invalid_measurement: 'Check the measurement values (cm).',
  code_taken: 'That coupon code already exists.',
  invalid_code: 'Use 3–20 letters or numbers for the code.',
  email_taken: 'A staff member with that email already exists.',
  password_too_short: 'Passwords need at least 10 characters.',
  invalid_hex: 'Use a colour like #F3EBDC.',
  invalid_image: 'Use a JPEG, PNG or WebP photo.',
  too_large: 'That photo is too large (2 MB at most).',
  invalid_category: 'Pick a category.',
  close_before_open: 'Closing time must be after opening time.',
  colours_required: 'Pick at least one colour for this fabric.',
  cannot_demote_self: "You can't remove your own owner access.",
  missing_field: 'Fill in the required fields.',
  invalid_email: 'Check the email address.',
};

export function errorMessage(err: unknown) {
  if (err instanceof ApiError) {
    if (err.code === 'missing_field' && err.data.field) return `Fill in ${String(err.data.field).replace(/_/g, ' ')}.`;
    if (err.code === 'invalid_number' && err.data.field) return `Check ${String(err.data.field).replace(/_/g, ' ')}.`;
    return MESSAGES[err.code] ?? `Something went wrong (${err.code}).`;
  }
  return 'Something went wrong.';
}
