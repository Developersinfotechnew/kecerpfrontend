'use client';

import type { ReactNode } from 'react';

import { toast } from './toast';

/**
 * Shared UI primitives.
 *
 * These are presentational only. They take plain props and render markup; none
 * of them fetch, read session, or know about routing. A screen composes them.
 *
 * That separation is what lets a static screen become a live one by changing
 * only where its data comes from, never the components themselves.
 *
 * Colours come from CSS custom properties defined in globals.css, referenced
 * inline because several values (bar widths, gauge fills, RAG dots) are computed
 * per row and cannot be expressed as static Tailwind classes.
 */

// ---------------------------------------------------------------------------
// Layout
// ---------------------------------------------------------------------------

export function PageHead({
  title,
  description,
  actions,
}: {
  title: string;
  description?: string;
  actions?: ReactNode;
}) {
  return (
    <div className="mb-4 flex flex-wrap items-end justify-between gap-4">
      <div>
        <h2 className="m-0 text-xl font-semibold tracking-tight">{title}</h2>
        {description ? (
          <p className="mt-1 max-w-[62ch] text-[13px]" style={{ color: 'var(--muted)' }}>
            {description}
          </p>
        ) : null}
      </div>
      {actions ? <div className="flex flex-wrap gap-2">{actions}</div> : null}
    </div>
  );
}

export function Panel({
  title,
  sub,
  actions,
  children,
  bodyless,
}: {
  title?: string;
  sub?: string;
  actions?: ReactNode;
  children: ReactNode;
  /** Skip the padded body wrapper — use when the panel holds a full-width table. */
  bodyless?: boolean;
}) {
  return (
    <section
      className="mb-[18px] rounded-lg"
      style={{ background: 'var(--panel)', border: '1px solid var(--line)', boxShadow: '0 1px 2px rgba(15,23,41,.03)' }}
    >
      {title ? (
        <header
          className="flex items-center justify-between gap-3 px-4 py-3"
          style={{ borderBottom: '1px solid var(--line-2)' }}
        >
          <h3 className="m-0 text-[13.5px] font-semibold">
            {title}
            {sub ? (
              <span className="ml-2 font-normal text-[12px]" style={{ color: 'var(--muted)' }}>
                {sub}
              </span>
            ) : null}
          </h3>
          {actions}
        </header>
      ) : null}
      {bodyless ? children : <div className="p-4">{children}</div>}
    </section>
  );
}

export function Grid({
  cols,
  children,
}: {
  cols: 2 | 3 | '2-1';
  children: ReactNode;
}) {
  const cls =
    cols === 2
      ? 'grid gap-[18px] grid-cols-1 lg:grid-cols-2'
      : cols === 3
        ? 'grid gap-[18px] grid-cols-1 md:grid-cols-3'
        : 'grid gap-[18px] grid-cols-1 lg:grid-cols-[2fr_1fr]';
  return <div className={cls}>{children}</div>;
}

// ---------------------------------------------------------------------------
// SVG chart primitives
//
// All charts are hand-rolled SVG, no external dependency. Colours come from
// the same CSS custom properties as the rest of the design system. Each
// component is a single self-contained <svg> with viewBox so it scales
// responsively without measurement code.
// ---------------------------------------------------------------------------

/**
 * Horizontal bar chart.
 *
 * @param items   label, value (numeric), optional tone key
 * @param max     highest value for scaling (defaults to max of items)
 * @param unit    suffix string shown at the end of each bar, e.g. "₹L"
 * @param color   CSS colour for the bars; defaults to var(--accent)
 */
export function HBarChart({
  items,
  unit = '',
  color = 'var(--accent)',
  height = 28,
}: {
  items: Array<{ label: string; value: number; tone?: 'ok' | 'warn' | 'bad' | 'info' }>;
  unit?: string;
  color?: string;
  height?: number;
}) {
  const max = Math.max(1, ...items.map((i) => i.value));
  const TONE: Record<string, string> = {
    ok: 'var(--ok)',
    warn: 'var(--warn)',
    bad: 'var(--danger)',
    info: 'var(--accent)',
  };
  return (
    <div className="flex flex-col gap-2">
      {items.map((it, idx) => {
        const pct = (it.value / max) * 100;
        const barColor = it.tone ? TONE[it.tone] : color;
        return (
          <div key={idx} className="flex items-center gap-2.5">
            <div className="w-[130px] shrink-0 truncate text-[12px]" style={{ color: 'var(--ink)' }}>
              {it.label}
            </div>
            <div className="relative flex-1" style={{ height: `${height}px` }}>
              <div
                className="absolute inset-0 rounded-[3px]"
                style={{ background: 'var(--panel-2)' }}
              />
              <div
                className="absolute inset-y-0 left-0 rounded-[3px] transition-all"
                style={{ width: `${pct}%`, background: barColor, opacity: 0.85, minWidth: 4 }}
              />
            </div>
            <div className="num w-[55px] shrink-0 text-right text-[11.5px]" style={{ color: 'var(--muted)' }}>
              {it.value.toLocaleString('en-IN')}{unit}
            </div>
          </div>
        );
      })}
    </div>
  );
}

/**
 * Donut / ring chart. Single-value centre label.
 *
 * @param segments  each: value, color (CSS), label
 * @param centreLabel  text shown in the middle (default: total)
 * @param centreSub   small text under the centre value
 */
export function DonutChart({
  segments,
  centreLabel,
  centreSub,
  size = 120,
  thickness = 16,
  fillCentre,
}: {
  segments: Array<{ value: number; color: string; label: string }>;
  centreLabel?: string;
  centreSub?: string;
  size?: number;
  thickness?: number;
  /** Paint the inner disc with the dominant segment colour so the gauge reads as "filled". */
  fillCentre?: boolean;
}) {
  const total = segments.reduce((s, x) => s + x.value, 0) || 1;
  const r = (size - thickness) / 2;
  const innerR = r - thickness / 2;
  const circumference = 2 * Math.PI * r;
  let offset = 0;

  // Pick the dominant segment colour for the centre fill.
  const dominant = segments.reduce((best, s) => (s.value > (best?.value ?? 0) ? s : best), segments[0]);
  const centreFill = fillCentre ? (dominant?.color ?? 'var(--panel-2)') : 'var(--panel)';

  return (
    <div className="flex items-center gap-4">
      <div className="relative shrink-0" style={{ width: size, height: size }}>
        <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="-rotate-90">
          {/* background ring */}
          <circle cx={size / 2} cy={size / 2} r={r} fill="none" strokeWidth={thickness} style={{ stroke: 'var(--panel-2)' }} />
          {/* centre disc — solid fill so the gauge doesn't look hollow */}
          <circle cx={size / 2} cy={size / 2} r={innerR} fill={centreFill} opacity={fillCentre ? 0.15 : 0} />
          {segments.map((seg, i) => {
            const pct = seg.value / total;
            const dash = pct * circumference;
            const el = (
              <circle
                key={i}
                cx={size / 2}
                cy={size / 2}
                r={r}
                fill="none"
                stroke={seg.color}
                strokeWidth={thickness}
                strokeDasharray={`${dash} ${circumference - dash}`}
                strokeDashoffset={-offset}
                style={{ transition: 'stroke-dasharray .4s, stroke-dashoffset .4s' }}
              />
            );
            offset += dash;
            return el;
          })}
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center text-center">
          <span className="num text-[22px] font-semibold leading-none" style={{ color: fillCentre ? dominant?.color : 'inherit' }}>
            {centreLabel ?? total}
          </span>
          {centreSub ? <span className="mt-0.5 text-[10px]" style={{ color: 'var(--muted)' }}>{centreSub}</span> : null}
        </div>
      </div>
      <div className="flex flex-col gap-1.5">
        {segments.map((seg, i) => (
          <div key={i} className="flex items-center gap-1.5 text-[11.5px]">
            <span className="h-2 w-2 rounded-[2px]" style={{ background: seg.color }} />
            <span style={{ color: 'var(--muted)' }}>{seg.label}</span>
            <span className="num ml-auto font-medium">{seg.value}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * Line / area chart. Single series, no external deps.
 *
 * @param points  Array<{ x, y, label? }>
 * @param unit    suffix for the hover tooltip value
 * @param color   CSS colour for the line and area
 * @param height  SVG height in px
 */
export function LineChart({
  points,
  unit = '',
  color = 'var(--accent)',
  height = 120,
  width = 500,
}: {
  points: Array<{ x: number; y: number; label?: string }>;
  unit?: string;
  color?: string;
  height?: number;
  width?: number;
}) {
  if (points.length < 2) {
    return (
      <div className="flex items-center justify-center text-[12px]" style={{ color: 'var(--muted)', height }}>
        Not enough data to plot.
      </div>
    );
  }

  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs, minX + 1);
  const minY = 0;
  const maxY = Math.max(...ys) * 1.15 || 1;

  const padL = 36;
  const padB = 20;
  const padT = 10;
  const chartW = width - padL;
  const chartH = height - padB - padT;

  const toX = (v: number) => padL + ((v - minX) / (maxX - minX)) * chartW;
  const toY = (v: number) => padT + chartH - (v / maxY) * chartH;

  const path = points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${toX(p.x)} ${toY(p.y)}`).join(' ');
  const area = `${path} L ${toX(points[points.length - 1].x)} ${padT + chartH} L ${toX(points[0].x)} ${padT + chartH} Z`;

  const yTicks = [0, Math.round(maxY / 2), Math.round(maxY)].map((v) => ({
    v,
    y: toY(v),
  }));

  return (
    <div>
      <svg
        viewBox={`0 0 ${width} ${height}`}
        style={{ width: '100%', height: 'auto', display: 'block' }}
        preserveAspectRatio="xMidYMid meet"
      >
        <defs>
          <linearGradient id="lineAreaGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity="0.18" />
            <stop offset="100%" stopColor={color} stopOpacity="0" />
          </linearGradient>
        </defs>
        {/* Y-axis gridlines */}
        {yTicks.map((t, i) => (
          <g key={i}>
            <line
              x1={padL}
              y1={t.y}
              x2={width}
              y2={t.y}
              style={{ stroke: 'var(--line-2)', strokeDasharray: '3 3', strokeWidth: 1 }}
            />
            <text
              x={padL - 6}
              y={t.y + 4}
              textAnchor="end"
              fontSize="10"
              style={{ fill: 'var(--muted)' }}
            >
              {t.v}
            </text>
          </g>
        ))}
        {/* Area */}
        <path d={area} fill="url(#lineAreaGrad)" />
        {/* Line */}
        <path d={path} fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" />
        {/* Points */}
        {points.map((p, i) => (
          <g key={i}>
            <circle cx={toX(p.x)} cy={toY(p.y)} r="3.5" fill={color} stroke="var(--panel)" strokeWidth="1.5" />
            {p.label ? (
              <text
                x={toX(p.x)}
                y={height - 4}
                textAnchor="middle"
                fontSize="10"
                style={{ fill: 'var(--muted)' }}
              >
                {p.label}
              </text>
            ) : null}
          </g>
        ))}
      </svg>
      {/* X-axis labels */}
      <div className="flex" style={{ paddingLeft: padL, paddingRight: 0, marginTop: -4 }}>
        <div className="flex-1" />
      </div>
      <div className="text-[10.5px] text-center" style={{ color: 'var(--faint)' }}>
        {unit ? `Values in ${unit}` : ''}
      </div>
    </div>
  );
}

/**
 * Stacked horizontal bar. Each row shows multiple coloured segments.
 * Used for "NCR + claims + approvals" per-project composition.
 *
 * @param rows  each row: label, segments (value, color, label)
 */
export function StackedBar({
  rows,
  unit = '',
}: {
  rows: Array<{
    label: string;
    segments: Array<{ value: number; color: string; label: string }>;
  }>;
  unit?: string;
}) {
  const total = Math.max(1, ...rows.map((r) => r.segments.reduce((s, x) => s + x.value, 0)));
  return (
    <div className="flex flex-col gap-2.5">
      {rows.map((row, idx) => {
        const rowTotal = row.segments.reduce((s, x) => s + x.value, 0);
        return (
          <div key={idx} className="flex items-center gap-2.5">
            <div className="w-[130px] shrink-0 truncate text-[12px]" style={{ color: 'var(--ink)' }}>
              {row.label}
            </div>
            <div className="relative flex-1 overflow-hidden rounded-[4px]" style={{ height: 20, background: 'var(--panel-2)' }}>
              <div className="flex h-full">
                {row.segments.map((seg, si) => {
                  const w = total > 0 ? (seg.value / total) * 100 : 0;
                  return w > 0 ? (
                    <div
                      key={si}
                      className="h-full"
                      style={{ width: `${w}%`, background: seg.color, minWidth: seg.value > 0 ? 3 : 0 }}
                      title={`${seg.label}: ${seg.value}`}
                    />
                  ) : null;
                })}
              </div>
            </div>
            <div className="num w-[55px] shrink-0 text-right text-[11.5px]" style={{ color: 'var(--muted)' }}>
              {rowTotal.toLocaleString('en-IN')}{unit}
            </div>
          </div>
        );
      })}
    </div>
  );
}

/**
 * Radial gauge: single value from 0 to max, shown as a 180° arc.
 * Used for progress, SPI/CPI, and health indicators.
 */
export function RadialGauge({
  value,
  max = 100,
  label,
  unit = '',
  size = 100,
  thickness = 10,
  tone = 'ok',
}: {
  value: number;
  max?: number;
  label?: string;
  unit?: string;
  size?: number;
  thickness?: number;
  tone?: 'ok' | 'warn' | 'bad' | 'info';
}) {
  const pct = Math.min(1, Math.max(0, value / max));
  const r = (size - thickness) / 2;
  const circumference = Math.PI * r; // half circle
  const dash = pct * circumference;
  const colorMap: Record<string, string> = {
    ok: 'var(--ok)',
    warn: 'var(--warn)',
    bad: 'var(--danger)',
    info: 'var(--accent)',
  };
  const color = colorMap[tone] ?? colorMap.ok;

  return (
    <div className="flex flex-col items-center gap-1 rounded-md px-3 py-2" style={{ background: 'var(--panel-2)' }}>
      <div className="relative" style={{ width: size, height: size / 2 + thickness }}>
        <svg
          width={size}
          height={size / 2 + thickness}
          viewBox={`0 0 ${size} ${size / 2 + thickness}`}
        >
          <path
            d={`M ${thickness / 2} ${size / 2} A ${r} ${r} 0 0 1 ${size - thickness / 2} ${size / 2}`}
            fill="none"
            style={{ stroke: 'var(--panel-2)', strokeWidth: thickness }}
          />
          <path
            d={`M ${thickness / 2} ${size / 2} A ${r} ${r} 0 0 1 ${size - thickness / 2} ${size / 2}`}
            fill="none"
            stroke={color}
            strokeWidth={thickness}
            strokeDasharray={`${dash} ${circumference - dash}`}
            style={{ transition: 'stroke-dasharray .4s' }}
          />
        </svg>
        <div
          className="absolute flex flex-col items-center"
          style={{ bottom: 0, left: 0, right: 0 }}
        >
          <span className="num text-[20px] font-semibold leading-none">
            {value}{unit}
          </span>
        </div>
      </div>
      {label ? <span className="text-[11px]" style={{ color: 'var(--muted)' }}>{label}</span> : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Chips and status
// ---------------------------------------------------------------------------

export type ChipTone = 'ok' | 'warn' | 'bad' | 'info' | 'mute';

const CHIP_STYLE: Record<ChipTone, { bg: string; fg: string }> = {
  ok: { bg: 'var(--ok-soft)', fg: 'var(--ok)' },
  warn: { bg: 'var(--warn-soft)', fg: 'var(--warn)' },
  bad: { bg: 'var(--danger-soft)', fg: 'var(--danger)' },
  info: { bg: 'var(--blue-soft)', fg: 'var(--blue)' },
  mute: { bg: 'var(--panel-2)', fg: 'var(--muted)' },
};

export function Chip({ tone = 'mute', children }: { tone?: ChipTone; children: ReactNode }) {
  const s = CHIP_STYLE[tone];
  return (
    <span
      className="inline-flex items-center gap-[5px] rounded-full px-2 py-[2.5px] text-[11.5px] font-medium whitespace-nowrap"
      style={{ background: s.bg, color: s.fg }}
    >
      <span
        className="h-[5px] w-[5px] rounded-full"
        style={{ background: 'currentColor' }}
        aria-hidden="true"
      />
      {children}
    </span>
  );
}

export function Bar({ pct, tone = 'ok' }: { pct: number; tone?: 'ok' | 'warn' | 'bad' }) {
  const color =
    tone === 'bad' ? 'var(--danger)' : tone === 'warn' ? 'var(--warn)' : 'var(--ok)';
  return (
    <span
      className="inline-block h-[6px] min-w-[70px] overflow-hidden rounded align-middle"
      style={{ background: 'var(--line-2)' }}
    >
      <i
        className="block h-full rounded"
        style={{ width: `${Math.min(Math.max(pct, 0), 100)}%`, background: color }}
      />
    </span>
  );
}

export function RagDot({ tone }: { tone: 'ok' | 'warn' | 'bad' }) {
  const color =
    tone === 'bad' ? 'var(--danger)' : tone === 'warn' ? 'var(--warn)' : 'var(--ok)';
  return (
    <span
      className="mr-1.5 inline-block h-2 w-2 rounded-full align-middle"
      style={{ background: color }}
      aria-hidden="true"
    />
  );
}

// ---------------------------------------------------------------------------
// Table
// ---------------------------------------------------------------------------

export interface Column {
  key: string;
  label: string;
  /** Right-align numeric columns. */
  align?: 'left' | 'right' | 'center';
}

export function DataTable({
  columns,
  rows,
  empty = 'Nothing to show.',
}: {
  columns: Column[];
  rows: ReactNode[][];
  empty?: string;
}) {
  if (!rows.length) {
    return (
      <div className="px-4 py-10 text-center text-[13px]" style={{ color: 'var(--muted)' }}>
        {empty}
      </div>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse">
        <thead>
          <tr>
            {columns.map((c) => (
              <th
                key={c.key}
                className="px-4 py-[9px] text-[11.5px] font-semibold whitespace-nowrap"
                style={{
                  textAlign: c.align ?? 'left',
                  color: 'var(--muted)',
                  borderBottom: '1px solid var(--line)',
                  background: '#fafbfa',
                }}
              >
                {c.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, ri) => (
            <tr key={ri} className="hover:bg-[#fafbfa]">
              {row.map((cell, ci) => (
                <td
                  key={ci}
                  className="px-4 py-2.5 align-middle text-[13px]"
                  style={{
                    textAlign: columns[ci]?.align ?? 'left',
                    borderBottom:
                      ri === rows.length - 1 ? 'none' : '1px solid var(--line-2)',
                  }}
                >
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ---------------------------------------------------------------------------
// KPI grid (the demo's .evm tiles)
// ---------------------------------------------------------------------------

export function KpiGrid({
  items,
}: {
  items: { label: string; value: string; note?: string; tone?: 'good' | 'warn' | 'bad' }[];
}) {
  const toneColor = (t?: 'good' | 'warn' | 'bad') =>
    t === 'bad' ? 'var(--danger)' : t === 'warn' ? 'var(--warn)' : t === 'good' ? 'var(--ok)' : undefined;

  return (
    <div
      className="grid gap-px grid-cols-2 lg:grid-cols-4"
      style={{ background: 'var(--line-2)' }}
    >
      {items.map((it, i) => (
        <div key={i} className="p-4" style={{ background: 'var(--panel)' }}>
          <div className="text-[11.5px]" style={{ color: 'var(--muted)' }}>
            {it.label}
          </div>
          <div
            className="num mt-[3px] text-xl font-semibold tracking-tight"
            style={{ color: toneColor(it.tone) }}
          >
            {it.value}
          </div>
          {it.note ? (
            <div className="mt-[3px] text-[11.5px]" style={{ color: 'var(--faint)' }}>
              {it.note}
            </div>
          ) : null}
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Vitals rail (the strip under the top bar)
// ---------------------------------------------------------------------------

export function VitalsRail({
  items,
}: {
  items: { label: string; value: string; unit?: string; note?: string; pct?: number; tone?: 'ok' | 'warn' | 'bad' }[];
}) {
  return (
    <div
      className="no-print grid grid-cols-2 gap-4 px-6 py-3.5 lg:grid-cols-5 lg:gap-0"
      style={{ background: 'var(--panel)', borderBottom: '1px solid var(--line)' }}
    >
      {items.map((it, i) => (
        <div
          key={i}
          className="lg:px-5 lg:border-r"
          style={{ borderColor: 'var(--line-2)' }}
        >
          <div className="mb-[5px] text-[11.5px]" style={{ color: 'var(--muted)' }}>
            {it.label}
          </div>
          <div className="num flex items-baseline gap-[7px] text-[19px] font-semibold tracking-tight">
            {it.value}
            {it.unit ? (
              <small className="text-[11.5px] font-medium" style={{ color: 'var(--muted)' }}>
                {it.unit}
              </small>
            ) : null}
          </div>
          {it.pct !== undefined ? <Bar pct={it.pct} tone={it.tone} /> : null}
          {it.note ? (
            <div className="mt-1.5 text-[11px]" style={{ color: 'var(--faint)' }}>
              {it.note}
            </div>
          ) : null}
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Key-value list
// ---------------------------------------------------------------------------

export function KVList({ pairs }: { pairs: [string, ReactNode][] }) {
  return (
    <dl className="grid grid-cols-[auto_1fr] gap-x-[18px] gap-y-[9px] text-[13px]">
      {pairs.map(([k, v], i) => (
        <Fragment key={i} k={k} v={v} />
      ))}
    </dl>
  );
}

function Fragment({ k, v }: { k: string; v: ReactNode }) {
  return (
    <>
      <dt style={{ color: 'var(--muted)' }}>{k}</dt>
      <dd className="m-0 text-right font-medium">{v}</dd>
    </>
  );
}

// ---------------------------------------------------------------------------
// Button
// ---------------------------------------------------------------------------

export function Button({
  children,
  variant = 'default',
  onClick,
  type = 'button',
  disabled,
  label,
  className,
}: {
  children: ReactNode;
  variant?: 'default' | 'primary' | 'small';
  onClick?: () => void;
  type?: 'button' | 'submit';
  disabled?: boolean;
  /**
   * Overrides the toast text raised when no onClick is given. Defaults to the
   * button's own text, which is almost always the right sentence.
   */
  label?: string;
  className?: string;
}) {
  const base =
    'inline-flex items-center rounded px-[13px] py-[7px] text-[13px] font-medium border';
  const style =
    variant === 'primary'
      ? { background: 'var(--accent)', borderColor: 'var(--accent)', color: '#fff' }
      : { background: 'var(--panel)', borderColor: 'var(--line)', color: 'var(--text)' };

  /**
   * A button with no handler is a button for a module that is not built yet.
   * Rather than doing nothing on click — which reads as broken — it says so.
   * The moment a screen passes its own onClick, this fallback goes away and the
   * button does real work. Wiring a module therefore means editing only that
   * screen.
   *
   * A submit button is exempt. It has no onClick by design, because the form's
   * own submit handler owns it. Toasting a submit would tell the user "not
   * built yet" on every real form submission, while the submission still went
   * through — the worst possible combination: a false alarm on a real action.
   */
  const handleClick =
    onClick ??
    (type === 'submit'
      ? undefined
      : () => {
          const text = label ?? (typeof children === 'string' ? children : 'This action');
          toast(`${text} — not built yet.`);
        });

  return (
    <button
      type={type}
      onClick={handleClick}
      disabled={disabled}
      className={`${base} ${variant === 'small' ? 'px-[9px] py-1 text-[12px]' : ''} ${disabled ? 'cursor-not-allowed opacity-50' : ''} ${className ?? ''}`}
      style={style}
    >
      {children}
    </button>
  );
}

// ---------------------------------------------------------------------------
// Flow (approval / stage chains)
// ---------------------------------------------------------------------------

export function Flow({
  steps,
}: {
  steps: { label: string; state?: 'done' | 'now' | 'todo' }[];
}) {
  return (
    <div className="flex flex-wrap items-center gap-1.5 p-4">
      {steps.map((s, i) => {
        const state = s.state ?? 'todo';
        const style =
          state === 'done'
            ? { borderColor: 'var(--accent)', background: 'var(--accent-soft)', color: 'var(--accent-dark)', fontWeight: 500 }
            : state === 'now'
              ? { borderColor: 'var(--amber)', background: 'var(--amber-soft)', color: 'var(--amber)', fontWeight: 600 }
              : { borderColor: 'var(--line)', background: '#fafbfa' };
        return (
          <span key={i} className="flex items-center gap-1.5">
            <span className="rounded px-[11px] py-2 text-[12.5px]" style={style}>
              {s.label}
            </span>
            {i < steps.length - 1 ? (
              <span style={{ color: 'var(--faint)' }} className="text-[12px]">
                →
              </span>
            ) : null}
          </span>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Activity feed
// ---------------------------------------------------------------------------

export function Feed({
  items,
}: {
  items: { tone?: 'ok' | 'warn' | 'bad' | 'info'; text: ReactNode; meta?: string; time?: string }[];
}) {
  const tick = (t?: string) =>
    t === 'warn' ? 'var(--amber)' : t === 'bad' ? 'var(--red)' : t === 'info' ? 'var(--blue)' : 'var(--accent)';
  return (
    <ul className="m-0 list-none p-0">
      {items.map((it, i) => (
        <li
          key={i}
          className="flex gap-[11px] px-4 py-[11px] text-[13px]"
          style={{ borderBottom: i === items.length - 1 ? 'none' : '1px solid var(--line-2)' }}
        >
          <span
            className="mt-[7px] h-[7px] w-[7px] flex-none rounded-full"
            style={{ background: tick(it.tone) }}
            aria-hidden="true"
          />
          <div className="flex-1">
            <div>{it.text}</div>
            {it.meta ? (
              <div className="text-[12px]" style={{ color: 'var(--muted)' }}>
                {it.meta}
              </div>
            ) : null}
          </div>
          {it.time ? (
            <time className="whitespace-nowrap text-[11.5px]" style={{ color: 'var(--faint)' }}>
              {it.time}
            </time>
          ) : null}
        </li>
      ))}
    </ul>
  );
}

// ---------------------------------------------------------------------------
// Notice banner
// ---------------------------------------------------------------------------

export function Notice({ children }: { children: ReactNode }) {
  return (
    <div
      className="mb-[18px] rounded px-3.5 py-2.5 text-[12.5px]"
      style={{ background: 'var(--amber-soft)', border: '1px solid #ebdab8', color: 'var(--amber)' }}
    >
      {children}
    </div>
  );
}

export function Mono({ children }: { children: ReactNode }) {
  return <span className="num text-[12px]">{children}</span>;
}

// ---------------------------------------------------------------------------
// Gantt (schedule bars positioned by percentage)
// ---------------------------------------------------------------------------

export function Gantt({
  rows,
  months,
  todayPct = 56,
  actual = false,
}: {
  rows: {
    label: string;
    sub?: string;
    startPct: number;
    widthPct: number;
    tone?: 'ok' | 'warn' | 'bad' | 'mute' | 'crit';
    critical?: boolean;
    /** Completion percent of this activity; drawn as an overlay when `actual` is on. */
    progress?: number;
  }[];
  months: string[];
  todayPct?: number;
  /** Draw the progress-to-date overlay on every row that has one. */
  actual?: boolean;
}) {
  const barColor = (t?: string) =>
    t === 'crit'
      ? 'var(--red)'
      : t === 'bad'
        ? 'var(--red)'
        : t === 'warn'
          ? 'var(--amber)'
          : t === 'mute'
            ? '#b9c4be'
            : 'var(--accent)';

  return (
    <div className="text-[12.5px]">
      <div
        className="grid grid-cols-[230px_1fr] max-[1100px]:grid-cols-1"
        style={{ borderBottom: '1px solid var(--line)', background: '#fafbfa' }}
      >
        <div className="px-4 py-[7px] text-[11px]" style={{ color: 'var(--muted)' }}>
          Activity
        </div>
        <div className="grid" style={{ gridTemplateColumns: `repeat(${months.length}, 1fr)` }}>
          {months.map((m, i) => (
            <span
              key={i}
              className="px-2 py-[7px] text-[11px]"
              style={{ color: 'var(--muted)', borderLeft: '1px solid var(--line-2)' }}
            >
              {m}
            </span>
          ))}
        </div>
      </div>

      {rows.map((r, i) => (
        <div
          key={i}
          className="grid grid-cols-[230px_1fr] items-center max-[1100px]:grid-cols-1"
          style={{ borderBottom: '1px solid var(--line-2)' }}
        >
          <div className="px-4 py-[9px]">
            {r.critical ? (
              <span
                className="mr-1.5 inline-block h-1.5 w-1.5 rounded-full align-middle"
                style={{ background: 'var(--red)' }}
                title="On critical path"
              />
            ) : null}
            {r.label}
            {r.sub ? (
              <small className="block text-[11px]" style={{ color: 'var(--muted)' }}>
                {r.sub}
              </small>
            ) : null}
          </div>
          <div
            className="relative h-[38px] overflow-hidden max-[1100px]:hidden"
            style={{ borderLeft: '1px solid var(--line-2)' }}
          >
            <div
              className="absolute top-0 bottom-0 w-[1.5px]"
              style={{ left: `${todayPct}%`, background: 'var(--red)', opacity: 0.55 }}
            />
            <div
              className="absolute top-[11px] h-4 rounded-[3px]"
              style={{
                left: `${Math.min(100, r.startPct)}%`,
                width: `${Math.max(0, Math.min(r.widthPct, 100 - Math.min(100, r.startPct)))}%`,
                background: barColor(r.tone),
                opacity: 0.9,
              }}
            />
            {/* Actual progress: a darker fill of the same bar, up to completion */}
            {actual && typeof r.progress === 'number' && r.progress > 0 ? (
              <div
                className="absolute top-[11px] h-4 rounded-[3px]"
                style={{
                  left: `${Math.min(100, r.startPct)}%`,
                  width: `${Math.max(
                    0,
                    Math.min(r.widthPct, 100 - Math.min(100, r.startPct)) *
                      (Math.min(100, r.progress) / 100),
                  )}%`,
                  background: 'rgba(0,0,0,0.28)',
                }}
              />
            ) : null}
          </div>
        </div>
      ))}
    </div>
  );
}

export function GanttLegend({
  items,
}: {
  items: { color: string; label: string }[];
}) {
  return (
    <div
      className="flex flex-wrap gap-4 px-4 py-2.5 text-[11.5px]"
      style={{ borderTop: '1px solid var(--line-2)', color: 'var(--muted)' }}
    >
      {items.map((it, i) => (
        <span key={i} className="flex items-center gap-1.5">
          <i className="inline-block h-1.5 w-4 rounded-[3px]" style={{ background: it.color }} />
          {it.label}
        </span>
      ))}
    </div>
  );
}

/** Small role-letter square used by the document control matrix. */
export function RoleLetter({ letter }: { letter: 'O' | 'R' | 'A' | 'I' }) {
  const style =
    letter === 'O'
      ? { background: 'var(--accent)', color: '#fff' }
      : letter === 'A'
        ? { background: 'var(--amber-soft)', color: 'var(--amber)', border: '1px solid #ebdab8' }
        : letter === 'R'
          ? { background: 'var(--blue-soft)', color: 'var(--blue)' }
          : { background: '#f0f2f0', color: 'var(--muted)' };
  return (
    <span
      className="num inline-grid h-[22px] w-[22px] place-items-center rounded text-[11px] font-semibold"
      style={style}
    >
      {letter}
    </span>
  );
}

/** Coding keys / review-code explainer list. */
export function CodeList({ items }: { items: [string, string][] }) {
  return (
    <div className="grid grid-cols-[auto_1fr] items-baseline gap-x-3.5 gap-y-2 text-[12.5px]">
      {items.map(([k, v], i) => (
        <FragmentRow key={i} code={k} text={v} />
      ))}
    </div>
  );
}

function FragmentRow({ code, text }: { code: string; text: string }) {
  return (
    <>
      <b
        className="num rounded-[3px] px-[7px] py-0.5 text-[11.5px] font-semibold"
        style={{ background: '#f0f2f0' }}
      >
        {code}
      </b>
      <span>{text}</span>
    </>
  );
}
