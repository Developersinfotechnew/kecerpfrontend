'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';

import { RecordForm } from '@/components/RecordForm';
import { Bar, Button, Chip, DataTable, Notice, PageHead, Panel, VitalsRail } from '@/components/ui';
import { records } from '@/lib/services';
import { L } from '@/lib/project-data';
import type { RecordRow, RecordType } from '@/lib/types';

const BUDGETS_KEY = 'cost_budgets';
const BOOKINGS_KEY = 'cost_bookings';
const CLAIMS_KEY = 'claims_register';

const STATUS_TONE: Record<string, 'ok' | 'info' | 'warn' | 'bad' | 'mute'> = {
  'On track': 'ok',
  Watch: 'warn',
  'Over budget': 'bad',
  Frozen: 'mute',
  Booked: 'ok',
  Reversed: 'mute',
  'Under review': 'warn',
};

const num = (v: unknown) => Number(v) || 0;

/** Project costing — budgets against committed and actual, all from records. */
export default function EpcCostingPage() {
  const [budgetType, setBudgetType] = useState<RecordType | null>(null);
  const [bookingType, setBookingType] = useState<RecordType | null>(null);
  const [budgets, setBudgets] = useState<RecordRow[]>([]);
  const [bookings, setBookings] = useState<RecordRow[]>([]);
  const [claims, setClaims] = useState<RecordRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState<{ type: RecordType; row: RecordRow | null } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [bRes, kRes, cPage] = await Promise.all([
        Promise.all([records.type(BUDGETS_KEY), records.list(BUDGETS_KEY, { limit: 300 })]),
        Promise.all([records.type(BOOKINGS_KEY), records.list(BOOKINGS_KEY, { limit: 300 })]),
        records.list(CLAIMS_KEY, { limit: 300 }),
      ]);
      setBudgetType(bRes[0]);
      setBookingType(kRes[0]);
      setBudgets(bRes[1].items);
      setBookings(kRes[1].items);
      setClaims(cPage.items);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load costing records');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // Actual spend comes from booked cost entries grouped by category. The budget
  // row carries its own actual figure too, so the screen prefers the bookings
  // when they exist and falls back to the stored value when none have been made.
  const totals = useMemo(() => {
    const booked = new Map<string, number>();
    for (const b of bookings) {
      const status = String(b.data.status ?? '');
      if (status === 'Reversed') continue;
      const category = String(b.data.category ?? '').trim();
      if (!category) continue;
      booked.set(category, (booked.get(category) ?? 0) + num(b.data.amount));
    }

    let budget = 0;
    let committed = 0;
    let actual = 0;
    let forecast = 0;
    let overBudget = 0;
    let bookedTotal = 0;
    const rows: {
      ref: string;
      category: string;
      budget: number;
      committed: number;
      actual: number;
      forecast: number;
      balance: number;
      utilisation: number;
      variance: number;
      status: string;
    }[] = [];

    for (const b of budgets) {
      const category = String(b.data.category ?? '');
      const bValue = num(b.data.budget);
      const cValue = num(b.data.committed);
      const kActual = booked.get(category) ?? null;
      const aValue = kActual ?? num(b.data.actual);

      const fValue = num(b.data.forecast);
      budget += bValue;
      committed += cValue;
      actual += aValue;
      forecast += fValue;
      if (aValue > bValue) overBudget += 1;

      rows.push({
        ref: b.ref,
        category,
        budget: bValue,
        committed: cValue,
        actual: aValue,
        forecast: fValue,
        balance: bValue - aValue,
        utilisation: bValue > 0 ? Math.round((aValue / bValue) * 100) : 0,
        variance: aValue - bValue,
        status: String(b.data.status ?? ''),
      });
    }

    for (const value of booked.values()) bookedTotal += value;

    return {
      budget,
      committed,
      actual,
      forecast,
      balance: budget - actual,
      committedPct: budget > 0 ? Math.round((committed / budget) * 100) : 0,
      actualPct: budget > 0 ? Math.round((actual / budget) * 100) : 0,
      marginPct: budget > 0 ? ((budget - actual) / budget) * 100 : 0,
      forecastMarginPct:
        budget > 0 && forecast > 0 ? ((budget - forecast) / budget) * 100 : null,
      openClaims: claims
        .filter((c) => !['Closed', 'Rejected'].includes(String(c.data.status)))
        .reduce((sum, c) => sum + num(c.data.amount), 0),
      overBudget,
      rows,
      bookings: bookings.filter((b) => String(b.data.status ?? '') !== 'Reversed').length,
      bookedTotal,
    };
  }, [budgets, bookings, claims]);

  return (
    <>
      <PageHead
        title="Project costing"
        description="Budget against committed and actual cost by category, with the margin position for the project."
        actions={
          <>
            <Button onClick={() => bookingType && setForm({ type: bookingType, row: null })}>
              Book cost
            </Button>
            <Button variant="primary" onClick={() => budgetType && setForm({ type: budgetType, row: null })}>
              Add cost category
            </Button>
          </>
        }
      />

      {error ? <Notice>{error}</Notice> : null}

      <VitalsRail
        items={[
          { label: 'Budget', value: L(totals.budget), note: `${budgets.length} categories` },
          {
            label: 'Committed',
            value: L(totals.committed),
            pct: totals.committedPct,
            note: 'Against raised POs',
          },
          {
            label: 'Actual booked',
            value: L(totals.actual),
            pct: totals.actualPct,
            note: `${totals.bookings} bookings`,
          },
          { label: 'Balance', value: L(totals.balance), note: 'Budget less actual' },
          {
            label: 'Forecast (EAC)',
            value: totals.forecast > 0 ? L(totals.forecast) : '—',
            note: totals.forecastMarginPct !== null ? `Margin ${totals.forecastMarginPct.toFixed(1)}%` : 'No forecast',
          },
          {
            label: 'Margin position',
            value: `${totals.marginPct.toFixed(1)}%`,
            tone: totals.marginPct < 15 ? ('warn' as const) : undefined,
            note: totals.overBudget > 0 ? `${totals.overBudget} over budget` : 'Within budget',
          },
          {
            label: 'Open claims',
            value: L(totals.openClaims),
            tone: totals.openClaims > 0 ? ('warn' as const) : undefined,
            note: 'Excluding closed and rejected',
          },
        ]}
      />

      <div className="mt-[18px]" />

      <Panel
        title="Cost by category"
        sub={loading ? 'Loading' : `₹ in lakh · ${budgets.length} categories`}
        bodyless
      >
        <DataTable
          columns={[
            { key: 'c', label: 'Category' },
            { key: 'b', label: 'Budget', align: 'right' },
            { key: 'cm', label: 'Committed', align: 'right' },
            { key: 'a', label: 'Actual', align: 'right' },
            { key: 'fc', label: 'Forecast', align: 'right' },
            { key: 'bal', label: 'Balance', align: 'right' },
            { key: 'u', label: 'Utilisation' },
            { key: 'v', label: 'Variance', align: 'right' },
            { key: 's', label: 'Status', align: 'right' },
            { key: 'edit', label: '' },
          ]}
          rows={
            totals.rows.length === 0
              ? [[loading ? 'Loading budgets…' : 'No cost categories yet. Use Add cost category.']]
              : totals.rows.map((r): React.ReactNode[] => {
                  const over = r.balance < 0;
                  return [
                    r.category,
                    <span key="b" className="num">{L(r.budget)}</span>,
                    <span key="cm" className="num">{L(r.committed)}</span>,
                    <span key="a" className="num">{L(r.actual)}</span>,
                    <span key="fc" className="num" style={{ color: r.forecast > 0 && r.forecast > r.budget ? 'var(--red)' : 'var(--muted)' }}>
                      {r.forecast > 0 ? L(r.forecast) : '—'}
                    </span>,
                    <span key="bal" className="num" style={over ? { color: 'var(--red)' } : undefined}>
                      {L(r.balance)}
                    </span>,
                    <Bar
                      key="u"
                      pct={Math.min(100, r.utilisation)}
                      tone={over ? 'bad' : r.utilisation >= 90 ? 'warn' : undefined}
                    />,
                    <span key="v" className="num" style={r.variance > 0 ? { color: 'var(--red)' } : undefined}>
                      {r.variance > 0 ? `+${L(r.variance)}` : L(r.variance)}
                    </span>,
                    <Chip key="s" tone={STATUS_TONE[r.status] ?? 'mute'}>{r.status}</Chip>,
                    <Button key="edit" onClick={() => setForm({ type: budgetType!, row: budgets.find((b) => b.ref === r.ref)! })}>
                      Edit
                    </Button>,
                  ];
                })
          }
        />
      </Panel>

      <div className="mt-[18px]" />

      <Panel
        title="Cost bookings"
        sub={loading ? 'Loading' : `${totals.bookings} booked · ${L(totals.bookedTotal)}`}
        bodyless
      >
        <DataTable
          columns={[
            { key: 'd', label: 'Date' },
            { key: 'r', label: 'Reference' },
            { key: 'c', label: 'Category' },
            { key: 'de', label: 'Description' },
            { key: 'a', label: 'Amount (₹L)', align: 'right' },
            { key: 's', label: 'Status', align: 'right' },
            { key: 'edit', label: '' },
          ]}
          rows={
            bookings.length === 0
              ? [[loading ? 'Loading bookings…' : 'No cost bookings yet. Use Book cost.']]
              : bookings.map((b): React.ReactNode[] => {
                  const status = String(b.data.status ?? '');
                  return [
                    <Code key="d">{formatDay(b.data.date)}</Code>,
                    <Code key="r">{b.ref}</Code>,
                    String(b.data.category ?? ''),
                    String(b.data.description ?? ''),
                    <span key="a" className="num">{L(num(b.data.amount))}</span>,
                    <Chip key="s" tone={STATUS_TONE[status] ?? 'mute'}>{status}</Chip>,
                    <Button key="edit" onClick={() => setForm({ type: bookingType!, row: b })}>
                      Edit
                    </Button>,
                  ];
                })
          }
        />
      </Panel>

      <div className="mt-[18px]" />

      <Panel
        title="Claims"
        sub={loading ? 'Loading' : `${claims.length} claims · open ${L(totals.openClaims)}`}
        bodyless
      >
        <DataTable
          columns={[
            { key: 'ref', label: 'Reference' },
            { key: 'desc', label: 'Claim' },
            { key: 'dir', label: 'Direction' },
            { key: 'cat', label: 'Category' },
            { key: 'amt', label: 'Amount (₹L)', align: 'right' },
            { key: 'owner', label: 'Owner' },
            { key: 'due', label: 'Due' },
            { key: 'status', label: 'Status', align: 'right' },
          ]}
          rows={
            claims.length === 0
              ? [[loading ? 'Loading claims…' : 'No claims recorded. Open the Claims register under Commercial.']]
              : claims.map((c): React.ReactNode[] => {
                  const status = String(c.data.status ?? '');
                  const open = !['Closed', 'Rejected'].includes(status);
                  return [
                    <Code key="ref">{c.ref}</Code>,
                    <span key="desc" className="text-[12.5px]">{String(c.data.description ?? '')}</span>,
                    <Chip key="dir" tone={c.data.direction === 'Vendor claim' ? 'info' : 'warn'}>
                      {String(c.data.direction ?? '')}
                    </Chip>,
                    <span key="cat" className="text-[12.5px]" style={{ color: 'var(--muted)' }}>
                      {String(c.data.category ?? '') || '—'}
                    </span>,
                    <span key="amt" className="num">{L(num(c.data.amount))}</span>,
                    <span key="o" className="text-[12.5px]">{String(c.data.owner ?? '')}</span>,
                    <Code key="due">{formatDay(c.data.dueDate)}</Code>,
                    <Chip key="status" tone={open ? 'warn' : 'mute'}>{status}</Chip>,
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
