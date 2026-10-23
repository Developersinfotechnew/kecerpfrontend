'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';

import { RecordForm } from '@/components/RecordForm';
import { Bar, Button, Chip, DataTable, Notice, PageHead, Panel, VitalsRail } from '@/components/ui';
import { records } from '@/lib/services';
import { L } from '@/lib/project-data';
import type { RecordRow, RecordType } from '@/lib/types';

const STOCK_KEY = 'inventory_stock';
const GRN_KEY = 'goods_receipts';

const STOCK_TONE: Record<string, 'ok' | 'info' | 'warn' | 'bad' | 'mute'> = {
  'In stock': 'ok',
  'Low stock': 'warn',
  'Out of stock': 'bad',
  'On order': 'info',
};

const GRN_TONE: Record<string, 'ok' | 'info' | 'warn' | 'bad' | 'mute'> = {
  'Pending inspection': 'warn',
  Accepted: 'ok',
  'Part accepted': 'info',
  Rejected: 'bad',
};

const num = (v: unknown) => Number(v) || 0;

/** Store stock — balance and value derived from received, issued, returned. */
export default function EpcInventoryPage() {
  const [stockType, setStockType] = useState<RecordType | null>(null);
  const [grnType, setGrnType] = useState<RecordType | null>(null);
  const [stock, setStock] = useState<RecordRow[]>([]);
  const [grns, setGrns] = useState<RecordRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState<{ type: RecordType; row: RecordRow | null } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [[sType, sPage], [gType, gPage]] = await Promise.all([
        Promise.all([records.type(STOCK_KEY), records.list(STOCK_KEY, { limit: 300 })]),
        Promise.all([records.type(GRN_KEY), records.list(GRN_KEY, { limit: 300 })]),
      ]);
      setStockType(sType);
      setGrnType(gType);
      setStock(sPage.items);
      setGrns(gPage.items);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load stock records');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // Balance is received plus returned less issued. Stock value multiplies that
  // by the stored rate, so a line with no rate contributes nothing and is
  // worth flagging rather than guessing a price.
  const roll = useMemo(() => {
    let stockValue = 0;
    let lowStock = 0;
    let outOfStock = 0;
    const rows = stock.map((r): React.ReactNode[] => {
      const received = num(r.data.received);
      const issued = num(r.data.issued);
      const returned = num(r.data.returned);
      const rate = num(r.data.rate);
      const minStock = num(r.data.minStock);
      const balance = Math.max(0, received + returned - issued);
      const value = balance * rate;
      const status = String(r.data.status ?? '');

      if (rate > 0) stockValue += value;
      if (minStock > 0 && balance <= minStock) lowStock += 1;
      if (balance === 0) outOfStock += 1;

      return [
        String(r.data.item ?? ''),
        String(r.data.unit ?? '—'),
        <span key="r" className="num">{received.toLocaleString('en-IN')}</span>,
        <span key="i" className="num">{issued.toLocaleString('en-IN')}</span>,
        <span key="re" className="num">{returned > 0 ? returned.toLocaleString('en-IN') : '—'}</span>,
        <span key="b" className="num">{balance.toLocaleString('en-IN')}</span>,
        <span key="v" className="num">{rate > 0 ? L(value / 100000) : '—'}</span>,
        <Chip key="s" tone={STOCK_TONE[status] ?? 'mute'}>{status}</Chip>,
        <Button key="edit" onClick={() => setForm({ type: stockType!, row: r })}>
          Edit
        </Button>,
      ];
    });

    return {
      rows,
      stockValue,
      lowStock,
      outOfStock,
      pendingGrns: grns.filter((g) => String(g.data.status ?? '') === 'Pending inspection').length,
      acceptedGrns: grns.filter((g) => String(g.data.status ?? '') === 'Accepted').length,
    };
  }, [stock, grns, stockType]);

  return (
    <>
      <PageHead
        title="Inventory"
        description="Stock on hand, goods received on site, and movement against the minimum stock line."
        actions={
          <>
            <Button onClick={() => grnType && setForm({ type: grnType, row: null })}>
              Raise GRN
            </Button>
            <Button variant="primary" onClick={() => stockType && setForm({ type: stockType, row: null })}>
              Add stock item
            </Button>
          </>
        }
      />

      {error ? <Notice>{error}</Notice> : null}

      <VitalsRail
        items={[
          { label: 'Stock lines', value: String(stock.length), note: 'In the store' },
          { label: 'Stock value', value: L(roll.stockValue / 100000), note: 'Balance × rate' },
          {
            label: 'Below min stock',
            value: String(roll.lowStock),
            note: 'Reorder needed',
            tone: roll.lowStock > 0 ? ('warn' as const) : undefined,
          },
          {
            label: 'Out of stock',
            value: String(roll.outOfStock),
            note: 'Zero balance',
            tone: roll.outOfStock > 0 ? ('bad' as const) : undefined,
          },
          { label: 'GRNs', value: String(grns.length), note: `${roll.pendingGrns} pending inspection` },
        ]}
      />

      <div className="mt-[18px]" />

      <Panel
        title="Stock on hand"
        sub={loading ? 'Loading' : `${stock.length} items · ₹ in lakh`}
        bodyless
      >
        <DataTable
          columns={[
            { key: 'i', label: 'Item' },
            { key: 'u', label: 'Unit' },
            { key: 'r', label: 'Received', align: 'right' },
            { key: 'is', label: 'Issued', align: 'right' },
            { key: 're', label: 'Returned', align: 'right' },
            { key: 'b', label: 'Balance', align: 'right' },
            { key: 'v', label: 'Value (₹L)', align: 'right' },
            { key: 's', label: 'Status', align: 'right' },
            { key: 'edit', label: '' },
          ]}
          rows={
            roll.rows.length === 0
              ? [[loading ? 'Loading stock…' : 'No stock items yet. Use Add stock item.']]
              : roll.rows
          }
        />
      </Panel>

      <div className="mt-[18px]" />

      <Panel
        title="Goods receipts"
        sub={loading ? 'Loading' : `${grns.length} GRNs · ${roll.pendingGrns} pending`}
        bodyless
      >
        <DataTable
          columns={[
            { key: 'g', label: 'GRN' },
            { key: 'v', label: 'Vendor' },
            { key: 'i', label: 'Item' },
            { key: 'q', label: 'Qty', align: 'right' },
            { key: 'd', label: 'Date' },
            { key: 's', label: 'Status', align: 'right' },
            { key: 'edit', label: '' },
          ]}
          rows={
            grns.length === 0
              ? [[loading ? 'Loading GRNs…' : 'No goods receipts yet. Use Raise GRN.']]
              : grns.map((g): React.ReactNode[] => {
                  const status = String(g.data.status ?? '');
                  return [
                    <Code key="g">{g.ref}</Code>,
                    String(g.data.vendor ?? ''),
                    String(g.data.item ?? ''),
                    <span key="q" className="num">{num(g.data.quantity).toLocaleString('en-IN')}</span>,
                    formatDay(g.data.receivedOn),
                    <Chip key="s" tone={GRN_TONE[status] ?? 'mute'}>{status}</Chip>,
                    <Button key="edit" onClick={() => setForm({ type: grnType!, row: g })}>
                      Edit
                    </Button>,
                  ];
                })
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

function formatDay(value: unknown): string {
  if (!value) return '—';
  const d = new Date(String(value));
  return Number.isNaN(d.getTime())
    ? String(value)
    : d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}
