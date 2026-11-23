'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';

import { RecordForm } from '@/components/RecordForm';
import { Button, Chip, DataTable, Notice, PageHead, Panel, VitalsRail } from '@/components/ui';
import { records } from '@/lib/services';
import { L } from '@/lib/project-data';
import type { RecordRow, RecordType } from '@/lib/types';

const PLAN_KEY = 'procurement_plan';
/** The same register the indent desk and the purchase screen raise into. */
const IND_KEY = 'boq_indents';

const DAY_MS = 86_400_000;

/** Today at 00:00 local, for day-granular date math. */
function today(): number {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/**
 * Procurement plan (CR-27).
 *
 * Each line carries a required-on-site date and three lead times. The PO
 * issue-by date is back-calculated: requiredOnSite minus manufacturing,
 * inspection and transit. A line whose issue-by date has already passed but
 * whose PO is not yet issued reads overdue, so the slip is flagged before it
 * reaches the site. Every figure here is computed live from the stored rows
 * — nothing is a fixed number.
 */
export default function EpcProcurePlanPage() {
  const [type, setType] = useState<RecordType | null>(null);
  const [rows, setRows] = useState<RecordRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState<RecordRow | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [indents, setIndents] = useState<RecordRow[]>([]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [t, page, ind] = await Promise.all([
        records.type(PLAN_KEY),
        records.list(PLAN_KEY, { limit: 500 }),
        records.list(IND_KEY, { limit: 500 }).then((p) => p.items).catch(() => [] as RecordRow[]),
      ]);
      setType(t);
      setRows(page.items);
      setIndents(ind);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load the procurement plan');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const now = today();

  // Back-calc per line. issueBy is the latest date the PO should be placed so
  // the item lands on the required-on-site day; daysLate is how far past that
  // today is. A line is at-risk only while its PO has not been raised yet.
  const computed = useMemo(
    () =>
      rows.map((r) => {
        const d = r.data as Record<string, unknown>;
        const reqOnSite = d.requiredOnSite ? new Date(String(d.requiredOnSite)).getTime() : null;
        const lead =
          (Number(d.manufacturingDays) || 0) + (Number(d.inspectionDays) || 0) + (Number(d.transitDays) || 0);
        const issueBy = reqOnSite != null ? reqOnSite - lead * DAY_MS : null;
        const poIssued = ['PO issued', 'In transit', 'Received'].includes(String(d.status ?? ''));
        const overdue = issueBy != null && !poIssued && now > issueBy;
        const daysLate = issueBy != null ? Math.round((now - issueBy) / DAY_MS) : null;
        return {
          row: r,
          issueBy,
          overdue,
          daysLate,
          poIssued,
          value: Number(d.value) || 0,
        };
      }),
    [rows, now],
  );

  const stats = useMemo(() => {
    const open = computed.filter((c) => !c.poIssued).length;
    const overdue = computed.filter((c) => c.overdue).length;
    const openValue = computed.filter((c) => !c.poIssued).reduce((s, c) => s + c.value, 0);
    return { total: computed.length, open, overdue, openValue };
  }, [computed]);

  // PR / Indent raised, straight from the boq_indents register (the same rows
  // the indent desk and the purchase screen write). A planner sees on this
  // screen what has already gone out against the plan, so a line that is
  // overdue here but already raised over there is not chased twice. estValue
  // is whole rupees (the dialog prices it live), shown in ₹L like the plan's
  // own value column.
  const indentStats = useMemo(() => {
    const live = indents.filter((r) => String(r.data.status ?? '') !== 'Rejected');
    const awaiting = live.filter((r) => ['Draft', 'Submitted'].includes(String(r.data.status ?? ''))).length;
    const estValueL = Math.round(live.reduce((s, r) => s + (Number(r.data.estValue) || 0), 0) / 100_000);
    return { total: live.length, awaiting, estValueL };
  }, [indents]);

  const fmtDate = (ms: number | null) =>
    ms == null ? '—' : new Date(ms).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });

  return (
    <>
      <PageHead
        title="Procurement plan"
        description="Back-calculated PO issue dates from required-on-site. Overdue lines must be issued before they reach the site."
        actions={
          <Button
            variant="primary"
            onClick={() => {
              setForm(null);
              setFormOpen(true);
            }}
          >
            Add plan line
          </Button>
        }
      />

      {error ? <Notice>{error}</Notice> : null}

      <VitalsRail
        items={[
          { label: 'Plan lines', value: String(stats.total), note: 'Total on the plan' },
          {
            label: 'POs to issue',
            value: String(stats.open),
            note: 'Not yet raised',
            tone: stats.open > 0 ? ('warn' as const) : undefined,
          },
          {
            label: 'Overdue',
            value: String(stats.overdue),
            note: 'Issue-by date passed',
            tone: stats.overdue > 0 ? ('bad' as const) : undefined,
          },
          { label: 'Open value', value: L(stats.openValue), note: 'Unissued POs, ₹L' },
          {
            label: 'PR / Indent raised',
            value: String(indentStats.total),
            note: `${indentStats.awaiting} awaiting · est ${L(indentStats.estValueL)}`,
            tone: indentStats.awaiting > 0 ? ('warn' as const) : undefined,
          },
        ]}
      />

      <div className="mt-[18px]" />

      <Panel
        title="Raised PR / Indents"
        sub="Live from the indent register — what has gone out against this plan"
        bodyless
      >
        <DataTable
          columns={[
            { key: 'ref', label: 'PR / Indent' },
            { key: 'site', label: 'Site' },
            { key: 'need', label: 'Need by' },
            { key: 'val', label: 'Est. value', align: 'right' },
            { key: 'st', label: 'Status', align: 'right' },
          ]}
          rows={
            indents.length === 0
              ? [[<span key="e" style={{ color: 'var(--muted)' }}>None raised yet. Raise one on the indent desk or the purchase screen.</span>]]
              : indents.map((r): React.ReactNode[] => {
                  const d = r.data;
                  const tone =
                    String(d.status ?? '') === 'Rejected'
                      ? ('bad' as const)
                      : ['Draft', 'Submitted'].includes(String(d.status ?? ''))
                        ? ('warn' as const)
                        : ('ok' as const);
                  return [
                    <span key="ref" className="font-semibold">{String(d.prNo ?? r.ref)}</span>,
                    <span key="site">{String(d.deliverySite ?? '—')}</span>,
                    <span key="need" className="num">{d.needBy ? new Date(String(d.needBy)).toLocaleDateString('en-IN') : '—'}</span>,
                    <span key="val" className="num">{L(Math.round((Number(d.estValue) || 0) / 100_000))}</span>,
                    <Chip key="st" tone={tone}>{String(d.status ?? '—')}</Chip>,
                  ];
                })
          }
        />
      </Panel>

      <div className="mt-[18px]" />

      <Panel
        title="PO issue plan"
        sub={loading ? 'Loading' : `${computed.length} lines · issue-by back-calculated live`}
        bodyless
      >
        <DataTable
          columns={[
            { key: 'item', label: 'Item' },
            { key: 'boq', label: 'BOQ ref' },
            { key: 'req', label: 'Required on site' },
            { key: 'issue', label: 'Issue PO by' },
            { key: 'late', label: 'Late', align: 'right' },
            { key: 'val', label: 'Value (₹L)', align: 'right' },
            { key: 'st', label: 'Status', align: 'right' },
            { key: 'edit', label: '' },
          ]}
          rows={
            computed.length === 0
              ? [[loading ? 'Loading plan…' : 'No plan lines yet. Add one with a required-on-site date and lead times.']]
              : computed.map((c): React.ReactNode[] => {
                  const d = c.row.data;
                  return [
                    <span key="i">
                      <span className="font-semibold">{String(d.item ?? c.row.ref)}</span>
                      {d.serviceLine ? (
                        <span className="block text-[11.5px]" style={{ color: 'var(--muted)' }}>
                          {String(d.serviceLine)}
                          {d.vendor ? ` · ${String(d.vendor)}` : ''}
                        </span>
                      ) : null}
                    </span>,
                    <span key="b">{String(d.boqRef ?? '—')}</span>,
                    <span key="r" className="num">
                      {d.requiredOnSite ? new Date(String(d.requiredOnSite)).toLocaleDateString('en-IN') : '—'}
                    </span>,
                    <span key="ib" className="num" style={{ color: c.overdue ? 'var(--red)' : 'var(--ink)' }}>
                      {fmtDate(c.issueBy)}
                    </span>,
                    <span key="l" className="num" style={{ color: c.overdue ? 'var(--red)' : 'var(--faint)' }}>
                      {c.poIssued
                        ? '—'
                        : c.daysLate != null && c.daysLate > 0
                          ? `${c.daysLate} d`
                          : 'on time'}
                    </span>,
                    <span key="v" className="num">{L(c.value)}</span>,
                    <Chip key="s" tone={c.overdue ? 'bad' : c.poIssued ? 'ok' : 'warn'}>
                      {String(d.status ?? 'Planned')}
                    </Chip>,
                    <Button key="e" variant="primary" className="min-w-[90px] justify-center" onClick={() => { setForm(c.row); setFormOpen(true); }}>Edit</Button>,
                  ];
                })
          }
        />
      </Panel>

      {formOpen && type ? (
        <RecordForm
          type={type}
          record={form}
          onCancel={() => setFormOpen(false)}
          onSubmit={async (body) => {
            if (form) {
              await records.update(PLAN_KEY, form.id, body);
            } else {
              await records.create(PLAN_KEY, body);
            }
            setFormOpen(false);
            setForm(null);
            void load();
          }}
        />
      ) : null}
    </>
  );
}
