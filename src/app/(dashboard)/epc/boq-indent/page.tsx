'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';

import { RecordForm } from '@/components/RecordForm';
import { ImportExcelModal } from '@/components/ImportExcelModal';
import { Button, Chip, DataTable, Grid, KpiGrid, Notice, PageHead, Panel } from '@/components/ui';
import type { ChipTone } from '@/components/ui';
import { toast } from '@/components/toast';
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

const BOQ_KEY = 'boq_register';
const IND_KEY = 'boq_indents';

/** An indent's item line as it is stored: the boq_register ref + quantity. */
interface IndentLine {
  boqRef: string;
  qty: number;
}

/** Rejected indents do not count: they were withdrawn, so the balance comes back. */
const counts = (p: RecordRow): boolean => String(p.data.status ?? '') !== 'Rejected';

/** The stored `lines` table, coerced to a safe shape. */
function linesOf(row: RecordRow): IndentLine[] {
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
const inr = (n: number): string => (n || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
/** Whole-number Indian grouping, for quantities. */
const qtyf = (n: number): string => (n || 0).toLocaleString('en-IN');
/** Today as an ISO day. */
const today = (): string => new Date().toISOString().slice(0, 10);
/** A stored date as 12 Sep 2026, or an em dash when absent. */
const fmtDay = (v: unknown): string => {
  if (v === null || v === undefined || String(v).trim() === '') return '—';
  const d = new Date(String(v));
  if (Number.isNaN(d.getTime())) return String(v);
  return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
};

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

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [t, b, p] = await Promise.all([
        records.type(BOQ_KEY),
        records.list(BOQ_KEY, { limit: 500 }),
        records.list(IND_KEY, { limit: 500 }),
      ]);
      setBoqType(t);
      setBoq(b.items);
      setIndents(p.items);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load the desk');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // --- derived: per-BOQ-ref indented qty and the desk's headline values ----
  const indented = useMemo(() => {
    const byRef = new Map<string, number>();
    for (const p of indents) {
      if (!counts(p)) continue;
      for (const l of linesOf(p)) byRef.set(l.boqRef, (byRef.get(l.boqRef) ?? 0) + l.qty);
    }
    return byRef;
  }, [indents]);

  // BOQ amounts are stored in ₹L; the desk speaks whole rupees.
  const boqValue = useMemo(
    () => boq.reduce((s, r) => s + (Number(r.data.amount) || 0) * 100_000, 0),
    [boq],
  );
  const rateOf = useCallback(
    (ref: string) => Number(boq.find((b) => b.ref === ref)?.data.rate ?? 0),
    [boq],
  );
  const indentValue = useCallback(
    (p: RecordRow) => linesOf(p).reduce((s, l) => s + l.qty * rateOf(l.boqRef), 0),
    [rateOf],
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
          rows: boq.map((b, i) => [
            String(i + 1),
            b.ref,
            String(b.data.description ?? ''),
            String(b.data.unit ?? ''),
            qtyf(Number(b.data.quantity) || 0),
            inr(Number(b.data.rate) || 0),
            inr((Number(b.data.amount) || 0) * 100_000),
          ]),
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
    const total = lines.reduce((s, l) => s + l.qty * rateOf(l.boqRef), 0);
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
            return [
              String(i + 1),
              l.boqRef,
              String(b?.data.description ?? l.boqRef),
              String(b?.data.unit ?? ''),
              qtyf(Number(b?.data.quantity ?? 0)),
              qtyf(l.qty),
              inr(l.qty * rateOf(l.boqRef)),
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
      const q = Number(b.data.quantity) || 0;
      const ind = indented.get(b.ref) ?? 0;
      return [
        b.ref,
        String(b.data.description ?? ''),
        String(b.data.unit ?? ''),
        q,
        Number(b.data.rate) || 0,
        inr(q * (Number(b.data.rate) || 0)),
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
      return [
        l.boqRef,
        String(b?.data.description ?? l.boqRef),
        String(b?.data.unit ?? ''),
        Number(b?.data.quantity ?? 0),
        l.qty,
        rateOf(l.boqRef),
        inr(l.qty * rateOf(l.boqRef)),
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
            />
          ) : null}

          {tab === 'boq' ? (
            <BoqTab
              boq={boq}
              indented={indented}
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
              onDoc={setPtDoc}
              onPr={setPtPr}
              onPrintBoq={printBoq}
              onPrintPr={printIndent}
              onCsvBoq={exportCsvBoq}
              onCsvPr={exportCsvIndent}
            />
          ) : null}
        </>
      ) : null}

      {/* BOQ line editor — the generic record form over the BOQ register. */}
      {boqType && boqForm ? (
        <RecordForm
          type={boqType}
          record={boqForm === 'new' ? null : boqForm}
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
          onSaved={() => {
            setDlg(null);
            void load();
          }}
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
}: {
  boq: RecordRow[];
  indents: RecordRow[];
  indented: Map<string, number>;
  boqValue: number;
  indentedValue: number;
  awaiting: number;
  indentValue: (p: RecordRow) => number;
  onGo: (t: 'boq' | 'pr') => void;
}) {
  // Items indented above their BOQ quantity — the desk's key red flag.
  const over = boq
    .map((b) => ({ b, q: Number(b.data.quantity) || 0, i: indented.get(b.ref) ?? 0 }))
    .filter((r) => r.i > r.q + 1e-9)
    .slice(0, 8);

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
            <Empty text="No indents raised yet." action="New indent" onAction={() => onGo('pr')} />
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
                    <Chip tone="bad">{qtyf(r.i)} of {qtyf(r.q)} {String(r.b.data.unit ?? '')}</Chip>
                  </span>
                </div>
              ))}
            </div>
          )}
        </Panel>
      </Grid>
    </>
  );
}

// ---------------------------------------------------------------------------
// Tab: BOQ
// ---------------------------------------------------------------------------

function BoqTab({
  boq,
  indented,
  mayCreate,
  onAdd,
  onEdit,
  onImport,
  onDelete,
}: {
  boq: RecordRow[];
  indented: Map<string, number>;
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

  // The filtered total, so a search reads like a sub-ledger.
  const total = rows.reduce((s, b) => s + (Number(b.data.quantity) || 0) * (Number(b.data.rate) || 0), 0);

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
                  const rate = Number(b.data.rate) || 0;
                  const ind = indented.get(b.ref) ?? 0;
                  const bal = q - ind;
                  return [
                    <span key="ref" className="num text-[12px]" style={{ color: 'var(--muted)' }}>{b.ref}</span>,
                    String(b.data.description ?? ''),
                    String(b.data.unit ?? ''),
                    <span key="qty" className="num">{qtyf(q)}</span>,
                    <span key="rate" className="num">₹{inr(rate)}</span>,
                    <span key="amt" className="num">₹{inr(q * rate)}</span>,
                    <span key="ind" className="num">{qtyf(ind)}</span>,
                    <span key="bal" className="num" style={bal < 0 ? { color: 'var(--danger)' } : undefined}>{qtyf(bal)}</span>,
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
  onDoc,
  onPr,
  onPrintBoq,
  onPrintPr,
  onCsvBoq,
  onCsvPr,
}: {
  doc: 'boq' | 'pr';
  prId: string;
  indents: RecordRow[];
  onDoc: (d: 'boq' | 'pr') => void;
  onPr: (id: string) => void;
  onPrintBoq: () => void;
  onPrintPr: (id: string) => void;
  onCsvBoq: () => void;
  onCsvPr: (id: string) => void;
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
        <div className="mt-4 flex flex-wrap items-center gap-2">
          {doc === 'boq' ? (
            <>
              <Button variant="primary" onClick={onPrintBoq}>Download print file</Button>
              <Button onClick={onCsvBoq}>Download Excel (CSV)</Button>
            </>
          ) : (
            <>
              <Button variant="primary" onClick={() => onPrintPr(prId)}>Download print file</Button>
              <Button onClick={() => onCsvPr(prId)}>Download Excel (CSV)</Button>
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

// ---------------------------------------------------------------------------
// The indent dialog — the desk's real value: pick BOQ lines, cap at balance.
// ---------------------------------------------------------------------------

function IndentDialog({
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
  onSaved: () => void;
}) {
  const inp = 'w-full rounded px-2.5 py-[6px] text-[13px] outline-none';
  const inpStyle: React.CSSProperties = { border: '1px solid var(--line)', background: 'var(--panel)', color: 'var(--text)' };

  // The head fields start from the existing row, or fresh with a suggested no.
  const [prNo, setPrNo] = useState(existing ? String(existing.data.prNo ?? '') : suggestNo);
  const [date, setDate] = useState(existing ? fmtDay(existing.data.date) : today());
  const [needBy, setNeedBy] = useState(existing ? fmtDay(existing.data.needBy) : '');
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

  const rateOf = (ref: string): number => Number(boq.find((b) => b.ref === ref)?.data.rate ?? 0);

  // When editing, this indent's own lines were already counted in `indented`,
  // so give them back before comparing against the balance.
  const myOwn = useMemo(() => {
    const m = new Map<string, number>();
    for (const l of existing ? linesOf(existing) : []) m.set(l.boqRef, l.qty);
    return m;
  }, [existing]);
  const balanceOf = (b: RecordRow): number =>
    (Number(b.data.quantity) || 0) - (indented.get(b.ref) ?? 0) + (myOwn.get(b.ref) ?? 0);

  const shown = useMemo(() => {
    const f = dq.trim().toLowerCase();
    if (!f) return boq;
    return boq.filter((b) => (b.ref + ' ' + String(b.data.description ?? '')).toLowerCase().includes(f));
  }, [boq, dq]);

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
      if (n > bal + 1e-9 && !firstErr) {
        firstErr = `Item ${b.ref}: indent qty ${qtyf(n)} is above the balance of ${qtyf(bal)}.`;
      }
      lines.push({ boqRef: b.ref, qty: n });
    }
    if (lines.length === 0) firstErr = firstErr || 'Enter an indent quantity for at least one item.';
    if (!prNo.trim()) firstErr = firstErr || 'PR number is required.';
    if (firstErr) {
      setErr(firstErr);
      return;
    }

    setBusy(true);
    setErr('');
    try {
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
      if (existing) await records.update(IND_KEY, existing.id, body);
      else await records.create(IND_KEY, body);
      onSaved();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Could not save the indent');
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
      <div className="max-h-[92vh] w-full max-w-3xl overflow-y-auto rounded-lg" style={{ background: 'var(--panel)', border: '1px solid var(--line)' }}>
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
              {nSel} item{nSel === 1 ? '' : 's'} selected · ₹{inr(total)}
            </span>
          </div>

          <div className="mt-2 max-h-[38vh] overflow-auto rounded" style={{ border: '1px solid var(--line)' }}>
            <table className="w-full border-collapse text-[12.5px]">
              <thead style={{ background: 'var(--panel-2)' }}>
                <tr>
                  {['Item no', 'Description', 'BOQ qty', 'Balance', 'Indent qty'].map((h, i) => (
                    <th
                      key={i}
                      className="px-2 py-1 text-[11px] font-semibold"
                      style={{
                        border: '1px solid var(--line)',
                        color: 'var(--muted)',
                        textAlign: i >= 2 && i <= 4 ? 'right' : 'left',
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
                    <td colSpan={5} className="px-3 py-6 text-center" style={{ color: 'var(--muted)' }}>
                      {boq.length === 0 ? 'Add BOQ items first.' : 'No items match the filter.'}
                    </td>
                  </tr>
                ) : (
                  shown.map((b) => {
                    const bal = balanceOf(b);
                    const v = q[b.ref] ?? '';
                    const over = Number(v) > bal + 1e-9;
                    return (
                      <tr key={b.id}>
                        <td className="num px-2 py-1.5" style={{ border: '1px solid var(--line)', color: 'var(--muted)' }}>{b.ref}</td>
                        <td className="px-2 py-1.5" style={{ border: '1px solid var(--line)' }}>{String(b.data.description ?? '')}</td>
                        <td className="num px-2 py-1.5 text-right" style={{ border: '1px solid var(--line)' }}>
                          <span title="BOQ qty">{qtyf(Number(b.data.quantity) || 0)}</span>
                        </td>
                        <td className="num px-2 py-1.5 text-right" style={{ border: '1px solid var(--line)', color: bal < 0 ? 'var(--danger)' : undefined }} title="Balance">
                          {qtyf(bal)}
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
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>

          <p className="mt-2 min-h-[16px] text-[12.5px]" style={{ color: err ? 'var(--danger)' : 'var(--muted)' }}>
            {err || 'Quantities are checked against the BOQ balance, so you cannot indent more than was bid.'}
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
