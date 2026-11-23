import type { RecordRow } from '@/lib/types';

/**
 * The one BOQ pricing rule, shared by every screen that turns a BOQ line into
 * money: the Indent Desk (`/epc/boq-indent`), its indent dialog, and the BOQ
 * register (`/epc/boq`).
 *
 * Objection 4 (BOQ module): "Price does not auto-calculate. Indent value should
 * be calculated as quantity × rate and update the Indented and Balance values.
 * The price has to be entered manually, and the totals do not update."
 *
 * Two things were wrong. Every derived value read `data.rate`, and the client's
 * imported lines carry their money in `amount` (₹L) with `rate` empty — so the
 * rate read 0 and Indented stayed ₹0.00. And the fallback that did exist divided
 * by `quantity || 1`, so a line with NO quantity priced at its whole amount per
 * unit — a ₹500L line read as ₹5,00,00,000 per unit.
 *
 * There are three shapes of BOQ line, and the rule differs for each:
 *
 *   Per-unit  — a bid quantity is present. The rate is the explicit `rate`, or
 *               amount ÷ qty when the row carries no rate (amount is ₹L, so
 *               × 100000). Indenting n units costs n × rate.
 *   Lump sum  — an amount but no bid quantity (the client's five imported
 *               rows). There is no per-unit price to invent, so the whole line
 *               amount counts as ONE unit: indenting the line costs the amount
 *               once, and the line is capped at that single unit. This is what
 *               lets an amount-only import be indented at all — before it, the
 *               derived rate read 0, the dialog refused to save, and the desk's
 *               Indented value could only ever be ₹0.00 (Objection 4).
 *   Unpriced  — neither a rate nor an amount. Nothing can be derived; the desk
 *               names the line so the operator prices it.
 *
 * Units: `rate` is ₹ per unit, `amount` is ₹L, quantities are plain counts.
 */

const LAKH = 100_000;

/** Two decimals, the money precision every BOQ figure is shown at. */
export const round2 = (n: number): number => Math.round((n || 0) * 100) / 100;

/** A stored number, 0 when absent or not a number. */
const num = (v: unknown): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

/** True when the line carries a bid quantity to price and cap against. */
export const hasBidQty = (b: RecordRow | undefined): boolean => num(b?.data.quantity) > 0;

/**
 * True when the line states a lump amount and no bid quantity: the whole
 * amount is one unit of the line, not a per-unit price.
 */
export const isLumpSum = (b: RecordRow | undefined): boolean =>
  !!b && !hasBidQty(b) && num(b.data.amount) > 0;

/**
 * ₹ per unit for a BOQ line, derived when the row carries no explicit rate.
 * 0 means the line cannot be priced per unit yet — it has no bid quantity.
 * A lump-sum line reports 0 here on purpose: its money is not per unit. Use
 * `lineRate` for anything that multiplies a quantity.
 */
export function rateFromRow(b: RecordRow | undefined): number {
  if (!b) return 0;
  const rate = num(b.data.rate);
  if (rate > 0) return rate;
  const qty = num(b.data.quantity);
  if (qty <= 0) return 0;
  return (num(b.data.amount) * LAKH) / qty;
}

/**
 * ₹ per unit as an indent must price it — the rule to multiply a quantity by.
 *
 * A lump-sum line is priced at its whole amount for its single allowed unit,
 * so `qty × lineRate` reads the line's money correctly for every row shape.
 * The cap that keeps a lump line at one unit lives in `lineUnits`; without it
 * this price would repeat the whole amount for every unit typed.
 */
export function lineRate(b: RecordRow | undefined): number {
  if (!b) return 0;
  const rate = rateFromRow(b);
  if (rate > 0) return rate;
  return isLumpSum(b) ? num(b.data.amount) * LAKH : 0;
}

/**
 * How many indentable units the line carries: its BOQ quantity, or 1 for a
 * lump-sum line, or 0 when the line is unpriced. This is the cap and the
 * balance basis, so a lump line can be indented exactly once.
 */
export function lineUnits(b: RecordRow | undefined): number {
  if (!b) return 0;
  if (hasBidQty(b)) return num(b.data.quantity);
  return isLumpSum(b) ? 1 : 0;
}

/**
 * The line's money in ₹, as the BOQ states it: qty × rate when both are known,
 * else the carried amount (an amount-only import states its own total).
 */
export function lineAmount(b: RecordRow | undefined): number {
  if (!b) return 0;
  const qty = num(b.data.quantity);
  const rate = rateFromRow(b);
  if (qty > 0 && rate > 0) return qty * rate;
  return num(b.data.amount) * LAKH;
}

/**
 * Live auto-fill for the BOQ item form: whichever of qty / rate / amount the
 * operator has typed, the third follows. Returns the fields to merge, or null
 * when nothing can be derived yet.
 *
 * Typing the BOQ qty on an imported amount-only line derives its rate — that is
 * how a line gets a per-unit price without anyone re-typing the money. A typed
 * rate is never clobbered: the amount follows qty × rate.
 */
export function deriveBoqLine(
  changed: string,
  values: Record<string, unknown>,
): Record<string, unknown> | null {
  const qty = num(values.quantity);
  const rate = num(values.rate);
  const amount = num(values.amount);
  const out: Record<string, unknown> = {};

  if (changed === 'quantity' || changed === 'rate') {
    if (qty > 0 && rate > 0) out.amount = String(round2((qty * rate) / LAKH));
    else if (changed === 'quantity' && qty > 0 && amount > 0) {
      // Typed qty on a line that carries only an amount: the price follows.
      out.rate = String(round2((amount * LAKH) / qty));
    }
  } else if (changed === 'amount' && qty > 0 && amount > 0) {
    // Typed amount with a qty: the price follows the amount.
    out.rate = String(round2((amount * LAKH) / qty));
  }

  return Object.keys(out).length > 0 ? out : null;
}
