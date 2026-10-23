/**
 * Shared report maths.
 *
 * Every number a report shows is computed here, from rows already loaded through
 * the record engine. There is no aggregation endpoint: the data volumes are in
 * the hundreds of rows per register, so fetching and reducing in the browser is
 * faster than a round trip, and it keeps every report consistent with the
 * screen that owns the same figure.
 *
 * The EVM formulas are the canonical ones. `earnedValue()` is the single place
 * SPI, CPI and EAC are derived, so a report cannot drift from the EVM screen.
 */

import type { RecordRow } from './types';

/** SPI below this reads as behind the plan. */
export const SPI_OK = 0.95;

/** CPI at or above this is on budget. */
export const CPI_OK = 1;

/** A register with fewer rows than this is not worth charting. */
const MAX_ROWS = 500;

export const DAY = 86_400_000;

/** A row's value for `key` as a finite number. Missing and junk both give 0. */
export function num(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

/** A row's value for `key` as a trimmed string. */
export function str(value: unknown): string {
  return value === null || value === undefined ? '' : String(value).trim();
}

/** Rupees in lakhs, the unit every currency field in this app is stored in. */
export function lakh(value: number): string {
  return Math.round(value).toLocaleString('en-IN', { maximumFractionDigits: 0 });
}

/** A signed variance as text, for a column where the sign carries meaning. */
export function variance(value: number): string {
  if (value === 0) return '—';
  return `${value > 0 ? '+' : '−'}${Math.abs(value).toLocaleString('en-IN', {
    maximumFractionDigits: 0,
  })}`;
}

/** Whole days from today until `value`. Negative means it has passed. */
export function daysUntil(value: unknown, from = Date.now()): number | null {
  if (!value) return null;
  const end = new Date(str(value));
  if (Number.isNaN(end.getTime())) return null;
  return Math.floor((end.getTime() - from) / DAY);
}

/** Sums one field across rows. */
export function sumField(rows: RecordRow[], key: string): number {
  return rows.reduce((acc, r) => acc + num(r.data[key]), 0);
}

/**
 * Groups rows by one field.
 *
 * Blank values collapse into one bucket named `unlabelled`, because a report
 * that silently drops rows is worse than one that shows them under a name.
 */
export function groupBy(rows: RecordRow[], key: string): Map<string, RecordRow[]> {
  const out = new Map<string, RecordRow[]>();
  for (const row of rows) {
    const label = str(row.data[key]) || 'Unspecified';
    const bucket = out.get(label);
    if (bucket) bucket.push(row);
    else out.set(label, [row]);
  }
  return out;
}

/**
 * Earned value for one work package, and the indices that follow from it.
 *
 * SPI is EV/PV and CPI is EV/AC. A null index means the denominator is zero,
 * which is not the same as a zero index: no planned value yet is unknown, not
 * infinitely behind. Every caller must render null as "—".
 */
export interface EvmResult {
  bac: number;
  pv: number;
  ev: number;
  ac: number;
  /** Schedule performance index = ev / pv, or null when pv is 0. */
  spi: number | null;
  /** Cost performance index = ev / ac, or null when ac is 0. */
  cpi: number | null;
  /** Estimate at completion = bac / cpi, falling back to bac at cpi 0. */
  eac: number;
  /** eac minus bac. Positive means a forecast overrun. */
  eacVariance: number;
  /** Physical completion = ev / bac, or null when bac is 0. */
  pctComplete: number | null;
}

/** Computes the indices for one work package row. */
export function earnedValue(row: RecordRow): EvmResult {
  const bac = num(row.data.bac);
  const pv = num(row.data.pv);
  const ev = num(row.data.ev);
  const ac = num(row.data.ac);

  const spi = pv > 0 ? ev / pv : null;
  const cpi = ac > 0 ? ev / ac : null;
  const eac = cpi !== null && cpi > 0 ? bac / cpi : bac;

  return {
    bac,
    pv,
    ev,
    ac,
    spi,
    cpi,
    eac,
    eacVariance: eac - bac,
    pctComplete: bac > 0 ? ev / bac : null,
  };
}

/**
 * Earned value across a set of work packages.
 *
 * The roll-up divides summed EV by summed PV and summed AC rather than
 * averaging the per-row indices. Averaging indices lets a tiny package
 * carrying a good ratio outweigh a large one that is behind, which is the
 * opposite of what a manager is asking.
 */
export function earnedValueTotal(rows: RecordRow[]): EvmResult & {
  spiRowCount: number;
  cpiRowCount: number;
} {
  let bac = 0;
  let pv = 0;
  let ev = 0;
  let ac = 0;
  let spiRowCount = 0;
  let cpiRowCount = 0;

  for (const row of rows) {
    const r = earnedValue(row);
    bac += r.bac;
    pv += r.pv;
    ev += r.ev;
    ac += r.ac;
    if (r.spi !== null) spiRowCount += 1;
    if (r.cpi !== null) cpiRowCount += 1;
  }

  const spi = pv > 0 ? ev / pv : null;
  const cpi = ac > 0 ? ev / ac : null;
  const eac = cpi !== null && cpi > 0 ? bac / cpi : bac;

  return {
    bac,
    pv,
    ev,
    ac,
    spi,
    cpi,
    eac,
    eacVariance: eac - bac,
    pctComplete: bac > 0 ? ev / bac : null,
    spiRowCount,
    cpiRowCount,
  };
}

/**
 * The page limit a report should request.
 *
 * Every report fetches whole registers, so this caps the one number that
 * decides how much comes back. Reports that page will say so on the card
 * rather than quietly truncating.
 */
export const REPORT_LIMIT = MAX_ROWS;

/** A simple gauge value, already clamped to 0..100 for a Bar. */
export function pctOf(part: number, whole: number): number | null {
  if (whole <= 0) return null;
  return Math.min(100, Math.max(0, (part / whole) * 100));
}

/** Formats a 0..100 value, or an em dash when it is unknown. */
export function pctText(value: number | null): string {
  return value === null ? '—' : `${Math.round(value)}%`;
}

/** Formats an index to two decimals, or an em dash when it is unknown. */
export function indexText(value: number | null): string {
  return value === null ? '—' : value.toFixed(2);
}

/**
 * A counting series for a bar chart: one bucket per calendar month.
 *
 * Months come back oldest first, because a chart read left to right should run
 * forwards in time. Any row outside the window is ignored rather than dropped
 * silently into the nearest month.
 */
export function monthlySeries(
  rows: RecordRow[],
  dateKey: string,
  valueKey: string,
  months: number,
): { label: string; value: number }[] {
  const buckets: { label: string; value: number }[] = [];
  const index = new Map<string, number>();

  const cursor = new Date();
  cursor.setDate(1);
  cursor.setHours(0, 0, 0, 0);
  cursor.setMonth(cursor.getMonth() - (months - 1));

  for (let i = 0; i < months; i += 1) {
    const label = cursor.toLocaleDateString('en-IN', { month: 'short', year: '2-digit' });
    index.set(`${cursor.getFullYear()}-${cursor.getMonth()}`, buckets.length);
    buckets.push({ label, value: 0 });
    cursor.setMonth(cursor.getMonth() + 1);
  }

  for (const row of rows) {
    const raw = row.data[dateKey];
    if (!raw) continue;
    const d = new Date(str(raw));
    if (Number.isNaN(d.getTime())) continue;
    const slot = index.get(`${d.getFullYear()}-${d.getMonth()}`);
    if (slot === undefined) continue;
    buckets[slot]!.value += num(row.data[valueKey]);
  }

  return buckets;
}