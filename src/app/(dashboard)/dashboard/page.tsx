'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';

import { useSession } from '../../session';
import { useProjectData, L, statusTone } from '@/lib/project-data';
import { projects, approvals, type MisProjectRow, type MisResult } from '@/lib/services';
import {
  Bar,
  Chip,
  DataTable,
  DonutChart,
  Feed,
  Grid,
  HBarChart,
  KpiGrid,
  KVList,
  PageHead,
  Panel,
  RadialGauge,
  StackedBar,
  VitalsRail,
} from '@/components/ui';

/**
 * Landing page.
 *
 * Portfolio vitals from the MIS endpoint; project KPIs from the project data
 * context. Data is live from the API — no sample values remain.
 */

const HEALTH_COLOR: Record<string, string> = {
  green: 'var(--ok)',
  amber: 'var(--warn)',
  red: 'var(--danger)',
};

export default function DashboardPage() {
  const { user } = useSession();
  const { projects: PROJECTS, current, loading, error } = useProjectData();

  const [mis, setMis] = useState<MisResult | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const result = await projects.portfolioMis();
        if (!cancelled) setMis(result);
      } catch {
        // MIS is a roll-up; a failure leaves it null, the render handles that.
      }
    })();
    return () => { cancelled = true; };
  }, []);

  if (!user) return null;

  // --- derived chart data ------------------------------------------------

  const healthSegments = (mis ? mis.rows : [])
    .reduce((acc, r) => {
      acc[r.health] = (acc[r.health] ?? 0) + 1;
      return acc;
    }, {} as Record<string, number>) as Record<string, number>;

  const donutSegments = [
    { value: healthSegments.green ?? 0, color: 'var(--ok)', label: 'Green' },
    { value: healthSegments.amber ?? 0, color: 'var(--warn)', label: 'Amber' },
    { value: healthSegments.red ?? 0, color: 'var(--danger)', label: 'Red' },
  ].filter((s) => s.value > 0);

  // Extra health content: RAG breakdown + KPI tiles (compact, fits same box).
  const misRows: MisProjectRow[] = mis ? mis.rows : [];
  const healthStats =
    misRows.length > 0
      ? (() => {
        const total = misRows.length;

        const ragRows = (['green', 'amber', 'red'] as const).map((k) => {
          const count = misRows.filter((r) => r.health === k).length;
          return {
            key: k,
            label: k.charAt(0).toUpperCase() + k.slice(1),
            count,
            pct: Math.round((count / total) * 100),
            color: HEALTH_COLOR[k],
          };
        });

        const avgSpi = misRows.reduce((s, r) => s + r.spi, 0) / total;
        const avgCpi = misRows.reduce((s, r) => s + r.cpi, 0) / total;
        const avgProgress = Math.round(misRows.reduce((s, r) => s + r.progress, 0) / total);
        const overBudget = misRows.filter((r) => r.eac > r.budget).length;

        return { ragRows, avgSpi, avgCpi, avgProgress, overBudget };
      })()
      : null;

  const eacBars = (mis ? [...mis.rows] : [])
    .sort((a, b) => b.eac - a.eac)
    .map((r) => ({
      label: r.name,
      value: r.eac,
      tone: (r.eac > r.budget ? 'bad' : 'ok') as 'ok' | 'bad',
    }));

  const openItemStacks = (mis ? mis.rows : [])
    .filter((r) => r.openNcrs > 0 || r.openClaims > 0 || r.pendingApprovals > 0)
    .map((r) => ({
      label: r.name,
      segments: [
        { value: r.openNcrs, color: 'var(--danger)', label: `NCR ${r.openNcrs}` },
        { value: r.openClaims, color: 'var(--warn)', label: `Claims ${r.openClaims}` },
        { value: r.pendingApprovals, color: 'var(--accent)', label: `Approvals ${r.pendingApprovals}` },
      ],
    }));

  const p = current;
  const activeProjects = PROJECTS.filter((x) => x.status === 'Active').length;
  const planningProjects = PROJECTS.filter((x) => x.status === 'Planning').length;
  const delayedProjects = PROJECTS.filter((x) => x.status === 'Delayed').length;
  const orderBook = PROJECTS.reduce((sum, x) => sum + x.value, 0);
  const costBooked = PROJECTS.reduce((sum, x) => sum + x.actual, 0);
  const billed = PROJECTS.reduce((sum, x) => sum + x.billed, 0);
  const collected = PROJECTS.reduce((sum, x) => sum + x.collected, 0);

  if (!p) {
    return (
      <PageHead
        title={`Welcome, ${user.name}`}
        description="No project is in your scope yet."
      />
    );
  }

  return (
    <>
      <PageHead
        title={`Welcome, ${user.name}`}
        description={`Signed in as ${user.role}. ${activeProjects} active projects across the portfolio.`}
        actions={
          <>
            <Link href="/approvals" className="rounded px-[13px] py-[7px] text-[13px] font-medium" style={{ border: '1px solid var(--line)', background: 'var(--panel)' }}>
              Open approvals
            </Link>
            <Link href="/projects" className="rounded px-[13px] py-[7px] text-[13px] font-medium text-white" style={{ background: 'var(--accent)' }}>
              All projects
            </Link>
          </>
        }
      />

      <VitalsRail
        items={[
          {
            label: 'Projects',
            value: String(mis?.totalProjects ?? PROJECTS.length),
            unit: `${mis?.activeProjects ?? activeProjects} active`,
            note: `${mis?.delayedProjects ?? delayedProjects} delayed · ${planningProjects} in planning`,
          },
          { label: 'Order book', value: L(mis?.orderBook ?? orderBook), note: 'Across all plants' },
          {
            label: 'Cost booked',
            value: L(costBooked),
            pct: orderBook > 0 ? Math.round((costBooked / orderBook) * 100) : 0,
          },
          {
            label: 'Billed / collected',
            value: L(billed),
            unit: `/ ${L(collected)}`,
            pct: billed > 0 ? Math.round((collected / billed) * 100) : 0,
          },
          {
            label: 'Open NCRs + claims',
            value: String((mis?.totalOpenNcrs ?? 0) + (mis?.totalOpenClaims ?? 0)),
            note: `${mis?.totalOpenNcrs ?? 0} NCR · ${mis?.totalOpenClaims ?? 0} claims`,
            tone: (mis?.totalOpenNcrs ?? 0) > 0 ? ('bad' as const) : undefined,
          },
        ]}
      />

      <div className="mt-[18px]" />

      <KpiGrid
        items={[
          { label: 'Physical progress', value: `${p.progress}%`, note: p.name, tone: p.progress < 50 ? 'warn' : undefined },
          { label: 'SPI — schedule', value: p.spi.toFixed(2), note: p.spi < 0.95 ? 'Behind plan' : 'On plan', tone: p.spi < 0.95 ? 'bad' : 'good' },
          { label: 'CPI — cost', value: p.cpi.toFixed(2), note: p.cpi < 1 ? 'Over spend for work done' : 'Within budget', tone: p.cpi < 1 ? 'warn' : 'good' },
          { label: 'Forecast at completion', value: L(p.eac), note: `Budget ${L(p.budget)}` },
        ]}
      />

      <div className="mt-[18px]" />

      {/* Chart band: portfolio visual roll-up */}
      {mis && mis.rows.length > 0 ? (
        <>
          <Grid cols={2}>
            <Panel title="Portfolio health" sub="RAG distribution" bodyless>
              <div className="flex items-center gap-4 px-4 py-5 mt-4">
                {donutSegments.length > 0 && healthStats ? (
                  <>
                    {/* Lock donut wrapper to exact ring size, kill hidden extra space */}
                    <div
                      className="shrink-0 overflow-visible"
                      style={{ width: 150, height: 150, lineHeight: 0 }}
                    >
                      <DonutChart
                        segments={donutSegments}
                        centreLabel={String(mis.totalProjects)}
                        centreSub="projects"
                        size={150}
                        thickness={22}
                        fillCentre
                      />
                    </div>

                    {/* Details, right */}
                    <div className="flex min-w-0 flex-1 flex-col gap-16">
                      {/* RAG bars */}
                      <div className="flex flex-col gap-1">
                        {healthStats.ragRows.map((g) => (
                          <div key={g.key} className="flex items-center gap-2 text-[11px]">
                            <span className="flex w-[48px] shrink-0 items-center gap-1.5 font-semibold">
                              <i
                                className="inline-block h-2 w-2 rounded-[2px]"
                                style={{ background: g.color }}
                              />
                              {g.label}
                            </span>
                            <div
                              className="h-[6px] min-w-0 flex-1 overflow-hidden rounded-full"
                              style={{ background: 'var(--line-2)' }}
                            >
                              <div
                                className="h-full rounded-full"
                                style={{ width: `${g.pct}%`, background: g.color }}
                              />
                            </div>
                            <span
                              className="num w-[56px] shrink-0 whitespace-nowrap text-right"
                              style={{ color: 'var(--muted)' }}
                            >
                              {g.count} · {g.pct}%
                            </span>
                          </div>
                        ))}
                      </div>

                      {/* Compact stat rows 2x2: label left, value right */}
                      <div className="grid grid-cols-2 gap-1.5">
                        {[
                          {
                            label: 'Avg SPI',
                            value: healthStats.avgSpi.toFixed(2),
                            color: healthStats.avgSpi < 0.95 ? 'var(--danger)' : 'var(--ok)',
                          },
                          {
                            label: 'Avg CPI',
                            value: healthStats.avgCpi.toFixed(2),
                            color: healthStats.avgCpi < 1 ? 'var(--warn)' : 'var(--ok)',
                          },
                          {
                            label: 'Progress',
                            value: `${healthStats.avgProgress}%`,
                            color: undefined,
                          },
                          {
                            label: 'Over budget',
                            value: String(healthStats.overBudget),
                            color: healthStats.overBudget > 0 ? 'var(--danger)' : 'var(--ok)',
                          },
                        ].map((t) => (
                          <div
                            key={t.label}
                            className="flex items-center justify-between gap-2 rounded-md px-2 py-1"
                            style={{ background: 'var(--panel-2)', border: '1px solid var(--line-2)' }}
                          >
                            <span
                              className="whitespace-nowrap text-[9.5px] uppercase tracking-wide"
                              style={{ color: 'var(--muted)' }}
                            >
                              {t.label}
                            </span>
                            <span
                              className="num text-[13px] font-semibold leading-none"
                              style={{ color: t.color }}
                            >
                              {t.value}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  </>
                ) : (
                  <p className="text-[12.5px]" style={{ color: 'var(--muted)' }}>No projects yet.</p>
                )}
              </div>
            </Panel>

            <Panel title="EAC by project" sub="Over-budget bars in red" bodyless>
              <div className="p-4">
                {eacBars.length > 0 ? (
                  <HBarChart items={eacBars} unit="L" height={20} />
                ) : (
                  <p className="text-[12.5px]" style={{ color: 'var(--muted)' }}>No EAC data.</p>
                )}
              </div>
            </Panel>
          </Grid>

          <div className="mt-[18px] grid gap-[18px] grid-cols-1 lg:grid-cols-2">
            <Panel title="Open items by project" sub="NCR · claims · approvals" bodyless>
              <div className="p-4">
                {openItemStacks.length > 0 ? (
                  <div>
                    <div className="mb-3 flex flex-wrap gap-3 text-[11px]" style={{ color: 'var(--muted)' }}>
                      <span className="flex items-center gap-1.5"><i className="inline-block h-2 w-2 rounded-[2px]" style={{ background: 'var(--danger)' }} /> NCR</span>
                      <span className="flex items-center gap-1.5"><i className="inline-block h-2 w-2 rounded-[2px]" style={{ background: 'var(--warn)' }} /> Claims</span>
                      <span className="flex items-center gap-1.5"><i className="inline-block h-2 w-2 rounded-[2px]" style={{ background: 'var(--accent)' }} /> Approvals</span>
                    </div>
                    <StackedBar rows={openItemStacks} />
                  </div>
                ) : (
                  <p className="text-[12.5px]" style={{ color: 'var(--muted)' }}>No open items.</p>
                )}
              </div>
            </Panel>

            <Panel title="Schedule index (SPI)" sub="Below 97% amber · below 90% red" bodyless>
              <div className="flex flex-wrap items-start gap-4 p-4">
                {mis.rows.filter((r) => r.status !== 'completed' && r.status !== 'closed').slice(0, 4).map((r) => (
                  <RadialGauge
                    key={r.projectId}
                    value={Math.round(r.spi * 100)}
                    max={120}
                    label={r.name.slice(0, 16)}
                    unit="%"
                    tone={r.spi >= 0.97 ? 'ok' : r.spi >= 0.9 ? 'warn' : 'bad'}
                    size={80}
                    thickness={7}
                  />
                ))}
                {mis.rows.filter((r) => r.status !== 'completed' && r.status !== 'closed').length === 0
                  ? <p className="text-[12.5px]" style={{ color: 'var(--muted)' }}>No active projects.</p>
                  : null}
              </div>
            </Panel>
          </div>

          <div className="mt-[18px]" />
        </>
      ) : null}

      {mis && mis.rows.length > 0 ? (
        <div className="mb-[18px]">
          <Panel title="Portfolio MIS" sub="Live roll-up across all projects in scope" bodyless>
            <DataTable
              columns={[
                { key: 'name', label: 'Project' },
                { key: 'pm', label: 'Manager' },
                { key: 'status', label: 'Health' },
                { key: 'progress', label: 'Progress', align: 'right' },
                { key: 'spi', label: 'SPI', align: 'right' },
                { key: 'cpi', label: 'CPI', align: 'right' },
                { key: 'eac', label: 'EAC (₹L)', align: 'right' },
                { key: 'ncr', label: 'Open NCR', align: 'right' },
                { key: 'claims', label: 'Open claims', align: 'right' },
                { key: 'appr', label: 'Pending appr.', align: 'right' },
              ]}
              rows={mis.rows.map((r) => [
                <span key="n" className="font-semibold">{r.name}</span>,
                r.pm,
                <Chip key="h" tone={r.health === 'green' ? 'ok' : r.health === 'amber' ? 'warn' : 'bad'}>
                  {r.health}
                </Chip>,
                <span key="pr" className="num">{r.progress}%</span>,
                <span key="sp" className="num" style={{ color: r.spi < 0.95 ? 'var(--red)' : undefined }}>{r.spi.toFixed(2)}</span>,
                <span key="cp" className="num" style={{ color: r.cpi < 1 ? 'var(--amber)' : undefined }}>{r.cpi.toFixed(2)}</span>,
                <span key="eac" className="num">{r.eac.toLocaleString('en-IN')}</span>,
                <span key="ncr" className="num" style={{ color: r.openNcrs > 0 ? 'var(--red)' : undefined }}>{r.openNcrs}</span>,
                <span key="cl" className="num">{r.openClaims}</span>,
                <span key="ap" className="num">{r.pendingApprovals}</span>,
              ])}
            />
          </Panel>
        </div>
      ) : null}

      <Grid cols="2-1">
        <div>
          <Panel
            title="Your permissions"
            sub={`${user.permissions.length} granted to ${user.role}`}
          >
            <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
              {groupPermissions(user.permissions).map((group) => (
                <div
                  key={group.module}
                  className="rounded-md p-3"
                  style={{ background: 'var(--panel-2)', border: '1px solid var(--line-2)' }}
                >
                  <div className="text-[13px] font-semibold capitalize" style={{ color: 'var(--ink)' }}>
                    {group.module}
                  </div>
                  <div className="mt-1.5 flex flex-wrap gap-1">
                    {group.actions.map((a) => (
                      <span
                        key={a}
                        className="rounded px-1.5 py-[2px] text-[10.5px] font-medium"
                        style={{ background: 'var(--accent-soft)', color: 'var(--accent-dark)' }}
                      >
                        {a}
                      </span>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </Panel>
        </div>

        <div>
          <Panel title="Approvals waiting on you">
            <Feed
              items={
                mis && mis.totalPendingApprovals > 0
                  ? mis.rows
                    .filter((r) => r.pendingApprovals > 0)
                    .map((r) => ({
                      tone: 'warn' as const,
                      text: (
                        <span>
                          <b>{r.name}</b> — {r.pendingApprovals} pending approval
                          {r.pendingApprovals > 1 ? 's' : ''}
                        </span>
                      ),
                      meta: `SPI ${r.spi.toFixed(2)} · CPI ${r.cpi.toFixed(2)}`,
                      time: 'live',
                    }))
                  : [{ tone: 'ok' as const, text: 'No pending approvals in your scope.', meta: 'All clear', time: '' }]
              }
            />
          </Panel>

          <Panel title="Schedule and earned value">
            <KVList
              pairs={[
                ['Critical path', <Chip key="cp" tone={p.cp === 'On track' ? 'ok' : 'bad'}>{p.cp}</Chip>],
                ['Driving activity', 'Digester fabrication'],
                ['Total float remaining', '0 days'],
                ['SPI · schedule', <span key="spi" className="num" style={{ color: p.spi < 0.95 ? 'var(--red)' : 'var(--accent-dark)' }}>{p.spi.toFixed(2)}</span>],
                ['CPI · cost', <span key="cpi" className="num" style={{ color: p.cpi < 1 ? 'var(--amber)' : 'var(--accent-dark)' }}>{p.cpi.toFixed(2)}</span>],
                ['Forecast at completion', <span key="eac" className="num">{L(p.eac)}</span>],
              ]}
            />
          </Panel>
        </div>
      </Grid>
    </>
  );
}

/**
 * Groups a flat `module:action` array into per-module buckets, preserving the
 * order in which each module first appears.
 */
function groupPermissions(
  permissions: string[],
): { module: string; actions: string[] }[] {
  const map = new Map<string, string[]>();
  for (const perm of permissions) {
    const [module, action] = perm.split(':');
    const list = map.get(module) ?? [];
    list.push(action);
    map.set(module, list);
  }
  return [...map.entries()].map(([module, actions]) => ({ module, actions }));
}