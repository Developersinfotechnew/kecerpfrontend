'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';

import { RecordForm } from '@/components/RecordForm';
import { ImportExcelModal } from '@/components/ImportExcelModal';
import {
  BOQ_KEY,
  IND_KEY,
  IndentDialog,
  counts,
  fmtDay,
  inr,
  linesOf,
  qtyf,
} from '@/components/IndentDialog';
import { Button, Chip, DataTable, Grid, KpiGrid, Notice, PageHead, Panel } from '@/components/ui';
import type { ChipTone } from '@/components/ui';
import { toast } from '@/components/toast';
import { deriveBoqLine, isLumpSum, lineAmount, lineRate, lineUnits, round2 } from '@/lib/boq-price';
import { openPrintReport } from '@/lib/print-report';
import { records } from '@/lib/services';
import { useSession } from '@/app/session';
import type { RecordRow, RecordType } from '@/lib/types';

/**
 * BOQ Indent Desk — the client's "BOQ Indent Desk".
 *
 * Two live registers behind one screen:
 *   boq_register — the approved Bill of Quantities (the reference).
 *   boq_indents  — one row per indent / PR; its item lines live on a
 *                  CR-11 table field and point back at BOQ refs.
 *
 * Every number on this screen is derived: indented qty and balance are the
 * arithmetic of the indent lines against the BOQ quantity, so they move the
 * moment a line moves. Nothing here is stored as a snapshot.
 */

const PRIORITY_TONE: Record<string, ChipTone> = { Urgent: 'bad', Normal: 'info', Low: 'mute' };
const STATUS_TONE: Record<string, ChipTone> = { Draft: 'mute', Submitted: 'warn', Approved: 'ok', Ordered: 'ok', Rejected: 'bad' };
const STATUS_WORDS = ['Draft', 'Submitted', 'Approved', 'Ordered', 'Rejected'];

export default function EpcBoqIndentPage() {
  const { can } = useSession();
  const mayCreate = can('boq:create');

  const [tab, setTab] = useState<'ov' | 'boq' | 'pr' | 'pt'>('ov');
  const [boqType, setBoqType] = useState<RecordType | null>(null);
  const [boq, setBoq] = useState<RecordRow[]>([]);
  const [indents, setIndents] = useState<RecordRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // The two print-tab selections live on the page so a row-level Print button
  // can hand them across when it jumps to the tab.
  const [ptDoc, setPtDoc] = useState<'boq' | 'pr'>('boq');
  const [ptPr, setPtPr] = useState('');

  // BOQ line editor + Excel import.
  const [boqForm, setBoqForm] = useState<RecordRow | 'new' | null>(null);
  const [importOpen, setImportOpen] = useState(false);

  // The indent / PR dialog.
  const [dlg, setDlg] = useState<RecordRow | 'new' | null>(null);

  /**
   * Reloads both registers and reports whether the indent list itself read.
   *
   * The two registers load independently: a failure on the BOQ list must not
   * blank the indents (and vice versa), because a single broken read used to
   * make the whole desk read "0 raised" with an empty table — the exact screen
   * behind Objection 5. `ok` now means "the indents list was read": `false`
   * is a read failure, not an empty list, and the caller must not confuse the
   * two when judging a save.
   */
  const load = useCallback(async (): Promise<{ items: RecordRow[]; ok: boolean }> => {
    setLoading(true);
    setError(null);
    const failed: string[] = [];
    try {
      const [t, b] = await Promise.all([
        records.type(BOQ_KEY),
        records.list(BOQ_KEY, { limit: 500 }),
      ]);
      setBoqType(t);
      setBoq(b.items);
    } catch (err) {
      failed.push(`BOQ list: ${err instanceof Error ? err.message : 'could not load'}`);
    }
    let pItems: RecordRow[] = [];
    let indOk = false;
    try {
      const p = await records.list(IND_KEY, { limit: 500 });
      pItems = p.items;
      setIndents(pItems);
      indOk = true;
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'could not load';
      // A 404 names the missing register: a backend that has not run the
      // catalogue sync since boq_indents was added cannot list or create it.
      failed.push(
        `Indents list: ${msg} (if the register is missing, restart the backend so the catalogue sync seeds it)`,
      );
    }
    if (failed.length > 0) setError(failed.join(' · '));
    setLoading(false);
    return { items: indOk ? pItems : [], ok: indOk };
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  /**
   * After a write: reload, then say what actually happened.
   *
   * The list is the only truth. When the written reference comes back, the
   * save is confirmed and the dialog closes. When it does not, the row either
   * did not persist or the list is hiding it behind a scope/cap — both are
   * named with the reference and the list size, so the operator never has to
   * guess which. Objection 5 was exactly this guess being made for them.
   */
  async function confirmSaved(ref: string): Promise<void> {
    const fresh = await load();
    setDlg(null);
    if (!fresh.ok) {
      // The write returned a reference; the read failed. Saying "failed"
      // would send the operator to retype a document that already exists.
      toast(`${ref || 'Indent'} was saved, but the list could not reload. Refresh the page.`, 'warn', 12000);
      return;
    }
    if (ref === '' || fresh.items.some((r) => r.ref === ref)) {
      toast(`${ref || 'Indent'} saved.`, 'ok', 6000);
      return;
    }
    // Persisted, but this list does not carry it: the row belongs to a project
    // the list is not filtered to, or the register is past its 500-row cap.
    toast(
      `${ref} was saved but is not in this list (${fresh.items.length} shown). It may sit under another project — filter Indents / PR to that project to see it.`,
      'warn',
      12000,
    );
  }

  // --- derived: per-BOQ-ref indented qty and the desk's headline values ----
  const indented = useMemo(() => {
    const byRef = new Map<string, number>();
    for (const p of indents) {
      if (!counts(p)) continue;
      for (const l of linesOf(p)) byRef.set(l.boqRef, (byRef.get(l.boqRef) ?? 0) + l.qty);
    }
    return byRef;
  }, [indents]);

  // BOQ amounts are stored in ₹L; the desk speaks whole rupees. The sum uses
  // the same per-line rule as every column (lineAmount), so a line priced by
  // qty × rate counts at its money even when no amount was typed — and the
  // BOQ value, the BOQ tab's Total and the Indented/Balance KPIs can never
  // disagree about what a line is worth.
  const boqValue = useMemo(() => boq.reduce((s, r) => s + lineAmount(r), 0), [boq]);
  // A BOQ row without an explicit rate falls back to its own amount ÷ qty.
  // Amount-only imports carry the whole line's ₹ value in `amount` (₹L) and
  // leave `rate` empty; derived indent values would otherwise read 0 for
  // every line even though the BOQ value is fully populated. Objection 4:
  // the whole desk prices through this one shared rule. A lump-sum line
  // (amount, no qty) prices at its whole amount for its single unit, so an
  // indent against the client's five amount-only rows carries real money.
  const rowRate = useCallback((r: RecordRow) => lineRate(r), []);
  const rateOfRef = useCallback(
    (ref: string) => {
      const r = boq.find((b) => b.ref === ref);
      return r ? rowRate(r) : 0;
    },
    [boq, rowRate],
  );
  const indentValue = useCallback(
    (p: RecordRow) => linesOf(p).reduce((s, l) => s + l.qty * rateOfRef(l.boqRef), 0),
    [rateOfRef],
  );
  const indentedValue = useMemo(
    () => indents.reduce((s, p) => (counts(p) ? s + indentValue(p) : s), 0),
    [indents, indentValue],
  );
  const awaiting = useMemo(
    () => indents.filter((p) => {
      const s = String(p.data.status ?? '');
      return s === 'Draft' || s === 'Submitted';
    }).length,
    [indents],
  );

  /** PR-<year>-<n>: one past the largest existing suffix. */
  const suggestPrNo = useMemo(() => {
    const y = new Date().getFullYear();
    let mx = 0;
    for (const p of indents) {
      const m = /(\d+)$/.exec(String(p.data.prNo ?? ''));
      if (m) mx = Math.max(mx, Number(m[1]));
    }
    return `PR-${y}-${String(mx + 1).padStart(3, '0')}`;
  }, [indents]);

  // --- mutations -------------------------------------------------------------
  async function removeBoq(r: RecordRow): Promise<void> {
    // A BOQ line in use by a live indent cannot be deleted — the balance math
    // would float. Reject it with a reason instead of orphaning indent lines.
    if ((indented.get(r.ref) ?? 0) > 0) {
      toast('This item is used in an indent. Remove it there first.', 'warn');
      return;
    }
    if (!window.confirm(`Delete ${r.ref}? This cannot be undone.`)) return;
    try {
      await records.remove(BOQ_KEY, r.id);
      await load();
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Delete failed', 'warn');
    }
  }

  async function removeIndent(r: RecordRow): Promise<void> {
    if (!window.confirm(`Delete ${r.ref}? This cannot be undone.`)) return;
    try {
      await records.remove(IND_KEY, r.id);
      await load();
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Delete failed', 'warn');
    }
  }

  /** A status change is a partial merge: send the one field, keep the lines. */
  async function setStatus(row: RecordRow, status: string): Promise<void> {
    try {
      await records.update(IND_KEY, row.id, { data: { status } });
      await load();
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Status update failed', 'warn');
    }
  }

  function openPrintFromPr(r: RecordRow): void {
    setPtDoc('pr');
    setPtPr(r.id);
    setTab('pt');
  }

  // --- print and export (the client's "Print and export" tab) ---------------
  function printBoq(): void {
    openPrintReport({
      title: 'Bill of Quantities',
      sub: 'BOQ schedule',
      meta: [`BOQ value: ${inr(boqValue)}`],
      tables: [
        {
          title: 'Bill of Quantities',
          head: ['Sl', 'Item no', 'Description', 'Unit', 'Qty', 'Rate', 'Amount'],
          aligns: ['left', 'left', 'left', 'left', 'right', 'right', 'right'],
          rows: boq.map((b, i) => {
            const r = rowRate(b);
            const q = Number(b.data.quantity) || 0;
            // A lump-sum line prints as one unit at the whole amount, so the
            // paper reads the same money the screen does.
            return [
              String(i + 1),
              b.ref,
              String(b.data.description ?? ''),
              String(b.data.unit ?? ''),
              q > 0 ? qtyf(q) : isLumpSum(b) ? '1 (lump sum)' : '—',
              inr(r),
              inr(lineAmount(b)),
            ];
          }),
        },
      ],
      notes: `Total: ${inr(boqValue)}`,
      signatures: ['Prepared by', 'Checked by', 'Approved by'],
    });
  }

  function printIndent(prId: string): void {
    const p = indents.find((x) => x.id === prId);
    if (!p) {
      toast('Pick an indent to print.', 'warn');
      return;
    }
    const lines = linesOf(p);
    const total = lines.reduce((s, l) => s + l.qty * rateOfRef(l.boqRef), 0);
    openPrintReport({
      title: 'Purchase Request / Indent',
      sub: p.ref,
      meta: [
        `PR no: ${String(p.data.prNo ?? '')}`,
        `Date: ${fmtDay(p.data.date)}`,
        `Required by: ${fmtDay(p.data.needBy)}`,
        `Priority: ${String(p.data.priority ?? 'Normal')}`,
        `Raised by: ${String(p.data.raisedBy ?? '—')}`,
        `Delivery site: ${String(p.data.deliverySite ?? '—')}`,
      ],
      tables: [
        {
          title: 'Item lines',
          head: ['Sl', 'Item no', 'Description', 'Unit', 'BOQ qty', 'Indent qty', 'Est. amount'],
          aligns: ['left', 'left', 'left', 'left', 'right', 'right', 'right'],
          rows: lines.map((l, i) => {
            const b = boq.find((x) => x.ref === l.boqRef);
            const q = Number(b?.data.quantity ?? 0);
            return [
              String(i + 1),
              l.boqRef,
              String(b?.data.description ?? l.boqRef),
              String(b?.data.unit ?? ''),
              q > 0 ? qtyf(q) : isLumpSum(b) ? 'lump sum' : '—',
              qtyf(l.qty),
              inr(l.qty * rateOfRef(l.boqRef)),
            ];
          }),
        },
      ],
      notes:
        `Estimated total: ${inr(total)}` + (p.data.remarks ? `  ·  Remarks: ${String(p.data.remarks)}` : ''),
      signatures: ['Site engineer', 'Project manager', 'Purchase dept.', 'Approved by'],
    });
  }

  function exportCsvBoq(): void {
    const head = ['Item No', 'Description', 'Unit', 'Qty', 'Rate', 'Amount', 'Indented', 'Balance'];
    const rows = boq.map((b) => {
      // Same basis as the BOQ tab: a lump-sum line carries one unit, so the
      // export's Qty/Balance columns match what the screen shows.
      const q = lineUnits(b);
      const ind = indented.get(b.ref) ?? 0;
      return [
        b.ref,
        String(b.data.description ?? ''),
        String(b.data.unit ?? ''),
        q,
        rowRate(b),
        inr(lineAmount(b)),
        ind,
        q - ind,
      ];
    });
    downloadCsv('BOQ.csv', [head, ...rows]);
  }

  function exportCsvIndent(prId: string): void {
    const p = indents.find((x) => x.id === prId);
    if (!p) {
      toast('Pick an indent first.', 'warn');
      return;
    }
    const lines = linesOf(p);
    const meta: (string | number)[][] = [
      ['PR no', String(p.data.prNo ?? p.ref)],
      ['Date', fmtDay(p.data.date)],
      ['Required by', fmtDay(p.data.needBy)],
      ['Raised by', String(p.data.raisedBy ?? '')],
      ['Priority', String(p.data.priority ?? '')],
      ['Status', String(p.data.status ?? '')],
      [],
      ['Item No', 'Description', 'Unit', 'BOQ Qty', 'Indent Qty', 'Rate', 'Est. Amount'],
    ];
    const rows = lines.map((l) => {
      const b = boq.find((x) => x.ref === l.boqRef);
      const q = Number(b?.data.quantity ?? 0);
      return [
        l.boqRef,
        String(b?.data.description ?? l.boqRef),
        String(b?.data.unit ?? ''),
        // A lump-sum line has no BOQ qty; the indent is one line at the whole
        // amount, so the sheet says so instead of printing 0.
        q > 0 ? q : isLumpSum(b) ? 'lump sum' : 0,
        l.qty,
        rateOfRef(l.boqRef),
        inr(l.qty * rateOfRef(l.boqRef)),
      ];
    });
    downloadCsv(`${String(p.data.prNo ?? p.ref).replace(/[^a-zA-Z0-9-_]+/g, '-')}.csv`, [...meta, ...rows]);
  }

  // --- render -----------------------------------------------------------------
  return (
    <>
      <PageHead
        title="BOQ Indent Desk"
        description="Bill of quantities, purchase requests and indents. Quantities are checked against the BOQ balance, so you cannot indent more than was bid."
      />

      {/* Tab bar — the desk's four views. */}
      <div className="mb-4 flex gap-1 overflow-x-auto" style={{ borderBottom: '1px solid var(--line)' }} role="tablist">
        {(
          [
            ['ov', 'Overview'],
            ['boq', 'BOQ'],
            ['pr', 'Indents / PR'],
            ['pt', 'Print and export'],
          ] as const
        ).map(([k, label]) => (
          <button
            key={k}
            role="tab"
            aria-selected={tab === k}
            onClick={() => setTab(k)}
            className="whitespace-nowrap px-3.5 py-2 text-[13px] font-medium"
            style={{
              border: 'none',
              background: 'transparent',
              color: tab === k ? 'var(--accent)' : 'var(--muted)',
              borderBottom: tab === k ? '2px solid var(--accent)' : '2px solid transparent',
              cursor: 'pointer',
            }}
          >
            {label}
          </button>
        ))}
      </div>

      {/*
        A failed desk load (a red Notice, not a blank spinner) is the
        difference between "no documents are saved" and "the list could not be
        read". Objection 5 read as lost documents because a failed indents
        list left the screen looking identical to a healthy empty one.
        The error is now visible on every tab.
      */}
      {error ? <Notice>{error}</Notice> : null}
      {loading ? (
        <div className="py-10 text-center text-[13px]" style={{ color: 'var(--muted)' }}>Loading…</div>
      ) : null}

      {!loading ? (
        <>
          {tab === 'ov' ? (
            <Overview
              boq={boq}
              indents={indents}
              indented={indented}
              boqValue={boqValue}
              indentedValue={indentedValue}
              awaiting={awaiting}
              indentValue={indentValue}
              onGo={(t) => setTab(t)}
              onNew={() => setDlg('new')}
              mayNew={mayCreate}
            />
          ) : null}

          {tab === 'boq' ? (
            <BoqTab
              boq={boq}
              indented={indented}
              rowRate={rowRate}
              mayCreate={mayCreate}
              onAdd={() => setBoqForm('new')}
              onEdit={(r) => setBoqForm(r)}
              onImport={() => setImportOpen(true)}
              onDelete={(r) => void removeBoq(r)}
            />
          ) : null}

          {tab === 'pr' ? (
            <PrTab
              indents={indents}
              indentValue={indentValue}
              mayCreate={mayCreate}
              onNew={() => setDlg('new')}
              onEdit={(r) => setDlg(r)}
              onPrint={(r) => openPrintFromPr(r)}
              onStatus={(r, s) => void setStatus(r, s)}
              onDelete={(r) => void removeIndent(r)}
            />
          ) : null}

          {tab === 'pt' ? (
            <PrintTab
              doc={ptDoc}
              prId={ptPr}
              indents={indents}
              boqCount={boq.length}
              onDoc={setPtDoc}
              onPr={setPtPr}
              onPrintBoq={printBoq}
              onPrintPr={printIndent}
              onCsvBoq={exportCsvBoq}
              onCsvPr={exportCsvIndent}
              onNew={() => setDlg('new')}
              mayNew={mayCreate}
              onGoPr={() => setTab('pr')}
            />
          ) : null}
        </>
      ) : null}

      {/* BOQ line editor — the generic record form over the BOQ register. */}
      {boqType && boqForm ? (
        <RecordForm
          type={boqType}
          record={boqForm === 'new' ? null : boqForm}
          // Objection (fields to remove): Ordered qty / Vendor / PO reference
          // belong to the RFQ and PO stages, not the indent-stage item form.
          // Excluded here on this desk only; the generic BOQ screen keeps
          // them, and editing never wipes a value a later stage wrote.
          excludeFields={['orderedQty', 'vendor', 'poRef']}
          // Objection 4: the price is never typed. Entering the BOQ qty on an
          // amount-only line splits the amount into a rate, and entering a
          // rate recomputes the amount — the line is priced either way.
          deriveFrom={deriveBoqLine}
          onCancel={() => setBoqForm(null)}
          onSubmit={async (body) => {
            if (boqForm === 'new') await records.create(BOQ_KEY, body);
            else await records.update(BOQ_KEY, boqForm.id, body);
            setBoqForm(null);
            await load();
          }}
        />
      ) : null}

      {/* Import the BOQ from the client's Excel/CSV. */}
      {importOpen && boqType ? (
        <ImportExcelModal
          type={boqType}
          // Objection 4, at the source: a sheet that carries Amount but no
          // Rate imports a line whose money never calculates. With a qty, the
          // rate is derived from amount ÷ qty. With no qty the line stays a
          // lump sum (one unit at the whole amount) — the desk prices it, so
          // nothing is rejected for a column the sheet simply does not have.
          prepare={(data) => {
            const qty = Number(data.quantity) || 0;
            const amount = Number(data.amount) || 0;
            if (qty > 0 && amount > 0 && !(Number(data.rate) > 0)) {
              return { ...data, rate: String(round2((amount * 100_000) / qty)) };
            }
            return data;
          }}
          create={async (data) => {
            await records.create(BOQ_KEY, { data });
          }}
          onClose={() => setImportOpen(false)}
          onImported={() => void load()}
        />
      ) : null}

      {/* Indent / PR editor with the balance-capped line picker. */}
      {dlg ? (
        <IndentDialog
          boq={boq}
          indented={indented}
          existing={dlg === 'new' ? null : dlg}
          suggestNo={suggestPrNo}
          onClose={() => setDlg(null)}
          onSaved={(ref) => confirmSaved(ref)}
        />
      ) : null}
    </>
  );
}

// ---------------------------------------------------------------------------
// Tab: Overview
// ---------------------------------------------------------------------------

function Overview({
  boq,
  indents,
  indented,
  boqValue,
  indentedValue,
  awaiting,
  indentValue,
  onGo,
  onNew,
  mayNew,
}: {
  boq: RecordRow[];
  indents: RecordRow[];
  indented: Map<string, number>;
  boqValue: number;
  indentedValue: number;
  awaiting: number;
  indentValue: (p: RecordRow) => number;
  onGo: (t: 'boq' | 'pr') => void;
  onNew: () => void;
  mayNew: boolean;
}) {
  // Items indented above their BOQ quantity — the desk's key red flag.
  // A lump-sum line (amount-only import) caps at its single unit, so it is
  // part of the check: indenting it twice reads as over-indented.
  const over = boq
    .map((b) => ({ b, q: lineUnits(b), i: indented.get(b.ref) ?? 0 }))
    .filter((r) => r.q > 0 && r.i > r.q + 1e-9)
    .slice(0, 8);
  // Lines with no indentable unit: no bid quantity and no amount either, so
  // there is nothing to cap against and nothing to price from. They are named
  // so the operator prices them on the BOQ tab, which turns the cap and the
  // price on at once — Objection 4 is answered by data, not by a silent 0.
  const noQty = boq.filter((b) => lineUnits(b) <= 0).slice(0, 8);

  return (
    <>
      <KpiGrid
        cols={5}
        items={[
          { label: 'BOQ items', value: String(boq.length) },
          { label: 'BOQ value', value: `₹${inr(boqValue)}` },
          { label: 'Indented value', value: `₹${inr(indentedValue)}` },
          {
            label: 'Balance value',
            value: `₹${inr(boqValue - indentedValue)}`,
            tone: boqValue - indentedValue < 0 ? 'bad' : undefined,
          },
          {
            label: 'Indents awaiting action',
            value: String(awaiting),
            tone: awaiting > 0 ? 'warn' : 'good',
          },
        ]}
      />

      <div className="mt-[18px]" />

      <Grid cols={2}>
        <Panel title="Recent indents">
          {indents.length === 0 ? (
            // The overview shortcut must create, not merely move tabs: when
            // the role may raise indents it opens the dialog here; a
            // read-only role still lands on the PR tab.
            <Empty
              text="No indents raised yet."
              action={mayNew ? 'New indent' : 'Open Indents / PR'}
              onAction={() => (mayNew ? onNew() : onGo('pr'))}
            />
          ) : (
            <div className="flex flex-col gap-0.5">
              {indents.slice(0, 5).map((p) => {
                const s = String(p.data.status ?? '');
                return (
                  <div key={p.id} className="flex flex-wrap items-center gap-2 py-1.5 text-[13px]">
                    <span className="num text-[12px]" style={{ color: 'var(--muted)' }}>{p.ref}</span>
                    <span className="font-medium">{String(p.data.prNo ?? '')}</span>
                    <span className="text-[12px]" style={{ color: 'var(--muted)' }}>{fmtDay(p.data.date)}</span>
                    <Chip tone={STATUS_TONE[s] ?? 'mute'}>{s || 'Draft'}</Chip>
                    <span className="num ml-auto text-[12px]" style={{ color: 'var(--muted)' }}>
                      {linesOf(p).length} lines · ₹{inr(indentValue(p))}
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </Panel>

        <Panel title="Items indented above BOQ quantity">
          {over.length === 0 ? (
            <Empty text="Every indent is within the BOQ balance." />
          ) : (
            <div className="flex flex-col gap-1.5">
              {over.map((r) => (
                <div key={r.b.id} className="flex items-center gap-2 text-[13px]">
                  <span className="num text-[12px]" style={{ color: 'var(--muted)' }}>{r.b.ref}</span>
                  <span className="truncate">{String(r.b.data.description ?? '')}</span>
                  <span className="ml-auto shrink-0">
                    {/* A lump-sum line counts in whole lines, not units. */}
                    <Chip tone="bad">
                      {isLumpSum(r.b)
                        ? `indented ${qtyf(r.i)} times (lump sum line)`
                        : `${qtyf(r.i)} of ${qtyf(r.q)} ${String(r.b.data.unit ?? '')}`}
                    </Chip>
                  </span>
                </div>
              ))}
            </div>
          )}
        </Panel>
      </Grid>

      {/* Objection 4, the data side: a line with no bid quantity and no money
          has no indentable unit, so its balance reads "—". Naming those lines
          makes the gap visible instead of silent; pricing them on the BOQ tab
          turns the cap and the price on at once. */}
      {noQty.length > 0 ? (
        <>
          <div className="mt-[18px]" />
          <Panel title="Lines that cannot be indented yet">
            <p className="m-0 text-[12.5px]" style={{ color: 'var(--muted)' }}>
              These lines have no BOQ quantity and no amount, so there is no unit to indent
              and no price to carry — their Balance shows “—”. Give one on the BOQ tab (a BOQ
              qty, an amount, or a rate) and the line becomes indentable straight away.
            </p>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {noQty.map((b) => (
                <Chip key={b.id} tone="warn">{b.ref} · {String(b.data.description ?? '')}</Chip>
              ))}
            </div>
          </Panel>
        </>
      ) : null}
    </>
  );
}

// ---------------------------------------------------------------------------
// Tab: BOQ
// ---------------------------------------------------------------------------

function BoqTab({
  boq,
  indented,
  rowRate,
  mayCreate,
  onAdd,
  onEdit,
  onImport,
  onDelete,
}: {
  boq: RecordRow[];
  indented: Map<string, number>;
  rowRate: (b: RecordRow) => number;
  mayCreate: boolean;
  onAdd: () => void;
  onEdit: (r: RecordRow) => void;
  onImport: () => void;
  onDelete: (r: RecordRow) => void;
}) {
  const [filter, setFilter] = useState('');
  const rows = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return boq;
    return boq.filter((b) =>
      [b.ref, b.data.description, b.data.trade].some((v) => String(v ?? '').toLowerCase().includes(q)),
    );
  }, [boq, filter]);

  // The filtered total, so a search reads like a sub-ledger. Each line's
  // money comes from the shared price rule, so an amount-only imported line
  // counts at the amount it carries instead of 0.
  const total = rows.reduce((s, b) => s + lineAmount(b), 0);

  return (
    <Panel
      title="BOQ line items"
      sub={filter ? `${rows.length} of ${boq.length}` : undefined}
      bodyless
      actions={
        <>
          <input
            type="search"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Search item code or description…"
            className="rounded px-2.5 py-[6px] text-[13px] outline-none sm:w-64"
            style={{ border: '1px solid var(--line)', background: 'var(--panel)' }}
          />
          <Button onClick={onImport}>Import Excel</Button>
          {mayCreate ? <Button variant="primary" onClick={onAdd}>Add item</Button> : null}
        </>
      }
    >
      <div className="p-3">
        <DataTable
          columns={[
            { key: 'ref', label: 'Item no' },
            { key: 'desc', label: 'Description' },
            { key: 'unit', label: 'Unit' },
            { key: 'qty', label: 'BOQ qty', align: 'right' },
            { key: 'rate', label: 'Rate', align: 'right' },
            { key: 'amt', label: 'Amount', align: 'right' },
            { key: 'ind', label: 'Indented', align: 'right' },
            { key: 'bal', label: 'Balance', align: 'right' },
            { key: 'a', label: '' },
          ]}
          rows={
            rows.length === 0
              ? [[boq.length ? 'No items match the search.' : 'No items yet. Use Import Excel or Add item.']]
              : rows.map((b) => {
                  const q = Number(b.data.quantity) || 0;
                  // A lump-sum line (amount, no qty) carries one indentable
                  // unit, so its Indented/Balance count that unit rather than
                  // showing "—" forever. Objection 4: the desk must answer
                  // "how much of this line is left" for every priced line.
                  const units = lineUnits(b);
                  const lump = units > 0 && q <= 0;
                  const rate = rowRate(b);
                  const ind = indented.get(b.ref) ?? 0;
                  const bal = units - ind;
                  return [
                    <span key="ref" className="num text-[12px]" style={{ color: 'var(--muted)' }}>{b.ref}</span>,
                    String(b.data.description ?? ''),
                    String(b.data.unit ?? ''),
                    <span key="qty" className="num" title={lump ? 'Lump-sum line: no BOQ qty, so it carries one unit priced at the whole amount.' : units <= 0 ? 'No amount and no BOQ qty: nothing to price or cap against.' : undefined}>{q > 0 ? qtyf(q) : lump ? 'lump sum' : '—'}</span>,
                    <span key="rate" className="num">₹{inr(rate)}</span>,
                    <span key="amt" className="num">₹{inr(lineAmount(b))}</span>,
                    <span key="ind" className="num">{units > 0 ? qtyf(ind) : '—'}</span>,
                    <span key="bal" className="num" style={units > 0 && bal < 0 ? { color: 'var(--danger)' } : undefined}>{units > 0 ? qtyf(bal) : '—'}</span>,
                    <span key="a" className="flex items-center justify-end gap-2 whitespace-nowrap">
                      <Button variant="primary" className="min-w-[60px] justify-center" onClick={() => onEdit(b)}>Edit</Button>
                      <Button variant="small" onClick={() => onDelete(b)}>Delete</Button>
                    </span>,
                  ];
                })
          }
          empty="No items yet."
        />
        {rows.length > 0 ? (
          <div
            className="mt-3 flex items-center justify-end gap-3 text-[13px] font-semibold"
            style={{ borderTop: '1px solid var(--line)', background: 'var(--panel-2)', padding: '8px 12px' }}
          >
            <span>Total</span>
            <span className="num">₹{inr(total)}</span>
          </div>
        ) : null}
      </div>
    </Panel>
  );
}

// ---------------------------------------------------------------------------
// Tab: Indents / PR
// ---------------------------------------------------------------------------

function PrTab({
  indents,
  indentValue,
  mayCreate,
  onNew,
  onEdit,
  onPrint,
  onStatus,
  onDelete,
}: {
  indents: RecordRow[];
  indentValue: (p: RecordRow) => number;
  mayCreate: boolean;
  onNew: () => void;
  onEdit: (r: RecordRow) => void;
  onPrint: (r: RecordRow) => void;
  onStatus: (r: RecordRow, s: string) => void;
  onDelete: (r: RecordRow) => void;
}) {
  return (
    <Panel
      title="Indents / PR"
      sub={`${indents.length} raised`}
      bodyless
      actions={mayCreate ? <Button variant="primary" onClick={onNew}>New indent</Button> : null}
    >
      <div className="p-3">
        <DataTable
          columns={[
            { key: 'pr', label: 'PR no' },
            { key: 'date', label: 'Date' },
            { key: 'need', label: 'Required by' },
            { key: 'raised', label: 'Raised by' },
            { key: 'prio', label: 'Priority' },
            { key: 'lines', label: 'Lines', align: 'right' },
            { key: 'val', label: 'Est. value', align: 'right' },
            { key: 'status', label: 'Status', align: 'right' },
            { key: 'a', label: '' },
          ]}
          rows={
            indents.length === 0
              ? [['No indents yet. Use New indent to raise one from the BOQ.']]
              : indents.map((p) => {
                  const s = String(p.data.status ?? 'Draft');
                  return [
                    <span key="pr" className="num text-[12px]" style={{ color: 'var(--muted)' }}>{p.ref}</span>,
                    String(p.data.prNo ?? ''),
                    fmtDay(p.data.date),
                    String(p.data.raisedBy ?? ''),
                    <Chip key="prio" tone={PRIORITY_TONE[String(p.data.priority ?? 'Normal')] ?? 'mute'}>
                      {String(p.data.priority ?? 'Normal')}
                    </Chip>,
                    <span key="lines" className="num">{linesOf(p).length}</span>,
                    <span key="val" className="num">₹{inr(indentValue(p))}</span>,
                    <select
                      key="status"
                      value={s}
                      onChange={(e) => onStatus(p, e.target.value)}
                      aria-label={`Status for ${p.ref}`}
                      className="rounded px-2 py-1 text-[12px]"
                      style={{ border: '1px solid var(--line)', background: 'var(--panel)', color: 'var(--text)' }}
                    >
                      {STATUS_WORDS.map((w) => (
                        <option key={w} value={w}>{w}</option>
                      ))}
                    </select>,
                    <span key="a" className="flex items-center justify-end gap-2 whitespace-nowrap">
                      <Button variant="primary" className="min-w-[60px] justify-center" onClick={() => onEdit(p)}>Edit</Button>
                      <Button variant="small" onClick={() => onPrint(p)}>Print</Button>
                      <Button variant="small" onClick={() => onDelete(p)}>Delete</Button>
                    </span>,
                  ];
                })
          }
          empty="No indents yet."
        />
      </div>
    </Panel>
  );
}

// ---------------------------------------------------------------------------
// Tab: Print and export
// ---------------------------------------------------------------------------

function PrintTab({
  doc,
  prId,
  indents,
  boqCount,
  onDoc,
  onPr,
  onPrintBoq,
  onPrintPr,
  onCsvBoq,
  onCsvPr,
  onNew,
  mayNew,
  onGoPr,
}: {
  doc: 'boq' | 'pr';
  prId: string;
  indents: RecordRow[];
  /** How many BOQ lines the schedule would print; 0 means nothing to export. */
  boqCount: number;
  onDoc: (d: 'boq' | 'pr') => void;
  onPr: (id: string) => void;
  onPrintBoq: () => void;
  onPrintPr: (id: string) => void;
  onCsvBoq: () => void;
  onCsvPr: (id: string) => void;
  onNew: () => void;
  mayNew: boolean;
  onGoPr: () => void;
}) {
  const sel = (
    <select
      value={doc}
      onChange={(e) => onDoc(e.target.value as 'boq' | 'pr')}
      className="w-full rounded px-2.5 py-2 text-[13px]"
      style={{ border: '1px solid var(--line)', background: 'var(--panel)' }}
    >
      <option value="boq">BOQ schedule</option>
      <option value="pr">Indent / PR</option>
    </select>
  );
  const prSel = (
    <select
      value={prId}
      onChange={(e) => onPr(e.target.value)}
      className="w-full rounded px-2.5 py-2 text-[13px]"
      style={{ border: '1px solid var(--line)', background: 'var(--panel)' }}
    >
      {indents.length === 0 ? <option value="">No indents</option> : null}
      {indents.map((p) => (
        <option key={p.id} value={p.id}>{String(p.data.prNo ?? p.ref)} ({fmtDay(p.data.date)})</option>
      ))}
    </select>
  );

  return (
    <>
      <Panel title="Document">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <label className="text-[12px]" style={{ color: 'var(--muted)' }}>
            Format
            <div className="mt-1">{sel}</div>
          </label>
          {doc === 'pr' ? (
            <label className="text-[12px]" style={{ color: 'var(--muted)' }}>
              Indent
              <div className="mt-1">{prSel}</div>
            </label>
          ) : null}
        </div>
        {doc === 'boq' && boqCount === 0 ? (
          <p className="m-0 mb-3 text-[12.5px]" style={{ color: 'var(--muted)' }}>
            No BOQ lines yet — the schedule has nothing to print. Add items on the BOQ tab
            (or import the sheet) and this tab fills in straight away.
          </p>
        ) : null}
        {doc === 'pr' && indents.length === 0 ? (
          <div className="mb-3">
            <p className="m-0 text-[12.5px]" style={{ color: 'var(--muted)' }}>
              No indent / PR documents to print yet.
            </p>
            <div className="mt-2">
              {mayNew ? (
                <Button variant="primary" onClick={onNew}>New indent</Button>
              ) : (
                <Button onClick={onGoPr}>Open Indents / PR</Button>
              )}
            </div>
          </div>
        ) : null}
        <div className="mt-4 flex flex-wrap items-center gap-2">
          {doc === 'boq' ? (
            <>
              <Button variant="primary" disabled={boqCount === 0} onClick={onPrintBoq}>Download print file</Button>
              <Button disabled={boqCount === 0} onClick={onCsvBoq}>Download Excel (CSV)</Button>
            </>
          ) : (
            <>
              <Button variant="primary" disabled={!prId} onClick={() => onPrintPr(prId)}>Download print file</Button>
              <Button disabled={!prId} onClick={() => onCsvPr(prId)}>Download Excel (CSV)</Button>
            </>
          )}
          <span className="text-[12px]" style={{ color: 'var(--muted)' }}>
            The print file opens with the print dialog ready. Choose A4 and “Save as PDF” for a PDF.
          </span>
        </div>
      </Panel>
    </>
  );
}

// A tiny empty state with an optional action.
function Empty({ text, action, onAction }: { text: string; action?: string; onAction?: () => void }) {
  return (
    <div className="py-8 text-center text-[13px]" style={{ color: 'var(--muted)' }}>
      {text}
      {action ? (
        <div className="mt-3">
          <Button variant="primary" onClick={onAction}>{action}</Button>
        </div>
      ) : null}
    </div>
  );
}

// RFC-4180-ish CSV to a browser download. No package: a Blob + an anchor.
function downloadCsv(name: string, rows: (string | number)[][]): void {
  const csv = rows
    .map((r) =>
      r
        .map((c) => {
          const s = String(c ?? '');
          return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
        })
        .join(','),
    )
    .join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}
