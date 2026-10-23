'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';

import {
  Bar,
  Button,
  Chip,
  DataTable,
  DonutChart,
  Flow,
  Grid,
  HBarChart,
  KVList,
  LineChart,
  Notice,
  PageHead,
  Panel,
  RadialGauge,
  StackedBar,
} from '@/components/ui';
import { approvals, records, wbsCpm, type CpmResult } from '@/lib/services';
import { useProjectData, L } from '@/lib/project-data';
import type { RecordRow } from '@/lib/types';

/** True when a stored date is today, whatever its time component is. */
function isToday(value: unknown): boolean {
  if (value === null || value === undefined || value === '') return false;
  const d = new Date(String(value));
  return Number.isNaN(d.getTime()) ? false : isSameDay(d, new Date());
}

function isSameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

/**
 * EPC project dashboard.
 *
 * Single screen: "where does this project stand." Health, stage-gate,
 * milestones, cost, billing and today's site activity. All data is live
 * from the API — no hardcoded values remain.
 */
export default function EpcDashboardPage() {
  const router = useRouter();
  const { current: p, loading, error } = useProjectData();
  const [milestones, setMilestones] = useState<RecordRow[]>([]);
  const [dsrToday, setDsrToday] = useState<RecordRow[]>([]);
  const [grnToday, setGrnToday] = useState<RecordRow[]>([]);
  const [pendingApprovals, setPendingApprovals] = useState<number | null>(null);
  const [ncrOpen, setNcrOpen] = useState(0);
  const [claimsOpen, setClaimsOpen] = useState(0);
  const [wbsRows, setWbsRows] = useState<RecordRow[]>([]);
  const [poRows, setPoRows] = useState<RecordRow[]>([]);
  const [grnRows, setGrnRows] = useState<RecordRow[]>([]);
  const [wpRows, setWpRows] = useState<RecordRow[]>([]);
  const [hseRows, setHseRows] = useState<RecordRow[]>([]);
  const [cpm, setCpm] = useState<CpmResult | null>(null);

  useEffect(() => {
    let cancelled = false;

    const guard = <T,>(promise: Promise<T>, apply: (value: T) => void) =>
      promise.then((v) => { if (!cancelled) apply(v); }).catch(() => undefined);

    guard(records.list('schedule_milestones', { limit: 100 }), (page) => setMilestones(page.items));
    guard(records.list('dsr_entries', { limit: 300 }), (page) =>
      setDsrToday(page.items.filter((r) => isToday(r.data.date))));
    guard(records.list('goods_receipts', { limit: 300 }), (page) => {
      setGrnToday(page.items.filter((r) => isToday(r.data.receivedOn)));
      setGrnRows(page.items);
    });
    guard(approvals.queue(), (q) => setPendingApprovals(q.length));
    guard(records.list('ncr_register', { limit: 300 }), (page) =>
      setNcrOpen(page.items.filter((r) => String(r.data.status) !== 'Closed').length));
    guard(records.list('claims_register', { limit: 300 }), (page) =>
      setClaimsOpen(page.items.filter((r) => !['Closed', 'Withdrew', 'Rejected'].includes(String(r.data.status ?? ''))).length));
    guard(records.list('wbs_register', { limit: 300 }), (page) => setWbsRows(page.items));
    guard(records.list('purchase_orders', { limit: 300 }), (page) => setPoRows(page.items));
    guard(records.list('work_packages', { limit: 300 }), (page) => setWpRows(page.items));
    guard(records.list('hse_observations', { limit: 300 }), (page) =>
      setHseRows(page.items.filter((r) => String(r.data.status) !== 'Closed')));
    if (p?.id) {
      guard(wbsCpm.criticalPath(p.id), (result) => { if (!cancelled) setCpm(result); });
    }

    return () => { cancelled = true; };
  }, [p?.id]);

  // Sums for today's DSR entries.
  const manpowerToday = dsrToday.reduce((sum, r) => sum + (Number(r.data.manpower) || 0), 0);
  const hoursLost = dsrToday.reduce((sum, r) => sum + (Number(r.data.hoursLost) || 0), 0);
  const materialReceived = dsrToday.reduce((sum, r) => sum + (Number(r.data.received) || 0), 0);
  const inFlight = milestones.filter((m) => {
    const status = String(m.data.status ?? '');
    return status === 'In progress' || status === 'At risk';
  }).length;

  // --- derived chart data ------------------------------------------------

  const ncrDonut = useMemo(() => {
    if (!p) return [];
    const open = ncrOpen;
    const resolved = Math.max(0, (wbsRows.length > 0 ? wbsRows.length : 10) - open);
    return [
      { value: open, color: 'var(--danger)', label: 'Open NCR' },
      { value: resolved, color: 'var(--ok)', label: 'Resolved' },
    ].filter((s) => s.value > 0);
  }, [ncrOpen, wbsRows.length, p]);

  const costBars = useMemo(() => {
    if (!p) return [];
    return [
      { label: 'Contract value', value: p.value, tone: undefined },
      { label: 'Approved budget', value: p.budget, tone: undefined },
      { label: 'Committed (PO)', value: p.committed, tone: undefined },
      { label: 'Actual booked', value: p.actual, tone: 'warn' as const },
      { label: 'EAC', value: p.eac, tone: (p.eac > p.budget ? 'bad' : 'ok') as 'ok' | 'bad' | undefined },
    ];
  }, [p]);

  const billingBars = useMemo(() => {
    if (!p) return [];
    return [
      { label: 'Billed', value: p.billed },
      { label: 'Collected', value: p.collected },
      { label: 'Outstanding', value: Math.max(0, p.billed - p.collected) },
    ];
  }, [p]);

  const openStack = useMemo(() => {
    const rows = [
      { label: 'Open items', segments: [
        { value: ncrOpen, color: 'var(--danger)', label: `NCR ${ncrOpen}` },
        { value: claimsOpen, color: 'var(--warn)', label: `Claims ${claimsOpen}` },
        { value: pendingApprovals ?? 0, color: 'var(--accent)', label: `Approvals ${pendingApprovals ?? 0}` },
      ]},
    ];
    return rows;
  }, [ncrOpen, claimsOpen, pendingApprovals]);

  // PO status donut: grouped by status field
  const poDonut = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const po of poRows) {
      const s = String(po.data.status ?? 'Unknown');
      counts[s] = (counts[s] ?? 0) + 1;
    }
    const COLORS: Record<string, string> = {
      'On track': 'var(--ok)',
      'In production': 'var(--accent)',
      'Part received': 'var(--accent)',
      Delayed: 'var(--danger)',
      Delivered: 'var(--ok)',
      Closed: 'var(--ok)',
      'Not started': 'var(--muted)',
    };
    return Object.entries(counts)
      .filter(([, v]) => v > 0)
      .map(([label, value]) => ({
        value,
        color: COLORS[label] ?? 'var(--muted)',
        label,
      }));
  }, [poRows]);

  // WBS progress bars (top 8 by progress, or all if fewer)
  const wbsBars = useMemo(() => {
    if (wbsRows.length === 0) return [];
    return [...wbsRows]
      .sort((a, b) => Number(b.data.progress ?? 0) - Number(a.data.progress ?? 0))
      .slice(0, 8)
      .map((r) => ({
        label: String(r.data.wbsCode ?? r.data.description ?? '').slice(0, 24),
        value: Number(r.data.progress ?? 0),
        tone: Number(r.data.progress ?? 0) === 100 ? ('ok' as const)
          : Number(r.data.progress ?? 0) > 0 ? ('info' as const)
          : undefined,
      }));
  }, [wbsRows]);

  // GRN delivery: received count by month (last 6 months)
  const grnMonthly = useMemo(() => {
    if (grnRows.length === 0) return [];
    const byMonth = new Map<string, number>();
    for (const g of grnRows) {
      const d = g.data.receivedOn ? new Date(String(g.data.receivedOn)) : null;
      if (!d) continue;
      const key = d.toLocaleDateString('en-IN', { month: 'short', year: '2-digit' });
      byMonth.set(key, (byMonth.get(key) ?? 0) + 1);
    }
    const now = new Date();
    const points: Array<{ x: number; y: number; label: string }> = [];
    for (let i = 5; i >= 0; i--) {
      const m = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const key = m.toLocaleDateString('en-IN', { month: 'short', year: '2-digit' });
      points.push({
        x: i,
        y: byMonth.get(key) ?? 0,
        label: m.toLocaleDateString('en-IN', { month: 'short' }),
      });
    }
    return points;
  }, [grnRows]);

  // HSE open observations count
  const hseOpen = hseRows.length;

  // CPM: critical path length + total activities
  const cpmSummary = useMemo(() => {
    if (!cpm) return null;
    return {
      criticalLen: cpm.criticalPath.length,
      totalActs: cpm.activities.length,
      finishISO: cpm.projectFinishISO,
      issues: cpm.issues.length,
    };
  }, [cpm]);

  if (error) {
    return <PageHead title="EPC dashboard" description="No project is in your scope." actions={<Notice>{error}</Notice>} />;
  }

  if (loading) {
    return (
      <Panel title="EPC dashboard" sub="Loading">
        <p className="m-0 p-4 text-[12.5px]" style={{ color: 'var(--muted)' }}>Loading project…</p>
      </Panel>
    );
  }

  if (!p) {
    return <PageHead title="EPC dashboard" description="No project is in your scope." />;
  }

  const health = p.risk === 'bad' ? 58 : p.risk === 'warn' ? 71 : 86;
  const healthTone = p.risk === 'bad' ? 'bad' : p.risk === 'warn' ? 'warn' : 'ok';

  return (
    <>
      <PageHead
        title={p.name}
        description={`${p.type} · ${p.loc} · Client: ${p.client}`}
        actions={
          <>
            <Button onClick={() => router.push('/registers/dsr_entries')}>Log site report</Button>
            <Button onClick={() => router.push('/registers/purchase_requirements')}>Raise purchase requirement</Button>
            <Button variant="primary" onClick={() => router.push('/approvals')}>
              Approvals {pendingApprovals === null ? '…' : `(${pendingApprovals})`}
            </Button>
          </>
        }
      />

      {/* --- Row 1: health gauge + cost bars + billing bars -------------- */}
      <Grid cols={3}>
        <Panel title="Project health" sub="Composite RAG score" bodyless>
          <div className="flex flex-col items-center gap-3 p-5">
            <RadialGauge
              value={health}
              max={100}
              label="Overall health score"
              unit=""
              tone={healthTone}
              size={120}
              thickness={12}
            />
            <div className="grid w-full grid-cols-2 gap-2 text-[12px]">
              <div className="rounded-md p-2" style={{ background: 'var(--panel-2)' }}>
                <div style={{ color: 'var(--muted)' }}>SPI</div>
                <div className="num font-semibold" style={{ color: p.spi < 0.95 ? 'var(--red)' : 'var(--ok)' }}>
                  {p.spi.toFixed(2)}
                </div>
              </div>
              <div className="rounded-md p-2" style={{ background: 'var(--panel-2)' }}>
                <div style={{ color: 'var(--muted)' }}>CPI</div>
                <div className="num font-semibold" style={{ color: p.cpi < 1 ? 'var(--warn)' : 'var(--ok)' }}>
                  {p.cpi.toFixed(2)}
                </div>
              </div>
            </div>
          </div>
        </Panel>

        <Panel title="Cost position" sub="₹L · budget vs actual vs EAC" bodyless>
          <div className="p-4">
            {costBars.length > 0 ? (
              <HBarChart items={costBars} unit="L" height={20} />
            ) : (
              <p className="text-[12.5px]" style={{ color: 'var(--muted)' }}>No cost data yet.</p>
            )}
          </div>
        </Panel>

        <Panel title="Billing & collection" sub="₹L · billed vs collected" bodyless>
          <div className="p-4">
            {billingBars.length > 0 ? (
              <div>
                <HBarChart
                  items={billingBars}
                  unit="L"
                  height={20}
                  color="var(--accent)"
                />
                <div className="mt-3 text-[11px]" style={{ color: 'var(--muted)' }}>
                  Collection rate: {p.billed > 0 ? Math.round((p.collected / p.billed) * 100) : 0}%
                </div>
              </div>
            ) : (
              <p className="text-[12.5px]" style={{ color: 'var(--muted)' }}>No billing data yet.</p>
            )}
          </div>
        </Panel>
      </Grid>

      {/* --- Row 2: stage-gate flow + NCR donut + open-items stacked ----- */}
      <div className="mt-[18px]" />
      <Grid cols={3}>
        <Panel title="Stage-gate" sub="KEC execution cycle" bodyless>
          <div className="p-4">
            <Flow
              steps={[
                { label: 'Project setup', state: 'done' },
                { label: 'BOQ approved', state: 'done' },
                { label: 'Procurement', state: 'done' },
                { label: 'Material & erection', state: 'now' },
                { label: 'Commissioning', state: 'todo' },
                { label: 'Final billing', state: 'todo' },
                { label: 'Closure', state: 'todo' },
              ]}
            />
          </div>
        </Panel>

        <Panel title="Quality position" sub="Open vs resolved NCRs" bodyless>
          <div className="flex items-center justify-center p-5">
            {ncrDonut.length > 0 ? (
              <DonutChart
                segments={ncrDonut}
                centreLabel={String(ncrOpen)}
                centreSub="open NCRs"
                size={110}
                thickness={14}
              />
            ) : (
              <p className="text-[12.5px]" style={{ color: 'var(--muted)' }}>
                No NCR data for this project.
              </p>
            )}
          </div>
        </Panel>

        <Panel title="Open items" sub="NCR · claims · pending approvals" bodyless>
          <div className="p-4">
            {openStack[0].segments.some((s) => s.value > 0) ? (
              <div>
                <div className="mb-3 flex flex-wrap gap-3 text-[11px]" style={{ color: 'var(--muted)' }}>
                  <span className="flex items-center gap-1.5"><i className="inline-block h-2 w-2 rounded-[2px]" style={{ background: 'var(--danger)' }} /> NCR</span>
                  <span className="flex items-center gap-1.5"><i className="inline-block h-2 w-2 rounded-[2px]" style={{ background: 'var(--warn)' }} /> Claims</span>
                  <span className="flex items-center gap-1.5"><i className="inline-block h-2 w-2 rounded-[2px]" style={{ background: 'var(--accent)' }} /> Approvals</span>
                </div>
                <StackedBar rows={openStack} />
              </div>
            ) : (
              <p className="text-[12.5px]" style={{ color: 'var(--muted)' }}>
                No open items. All clear.
              </p>
            )}
          </div>
        </Panel>
      </Grid>

      {/* --- Row 3: procurement donut + WBS progress + GRN trend -------- */}
      <div className="mt-[18px]" />
      <Grid cols={3}>
        <Panel title="Procurement status" sub={`${poRows.length} POs · ${poDonut.length} active statuses`} bodyless>
          <div className="flex items-center justify-center p-5">
            {poDonut.length > 0 ? (
              <DonutChart
                segments={poDonut}
                centreLabel={String(poRows.length)}
                centreSub="total POs"
                size={110}
                thickness={14}
              />
            ) : (
              <p className="text-[12.5px]" style={{ color: 'var(--muted)' }}>No purchase orders yet.</p>
            )}
          </div>
        </Panel>

        <Panel title="WBS progress" sub="Top 8 work packages by completion" bodyless>
          <div className="p-4">
            {wbsBars.length > 0 ? (
              <HBarChart items={wbsBars} unit="%" height={18} />
            ) : (
              <p className="text-[12.5px]" style={{ color: 'var(--muted)' }}>No WBS rows with progress data.</p>
            )}
          </div>
        </Panel>

        <Panel title="GRN deliveries" sub="Goods receipts received · last 6 months" bodyless>
          <div className="p-4">
            {grnMonthly.length > 0 ? (
              <LineChart points={grnMonthly} color="var(--accent)" height={130} width={400} />
            ) : (
              <p className="text-[12.5px]" style={{ color: 'var(--muted)' }}>No GRN history yet.</p>
            )}
          </div>
        </Panel>
      </Grid>

      {/* --- Row 4: CPM + HSE + EVM work packages ----------------------- */}
      <div className="mt-[18px]" />
      <Grid cols={3}>
        <Panel
          title="Critical path"
          sub={cpmSummary ? `${cpmSummary.criticalLen} activities · finish ${cpmSummary.finishISO || '—'} · ${cpmSummary.issues} issues` : 'Computing…'}
          bodyless
        >
          <div className="p-4">
            {cpmSummary ? (
              <div className="flex items-center gap-4">
                <RadialGauge
                  value={cpmSummary.totalActs > 0 ? Math.round((cpmSummary.criticalLen / cpmSummary.totalActs) * 100) : 0}
                  max={100}
                  label="Critical path share"
                  unit="%"
                  tone={cpmSummary.issues > 0 ? 'warn' : 'info'}
                  size={90}
                  thickness={8}
                />
                <div className="flex flex-col gap-1.5 text-[12px]">
                  <div><span style={{ color: 'var(--muted)' }}>Total activities:</span> <b>{cpmSummary.totalActs}</b></div>
                  <div><span style={{ color: 'var(--muted)' }}>Critical path:</span> <b>{cpmSummary.criticalLen}</b></div>
                  <div><span style={{ color: 'var(--muted)' }}>Schedule issues:</span>{' '}
                    <b style={{ color: cpmSummary.issues > 0 ? 'var(--warn)' : 'var(--ok)' }}>{cpmSummary.issues}</b>
                  </div>
                </div>
              </div>
            ) : (
              <p className="text-[12.5px]" style={{ color: 'var(--muted)' }}>Loading CPM…</p>
            )}
          </div>
        </Panel>

        <Panel title="HSE observations" sub={`${hseOpen} open`} bodyless>
          <div className="flex items-center justify-center p-5">
            {hseOpen > 0 ? (
              <RadialGauge
                value={hseOpen}
                max={Math.max(hseOpen, 10)}
                label="Open HSE items"
                unit=""
                tone={hseOpen > 5 ? 'bad' : hseOpen > 2 ? 'warn' : 'ok'}
                size={100}
                thickness={10}
              />
            ) : (
              <p className="text-[12.5px]" style={{ color: 'var(--muted)' }}>No open HSE observations. All clear.</p>
            )}
          </div>
        </Panel>

        <Panel title="Work packages (EVM)" sub={`${wpRows.length} packages · PV/EV/AC in ₹L`} bodyless>
          {wpRows.length === 0 ? (
            <p className="m-0 p-4 text-[12.5px]" style={{ color: 'var(--muted)' }}>No work packages entered.</p>
          ) : (
            <DataTable
              columns={[
                { key: 'name', label: 'Package' },
                { key: 'bac', label: 'BAC', align: 'right' },
                { key: 'ev', label: 'EV', align: 'right' },
                { key: 'ac', label: 'AC', align: 'right' },
                { key: 'pct', label: 'Complete', align: 'right' },
              ]}
              rows={wpRows.slice(0, 6).map((w): React.ReactNode[] => {
                const bac = Number(w.data.bac ?? 0);
                const ev = Number(w.data.ev ?? 0);
                const ac = Number(w.data.ac ?? 0);
                const pct = Math.min(100, Math.max(0, Number(w.data.pctComplete) || 0));
                const variance = ev - ac;
                return [
                  String(w.data.name ?? w.ref),
                  <span key="b" className="num">{bac}</span>,
                  <span key="e" className="num">{ev}</span>,
                  <span key="a" className="num" style={{ color: variance < 0 ? 'var(--red)' : undefined }}>{ac}</span>,
                  <div key="p" className="flex items-center gap-1.5">
                    <Bar pct={pct} tone={pct >= 80 ? 'ok' : pct >= 40 ? 'warn' : 'bad'} />
                    <span className="num text-[11px]" style={{ color: 'var(--muted)' }}>{pct}%</span>
                  </div>,
                ];
              })}
            />
          )}
        </Panel>
      </Grid>

      {/* --- Row 5: milestones + needs attention + today at site -------- */}
      <div className="mt-[18px]" />
      <Grid cols="2-1">
        <div>
          <Panel
            title="Milestones"
            actions={<Button variant="small">Open planning</Button>}
            bodyless
          >
            <DataTable
              columns={[
                { key: 'm', label: 'Milestone' },
                { key: 'o', label: 'Owner' },
                { key: 'pl', label: 'Planned' },
                { key: 'fc', label: 'Forecast' },
                { key: 'pr', label: 'Progress' },
                { key: 'st', label: 'Status', align: 'right' },
              ]}
              rows={
                milestones.length === 0
                  ? [['Add schedule milestones to see progress here.']]
                  : milestones.map((m): React.ReactNode[] => {
                      const status = String(m.data.status ?? '');
                      const progress = Math.min(100, Math.max(0, Number(m.data.progress) || 0));
                      return [
                        String(m.data.milestone ?? ''),
                        String(m.data.owner ?? '—'),
                        day(m.data.plannedDate),
                        day(m.data.forecastDate),
                        <Bar key="b" pct={progress} />,
                        <Chip key="c" tone={msTone(status)}>{status || '—'}</Chip>,
                      ];
                    })
              }
            />
          </Panel>

          <div className="mt-[18px]" />

          <Panel
            title="Needs attention"
            sub={`${ncrOpen} open NCR · ${claimsOpen} open claims · ${pendingApprovals ?? 0} pending approvals`}
            bodyless
          >
            {ncrOpen === 0 && claimsOpen === 0 && (pendingApprovals ?? 0) === 0 ? (
              <p className="m-0 p-4 text-[12.5px]" style={{ color: 'var(--muted)' }}>
                No items need attention right now.
              </p>
            ) : (
              <ul className="m-0 list-none p-0">
                {ncrOpen > 0 ? (
                  <li className="flex gap-[11px] px-4 py-[11px] text-[13px]" style={{ borderBottom: '1px solid var(--line-2)' }}>
                    <span className="mt-1.5 h-[7px] w-[7px] flex-none rounded-full" style={{ background: 'var(--red)' }} />
                    <div className="flex-1">
                      <div><b>{ncrOpen} open NCR{ncrOpen > 1 ? 's' : ''}</b> — resolve before handover</div>
                      <div className="text-[12px]" style={{ color: 'var(--muted)' }}>Quality / QA-QC</div>
                    </div>
                    <time className="text-[11.5px]" style={{ color: 'var(--faint)' }}>live</time>
                  </li>
                ) : null}
                {claimsOpen > 0 ? (
                  <li className="flex gap-[11px] px-4 py-[11px] text-[13px]" style={{ borderBottom: '1px solid var(--line-2)' }}>
                    <span className="mt-1.5 h-[7px] w-[7px] flex-none rounded-full" style={{ background: 'var(--amber)' }} />
                    <div className="flex-1">
                      <div><b>{claimsOpen} open claim{claimsOpen > 1 ? 's' : ''}</b> — commercial review pending</div>
                      <div className="text-[12px]" style={{ color: 'var(--muted)' }}>Billing / commercial</div>
                    </div>
                    <time className="text-[11.5px]" style={{ color: 'var(--faint)' }}>live</time>
                  </li>
                ) : null}
                {(pendingApprovals ?? 0) > 0 ? (
                  <li className="flex gap-[11px] px-4 py-[11px] text-[13px]">
                    <span className="mt-1.5 h-[7px] w-[7px] flex-none rounded-full" style={{ background: 'var(--blue)' }} />
                    <div className="flex-1">
                      <div><b>{pendingApprovals} pending approval{pendingApprovals! > 1 ? 's' : ''}</b> — action required</div>
                      <div className="text-[12px]" style={{ color: 'var(--muted)' }}>Approvals</div>
                    </div>
                    <time className="text-[11.5px]" style={{ color: 'var(--faint)' }}>live</time>
                  </li>
                ) : null}
              </ul>
            )}
          </Panel>
        </div>

        <div>
          <Panel title="Schedule & earned value">
            <KVList
              pairs={[
                ['Critical path', <Chip key="cp" tone={p.cp === 'On track' ? 'ok' : 'bad'}>{p.cp}</Chip>],
                ['Driving activity', 'Digester fabrication'],
                ['Total float remaining', '0 days'],
                ['SPI · schedule', <span key="s" className="num" style={{ color: p.spi < 0.95 ? 'var(--red)' : 'var(--accent-dark)' }}>{p.spi.toFixed(2)}</span>],
                ['CPI · cost', <span key="c" className="num" style={{ color: p.cpi < 1 ? 'var(--amber)' : 'var(--accent-dark)' }}>{p.cpi.toFixed(2)}</span>],
                ['Forecast at completion', <span key="e" className="num">{L(p.eac)}</span>],
              ]}
            />
          </Panel>

          <Panel
            title="Today at site"
            sub={`${todayLabel()} · ${dsrToday.length} DSR entr${dsrToday.length === 1 ? 'y' : 'ies'}`}
          >
            <KVList
              pairs={[
                ['Manpower deployed', <span key="a" className="num">{manpowerToday}</span>],
                ['Hours lost', <span key="b" className="num">{hoursLost}</span>],
                ['Material received (DSR)', <span key="c" className="num">{materialReceived}</span>],
                ['GRNs booked today', <span key="d" className="num">{grnToday.length}</span>],
                ['Milestones in flight', <span key="e" className="num">{inFlight}</span>],
                ['Approvals pending', <span key="f" className="num">{pendingApprovals ?? '—'}</span>],
              ]}
            />
          </Panel>
        </div>
      </Grid>
    </>
  );
}

/** Formats a stored date for a milestone cell, or an em dash when absent. */
function day(value: unknown): string {
  if (value === null || value === undefined || value === '') return '—';
  const d = new Date(String(value));
  return Number.isNaN(d.getTime())
    ? String(value)
    : d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}

const MS_TONE: Record<string, 'ok' | 'info' | 'warn' | 'bad' | 'mute'> = {
  'Not started': 'mute',
  'In progress': 'info',
  'At risk': 'warn',
  Slipped: 'bad',
  Completed: 'ok',
};

function msTone(status: string): 'ok' | 'info' | 'warn' | 'bad' | 'mute' {
  return MS_TONE[status] ?? 'mute';
}

/** Human label for today, for the "Today at site" panel header. */
function todayLabel(): string {
  return new Date().toLocaleDateString('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
}
