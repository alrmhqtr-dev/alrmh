/**
 * CSV that opens cleanly in Excel: a byte-order mark so Arabic shows correctly,
 * and cells that start like a formula are prefixed so a name such as
 * "=HYPERLINK(...)" is shown as text instead of run.
 */
export function toCsv(header: string[], rows: unknown[][]) {
  const cell = (v: unknown) => {
    let s = v === null || v === undefined ? '' : v instanceof Date ? v.toISOString() : String(v);
    if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
    return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return '﻿' + [header, ...rows].map((r) => r.map(cell).join(',')).join('\r\n') + '\r\n';
}
