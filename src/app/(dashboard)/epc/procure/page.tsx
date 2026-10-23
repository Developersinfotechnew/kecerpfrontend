'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';

import { RecordForm } from '@/components/RecordForm';
import { Bar, Button, Chip, DataTable, Flow, Notice, PageHead, Panel } from '@/components/ui';
import { records, vendorScores, type VendorScoreResult } from '@/lib/services';
import type { RecordRow, RecordType } from '@/lib/types';

const PR_KEY = 'purchase_requirements';
const PO_KEY = 'purchase_orders';

const PRIO_TONE: Record<string, 'ok' | 'info' | 'warn' | 'bad' | 'mute'> = {
  High: 'bad',
  Medium: 'warn',
  Low: 'mute',
};
/**
 * The priority a queue item or row is missing on. Records created before the
 * priority field existed have no value; treat the absence as Medium so the
 * chip never renders blank and the column stays aligned.
 */
const PRIO_DEFAULT = 'Medium';

const PR_TONE: Record<string, 'ok' | 'info' | 'warn' | 'bad' | 'mute'> = {
  'Site requirement': 'mute',
  'BOQ check': 'mute',
  'Commercial approval': 'warn',
  'PM approval': 'warn',
  'Mgmt approval': 'warn',
  'RFQ sent': 'info',
  'Quotes received': 'info',
  'PO raised': 'ok',
  'Budget check failed': 'bad',
  'BOQ not approved': 'bad',
};

const PO_TONE: Record<string, 'ok' | 'info' | 'warn' | 'bad' | 'mute'> = {
  'Not started': 'mute',
  'In production': 'info',
  'Part received': 'info',
  'On track': 'ok',
  Delayed: 'bad',
  Delivered: 'ok',
  Closed: 'mute',
};

const money = (n: number) => n.toLocaleString('en-IN', { maximumFractionDigits: 0 });

/** Purchase and procurement — requirements and orders, both read from records. */
export default function EpcProcurePage() {
  const [prType, setPrType] = useState<RecordType | null>(null);
  const [poType, setPoType] = useState<RecordType | null>(null);
  const [prs, setPrs] = useState<RecordRow[]>([]);
  const [pos, setPos] = useState<RecordRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState<{ type: RecordType; row: RecordRow | null } | null>(null);
  const [scores, setScores] = useState<VendorScoreResult | null>(null);
  const [scoring, setScoring] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [[prTypeRes, prPage], [poTypeRes, poPage]] = await Promise.all([
        Promise.all([records.type(PR_KEY), records.list(PR_KEY, { limit: 300 })]),
        Promise.all([records.type(PO_KEY), records.list(PO_KEY, { limit: 300 })]),
      ]);
      setPrType(prTypeRes);
      setPoType(poTypeRes);
      setPrs(prPage.items);
      setPos(poPage.items);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load procurement records');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // Counts drive the stage flow. The requirement furthest along decides how far
  // down the line the current cycle has reached.
  const stats = useMemo(() => {
    let awaitingApproval = 0;
    let blocked = 0;
    let openPoValue = 0;
    let delayed = 0;

    for (const pr of prs) {
      const stage = String(pr.data.stage ?? '');
      if (stage === 'Commercial approval' || stage === 'PM approval' || stage === 'Mgmt approval') awaitingApproval += 1;
      if (stage === 'Budget check failed' || stage === 'BOQ not approved') blocked += 1;
    }

    for (const po of pos) {
      const status = String(po.data.status ?? '');
      if (status !== 'Delivered' && status !== 'Closed') {
        openPoValue += Number(po.data.value) || 0;
      }
      if (status === 'Delayed') delayed += 1;
    }

    return { awaitingApproval, blocked, openPoValue, delayed };
  }, [prs, pos]);

  return (
    <>
      <PageHead
        title="Purchase & procurement"
        description="Site requirement is validated against the approved BOQ and remaining budget before it can move to quotation and order."
        actions={
          <>
            <Button>Compare quotations</Button>
            <Button
              disabled={scoring}
              onClick={async () => {
                setScoring(true);
                try {
                  setScores(await vendorScores.compute());
                } catch {
                  // silent: a failure leaves scores null
                } finally {
                  setScoring(false);
                }
              }}
            >
              {scoring ? 'Scoring…' : 'Score vendors'}
            </Button>
            <Button
              variant="primary"
              onClick={() => prType && setForm({ type: prType, row: null })}
            >
              Raise purchase requirement
            </Button>
          </>
        }
      />

      {error ? <Notice>{error}</Notice> : null}

      <Panel title="How a requirement becomes an order">
        <Flow
          steps={[
            { label: 'Site requirement', state: 'done' },
            { label: 'BOQ & budget check', state: 'done' },
            { label: 'PM approval', state: 'done' },
            { label: 'Management approval', state: 'now' },
            { label: 'RFQ to vendors', state: 'todo' },
            { label: 'Quote comparison', state: 'todo' },
            { label: 'Purchase order', state: 'todo' },
            { label: 'Delivery & GRN', state: 'todo' },
          ]}
        />
      </Panel>

      <div className="mt-[18px]" />

      <Vitals
        prs={prs.length}
        pos={pos.length}
        awaitingApproval={stats.awaitingApproval}
        openPoValue={stats.openPoValue}
        delayed={stats.delayed}
      />

      <div className="mt-[18px]" />

      <Panel
        title="Purchase requirements"
        sub={loading ? 'Loading' : `${prs.length} raised · ${stats.awaitingApproval} awaiting approval`}
        bodyless
      >
        <DataTable
          columns={[
            { key: 'pr', label: 'PR No.' },
            { key: 'p', label: 'Priority' },
            { key: 'i', label: 'Item' },
            { key: 'b', label: 'BOQ ref' },
            { key: 'q', label: 'Qty' },
            { key: 'r', label: 'Required by' },
            { key: 'v', label: 'Value', align: 'right' },
            { key: 's', label: 'Stage', align: 'right' },
            { key: 'edit', label: '' },
          ]}
          rows={
            prs.length === 0
              ? [
                  [
                    loading
                      ? 'Loading requirements…'
                      : 'No purchase requirements yet. Use Raise purchase requirement.',
                  ],
                ]
              : prs.map((r): React.ReactNode[] => {
                  const stage = String(r.data.stage ?? '');
                  const priority = r.data.priority ? String(r.data.priority) : PRIO_DEFAULT;
                  return [
                    <Code key="pr">{r.ref}</Code>,
                    <Chip key="p" tone={PRIO_TONE[priority] ?? 'mute'}>{priority}</Chip>,
                    String(r.data.item ?? ''),
                    r.data.boqRef ? <Code key="b">{String(r.data.boqRef)}</Code> : '—',
                    String(r.data.quantity ?? ''),
                    formatDay(r.data.requiredBy),
                    <span key="v" className="num">{`₹${money(Number(r.data.value) || 0)}L`}</span>,
                    <Chip key="s" tone={PR_TONE[stage] ?? 'mute'}>{stage}</Chip>,
                    <Button
                      key="edit"
                      onClick={() => setForm({ type: prType!, row: r })}
                    >
                      Edit
                    </Button>,
                  ];
                })
          }
        />
      </Panel>

      <div className="mt-[18px]" />

      <Panel
        title="Open purchase orders"
        sub={loading ? 'Loading' : `${pos.length} orders · ${stats.delayed} delayed`}
        bodyless
        actions={
          poType ? (
            <Button onClick={() => setForm({ type: poType, row: null })}>Raise purchase order</Button>
          ) : undefined
        }
      >
        <DataTable
          columns={[
            { key: 'po', label: 'PO No.' },
            { key: 'v', label: 'Vendor' },
            { key: 'i', label: 'Item' },
            { key: 'val', label: 'PO value', align: 'right' },
            { key: 'p', label: 'Promised' },
            { key: 'r', label: 'Received' },
            { key: 's', label: 'Status', align: 'right' },
            { key: 'edit', label: '' },
          ]}
          rows={
            pos.length === 0
              ? [[loading ? 'Loading orders…' : 'No purchase orders yet.']]
              : pos.map((r): React.ReactNode[] => {
                  const status = String(r.data.status ?? '');
                  const pct = Math.min(100, Math.max(0, Math.round(Number(r.data.receivedPct) || 0)));
                  return [
                    <Code key="po">{r.ref}</Code>,
                    String(r.data.vendor ?? ''),
                    String(r.data.item ?? ''),
                    <span key="val" className="num">{`₹${money(Number(r.data.value) || 0)}L`}</span>,
                    formatDay(r.data.promised),
                    <Bar key="b" pct={pct} tone={status === 'Delayed' ? 'warn' : undefined} />,
                    <Chip key="s" tone={PO_TONE[status] ?? 'mute'}>{status}</Chip>,
                    <Button
                      key="edit"
                      onClick={() => setForm({ type: poType!, row: r })}
                    >
                      Edit
                    </Button>,
                  ];
                })
          }
        />
      </Panel>

      {scores && scores.scored.length > 0 ? (
        <>
          <div className="mt-[18px]" />
          <Panel
            title="Vendor performance"
            sub={`Auto-scored from GRN/PO data · ${scores.scored.length} vendors · ${scores.noHistory.length} with no delivery history`}
            bodyless
          >
            <DataTable
              columns={[
                { key: 'v', label: 'Vendor' },
                { key: 'ontime', label: 'On-time %', align: 'right' },
                { key: 'rej', label: 'Rejection %', align: 'right' },
                { key: 'resp', label: 'Responsiveness', align: 'right' },
                { key: 'score', label: 'Overall', align: 'right' },
                { key: 'grade', label: 'Grade', align: 'right' },
              ]}
              rows={scores.scored.map((r) => [
                r.vendor,
                <span key="o" className="num">{r.onTimeDeliveryPct}%</span>,
                <span key="r" className="num">{r.qualityRejectionPct}%</span>,
                <span key="s" className="num">{r.responsivenessScore.toFixed(1)}</span>,
                <span key="sc" className="num">{r.overallScore}</span>,
                <Chip key="g" tone={r.grade === 'A' ? 'ok' : r.grade === 'B' ? 'info' : r.grade === 'C' ? 'warn' : 'bad'}>
                  {r.grade}
                </Chip>,
              ])}
            />
            {scores.noHistory.length > 0 ? (
              <div
                className="flex flex-wrap items-center gap-2 px-4 py-2.5 text-[12px]"
                style={{ borderTop: '1px solid var(--line-2)', color: 'var(--muted)', background: 'var(--panel-2)' }}
              >
                <span className="font-medium" style={{ color: 'var(--ink)' }}>No delivery history yet:</span>
                {scores.noHistory.map((v) => (
                  <Chip key={v} tone="mute">{v}</Chip>
                ))}
              </div>
            ) : null}
          </Panel>
        </>
      ) : null}

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

/** Vitals rail for the procurement cycle, all computed from stored rows. */
function Vitals({
  prs,
  pos,
  awaitingApproval,
  openPoValue,
  delayed,
}: {
  prs: number;
  pos: number;
  awaitingApproval: number;
  openPoValue: number;
  delayed: number;
}) {
  const items = [
    { label: 'Purchase requirements', value: String(prs), note: 'raised' },
    {
      label: 'Awaiting approval',
      value: String(awaitingApproval),
      note: 'PM or management',
      tone: awaitingApproval > 0 ? ('warn' as const) : undefined,
    },
    { label: 'Purchase orders', value: String(pos), note: 'raised' },
    { label: 'Open PO value', value: `₹${money(openPoValue)}L`, note: 'not yet delivered' },
    {
      label: 'Delayed orders',
      value: String(delayed),
      note: 'past promised date',
      tone: delayed > 0 ? ('bad' as const) : undefined,
    },
  ];

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
          <div
            className="num flex items-baseline gap-[7px] text-[19px] font-semibold tracking-tight"
            style={{ color: it.tone === 'bad' ? 'var(--red)' : it.tone === 'warn' ? 'var(--amber)' : undefined }}
          >
            {it.value}
          </div>
          <div className="mt-[3px] text-[11.5px]" style={{ color: 'var(--muted)' }}>
            {it.note}
          </div>
        </div>
      ))}
    </div>
  );
}

/** Renders a stored date as 12 Sep 2026, or an em dash when absent. */
function formatDay(value: unknown): string {
  if (value === null || value === undefined || value === '') return '—';
  const d = new Date(String(value));
  if (Number.isNaN(d.getTime())) return String(value);
  return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}
