import { useMemo, useRef, useState } from 'react';
import { isAr } from './lib/i18n';
import { day, money } from './lib/format';

/** Categorical slots in fixed order (validated reference palette): a branch keeps its colour. */
export const SERIES = ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300', '#6250d6', '#e34948'];

type Series = { id: string; name: string; values: number[] };

/**
 * Sales per day, a line per branch. One y-axis, recessive grid, 2px lines,
 * a crosshair with every branch's value on hover, and a legend when there is more than one line.
 */
export function LineChart({ days, series, height = 260, label }: { days: string[]; series: Series[]; height?: number; label: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [hover, setHover] = useState<number | null>(null);
  const W = 900;
  const H = height;
  const pad = { l: 56, r: 16, t: 12, b: 28 };
  const max = useMemo(() => {
    const m = Math.max(1, ...series.flatMap((s) => s.values));
    const step = 10 ** Math.floor(Math.log10(m));
    return Math.ceil(m / step) * step;
  }, [series]);
  const rtl = isAr();
  const x = (i: number) => {
    const p = days.length <= 1 ? 0.5 : i / (days.length - 1);
    return pad.l + (rtl ? 1 - p : p) * (W - pad.l - pad.r);
  };
  const y = (v: number) => pad.t + (1 - v / max) * (H - pad.t - pad.b);
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => f * max);
  const onMove = (e: React.MouseEvent) => {
    const box = ref.current!.getBoundingClientRect();
    const px = ((e.clientX - box.left) / box.width) * W;
    let best = 0;
    days.forEach((_, i) => {
      if (Math.abs(x(i) - px) < Math.abs(x(best) - px)) best = i;
    });
    setHover(best);
  };
  const short = (v: number) => (v >= 1000 ? `${Math.round(v / 100) / 10}k` : String(Math.round(v)));
  return (
    <div className="stack" style={{ gap: 8 }}>
      {series.length > 1 ? (
        <div className="legend">
          {series.map((s, i) => (
            <span key={s.id}><i style={{ background: SERIES[i % SERIES.length] }} />{s.name}</span>
          ))}
        </div>
      ) : null}
      <div className="chart-wrap" ref={ref} onMouseMove={onMove} onMouseLeave={() => setHover(null)}>
        <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label={label} style={{ display: 'block' }}>
          {ticks.map((v) => (
            <g key={v}>
              <line x1={pad.l} x2={W - pad.r} y1={y(v)} y2={y(v)} stroke="#ece7dc" strokeWidth={1} />
              <text x={pad.l - 8} y={y(v) + 4} fontSize={11} fill="#8a8a8a" textAnchor="end" style={{ fontVariantNumeric: 'tabular-nums' }}>{short(v)}</text>
            </g>
          ))}
          {days.map((d, i) =>
            i % Math.ceil(days.length / 6) === 0 || i === days.length - 1 ? (
              <text key={d} x={x(i)} y={H - 8} fontSize={11} fill="#8a8a8a" textAnchor="middle">{d.slice(8)}/{d.slice(5, 7)}</text>
            ) : null,
          )}
          {series.map((s, si) => (
            <polyline key={s.id} fill="none" stroke={SERIES[si % SERIES.length]} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" points={s.values.map((v, i) => `${x(i)},${y(v)}`).join(' ')} />
          ))}
          {hover !== null ? (
            <g>
              <line x1={x(hover)} x2={x(hover)} y1={pad.t} y2={H - pad.b} stroke="#0b0b0b" strokeOpacity={0.25} />
              {series.map((s, si) => (
                <circle key={s.id} cx={x(hover)} cy={y(s.values[hover])} r={4.5} fill={SERIES[si % SERIES.length]} stroke="#fff" strokeWidth={2} />
              ))}
            </g>
          ) : null}
        </svg>
        {hover !== null ? (
          <div className="chart-tip" style={{ left: `${(x(hover) / W) * 100}%`, top: 8, transform: `translateX(${x(hover) > W / 2 ? '-105%' : '5%'})` }}>
            <div className="strong">{day(days[hover])}</div>
            {series.map((s, si) => (
              <div key={s.id} className="row" style={{ gap: 6 }}>
                <span style={{ width: 8, height: 8, borderRadius: 4, background: SERIES[si % SERIES.length], display: 'inline-block' }} />
                <span className="secondary">{s.name}</span>
                <span className="num strong" style={{ marginInlineStart: 'auto' }}>{money(s.values[hover])}</span>
              </div>
            ))}
          </div>
        ) : null}
      </div>
    </div>
  );
}
