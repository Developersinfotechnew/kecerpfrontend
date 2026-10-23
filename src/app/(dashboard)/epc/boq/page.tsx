'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';

import { RecordForm } from '@/components/RecordForm';
import { Button, Chip, DataTable, Notice, PageHead, Panel, VitalsRail } from '@/components/ui';
import { records } from '@/lib/services';
import type { RecordRow, RecordType } from '@/lib/types';

/** BOQ register key. The fields come from record.seed.ts, not from this file. */
const BOQ_KEY = 'boq_register';

const STATUS_TONE: Record<string, 'ok' | 'info' | 'warn' | 'bad' | 'mute'> = {
  'Pending approval': 'warn',
  Approved: 'ok',
  'PR raised': 'info',
  'PO raised': 'info',
  'Partially received': 'info',
  Received: 'ok',
  Superseded: 'mute',
};

/** BOQ and estimation — every total below is computed from stored rows. */
export default function EpcBoqPage() {
  const [type, setType] = useState<RecordType | null>(null);
  const [rows, setRows] = useState<RecordRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<RecordRow | null>(null);
  const [filter, setFilter] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [typeRes, page] = await Promise.all([
        records.type(BOQ_KEY),
        records.list(BOQ_KEY, { limit: 500 }),
      ]);
      setType(typeRes);
      setRows(page.items);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load the BOQ');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const visible = useMemo(() => {
    if (!filter.trim()) return rows;
    const q = filter.trim().toLowerCase();
    return rows.filter((r) =>
      [r.ref, r.data.description, r.data.trade, r.data.vendor, r.data.status]
        .map((v) => String(v ?? '').toLowerCase())
        .some((v) => v.includes(q)),
    );
  }, [rows, filter]);

  // Rollups. Each one sums the stored rows, so they move when the data moves.
  const totals = useMemo(() => {
    let value = 0;
    let ordered = 0;
    let approved = 0;
    let pending = 0;
    let overQty = 0;

    for (const r of rows) {
      const qty = Number(r.data.quantity) || 0;
      const rate = Number(r.data.rate) || 0;
      const amount = Number(r.data.amount) || 0;
      const status = String(r.data.status ?? '');
      const orderedQty = Number(r.data.orderedQty) || 0;

      value += amount;
      if (status === 'Approved' || status === 'PR raised' || status === 'PO raised') {
        approved += amount;
      }
      if (status === 'Pending approval') pending += 1;
      if (qty > 0 && orderedQty > qty) overQty += 1;
    }

    return {
      value,
      approved,
      orderedPct: value > 0 ? Math.round((approved / value) * 100) : 0,
      pending,
      overQty,
      lines: rows.length,
    };
  }, [rows]);

  const pctText = (qty: number, orderedQty: number) => {
    if (!qty) return '—';
    return `${Math.min(100, Math.round((orderedQty / qty) * 100))}%`;
  };

  const money = (n: number) =>
    n.toLocaleString('en-IN', { maximumFractionDigits: 0 });

  return (
    <>
      <PageHead
        title="BOQ & estimation"
        description="The approved BOQ is the reference for every purchase requirement and every unit of material consumed on site. Revisions are versioned and re-approved."
        actions={
          <>
            <Button>Import from Excel</Button>
            <Button>Revision history</Button>
            <Button
              variant="primary"
              onClick={() => {
                setEditing(null);
                setFormOpen(true);
              }}
            >
              Add BOQ item
            </Button>
          </>
        }
      />

      {error ? <Notice>{error}</Notice> : null}

      <VitalsRail
        items={[
          {
            label: 'BOQ value',
            value: `₹${money(totals.value)}L`,
            note: `${totals.lines} line items`,
          },
          {
            label: 'Approved value',
            value: `₹${money(totals.approved)}L`,
            unit: `${totals.orderedPct}%`,
            pct: totals.orderedPct,
          },
          {
            label: 'Pending approval',
            value: String(totals.pending),
            note: 'blocked from procurement',
            tone: totals.pending > 0 ? ('warn' as const) : undefined,
          },
          {
            label: 'Over BOQ qty',
            value: String(totals.overQty),
            note: 'ordered beyond the BOQ quantity',
            tone: totals.overQty > 0 ? ('bad' as const) : undefined,
          },
        ]}
      />

      <div className="mt-[18px]" />

      <Panel
        title="BOQ line items"
        sub={loading ? 'Loading' : `Showing ${visible.length} of ${rows.length}`}
        bodyless
      >
        <div className="p-3">
          <input
            type="search"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Search code, description, trade or vendor…"
            className="w-full rounded px-2.5 py-2 text-[13px] outline-none sm:w-80"
            style={{
              background: 'var(--panel-2)',
              border: '1px solid var(--line)',
              color: 'var(--ink)',
            }}
          />
        </div>

        <DataTable
          columns={[
            { key: 'ref', label: 'Code' },
            { key: 'd', label: 'Description' },
            { key: 'u', label: 'Unit' },
            { key: 'q', label: 'BOQ qty', align: 'right' },
            { key: 'r', label: 'Rate (₹)', align: 'right' },
            { key: 'a', label: 'Amount (₹L)', align: 'right' },
            { key: 'o', label: 'Ordered', align: 'right' },
            { key: 's', label: 'Status', align: 'right' },
            { key: 'edit', label: '' },
          ]}
          rows={
            visible.length === 0
              ? [
                  [
                    loading
                      ? 'Loading BOQ items…'
                      : 'No BOQ items yet. Use Add BOQ item to create the first one.',
                  ],
                ]
              : visible.map((r): React.ReactNode[] => {
                  const qty = Number(r.data.quantity) || 0;
                  const orderedQty = Number(r.data.orderedQty) || 0;
                  const status = String(r.data.status ?? 'Pending approval');
                  return [
                    <span key="ref" className="num text-[12px]" style={{ color: 'var(--muted)' }}>
                      {r.ref}
                    </span>,
                    String(r.data.description ?? ''),
                    String(r.data.unit ?? ''),
                    <span key="q" className="num">{qty.toLocaleString('en-IN')}</span>,
                    <span key="r" className="num">{money(Number(r.data.rate) || 0)}</span>,
                    <span key="a" className="num">{(Number(r.data.amount) || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 })}</span>,
                    <span key="o" className="num">{pctText(qty, orderedQty)}</span>,
                    <Chip key="s" tone={STATUS_TONE[status] ?? 'mute'}>{status}</Chip>,
                    <Button
                      key="edit"
                      onClick={() => {
                        setEditing(r);
                        setFormOpen(true);
                      }}
                    >
                      Edit
                    </Button>,
                  ];
                })
          }
        />
      </Panel>

      {formOpen && type ? (
        <RecordForm
          type={type}
          record={editing}
          onCancel={() => setFormOpen(false)}
          onSubmit={async (body) => {
            if (editing) {
              await records.update(BOQ_KEY, editing.id, body);
            } else {
              await records.create(BOQ_KEY, body);
            }
            setFormOpen(false);
            void load();
          }}
        />
      ) : null}
    </>
  );
}
