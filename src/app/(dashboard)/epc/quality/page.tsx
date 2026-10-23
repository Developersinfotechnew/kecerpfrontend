'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';

import {
  Bar,
  Button,
  Chip,
  DataTable,
  Notice,
  PageHead,
  Panel,
} from '@/components/ui';
import { useProjectData } from '@/lib/project-data';
import { records } from '@/lib/services';
import type { RecordRow } from '@/lib/types';

/**
 * Quality dossier — one project's quality evidence, rolled up from the
 * existing quality registers. Read-only: each register keeps its own form
 * and workflow; this page is the roll-up and KPI view.
 *
 * Data sources:
 *   itp_plans          inspection and test plan points
 *   qaqc_inspections    inspection log
 *   ncr_register       non-conformance and corrective actions
 *   commissioning_tests FAT/SAT and performance tests
 */
const ITP_KEY = 'itp_plans';
const INSPECTIONS_KEY = 'qaqc_inspections';
const NCR_KEY = 'ncr_register';
const TESTS_KEY = 'commissioning_tests';

const STATUS_TONE: Record<string, 'ok' | 'info' | 'warn' | 'bad' | 'mute'> = {
  Open: 'warn',
  Passed: 'ok',
  Closed: 'ok',
  'Not started': 'mute',
  Failed: 'bad',
  Deferred: 'info',
  'Passed with defer': 'info',
  'In progress': 'info',
  Overdue: 'bad',
  Scheduled: 'mute',
};

type Tab = 'all' | 'itp' | 'inspections' | 'ncr' | 'tests';

export default function EpcQualityPage() {
  const { current: p } = useProjectData();
  const [itp, setItp] = useState<RecordRow[]>([]);
  const [inspections, setInspections] = useState<RecordRow[]>([]);
  const [ncrs, setNcrs] = useState<RecordRow[]>([]);
  const [tests, setTests] = useState<RecordRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>('all');
  const [filter, setFilter] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const pid = p?.id;
      const [itpPage, insPage, ncrPage, testPage] = await Promise.all([
        records.list(ITP_KEY, { projectId: pid, limit: 500 }),
        records.list(INSPECTIONS_KEY, { projectId: pid, limit: 500 }),
        records.list(NCR_KEY, { projectId: pid, limit: 500 }),
        records.list(TESTS_KEY, { projectId: pid, limit: 500 }),
      ]);
      setItp(itpPage.items);
      setInspections(insPage.items);
      setNcrs(ncrPage.items);
      setTests(testPage.items);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load quality records');
    } finally {
      setLoading(false);
    }
  }, [p?.id]);

  useEffect(() => {
    void load();
  }, [load]);

  const stats = useMemo(() => {
    const openNcrs = ncrs.filter((r) => String(r.data.status) !== 'Closed');
    const overdueNcrs = ncrs.filter(
      (r) => String(r.data.status) === 'Overdue' || (
        String(r.data.status) === 'Open' &&
        r.data.dueDate &&
        new Date(String(r.data.dueDate)).getTime() < Date.now()
      ),
    );
    const openHoldPoints = itp.filter(
      (r) => String(r.data.pointType) === 'Hold point' && String(r.data.status) === 'Open',
    );
    const openDeferers = tests.filter(
      (r) => String(r.data.result) === 'Passed with defer' || String(r.data.result) === 'Defer',
    );
    const passedPct =
      inspections.length > 0
        ? Math.round(
            (inspections.filter((r) => ['Passed', 'Closed'].includes(String(r.data.status))).length /
              inspections.length) *
              100,
          )
        : 0;
    return { openNcrs: openNcrs.length, overdueNcrs: overdueNcrs.length, openHoldPoints: openHoldPoints.length, openDeferers: openDeferers.length, passedPct };
  }, [itp, inspections, ncrs, tests]);

  const rowsFor = (list: RecordRow[]) => {
    if (!filter.trim()) return list;
    const q = filter.trim().toLowerCase();
    return list.filter((r) =>
      Object.values(r.data)
        .map((v) => String(v ?? '').toLowerCase())
        .some((v) => v.includes(q)),
    );
  };

  if (loading) {
    return <p className="text-sm" style={{ color: 'var(--muted)' }}>Loading quality dossier…</p>;
  }

  const tabDefs: Array<{ id: Tab; label: string; count: number }> = [
    { id: 'all', label: 'All', count: itp.length + inspections.length + ncrs.length + tests.length },
    { id: 'itp', label: 'ITP', count: itp.length },
    { id: 'inspections', label: 'Inspections', count: inspections.length },
    { id: 'ncr', label: 'NCR / CAR', count: ncrs.length },
    { id: 'tests', label: 'Tests', count: tests.length },
  ];

  return (
    <>
      <PageHead
        title="Quality dossier"
        description="Every inspection point, NCR and test for the project. Open NCRs and unresolved hold points block handover and closure."
        actions={
          <Button onClick={() => void load()}>Refresh</Button>
        }
      />

      <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
        <KpiCard label="Open NCRs" value={stats.openNcrs} tone={stats.openNcrs > 0 ? 'warn' : 'ok'} />
        <KpiCard label="Overdue NCRs" value={stats.overdueNcrs} tone={stats.overdueNcrs > 0 ? 'bad' : 'ok'} />
        <KpiCard label="Open hold points" value={stats.openHoldPoints} tone={stats.openHoldPoints > 0 ? 'warn' : 'ok'} />
        <KpiCard label="Open defers" value={stats.openDeferers} tone={stats.openDeferers > 0 ? 'warn' : 'ok'} />
        <div>
          <div className="text-[11px] uppercase tracking-wide" style={{ color: 'var(--muted)' }}>
            Inspection pass rate
          </div>
          <div className="num text-[22px] font-semibold">{stats.passedPct}%</div>
          <Bar pct={stats.passedPct} tone={stats.passedPct >= 80 ? 'ok' : 'warn'} />
        </div>
      </div>

      {error ? <Notice>{error}</Notice> : null}

      <Panel
        title="Quality records"
        sub={`${tabDefs[0].count} records across ITP, inspections, NCR and tests`}
        bodyless
      >
        <div className="flex flex-wrap items-center gap-2 px-4 py-3" style={{ borderBottom: '1px solid var(--line-2)' }}>
          <div className="flex flex-wrap gap-1.5">
            {tabDefs.map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => setTab(t.id)}
                className="rounded px-2.5 py-1 text-[12px] font-medium"
                style={{
                  background: tab === t.id ? 'var(--accent-soft, #eef5f2)' : 'transparent',
                  color: tab === t.id ? 'var(--ink)' : 'var(--muted)',
                  border: `1px solid ${tab === t.id ? 'var(--line)' : 'transparent'}`,
                }}
              >
                {t.label} ({t.count})
              </button>
            ))}
          </div>
          <input
            type="text"
            placeholder="Search by ref, item, owner, status…"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            className="ml-auto w-[240px] rounded px-2.5 py-1.5 text-[12.5px]"
            style={{ border: '1px solid var(--line)', background: 'var(--panel)', color: 'var(--ink)', outline: 'none' }}
          />
        </div>

        {tab === 'all' ? (
          <DataTable
            columns={[
              { key: 'ref', label: 'Reference' },
              { key: 'type', label: 'Register' },
              { key: 'title', label: 'Item / description' },
              { key: 'date', label: 'Date' },
              { key: 'status', label: 'Status' },
            ]}
            rows={[...itp, ...inspections, ...ncrs, ...tests]
              .map((r) => ({
                row: r,
                register: registerOf(r.data),
                ref: r.ref,
                title: String(r.data.headline ?? r.data.activity ?? r.data.itemDescription ?? r.data.system ?? ''),
                date: String(r.data.raisedOn ?? r.data.inspectionDate ?? r.data.auditedAt ?? r.data.plannedDate ?? r.data.actualDate ?? ''),
                status: String(r.data.status ?? r.data.result ?? ''),
              }))
              .filter((x) => x.register === 'ITP' || x.register === 'Inspection' || x.register === 'NCR' || x.register === 'Test')
              .map((x) => [
                <span key="ref" className="num text-[12.5px] font-semibold">{x.ref}</span>,
                <Chip key="reg" tone={x.register === 'NCR' ? 'bad' : x.register === 'ITP' ? 'info' : 'mute'}>
                  {x.register}
                </Chip>,
                <span key="t" className="text-[12.5px]">{x.title || '—'}</span>,
                <span key="d" className="text-[12.5px]" style={{ color: 'var(--muted)' }}>{x.date || '—'}</span>,
                <span key="s"><Chip tone={STATUS_TONE[x.status] ?? 'mute'}>{x.status || '—'}</Chip></span>,
              ])}
          />
        ) : (
          <DataTable
            columns={
              tab === 'itp'
                ? [
                    { key: 'ref', label: 'Reference' },
                    { key: 'activity', label: 'Activity / system' },
                    { key: 'point', label: 'Inspection point' },
                    { key: 'type', label: 'Point type' },
                    { key: 'date', label: 'Planned' },
                    { key: 'status', label: 'Status' },
                  ]
                : tab === 'inspections'
                  ? [
                      { key: 'ref', label: 'Reference' },
                      { key: 'item', label: 'Item' },
                      { key: 'date', label: 'Date' },
                      { key: 'result', label: 'Result' },
                      { key: 'status', label: 'Status' },
                    ]
                  : tab === 'ncr'
                    ? [
                        { key: 'ref', label: 'Reference' },
                        { key: 'headline', label: 'NCR' },
                        { key: 'type', label: 'Type' },
                        { key: 'owner', label: 'Owner' },
                        { key: 'due', label: 'Due' },
                        { key: 'status', label: 'Status' },
                      ]
                    : [
                        { key: 'ref', label: 'Reference' },
                        { key: 'system', label: 'System' },
                        { key: 'type', label: 'Test type' },
                        { key: 'date', label: 'Actual' },
                        { key: 'result', label: 'Result' },
                        { key: 'status', label: 'Status' },
                      ]
            }
            rows={
              tab === 'itp'
                ? rowsFor(itp).map((r) => [
                    <span key="r" className="num text-[12.5px] font-semibold">{r.ref}</span>,
                    <span key="a" className="text-[12.5px]">{String(r.data.activity ?? '')}</span>,
                    <span key="p" className="text-[12.5px]" style={{ color: 'var(--muted)' }}>{String(r.data.inspectionPoint ?? '')}</span>,
                    <span key="t"><Chip tone={r.data.pointType === 'Hold point' ? 'warn' : 'info'}>{String(r.data.pointType ?? '')}</Chip></span>,
                    <span key="d" className="text-[12.5px]" style={{ color: 'var(--muted)' }}>{String(r.data.plannedDate ?? '') || '—'}</span>,
                    <span key="s"><Chip tone={STATUS_TONE[String(r.data.status ?? '')] ?? 'mute'}>{String(r.data.status ?? '')}</Chip></span>,
                  ])
                : tab === 'inspections'
                  ? rowsFor(inspections).map((r) => [
                      <span key="r" className="num text-[12.5px] font-semibold">{r.ref}</span>,
                      <span key="i" className="text-[12.5px]">{String(r.data.itemDescription ?? '')}</span>,
                      <span key="d" className="text-[12.5px]" style={{ color: 'var(--muted)' }}>{String(r.data.inspectionDate ?? '') || '—'}</span>,
                      <span key="res"><Chip tone={r.data.result === 'Rejected' || r.data.result === 'Rework required' ? 'bad' : 'ok'}>{String(r.data.result ?? '')}</Chip></span>,
                      <span key="s"><Chip tone={STATUS_TONE[String(r.data.status ?? '')] ?? 'mute'}>{String(r.data.status ?? '')}</Chip></span>,
                    ])
                  : tab === 'ncr'
                    ? rowsFor(ncrs).map((r) => [
                        <span key="r" className="num text-[12.5px] font-semibold">{r.ref}</span>,
                        <span key="h" className="text-[12.5px]">{String(r.data.headline ?? '')}</span>,
                        <span key="t" className="text-[12.5px]" style={{ color: 'var(--muted)' }}>{String(r.data.type ?? '')}</span>,
                        <span key="o" className="text-[12.5px]">{String(r.data.owner ?? '')}</span>,
                        <span key="d" className="text-[12.5px]" style={{ color: 'var(--muted)' }}>{String(r.data.dueDate ?? '') || '—'}</span>,
                        <span key="s"><Chip tone={STATUS_TONE[String(r.data.status ?? '')] ?? 'mute'}>{String(r.data.status ?? '')}</Chip></span>,
                      ])
                    : rowsFor(tests).map((r) => [
                        <span key="r" className="num text-[12.5px] font-semibold">{r.ref}</span>,
                        <span key="s" className="text-[12.5px]">{String(r.data.system ?? '')}</span>,
                        <span key="t" className="text-[12.5px]" style={{ color: 'var(--muted)' }}>{String(r.data.testType ?? '')}</span>,
                        <span key="d" className="text-[12.5px]" style={{ color: 'var(--muted)' }}>{String(r.data.actualDate ?? '') || '—'}</span>,
                        <span key="res"><Chip tone={r.data.result === 'Failed' ? 'bad' : r.data.result === 'Not started' ? 'mute' : 'ok'}>{String(r.data.result ?? '')}</Chip></span>,
                        <span key="st"><Chip tone={STATUS_TONE[String(r.data.status ?? '')] ?? 'mute'}>{String(r.data.status ?? '')}</Chip></span>,
                      ])
            }
          />
        )}
      </Panel>
    </>
  );
}

/** Which register a row came from, used by the "All" tab. */
function registerOf(data: Record<string, unknown>): 'ITP' | 'Inspection' | 'NCR' | 'Test' | 'Other' {
  if (data.activity && data.inspectionPoint) return 'ITP';
  if (data.headline && data.correctiveAction !== undefined) return 'NCR';
  if (data.inspectionNo && data.itemDescription) return 'Inspection';
  if (data.system && data.testType) return 'Test';
  if (data.headline) return 'NCR';
  if (data.itemDescription) return 'Inspection';
  if (data.system) return 'Test';
  return 'Other';
}

function KpiCard({ label, value, tone }: { label: string; value: number; tone?: 'ok' | 'warn' | 'bad' }) {
  const color =
    tone === 'bad' ? 'var(--danger, var(--red))' :
    tone === 'warn' ? 'var(--warn, var(--amber))' :
    'var(--ok, var(--accent))';
  return (
    <div className="rounded-lg border p-3" style={{ borderColor: 'var(--line)', background: 'var(--panel)' }}>
      <div className="text-[11px] uppercase tracking-wide" style={{ color: 'var(--muted)' }}>{label}</div>
      <div className="num text-[22px] font-semibold" style={{ color: value > 0 ? color : 'var(--ink)' }}>
        {value}
      </div>
    </div>
  );
}
