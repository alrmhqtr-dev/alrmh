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

const MESSAGES: Record<string, string> = {
  network: "Can't reach the AlRmh API. Check the connection.",
  invalid_login: 'Wrong email or password.',
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
