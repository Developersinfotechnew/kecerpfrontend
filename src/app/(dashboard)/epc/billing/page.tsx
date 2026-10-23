'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';

import { RecordForm } from '@/components/RecordForm';
import { Bar, Button, Chip, DataTable, Feed, Grid, Notice, PageHead, Panel, VitalsRail } from '@/components/ui';
import { records } from '@/lib/services';
import type { RecordRow, RecordType } from '@/lib/types';

const BILLS_KEY = 'ra_bills';
const FOLLOWUPS_KEY = 'billing_followups';
const RECEIPTS_KEY = 'collection_receipts';

const BILL_TONE: Record<string, 'ok' | 'info' | 'warn' | 'bad' | 'mute'> = {
  'Awaiting certification': 'warn',
  Certified: 'info',
  Overdue: 'bad',
  Settled: 'ok',
  'Part received': 'info',
};

const FU_TONE: Record<string, 'ok' | 'info' | 'warn' | 'bad'> = {
  Unresolved: 'warn',
  'In progress': 'info',
  Cleared: 'ok',
};

const DAY = 86_400_000;

/** Collection ageing buckets, oldest first, measured in days past due. */
const BUCKETS = [
  { label: '0–30 days', max: 30 },
  { label: '31–45 days', max: 45 },
  { label: '46–60 days', max: 60 },
  { label: 'Above 60 days', max: Infinity },
];

const money = (n: number) =>
  n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** Billing and collection — every figure derived from stored bills. */
export default function EpcBillingPage() {
  const [billType, setBillType] = useState<RecordType | null>(null);
  const [fuType, setFuType] = useState<RecordType | null>(null);
  const [bills, setBills] = useState<RecordRow[]>([]);
  const [followups, setFollowups] = useState<RecordRow[]>([]);
  const [receipts, setReceipts] = useState<RecordRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState<{ type: RecordType; row: RecordRow | null } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [billsRes, fuRes, receiptsPage] = await Promise.all([
        Promise.all([records.type(BILLS_KEY), records.list(BILLS_KEY, { limit: 300 })]),
        Promise.all([records.type(FOLLOWUPS_KEY), records.list(FOLLOWUPS_KEY, { limit: 100 })]),
        records.list(RECEIPTS_KEY, { limit: 300 }),
      ]);
      setBillType(billsRes[0]);
      setFuType(fuRes[0]);
      setBills(billsRes[1].items);
      setFollowups(fuRes[1].items);
      setReceipts(receiptsPage.items);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load billing records');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // Rollups. Ageing only counts bills that are still open and past due — a
  // settled bill cannot be overdue, whatever its old due date was.
  const stats = useMemo(() => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    let billed = 0;
    let collected = 0;
    let retention = 0;
    let overdueTotal = 0;
    const bucketTotals = [0, 0, 0, 0];
    const openBills: { ref: string; outstanding: number; daysOver: number }[] = [];

    for (const b of bills) {
      const gross = Number(b.data.gross) || 0;
      const held = Number(b.data.retention) || 0;
      const got = Number(b.data.received) || 0;
      const status = String(b.data.status ?? '');
      const due = parseDate(b.data.dueDate);

      billed += gross;
      collected += got;
      if (status === 'Settled' && got < gross) {
        // Retention typically clears at handover, so a settled bill still
        // holds its stated retention amount.
        retention += held;
      }

      const outstanding = Math.max(0, gross - got);
      if (outstanding === 0) continue;

      if (!due) continue;
      const daysOver = Math.floor((today.getTime() - due.getTime()) / DAY);
      if (daysOver <= 0) continue;

      overdueTotal += outstanding;
      bucketTotals[BUCKETS.findIndex((bk) => daysOver <= bk.max)] += outstanding;
      openBills.push({ ref: b.ref, outstanding, daysOver });
    }

    return {
      billed,
      collected,
      outstanding: Math.max(0, billed - collected),
      retention,
      overdueTotal,
      overduePct: overdueTotal > 0 ? Math.min(100, Math.round((overdueTotal / Math.max(overdueTotal, billed)) * 100)) : 0,
      buckets: bucketTotals,
      maxBucket: Math.max(1, ...bucketTotals),
      openCount: openBills.length,
    };
  }, [bills]);

  return (
    <>
      <PageHead
        title="Billing & collection"
        description="Milestone and RA billing with retention, due dates and collection follow-up."
        actions={
          <>
            <Button
              onClick={() => fuType && setForm({ type: fuType, row: null })}
            >
              Log follow-up
            </Button>
            <Button
              variant="primary"
              onClick={() => billType && setForm({ type: billType, row: null })}
            >
              Raise RA bill
            </Button>
          </>
        }
      />

      {error ? <Notice>{error}</Notice> : null}

      <VitalsRail
        items={[
          {
            label: 'Billed to date',
            value: `₹${money(stats.billed)}L`,
            note: `${bills.length} bills raised`,
          },
          {
            label: 'Collected',
            value: `₹${money(stats.collected)}L`,
            unit: stats.billed > 0 ? `${Math.round((stats.collected / stats.billed) * 100)}%` : undefined,
            pct: stats.billed > 0 ? Math.round((stats.collected / stats.billed) * 100) : 0,
          },
          {
            label: 'Outstanding',
            value: `₹${money(stats.outstanding)}L`,
            note: `${stats.openCount} open bill${stats.openCount === 1 ? '' : 's'}`,
          },
          {
            label: 'Overdue',
            value: `₹${money(stats.overdueTotal)}L`,
            unit: stats.openCount > 0 ? `${Math.round((stats.overdueTotal / Math.max(stats.outstanding, 1)) * 100)}%` : undefined,
            tone: stats.overdueTotal > 0 ? 'bad' : undefined,
          },
          {
            label: 'Retention held',
            value: `₹${money(stats.retention)}L`,
            note: 'Releasable at handover',
          },
        ]}
      />

      <div className="mt-[18px]" />

      <Panel title="Bills" sub={loading ? 'Loading' : `${bills.length} raised`} bodyless>
        <DataTable
          columns={[
            { key: 'b', label: 'Bill No.' },
            { key: 'm', label: 'Milestone / period' },
            { key: 'g', label: 'Gross (₹L)', align: 'right' },
            { key: 'r', label: 'Retention', align: 'right' },
            { key: 'n', label: 'Net payable', align: 'right' },
            { key: 'd', label: 'Due date' },
            { key: 'mq', label: 'Measured qty', align: 'right' },
            { key: 'cert', label: 'Certified' },
            { key: 'rc', label: 'Received', align: 'right' },
            { key: 's', label: 'Status', align: 'right' },
            { key: 'edit', label: '' },
          ]}
          rows={
            bills.length === 0
              ? [
                  [loading ? 'Loading bills…' : 'No bills yet. Use Raise RA bill.'],
                ]
              : bills.map((r): React.ReactNode[] => {
                  const status = String(r.data.status ?? '');
                  const got = Number(r.data.received) || 0;
                  return [
                    <Code key="b">{r.ref}</Code>,
                    String(r.data.milestone ?? ''),
                    <span key="g" className="num">{money(Number(r.data.gross) || 0)}</span>,
                    <span key="r" className="num">{money(Number(r.data.retention) || 0)}</span>,
                    <span key="n" className="num">{money(Number(r.data.netPayable) || 0)}</span>,
                    formatDay(r.data.dueDate),
                    <span key="mq" className="num">
                      {r.data.measuredQty ? String(r.data.measuredQty) : '—'}
                    </span>,
                    <span key="cert" className="text-[12px]" style={{ color: 'var(--muted)' }}>
                      {r.data.certifiedBy ? String(r.data.certifiedBy) : '—'}
                      {r.data.certifiedOn ? ` · ${formatDay(r.data.certifiedOn)}` : ''}
                    </span>,
                    <span key="rc" className="num">
                      {got > 0 ? money(got) : '—'}
                    </span>,
                    <Chip key="s" tone={BILL_TONE[status] ?? 'mute'}>{status}</Chip>,
                    <Button key="edit" onClick={() => setForm({ type: billType!, row: r })}>
                      Edit
                    </Button>,
                  ];
                })
          }
        />
      </Panel>

      <div className="mt-[18px]" />

      <Grid cols={2}>
        <Panel title="Collection ageing" sub="Open bills past their due date" bodyless>
          <DataTable
            columns={[
              { key: 'b', label: 'Bucket' },
              { key: 'a', label: 'Amount (₹L)', align: 'right' },
              { key: 's', label: 'Share' },
            ]}
            rows={BUCKETS.map((bk, i) => [
              bk.label,
              <span key="a" className="num">{money(stats.buckets[i] ?? 0)}</span>,
              <Bar
                key="s"
                pct={Math.round(((stats.buckets[i] ?? 0) / stats.maxBucket) * 100)}
                tone={bk.label === 'Above 60 days' ? 'bad' : undefined}
              />,
            ])}
          />
        </Panel>

        <Panel title="Follow-up log" sub={`${followups.length} entries`}>
          {followups.length === 0 ? (
            <p className="m-0 p-4 text-[12.5px]" style={{ color: 'var(--muted)' }}>
              {loading ? 'Loading…' : 'No follow-ups logged. Use Log follow-up.'}
            </p>
          ) : (
            <Feed
              items={followups.map((f) => ({
                tone: FU_TONE[String(f.data.tone)] ?? 'warn',
                text: String(f.data.note ?? ''),
                meta: `${String(f.data.billRef ?? '')}${f.data.method ? ` · ${f.data.method}` : ''}`,
                time: relative(f.data.raisedOn),
              }))}
            />
          )}
        </Panel>
      </Grid>

      <div className="mt-[18px]" />

      <Panel
        title="Collection receipts"
        sub={loading ? 'Loading' : `${receipts.length} receipts · ₹${money(receipts.reduce((s, r) => s + (Number(r.data.amount) || 0), 0))}L booked`}
        bodyless
      >
        <DataTable
          columns={[
            { key: 'ref', label: 'Receipt No.' },
            { key: 'bill', label: 'Against bill' },
            { key: 'amt', label: 'Amount (₹L)', align: 'right' },
            { key: 'date', label: 'Received on' },
            { key: 'payref', label: 'Payment reference' },
            { key: 'method', label: 'Method' },
            { key: 'against', label: 'Settles' },
            { key: 'status', label: 'Status', align: 'right' },
          ]}
          rows={
            receipts.length === 0
              ? [[loading ? 'Loading receipts…' : 'No receipts recorded. Open Collection receipts under Commercial.']]
              : receipts.map((r): React.ReactNode[] => [
                  <Code key="ref">{r.ref}</Code>,
                  <Code key="bill">{String(r.data.billRef ?? '')}</Code>,
                  <span key="amt" className="num">{money(Number(r.data.amount) || 0)}</span>,
                  formatDay(r.data.receivedOn),
                  <span key="payref" className="num text-[12px]" style={{ color: 'var(--muted)' }}>
                    {String(r.data.reference ?? '') || '—'}
                  </span>,
                  String(r.data.method ?? ''),
                  <Chip key="against" tone={r.data.against === 'Retention release' ? 'info' : 'mute'}>
                    {String(r.data.against ?? '')}
                  </Chip>,
                  <Chip key="status" tone={String(r.data.status) === 'Reconciled' ? 'ok' : 'warn'}>
                    {String(r.data.status ?? '')}
                  </Chip>,
                ])
          }
        />
      </Panel>

      {form ? (
        <RecordForm
          type={form.type}
          record={form.row}
          onCancel={() => setForm(null)}
          onSubmit={async (body) => {
            const key = form.type.key;
            if (form.row) {
              await records.update(key, form.row.id, body);
            } else {
              await records.create(key, body);
            }
            setForm(null);
            void load();
          }}
        />
      ) : null}
    </>
  );
}

function Code({ children }: { children: React.ReactNode }) {
  return (
    <span className="num text-[12px]" style={{ color: 'var(--muted)' }}>
      {children}
    </span>
  );
}

function parseDate(value: unknown): Date | null {
  if (value === null || value === undefined || value === '') return null;
  const d = new Date(String(value));
  return Number.isNaN(d.getTime()) ? null : d;
}

function formatDay(value: unknown): string {
  const d = parseDate(value);
  if (!d) return '—';
  return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}

/** Compact relative label for a follow-up entry. */
function relative(value: unknown): string {
  const d = parseDate(value);
  if (!d) return '';
  const days = Math.floor((Date.now() - d.getTime()) / DAY);
  if (days <= 0) return 'today';
  if (days < 7) return `${days}d`;
  if (days < 30) return `${Math.floor(days / 7)}w`;
  return `${Math.floor(days / 30)}mo`;
}
