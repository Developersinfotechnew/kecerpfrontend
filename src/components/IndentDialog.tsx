'use client';

import { useEffect, useRef, useState, type CSSProperties } from 'react';

import { Button } from '@/components/ui';
import { hasBidQty, isLumpSum, lineRate, lineUnits } from '@/lib/boq-price';
import { records } from '@/lib/services';
import type { RecordRow } from '@/lib/types';

/**
 * The indent / PR dialog — pick BOQ lines, cap each at its balance.
 *
 * Shared by two screens so the rules cannot drift: the BOQ Indent Desk
 * (`/epc/boq-indent`, the client's own desk) and the purchase & procurement
 * screen (`/epc/procure`). Both raise the SAME `boq_indents` rows, so an
 * indent is one document wherever it is raised, and the desk's balance math
 * sees it immediately.
 *
 * Every amount is derived, never typed: a line's amount is its quantity times
 * the BOQ rate, and the estimated total is the sum of those. Nothing on this
 * dialog is a stored snapshot.
 */

export const BOQ_KEY = 'boq_register';
export const IND_KEY = 'boq_indents';

/** An indent's item line as it is stored: the boq_register ref + quantity. */
export interface IndentLine {
  boqRef: string;
  qty: number;
}

/** Rejected indents do not count: they were withdrawn, so the balance comes back. */
export const counts = (p: RecordRow): boolean => String(p.data.status ?? '') !== 'Rejected';

/** The stored `lines` table, coerced to a safe shape. */
export function linesOf(row: RecordRow): IndentLine[] {
  const raw = row.data.lines;
  if (!Array.isArray(raw)) return [];
  const out: IndentLine[] = [];
  for (const r of raw) {
    if (!r || typeof r !== 'object') continue;
    const ref = String((r as { boqRef?: unknown }).boqRef ?? '').trim();
    if (!ref) continue;
    out.push({ boqRef: ref, qty: Number((r as { qty?: unknown }).qty) || 0 });
  }
  return out;
}

/** ₹ with Indian digit grouping, two decimals — the desk's money voice. */
export const inr = (n: number): string =>
  (n || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** Whole-number Indian grouping, for quantities. */
export const qtyf = (n: number): string => (n || 0).toLocaleString('en-IN');

/** A stored date as 12 Sep 2026, or an em dash when absent. */
export const fmtDay = (v: unknown): string => {
  if (v === null || v === undefined || String(v).trim() === '') return '—';
  const d = new Date(String(v));
  if (Number.isNaN(d.getTime())) return String(v);
  return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
};

/** Today as YYYY-MM-DD for <input type="date">. */
const todayIso = (): string => new Date().toISOString().slice(0, 10);

/**
 * A failed save, in words the operator can act on.
 *
 * The engine answers a bad field with "Record failed validation" and the real
 * reason in `details` keyed by field. Showing only the headline told the
 * operator nothing, which is how a rejected save reads as a dead button. Each
 * named field is spelled out; a plain network/HTTP failure passes through.
 */
function explain(e: unknown): string {
  const details = (e as { details?: unknown })?.details;
  if (details && typeof details === 'object' && !Array.isArray(details)) {
    const parts = Object.entries(details as Record<string, unknown>)
      .map(([k, v]) => `${k}: ${String(v)}`);
    if (parts.length > 0) return parts.join(' · ');
  }
  return e instanceof Error && e.message ? e.message : 'Could not save the indent';
}

/** A stored date as YYYY-MM-DD, or empty string when absent. */
const isoDay = (v: unknown): string => {
  if (v === null || v === undefined || String(v).trim() === '') return '';
  const s = String(v);
  // Backend may return ISO timestamp or already-trimmed date.
  return s.slice(0, 10);
};

export function IndentDialog({
  boq,
  indented,
  existing,
  suggestNo,
  onClose,
  onSaved,
}: {
  boq: RecordRow[];
  indented: Map<string, number>;
  existing: RecordRow | null;
  suggestNo: string;
  onClose: () => void;
  /**
   * Fired after a successful write, with the saved row's reference. The desk
   * reloads and checks that the reference actually came back in the list —
   * that is what tells a save that persisted but is invisible (scope, filters)
   * apart from a save that silently failed. The dialog itself never claims
   * success: only the caller, after that check, does.
   */
  onSaved: (ref: string) => void | Promise<void>;
}) {
  const inp = 'w-full rounded px-2.5 py-[6px] text-[13px] outline-none';
  const inpStyle: CSSProperties = { border: '1px solid var(--line)', background: 'var(--panel)', color: 'var(--text)' };

  // The head fields start from the existing row, or fresh with a suggested no.
  const [prNo, setPrNo] = useState(existing ? String(existing.data.prNo ?? '') : suggestNo);
  // <input type="date"> only accepts YYYY-MM-DD. fmtDay renders "12 Sep 2026",
  // which the control drops silently — that is why an edit could not be saved.
  const [date, setDate] = useState(existing ? isoDay(existing.data.date) : todayIso());
  const [needBy, setNeedBy] = useState(existing ? isoDay(existing.data.needBy) : '');
  const [raisedBy, setRaisedBy] = useState(existing ? String(existing.data.raisedBy ?? '') : '');
  const [deliverySite, setDeliverySite] = useState(existing ? String(existing.data.deliverySite ?? '') : '');
  const [priority, setPriority] = useState(existing ? String(existing.data.priority ?? 'Normal') : 'Normal');
  const [remarks, setRemarks] = useState(existing ? String(existing.data.remarks ?? '') : '');
  // The status is carried on the saved row; the dialog edits its own fields.
  const [status] = useState(existing ? String(existing.data.status ?? 'Draft') : 'Draft');

  // Per-BOQ-ref indent quantity, prefilled from the existing row's lines.
  const [q, setQ] = useState<Record<string, string>>(() => {
    const init: Record<string, string> = {};
    for (const l of existing ? linesOf(existing) : []) init[l.boqRef] = String(l.qty);
    return init;
  });
  const [dq, setDq] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  // A blocked save must not be invisible. The error paragraph sits below the
  // 38vh item table, so on a laptop every message the dialog raises lands
  // under the fold — the operator clicks Save, sees nothing change and reads
  // it as "the button does not work" (Objection 3 and 5). The alert is
  // therefore repeated at the top, and the box is scrolled back up to it.
  const boxRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (err) boxRef.current?.scrollTo({ top: 0, behavior: 'smooth' });
  }, [err]);

  // A row without an explicit rate falls back to amount ÷ qty (₹L × 100000),
  // the same rule as the desk: amount-only BOQ imports still price an indent
  // instead of every total reading 0. Objection 4: this number is derived,
  // never typed — the operator enters a quantity and the money follows.
  // A lump-sum line (amount, no BOQ qty) prices at its whole amount for its
  // single unit, so the indent is worth the line's money either way.
  const rateOf = (ref: string): number => lineRate(boq.find((x) => x.ref === ref));

  // A BOQ row imported amount-only carries no quantity, so there is no bid
  // quantity to cap against. Capping it at 0 makes the dialog reject every
  // indent quantity, so the desk cannot save a single document against such a
  // row — the wall behind "Create does not work" on amount-only imports. Such
  // a row is a lump sum: it carries exactly one indentable unit, so it prices
  // and caps at 1 instead of refusing. Rows with a bid quantity keep the bid
  // cap. Objection 4: every line is indentable and priced the moment it has
  // money.
  const unitsOf = (b: RecordRow): number => lineUnits(b);
  const capped = (b: RecordRow): boolean => unitsOf(b) > 0;

  // When editing, this indent's own lines were already counted in `indented`,
  // so give them back before comparing against the balance.
  const myOwn = (() => {
    const m = new Map<string, number>();
    for (const l of existing ? linesOf(existing) : []) m.set(l.boqRef, l.qty);
    return m;
  })();
  const balanceOf = (b: RecordRow): number =>
    unitsOf(b) - (indented.get(b.ref) ?? 0) + (myOwn.get(b.ref) ?? 0);

  const f = dq.trim().toLowerCase();
  const shown = !f ? boq : boq.filter((b) => (b.ref + ' ' + String(b.data.description ?? '')).toLowerCase().includes(f));

  // Live count + estimated total as the operator types.
  let nSel = 0;
  let total = 0;
  for (const b of boq) {
    const n = Number(q[b.ref]) || 0;
    if (n > 0) nSel += 1;
    total += n * rateOf(b.ref);
  }


  async function save(): Promise<void> {
    const lines: IndentLine[] = [];
    let firstErr = '';
    for (const b of boq) {
      const n = Number(q[b.ref]) || 0;
      if (n <= 0) continue;
      const bal = balanceOf(b);
      if (capped(b) && n > bal + 1e-9 && !firstErr) {
        // A lump-sum line has one unit, not a quantity — say that plainly
        // rather than quoting a balance of 1 against a typed 5.
        firstErr = isLumpSum(b)
          ? `Item ${b.ref}: this is a lump-sum line (amount only, no BOQ qty), so it can be indented once at qty 1.`
          : `Item ${b.ref}: indent qty ${qtyf(n)} is above the balance of ${qtyf(bal)}.`;
      }
      // Objection 4: a line with no price would save an indent worth ₹0 and
      // leave the desk's Indented total where it was. Say so instead of
      // writing a silently worthless document. A lump-sum line is priced from
      // its amount, so only a line with neither a rate nor an amount lands
      // here.
      if (rateOf(b.ref) <= 0 && !firstErr) {
        firstErr = `Item ${b.ref}: no rate and no amount, so this line would indent at ₹0. Price it on the BOQ tab first.`;
      }
      lines.push({ boqRef: b.ref, qty: n });
    }
    if (lines.length === 0) firstErr = firstErr || 'Enter an indent quantity for at least one item.';
    if (!prNo.trim()) firstErr = firstErr || 'PR number is required.';
    // The engine makes the date required; an emptied date input would only
    // surface as an API error, so name it here.
    if (!date) firstErr = firstErr || 'Date is required.';
    if (firstErr) {
      setErr(firstErr);
      return;
    }

    setBusy(true);
    setErr('');

    const body = {
      data: {
        prNo,
        date,
        needBy,
        raisedBy,
        deliverySite,
        priority,
        estValue: total,
        remarks,
        status,
        lines,
      },
    };

    // The save's own reference: the caller reloads the list and looks for it.
    // A cap or a scope filter can hide a row that saved perfectly well, and
    // blaming the write for that is what made Objection 5 read as "documents
    // are never saved".
    let ref = existing ? existing.ref : '';
    try {
      if (existing) await records.update(IND_KEY, existing.id, body);
      else ref = (await records.create(IND_KEY, body)).ref;
    } catch (e) {
      // Nothing was written, so this is a real failure. Say which field the
      // engine rejected instead of a bare "failed".
      setErr(explain(e));
      setBusy(false);
      return;
    }

    // The write landed. Only the caller knows whether the row came back from
    // the list, so the dialog does not announce success — it hands over and
    // waits to be closed. A throw from the caller is about the list, not the
    // write, so it surfaces in the console rather than as a save failure; the
    // busy flag is cleared either way.
    try {
      await onSaved(ref);
    } catch (e) {
      console.error('Indent saved, but confirming it against the list failed', e);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center p-4"
      style={{ background: 'rgba(15, 23, 41, 0.45)' }}
      role="dialog"
      aria-modal="true"
    >
      <div ref={boxRef} className="max-h-[92vh] w-full max-w-3xl overflow-y-auto rounded-lg" style={{ background: 'var(--panel)', border: '1px solid var(--line)' }}>
        <header className="flex items-center justify-between px-4 py-3" style={{ borderBottom: '1px solid var(--line-2)' }}>
          <h3 className="m-0 text-[14px] font-semibold">{existing ? `Edit ${existing.ref}` : 'New indent'}</h3>
          <button
            type="button"
            className="text-[18px] leading-none"
            style={{ color: 'var(--muted)', background: 'none', border: 'none', cursor: 'pointer' }}
            onClick={onClose}
            aria-label="Close"
          >
            ×
          </button>
        </header>

        {/* The same failure the footer states, repeated where it cannot be
            missed. A blocked save that looks like a dead button is Objection 3
            and 5; the reason belongs above the item table, not under it. */}
        {err ? (
          <p
            className="m-0 px-4 py-2 text-[12.5px]"
            role="alert"
            style={{ background: 'var(--danger-soft, #fdecec)', color: 'var(--danger)', borderBottom: '1px solid var(--line-2)' }}
          >
            {err}
          </p>
        ) : null}

        <div className="p-4">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <label className="text-[12px]" style={{ color: 'var(--muted)' }}>
              PR no
              <div className="mt-1"><input value={prNo} onChange={(e) => setPrNo(e.target.value)} className={inp} style={inpStyle} /></div>
            </label>
            <label className="text-[12px]" style={{ color: 'var(--muted)' }}>
              Date
              <div className="mt-1"><input type="date" value={date} onChange={(e) => setDate(e.target.value)} className={inp} style={inpStyle} /></div>
            </label>
            <label className="text-[12px]" style={{ color: 'var(--muted)' }}>
              Required by
              <div className="mt-1"><input type="date" value={needBy} onChange={(e) => setNeedBy(e.target.value)} className={inp} style={inpStyle} /></div>
            </label>
            <label className="text-[12px]" style={{ color: 'var(--muted)' }}>
              Raised by
              <div className="mt-1"><input value={raisedBy} onChange={(e) => setRaisedBy(e.target.value)} className={inp} style={inpStyle} /></div>
            </label>
            <label className="text-[12px]" style={{ color: 'var(--muted)' }}>
              Delivery site
              <div className="mt-1"><input value={deliverySite} onChange={(e) => setDeliverySite(e.target.value)} className={inp} style={inpStyle} /></div>
            </label>
            <label className="text-[12px]" style={{ color: 'var(--muted)' }}>
              Priority
              <div className="mt-1">
                <select value={priority} onChange={(e) => setPriority(e.target.value)} className={inp} style={inpStyle}>
                  {['Low', 'Normal', 'Urgent'].map((p) => <option key={p} value={p}>{p}</option>)}
                </select>
              </div>
            </label>
            <label className="text-[12px] sm:col-span-3" style={{ color: 'var(--muted)' }}>
              Remarks
              <div className="mt-1"><textarea rows={2} value={remarks} onChange={(e) => setRemarks(e.target.value)} className={inp} style={inpStyle} /></div>
            </label>
          </div>

          <div className="mt-4 flex items-center gap-2">
            <input
              type="search"
              value={dq}
              onChange={(e) => setDq(e.target.value)}
              placeholder="Filter BOQ items"
              className={inp}
              style={{ ...inpStyle, flex: 1 }}
            />
            <span className="whitespace-nowrap text-[12px]" style={{ color: 'var(--muted)' }}>
              {nSel} item{nSel === 1 ? '' : 's'} selected · value ₹{inr(total)}
            </span>
          </div>

          <div className="mt-2 max-h-[38vh] overflow-auto rounded" style={{ border: '1px solid var(--line)' }}>
            <table className="w-full border-collapse text-[12.5px]">
              <thead style={{ background: 'var(--panel-2)' }}>
                <tr>
                  {['Item no', 'Description', 'BOQ qty', 'Balance', 'Rate', 'Indent qty', 'Amount'].map((h, i) => (
                    <th
                      key={i}
                      className="px-2 py-1 text-[11px] font-semibold"
                      style={{
                        border: '1px solid var(--line)',
                        color: 'var(--muted)',
                        textAlign: i >= 2 ? 'right' : 'left',
                        textTransform: 'uppercase',
                        letterSpacing: '.04em',
                      }}
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {shown.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="px-3 py-6 text-center" style={{ color: 'var(--muted)' }}>
                      {boq.length === 0 ? 'Add BOQ items first.' : 'No items match the filter.'}
                    </td>
                  </tr>
                ) : (
                  shown.map((b) => {
                    const isCap = capped(b);
                    const hasQ = hasBidQty(b);
                    // A line with an amount and no BOQ qty is a lump sum: one
                    // unit, priced at the line's whole amount. The break-even
                    // here is "does it have money", never "does it have a qty".
                    const lump = isLumpSum(b);
                    const bal = balanceOf(b);
                    const v = q[b.ref] ?? '';
                    const over = isCap && Number(v) > bal + 1e-9;
                    return (
                      <tr key={b.id}>
                        <td className="num px-2 py-1.5" style={{ border: '1px solid var(--line)', color: 'var(--muted)' }}>{b.ref}</td>
                        <td className="px-2 py-1.5" style={{ border: '1px solid var(--line)' }}>{String(b.data.description ?? '')}</td>
                        <td className="num px-2 py-1.5 text-right" style={{ border: '1px solid var(--line)' }}>
                          <span title={lump ? 'Lump-sum line: no BOQ qty, so it carries one unit priced at the whole amount.' : 'BOQ qty'}>
                            {hasQ ? qtyf(Number(b.data.quantity) || 0) : lump ? 'lump sum' : '—'}
                          </span>
                        </td>
                        <td className="num px-2 py-1.5 text-right" style={{ border: '1px solid var(--line)', color: isCap && bal < 0 ? 'var(--danger)' : undefined }} title="Balance">
                          {isCap ? qtyf(bal) : '—'}
                        </td>
                        <td
                          className="num px-2 py-1.5 text-right"
                          style={{
                            border: '1px solid var(--line)',
                            color:
                              rateOf(b.ref) <= 0
                                ? 'var(--danger)'
                                : lump || !hasQ
                                  ? 'var(--warn)'
                                  : undefined,
                          }}
                          title={
                            Number(b.data.rate) > 0
                              ? 'BOQ rate'
                              : lump
                                ? 'Lump sum: the indent is priced at this line’s whole amount, once. Add the BOQ qty on the BOQ tab to price it per unit.'
                                : hasQ
                                  ? 'No BOQ rate set; using the rate derived from the item amount (amount ÷ qty).'
                                  : 'No rate and no amount on this BOQ line, so it cannot be priced. Add one on the BOQ tab.'
                          }
                        >
                          {rateOf(b.ref) > 0 ? `₹${inr(rateOf(b.ref))}` : 'no rate'}
                        </td>
                        <td className="px-2 py-1.5" style={{ border: '1px solid var(--line)' }}>
                          <input
                            inputMode="decimal"
                            value={v}
                            onChange={(e) => setQ((s) => ({ ...s, [b.ref]: e.target.value }))}
                            className="num w-[90px] rounded px-1.5 py-1 text-right text-[12.5px]"
                            style={{
                              border: `1px solid ${over ? 'var(--danger)' : 'var(--line)'}`,
                              background: 'var(--panel)',
                              color: over ? 'var(--danger)' : undefined,
                            }}
                          />
                        </td>
                        {/* Auto amount: indent qty times the BOQ rate. The live
                            total above and the saved est value follow it. */}
                        <td className="num px-2 py-1.5 text-right" style={{ border: '1px solid var(--line)' }}>
                          {Number(v) > 0 ? inr(Number(v) * rateOf(b.ref)) : '—'}
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>

          <p className="mt-2 min-h-[16px] text-[12.5px]" style={{ color: err ? 'var(--danger)' : 'var(--muted)' }}>
            {err ||
              'Amounts calculate from the BOQ rate as you type — enter a quantity and the value follows. Quantities are checked against the BOQ balance, so you cannot indent more than was bid. A “lump sum” line has no BOQ qty: it counts as one unit, priced at the whole line amount.'}
          </p>

          <div className="mt-2 flex justify-end gap-2">
            <Button onClick={onClose}>Cancel</Button>
            <Button variant="primary" disabled={busy} onClick={() => void save()}>
              {busy ? 'Saving…' : 'Save indent'}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
