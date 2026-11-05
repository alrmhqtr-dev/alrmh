const TZ = 'Asia/Qatar';
export const money = (n: number | string | null | undefined) =>
  `QAR ${Number(n ?? 0).toLocaleString('en-US', { minimumFractionDigits: Number(n) % 1 ? 2 : 0, maximumFractionDigits: 2 })}`;
export const num = (n: number | null | undefined) => Number(n ?? 0).toLocaleString('en-US');
export const date = (d?: string | null) => (d ? new Date(d.length === 10 ? d + 'T00:00:00+03:00' : d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: TZ }) : '—');
export const day = (d?: string | null) => (d ? new Date(d.length === 10 ? d + 'T00:00:00+03:00' : d).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: TZ }) : '—');
export const time = (d?: string | null) => (d ? new Date(d).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: TZ }) : '—');
export const dateTime = (d?: string | null) => (d ? `${day(d)} · ${time(d)}` : '—');
export const phone = (p?: string | null) => (p ? p.replace(/^\+974(\d{4})(\d{4})$/, '+974 $1 $2') : '—');
export const todayQatar = () => new Date(Date.now() + 3 * 3600_000).toISOString().slice(0, 10);
export const addDays = (d: string, n: number) => new Date(new Date(d + 'T00:00:00Z').getTime() + n * 864e5).toISOString().slice(0, 10);
export const minuteToTime = (m: number) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
export const timeToMinute = (t: string) => {
  const [h, m] = t.split(':').map(Number);
  return h * 60 + (m || 0);
};

export const STAGES = ['confirmed', 'measured', 'cutting', 'stitching', 'ready', 'out_for_delivery', 'delivered'] as const;
export const STAGE_LABEL: Record<string, string> = {
  pending_payment: 'Awaiting payment',
  payment_failed: 'Payment failed',
  confirmed: 'Confirmed',
  measured: 'Measured',
  cutting: 'Cutting',
  stitching: 'Stitching',
  ready: 'Ready',
  out_for_delivery: 'Out for delivery',
  delivered: 'Delivered',
  cancelled: 'Cancelled',
};
export const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
export const RELATION: Record<string, string> = { self: 'Account holder', father: 'Father', son: 'Son', brother: 'Brother', friend: 'Friend', other: 'Other' };
export const MEASURE_FIELDS = [
  ['length_cm', 'Length'],
  ['shoulder_cm', 'Shoulder'],
  ['chest_cm', 'Chest'],
  ['waist_cm', 'Waist'],
  ['sleeve_cm', 'Sleeve'],
  ['neck_cm', 'Neck'],
  ['cuff_cm', 'Cuff'],
] as const;
