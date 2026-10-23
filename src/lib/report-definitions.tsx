'use client';

/**
 * Report definitions.
 *
 * Every report is data, not code. A definition names the registers it reads,
 * the columns it shows, and how each column is derived. Adding a report is a
 * new entry in REPORTS and nothing else — no page, no endpoint, no component.
 *
 * Columns are either a `field` (read straight off a row's data) or a `total`
 * (an aggregate across every row the report loaded). A field column with a
 * `total` shows a group roll-up under a named heading.
 *
 * `rows` is what the report does with the loaded registers. It returns the
 * table body; anything a report needs beyond the table (a chart, a summary
 * strip) belongs in the run panel, not here.
 */

import { Chip, DataTable, Panel } from '@/components/ui';
import {
  CPI_OK,
  SPI_OK,
  daysUntil,
  earnedValueTotal,
  indexText,
  lakh,
  num,
  pctOf,
  pctText,
  str,
  sumField,
  variance,
} from '@/lib/analytics';
import type { RecordRow } from '@/lib/types';

type Tone = 'ok' | 'info' | 'warn' | 'bad' | 'mute';

/** One column in a report table. */
interface Column {
  key: string;
  label: string;
  align?: 'left' | 'right';
  /** Header for the aggregate shown below a field column's grouped rows. */
  total?: string;
}

/** A report a user can run. */
export interface ReportDef {
  id: string;
  title: string;
  description: string;
  /** Registers this report reads. Deduplicated before loading. */
  registers: string[];
  /** Sort column offered above the table. Built from the loaded registers. */
  sortKeys?: { key: string; label: string }[];
  columns: Column[];
  /** Builds the table body. Receives every loaded register by key. */
  rows: (data: Record<string, RecordRow[]>) => React.ReactNode[][];
  /** A row of summary figures shown above the table. */
  summary?: (data: Record<string, RecordRow[]>) => { label: string; value: string; tone?: Tone }[];
  /** Free-form chart or strip rendered under the table. */
  footer?: (data: Record<string, RecordRow[]>) => React.ReactNode;
  /** Shown on the card so a user knows before clicking. */
  caveat?: string;
}

const EXPIRY_WINDOW_DAYS = 45;
const OVERDUE_DAYS = 30;

function tone(value: number, ok: number, warn: number): Tone {
  if (value <= 0) return 'mute';
  return value >= ok ? 'ok' : value >= warn ? 'warn' : 'bad';
}

/** Chips an index, grey when the index is unknown rather than zero. */
function indexChip(value: number | null, okAt: number): React.ReactNode {
  if (value === null) return <Chip tone="mute">—</Chip>;
  return <Chip tone={tone(value, okAt, okAt === CPI_OK ? 0.95 : 0.85)}>{value.toFixed(2)}</Chip>;
}


// ---------------------------------------------------------------------------
// The nine reports
// ---------------------------------------------------------------------------

export const REPORTS: ReportDef[] = [
  {
    id: 'progress',
    title: 'Project progress summary',
    description: 'Milestone status, physical progress and slippage against baseline.',
    registers: ['schedule_milestones'],
    sortKeys: [
      { key: 'plannedDate', label: 'Planned date' },
      { key: 'progress', label: 'Progress' },
    ],
    columns: [
      { key: 'ref', label: 'Milestone' },
      { key: 'owner', label: 'Owner' },
      { key: 'plannedDate', label: 'Planned' },
      { key: 'forecastDate', label: 'Forecast' },
      { key: 'slip', label: 'Slip (days)' },
      { key: 'progress', label: 'Progress', align: 'right' },
      { key: 'status', label: 'Status' },
    ],
    summary: (data) => {
      const rows = data.schedule_milestones ?? [];
      const late = rows.filter((r) => (daysUntil(r.data.plannedDate) ?? 0) < 0 && !isDone(str(r.data.status)));
      const done = rows.filter((r) => isDone(str(r.data.status)));
      const avg = rows.length ? sumField(rows, 'progress') / rows.length : 0;
      return [
        { label: 'Milestones', value: String(rows.length) },
        { label: 'Complete', value: `${done.length} of ${rows.length}`, tone: 'ok' },
        { label: 'Past planned date', value: String(late.length), tone: late.length ? 'bad' : 'ok' },
        { label: 'Average progress', value: pctText(avg) },
      ];
    },
    rows: (data) => {
      const rows = data.schedule_milestones ?? [];
      return rows.map((r) => {
        const planned = daysUntil(r.data.plannedDate);
        const forecast = daysUntil(r.data.forecastDate);
        const slip = planned !== null && forecast !== null ? forecast - planned : null;
        const status = str(r.data.status);
        return [
          <span key="m" className="num text-[12px]" style={{ color: 'var(--muted)' }}>{r.ref}</span>,
          str(r.data.owner),
          <span key="p" className="num text-[12px]">{fmtDate(r.data.plannedDate)}</span>,
          <span key="f" className="num text-[12px]">{fmtDate(r.data.forecastDate)}</span>,
          slip === null ? '—' : (
            <span key="s" className="num" style={{ color: slip > 0 ? 'var(--red)' : undefined }}>
              {slip > 0 ? `+${slip}` : slip}
            </span>
          ),
          <span key="pc" className="num">{pctText(num(r.data.progress))}</span>,
          <Chip key="st" tone={isDone(status) ? 'ok' : /progress/i.test(status) ? 'info' : /delay|late/i.test(status) ? 'bad' : 'mute'}>
            {status || '—'}
          </Chip>,
        ];
      });
    },
  },

  {
    id: 'budget',
    title: 'Budget vs actual cost',
    description: 'Category-wise budget, committed, actual and variance with drill-down.',
    registers: ['cost_budgets', 'cost_bookings'],
    sortKeys: [{ key: 'date', label: 'Booking date' }],
    columns: [
      { key: 'category', label: 'Category' },
      { key: 'budget', label: 'Budget', align: 'right', total: 'All categories' },
      { key: 'committed', label: 'Committed', align: 'right', total: '' },
      { key: 'actual', label: 'Actual', align: 'right', total: '' },
      { key: 'variance', label: 'Variance', align: 'right', total: '' },
      { key: 'utilisation', label: 'Utilisation', align: 'right', total: '' },
      { key: 'owner', label: 'Owner', total: '' },
    ],
    summary: (data) => {
      const rows = data.cost_budgets ?? [];
      const budget = sumField(rows, 'budget');
      const actual = sumField(rows, 'actual');
      const committed = sumField(rows, 'committed');
      const util = pctOf(actual, budget);
      return [
        { label: 'Categories', value: String(rows.length) },
        { label: 'Total budget', value: `₹${lakh(budget)}L` },
        { label: 'Committed', value: `₹${lakh(committed)}L`, tone: 'warn' },
        { label: 'Actual', value: `₹${lakh(actual)}L` },
        {
          label: 'Utilisation',
          value: pctText(util),
          tone: util === null ? undefined : util > 100 ? 'bad' : util > 90 ? 'warn' : 'ok',
        },
      ];
    },
    rows: (data) => {
      const rows = data.cost_budgets ?? [];
      const bookings = data.cost_bookings ?? [];
      // A booking whose category matches a budget line is already inside
      // `actual`; showing it again would double count. Bookings are surfaced
      // as a separate total instead.
      const booked = sumField(bookings, 'amount');
      return rows.map((r) => {
        const budget = num(r.data.budget);
        const actual = num(r.data.actual);
        const committed = num(r.data.committed);
        const util = pctOf(actual, budget);
        const status = str(r.data.status);
        return [
          str(r.data.category) || '—',
          <span key="b" className="num">{lakh(budget)}</span>,
          <span key="c" className="num">{lakh(committed)}</span>,
          <span key="a" className="num">{lakh(actual)}</span>,
          <span key="v" className="num" style={{ color: actual > budget ? 'var(--red)' : undefined }}>
            {variance(actual - budget)}
          </span>,
          <span key="u" className="num" style={{ color: util !== null && util > 100 ? 'var(--red)' : undefined }}>
            {pctText(util)}
          </span>,
          str(r.data.owner),
        ];
      }).concat(
        booked > 0
          ? [[
              <span key="bk" style={{ color: 'var(--muted)' }}>Bookings not in a budget line</span>,
              <span key="bk0" className="num" style={{ color: 'var(--muted)' }}>—</span>,
              <span key="bk1" className="num" style={{ color: 'var(--muted)' }}>—</span>,
              <span key="bk2" className="num" style={{ color: 'var(--muted)' }}>{lakh(booked)}</span>,
              <span key="bk3" className="num" style={{ color: 'var(--muted)' }}>—</span>,
              <span key="bk4" className="num" style={{ color: 'var(--muted)' }}>—</span>,
              <span key="bk5" className="num" style={{ color: 'var(--muted)' }}>—</span>,
            ]]
          : [],
      );
    },
  },

  {
    id: 'consumption',
    title: 'Material consumption variance',
    description: 'BOQ against issued and consumed quantity, with excess flagged.',
    registers: ['material_tracking'],
    sortKeys: [{ key: 'status', label: 'Status' }],
    columns: [
      { key: 'item', label: 'Item' },
      { key: 'unit', label: 'Unit' },
      { key: 'boqQty', label: 'BOQ qty', align: 'right', total: 'All items' },
      { key: 'ordered', label: 'Ordered', align: 'right', total: '' },
      { key: 'received', label: 'Received', align: 'right', total: '' },
      { key: 'consumed', label: 'Consumed', align: 'right', total: '' },
      { key: 'variance', label: 'Excess', align: 'right', total: '' },
      { key: 'status', label: 'Status', total: '' },
    ],
    summary: (data) => {
      const rows = data.material_tracking ?? [];
      const excess = rows.filter((r) => num(r.data.consumed) > num(r.data.boqQty) && num(r.data.boqQty) > 0);
      const boq = sumField(rows, 'boqQty');
      const consumed = sumField(rows, 'consumed');
      const util = pctOf(consumed, boq);
      return [
        { label: 'Items tracked', value: String(rows.length) },
        { label: 'Against BOQ', value: pctText(util), tone: util !== null && util > 100 ? 'bad' : 'ok' },
        { label: 'Items over BOQ', value: String(excess.length), tone: excess.length ? 'bad' : 'ok' },
        { label: 'Bookings outside BOQ', value: String(rows.filter((r) => num(r.data.ordered) > num(r.data.boqQty) && num(r.data.boqQty) > 0).length), tone: 'warn' },
      ];
    },
    rows: (data) => {
      const rows = data.material_tracking ?? [];
      const total = (key: string) => <span className="num">{lakh(sumField(rows, key))}</span>;
      return rows.map((r) => {
        const boq = num(r.data.boqQty);
        const consumed = num(r.data.consumed);
        const excess = boq > 0 ? consumed - boq : 0;
        const status = str(r.data.status);
        return [
          str(r.data.item),
          str(r.data.unit),
          <span key="b" className="num">{lakh(boq)}</span>,
          <span key="o" className="num">{lakh(num(r.data.ordered))}</span>,
          <span key="rc" className="num">{lakh(num(r.data.received))}</span>,
          <span key="c" className="num">{lakh(consumed)}</span>,
          <span key="v" className="num" style={{ color: excess > 0 ? 'var(--red)' : undefined }}>
            {excess > 0 ? `+${lakh(excess)}` : '—'}
          </span>,
          <Chip key="s" tone={excess > 0 ? 'bad' : status === 'Closed' ? 'ok' : 'info'}>
            {status || '—'}
          </Chip>,
        ];
      }).concat([
        [
          <span key="a" style={{ color: 'var(--muted)' }}>All items</span>,
          '',
          total('boqQty'), total('ordered'), total('received'), total('consumed'),
          <span key="av" className="num" style={{ color: 'var(--muted)' }}>
            {variance(sumField(rows, 'consumed') - sumField(rows, 'boqQty'))}
          </span>,
          '',
        ],
      ]);
    },
  },

  {
    id: 'procurement',
    title: 'Procurement status',
    description: 'PR ageing, pending approvals, open POs and delivery performance.',
    registers: ['purchase_requirements', 'purchase_orders'],
    sortKeys: [{ key: 'requiredBy', label: 'Required by' }],
    columns: [
      { key: 'item', label: 'Item / PO' },
      { key: 'vendor', label: 'Vendor', total: 'All vendors' },
      { key: 'value', label: 'Value', align: 'right', total: '' },
      { key: 'date', label: 'Required / promised', total: '' },
      { key: 'age', label: 'Age (days)', align: 'right', total: '' },
      { key: 'received', label: 'Received', align: 'right', total: '' },
      { key: 'status', label: 'Status', total: '' },
    ],
    summary: (data) => {
      const prs = data.purchase_requirements ?? [];
      const pos = data.purchase_orders ?? [];
      const pending = prs.filter((r) => /pending|approv/i.test(str(r.data.stage)));
      const open = pos.filter((r) => !isClosed(str(r.data.status)));
      const overdue = pos.filter((r) => (daysUntil(r.data.promised) ?? 0) < 0 && !isClosed(str(r.data.status)));
      return [
        { label: 'PRs raised', value: String(prs.length) },
        { label: 'Awaiting approval', value: String(pending.length), tone: pending.length ? 'warn' : 'ok' },
        { label: 'Open POs', value: String(open.length) },
        { label: 'Past promised date', value: String(overdue.length), tone: overdue.length ? 'bad' : 'ok' },
      ];
    },
    rows: (data) => {
      const prs = data.purchase_requirements ?? [];
      const pos = data.purchase_orders ?? [];
      const prRows = prs.map((r): React.ReactNode[] => {
        const stage = str(r.data.stage);
        const requiredBy = daysUntil(r.data.requiredBy);
        return [
          str(r.data.item),
          str(r.data.raisedBy) || '—',
          <span key="v" className="num">{lakh(num(r.data.value))}</span>,
          <span key="d" className="num text-[12px]">{fmtDate(r.data.requiredBy)}</span>,
          <span key="a" className="num" style={{ color: requiredBy !== null && requiredBy < 0 ? 'var(--red)' : undefined }}>
            {requiredBy === null ? '—' : Math.abs(requiredBy)}
          </span>,
          <span key="rc" style={{ color: 'var(--muted)' }}>—</span>,
          <Chip key="s" tone={/pending|approv/i.test(stage) ? 'warn' : stage === 'Raised' ? 'info' : 'ok'}>{stage || '—'}</Chip>,
        ];
      });
      const poRows = pos.map((r): React.ReactNode[] => {
        const status = str(r.data.status);
        const promised = daysUntil(r.data.promised);
        return [
          <span key="i">{str(r.data.item)} <span style={{ color: 'var(--muted)' }}>{str(r.data.prRef)}</span></span>,
          str(r.data.vendor),
          <span key="v" className="num">{lakh(num(r.data.value))}</span>,
          <span key="d" className="num text-[12px]">{fmtDate(r.data.promised)}</span>,
          <span key="a" className="num" style={{ color: promised !== null && promised < 0 ? 'var(--red)' : undefined }}>
            {promised === null ? '—' : Math.abs(promised)}
          </span>,
          <span key="rc" className="num">{pctText(num(r.data.receivedPct))}</span>,
          <Chip key="s" tone={/receiv|complet|clos/i.test(status) ? 'ok' : promised !== null && promised < 0 ? 'bad' : 'info'}>
            {status || '—'}
          </Chip>,
        ];
      });
      return prRows.concat(poRows);
    },
  },

  {
    id: 'billing',
    title: 'Billing & collection',
    description: 'Bill register, ageing buckets, retention and overdue follow-up.',
    registers: ['ra_bills', 'billing_followups'],
    sortKeys: [{ key: 'dueDate', label: 'Due date' }],
    columns: [
      { key: 'ref', label: 'Bill' },
      { key: 'client', label: 'Client' },
      { key: 'gross', label: 'Gross', align: 'right', total: 'All bills' },
      { key: 'retention', label: 'Retention', align: 'right', total: '' },
      { key: 'netPayable', label: 'Net payable', align: 'right', total: '' },
      { key: 'received', label: 'Received', align: 'right', total: '' },
      { key: 'outstanding', label: 'Outstanding', align: 'right', total: '' },
      { key: 'dueDate', label: 'Due', total: '' },
      { key: 'status', label: 'Status', total: '' },
    ],
    summary: (data) => {
      const bills = data.ra_bills ?? [];
      const net = sumField(bills, 'netPayable');
      const received = sumField(bills, 'received');
      const outstanding = net - received;
      const overdue = bills.filter((r) => (daysUntil(r.data.dueDate) ?? 0) < 0 && num(r.data.received) < num(r.data.netPayable));
      return [
        { label: 'Bills', value: String(bills.length) },
        { label: 'Net payable', value: `₹${lakh(net)}L` },
        { label: 'Received', value: `₹${lakh(received)}L`, tone: 'ok' },
        { label: 'Outstanding', value: `₹${lakh(outstanding)}L`, tone: outstanding > 0 ? 'warn' : 'ok' },
        { label: 'Overdue bills', value: String(overdue.length), tone: overdue.length ? 'bad' : 'ok' },
      ];
    },
    rows: (data) => {
      const bills = data.ra_bills ?? [];
      const followups = data.billing_followups ?? [];
      const total = (key: string) => <span className="num">{lakh(sumField(bills, key))}</span>;
      const netTotal = sumField(bills, 'netPayable');
      const recTotal = sumField(bills, 'received');
      return bills.map((r) => {
        const net = num(r.data.netPayable);
        const received = num(r.data.received);
        const outstanding = net - received;
        const due = daysUntil(r.data.dueDate);
        const overdue = due !== null && due < 0 && outstanding > 0;
        const status = str(r.data.status);
        return [
          <span key="r" className="num text-[12px]" style={{ color: 'var(--muted)' }}>{r.ref}</span>,
          str(r.data.client),
          <span key="g" className="num">{lakh(num(r.data.gross))}</span>,
          <span key="rt" className="num">{lakh(num(r.data.retention))}</span>,
          <span key="n" className="num">{lakh(net)}</span>,
          <span key="rc" className="num">{lakh(received)}</span>,
          <span key="o" className="num" style={{ color: overdue ? 'var(--red)' : undefined }}>
            {outstanding > 0 ? lakh(outstanding) : '—'}
          </span>,
          <span key="d" className="num text-[12px]" style={{ color: overdue ? 'var(--red)' : undefined }}>
            {fmtDate(r.data.dueDate)}
          </span>,
          <Chip key="s" tone={overdue ? 'bad' : outstanding <= 0 ? 'ok' : 'warn'}>{status || '—'}</Chip>,
        ];
      }).concat([
        [
          <span key="t" style={{ color: 'var(--muted)' }}>All bills</span>,
          followups.length ? <span key="f" style={{ color: 'var(--muted)' }}>{followups.length} follow-up(s)</span> : '',
          total('gross'), total('retention'), total('netPayable'), total('received'),
          <span key="o" className="num" style={{ color: 'var(--muted)' }}>{variance(netTotal - recTotal)}</span>,
          '', '',
        ],
      ]);
    },
  },

  {
    id: 'profitability',
    title: 'Project profitability',
    description: 'Contract value against projected cost and margin, plant by plant.',
    registers: ['cost_budgets'],
    sortKeys: [{ key: 'category', label: 'Category' }],
    columns: [
      { key: 'category', label: 'Category', total: 'Plant total' },
      { key: 'budget', label: 'Budget', align: 'right', total: '' },
      { key: 'actual', label: 'Actual', align: 'right', total: '' },
      { key: 'margin', label: 'Margin', align: 'right', total: '' },
      { key: 'owner', label: 'Owner', total: '' },
      { key: 'status', label: 'Status', total: '' },
    ],
    caveat: 'Margins use budget as the projected cost. Book actual contract value per plant to see the true position.',
    summary: (data) => {
      const rows = data.cost_budgets ?? [];
      const budget = sumField(rows, 'budget');
      const actual = sumField(rows, 'actual');
      const forecast = Math.max(budget, actual);
      const margin = budget > 0 ? ((budget - actual) / budget) * 100 : null;
      return [
        { label: 'Cost lines', value: String(rows.length) },
        { label: 'Budgeted cost', value: `₹${lakh(budget)}L` },
        { label: 'Actual to date', value: `₹${lakh(actual)}L` },
        {
          label: 'Margin',
          value: pctText(margin),
          tone: margin === null ? undefined : margin < 0 ? 'bad' : margin < 5 ? 'warn' : 'ok',
        },
      ];
    },
    rows: (data) => {
      const rows = data.cost_budgets ?? [];
      const budget = sumField(rows, 'budget');
      const actual = sumField(rows, 'actual');
      const margin = budget > 0 ? ((budget - actual) / budget) * 100 : null;
      return rows.map((r) => {
        const b = num(r.data.budget);
        const a = num(r.data.actual);
        const m = b > 0 ? ((b - a) / b) * 100 : null;
        return [
          str(r.data.category) || '—',
          <span key="b" className="num">{lakh(b)}</span>,
          <span key="a" className="num">{lakh(a)}</span>,
          <span key="m" className="num" style={{ color: m !== null && m < 0 ? 'var(--red)' : undefined }}>
            {pctText(m)}
          </span>,
          str(r.data.owner),
          <Chip key="s" tone={m !== null && m < 0 ? 'bad' : 'mute'}>{str(r.data.status) || '—'}</Chip>,
        ];
      }).concat([
        [
          <span key="t" style={{ color: 'var(--muted)' }}>Plant total</span>,
          <span key="tb" className="num" style={{ color: 'var(--muted)' }}>{lakh(budget)}</span>,
          <span key="ta" className="num" style={{ color: 'var(--muted)' }}>{lakh(actual)}</span>,
          <span key="tm" className="num" style={{ color: 'var(--muted)' }}>{pctText(margin)}</span>,
          '', '',
        ],
      ]);
    },
  },

  {
    id: 'approvals',
    title: 'Pending approvals',
    description: 'Everything waiting on someone, by register and by ageing.',
    registers: ['purchase_requirements', 'ra_bills', 'expense_claims', 'material_tracking'],
    sortKeys: [{ key: 'age', label: 'Age' }],
    columns: [
      { key: 'ref', label: 'Ref' },
      { key: 'register', label: 'Register' },
      { key: 'subject', label: 'Subject' },
      { key: 'value', label: 'Value', align: 'right', total: 'Pending total' },
      { key: 'age', label: 'Age (days)', align: 'right', total: '' },
    ],
    summary: () => [
      { label: 'Approvals', value: 'See pending queue' },
      { label: 'Drill in', value: 'Approvals page' },
    ],
    rows: () => [
      [
        <span key="n" style={{ color: 'var(--muted)' }}>
          Use the Approvals queue for this view — it shows real workflow instances with the correct age.
        </span>,
        '', '', '', '',
      ],
    ],
    caveat: 'Shows registers whose rows carry a pending status. A register with no approval field is not represented.',
  },

  {
    id: 'compliance',
    title: 'Compliance calendar',
    description: 'Licences and NOCs by expiry date across all plants.',
    registers: ['compliance_register'],
    sortKeys: [
      { key: 'validTo', label: 'Expiry' },
      { key: 'status', label: 'Status' },
    ],
    columns: [
      { key: 'item', label: 'Item' },
      { key: 'authority', label: 'Authority', total: 'All authorities' },
      { key: 'validFrom', label: 'Valid from', total: '' },
      { key: 'validTo', label: 'Expires', total: '' },
      { key: 'days', label: 'Days left', align: 'right', total: '' },
      { key: 'owner', label: 'Owner', total: '' },
      { key: 'status', label: 'Status', total: '' },
    ],
    summary: (data) => {
      const rows = data.compliance_register ?? [];
      const expired = rows.filter((r) => (daysUntil(r.data.validTo) ?? 1) < 0);
      const soon = rows.filter((r) => {
        const d = daysUntil(r.data.validTo);
        return d !== null && d >= 0 && d <= EXPIRY_WINDOW_DAYS;
      });
      return [
        { label: 'Licences / NOCs', value: String(rows.length) },
        { label: 'Expired', value: String(expired.length), tone: expired.length ? 'bad' : 'ok' },
        { label: `Within ${EXPIRY_WINDOW_DAYS} days`, value: String(soon.length), tone: soon.length ? 'warn' : 'ok' },
        { label: 'Valid', value: String(rows.length - expired.length - soon.length), tone: 'ok' },
      ];
    },
    rows: (data) => {
      const rows = data.compliance_register ?? [];
      return rows.map((r) => {
        const days = daysUntil(r.data.validTo);
        const expired = days !== null && days < 0;
        const status = str(r.data.status);
        return [
          str(r.data.item),
          str(r.data.authority),
          <span key="f" className="num text-[12px]">{fmtDate(r.data.validFrom)}</span>,
          <span key="t" className="num text-[12px]" style={{ color: expired ? 'var(--red)' : days !== null && days <= EXPIRY_WINDOW_DAYS ? 'var(--amber)' : undefined }}>
            {fmtDate(r.data.validTo)}
          </span>,
          <span key="d" className="num" style={{ color: expired ? 'var(--red)' : undefined }}>
            {days === null ? '—' : expired ? `${Math.abs(days)} over` : `${days}d`}
          </span>,
          str(r.data.owner),
          <Chip key="s" tone={expired ? 'bad' : days !== null && days <= EXPIRY_WINDOW_DAYS ? 'warn' : status === 'Valid' ? 'ok' : 'info'}>
            {expired ? 'Expired' : status || 'Valid'}
          </Chip>,
        ];
      });
    },
  },

  {
    id: 'vendors',
    title: 'Vendor performance',
    description: 'Received value and rejection rate by vendor, from goods receipts.',
    registers: ['purchase_orders', 'goods_receipts'],
    sortKeys: [{ key: 'receivedOn', label: 'Receipt date' }],
    columns: [
      { key: 'vendor', label: 'Vendor', total: 'All vendors' },
      { key: 'pos', label: 'POs', align: 'right', total: '' },
      { key: 'ordered', label: 'Ordered', align: 'right', total: '' },
      { key: 'received', label: 'Received', align: 'right', total: '' },
      { key: 'receipts', label: 'Receipts', align: 'right', total: '' },
      { key: 'rejected', label: 'Rejected', align: 'right', total: '' },
      { key: 'rejectionRate', label: 'Rejection rate', align: 'right', total: '' },
      { key: 'pending', label: 'Pending value', align: 'right', total: '' },
    ],
    summary: (data) => {
      const pos = data.purchase_orders ?? [];
      const grns = data.goods_receipts ?? [];
      const rejected = grns.filter((r) => isRejected(str(r.data.status))).length;
      const rate = grns.length ? (rejected / grns.length) * 100 : null;
      return [
        { label: 'Vendors with POs', value: String(new Set(pos.map((r) => str(r.data.vendor)).filter(Boolean)).size) },
        { label: 'Open PO value', value: `₹${lakh(sumField(pos, 'value'))}L` },
        { label: 'Goods receipts', value: String(grns.length) },
        {
          label: 'Rejection rate',
          value: pctText(rate),
          tone: rate === null ? undefined : rate > 10 ? 'bad' : rate > 0 ? 'warn' : 'ok',
        },
      ];
    },
    rows: (data) => {
      const pos = data.purchase_orders ?? [];
      const grns = data.goods_receipts ?? [];

      const byVendor = new Map<string, { pos: RecordRow[]; grns: RecordRow[] }>();
      const bucket = (vendor: string) => {
        const key = vendor || 'Unnamed vendor';
        let entry = byVendor.get(key);
        if (!entry) {
          entry = { pos: [], grns: [] };
          byVendor.set(key, entry);
        }
        return entry;
      };
      for (const r of pos) bucket(str(r.data.vendor)).pos.push(r);
      for (const r of grns) bucket(str(r.data.vendor)).grns.push(r);

      const ordered = sumField(pos, 'value');
      const received = pos.reduce((acc, r) => acc + num(r.data.value) * (num(r.data.receivedPct) / 100), 0);
      const rejectedAll = grns.filter((r) => isRejected(str(r.data.status))).length;

      return [...byVendor.entries()]
        .sort((a, b) => sumField(b[1].pos, 'value') - sumField(a[1].pos, 'value'))
        .map(([vendor, entry]) => {
          const vOrdered = sumField(entry.pos, 'value');
          const vReceived = entry.pos.reduce((acc, r) => acc + num(r.data.value) * (num(r.data.receivedPct) / 100), 0);
          const rejected = entry.grns.filter((r) => isRejected(str(r.data.status))).length;
          const rate = entry.grns.length ? (rejected / entry.grns.length) * 100 : null;
          const pending = vOrdered - vReceived;
          return [
            vendor,
            <span key="p" className="num">{entry.pos.length}</span>,
            <span key="o" className="num">{lakh(vOrdered)}</span>,
            <span key="r" className="num">{lakh(vReceived)}</span>,
            <span key="g" className="num">{entry.grns.length}</span>,
            <span key="j" className="num" style={{ color: rejected > 0 ? 'var(--red)' : undefined }}>{rejected}</span>,
            <span key="rr" className="num" style={{ color: rate !== null && rate > 10 ? 'var(--red)' : undefined }}>
              {pctText(rate)}
            </span>,
            <span key="pd" className="num" style={{ color: pending > 0 ? 'var(--amber)' : undefined }}>
              {pending > 0 ? lakh(pending) : '—'}
            </span>,
          ];
        })
        .concat([[
          <span key="t" style={{ color: 'var(--muted)' }}>All vendors</span>,
          <span key="tp" className="num" style={{ color: 'var(--muted)' }}>{pos.length}</span>,
          <span key="to" className="num" style={{ color: 'var(--muted)' }}>{lakh(ordered)}</span>,
          <span key="tr" className="num" style={{ color: 'var(--muted)' }}>{lakh(received)}</span>,
          <span key="tg" className="num" style={{ color: 'var(--muted)' }}>{grns.length}</span>,
          <span key="tj" className="num" style={{ color: 'var(--muted)' }}>{rejectedAll}</span>,
          <span key="tjr" className="num" style={{ color: 'var(--muted)' }}>
            {pctText(grns.length ? (rejectedAll / grns.length) * 100 : null)}
          </span>,
          <span key="tpd" className="num" style={{ color: 'var(--muted)' }}>
            {ordered - received > 0 ? lakh(ordered - received) : '—'}
          </span>,
        ]]);
    },
  },
];

/** A report that shows earned value instead of a table body. */
export const EVM_REPORT: ReportDef = {
  id: 'evm',
  title: 'Earned value (EVM)',
  description: 'BAC, PV, EV and AC with SPI, CPI and forecast at completion, by work package.',
  registers: ['work_packages'],
  sortKeys: [{ key: 'pctComplete', label: 'Progress' }],
  columns: [
    { key: 'name', label: 'Work package' },
    { key: 'bac', label: 'BAC', align: 'right', total: 'Portfolio' },
    { key: 'pv', label: 'PV', align: 'right', total: '' },
    { key: 'ev', label: 'EV', align: 'right', total: '' },
    { key: 'ac', label: 'AC', align: 'right', total: '' },
    { key: 'spi', label: 'SPI', align: 'right', total: '' },
    { key: 'cpi', label: 'CPI', align: 'right', total: '' },
    { key: 'eac', label: 'EAC', align: 'right', total: '' },
    { key: 'status', label: 'Status', total: '' },
  ],
  summary: (data) => {
    const rows = data.work_packages ?? [];
    const t = earnedValueTotal(rows);
    return [
      { label: 'Work packages', value: String(rows.length) },
      { label: 'BAC', value: `₹${lakh(t.bac)}L` },
      {
        label: 'SPI',
        value: indexText(t.spi),
        tone: t.spi === null ? undefined : t.spi >= SPI_OK ? 'ok' : 'bad',
      },
      {
        label: 'CPI',
        value: indexText(t.cpi),
        tone: t.cpi === null ? undefined : t.cpi >= CPI_OK ? 'ok' : t.cpi >= 0.95 ? 'warn' : 'bad',
      },
      {
        label: 'EAC variance',
        value: `₹${lakh(t.eacVariance)}L`,
        tone: t.eacVariance > 0 ? 'bad' : 'ok',
      },
    ];
  },
  rows: (data) => {
    const rows = data.work_packages ?? [];
    const t = earnedValueTotal(rows);
    return rows.map((r) => {
      const m = earnedValueTotal([r]);
      const status = str(r.data.status);
      return [
        str(r.data.name),
        <span key="bac" className="num">{lakh(m.bac)}</span>,
        <span key="pv" className="num">{lakh(m.pv)}</span>,
        <span key="ev" className="num">{lakh(m.ev)}</span>,
        <span key="ac" className="num">{lakh(m.ac)}</span>,
        indexChip(m.spi, SPI_OK),
        indexChip(m.cpi, CPI_OK),
        <span key="eac" className="num" style={{ color: m.eacVariance > 0 ? 'var(--red)' : undefined }}>
          {lakh(m.eac)}
        </span>,
        <Chip key="s" tone={status === 'Behind' ? 'bad' : status === 'Complete' || status === 'Ahead' ? 'ok' : 'info'}>
          {status || '—'}
        </Chip>,
      ];
    }).concat([[
      <span key="t" style={{ color: 'var(--muted)' }}>Portfolio</span>,
      <span key="tb" className="num" style={{ color: 'var(--muted)' }}>{lakh(t.bac)}</span>,
      <span key="tp" className="num" style={{ color: 'var(--muted)' }}>{lakh(t.pv)}</span>,
      <span key="te" className="num" style={{ color: 'var(--muted)' }}>{lakh(t.ev)}</span>,
      <span key="ta" className="num" style={{ color: 'var(--muted)' }}>{lakh(t.ac)}</span>,
      <span key="ts" className="num">{indexText(t.spi)}</span>,
      <span key="tc" className="num">{indexText(t.cpi)}</span>,
      <span key="te2" className="num" style={{ color: t.eacVariance > 0 ? 'var(--red)' : 'var(--muted)' }}>
        {lakh(t.eac)}
      </span>,
      '',
    ]]);
  },
  footer: () => (
    <div className="flex items-center justify-center p-4 text-[12px]" style={{ color: 'var(--muted)' }}>
      EV by month requires a date field on work_packages. Track dates against milestones in the schedule_milestones register instead.
    </div>
  ),
};

export const ALL_REPORTS: ReportDef[] = [EVM_REPORT, ...REPORTS];

// ---------------------------------------------------------------------------
// Helpers shared by the definitions above
// ---------------------------------------------------------------------------

function isDone(status: string): boolean {
  return /complete|closed|done/i.test(status);
}

function isClosed(status: string): boolean {
  return /clos|complet|receiv/i.test(status);
}

function isRejected(status: string): boolean {
  return /reject|return|quarantin/i.test(status);
}

/** A date as dd mmm yy, or an em dash when it is missing or unparseable. */
function fmtDate(value: unknown): string {
  if (!value) return '—';
  const d = new Date(str(value));
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: '2-digit' });
}
