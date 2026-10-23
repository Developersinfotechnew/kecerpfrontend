'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';

import {
  Chip, DataTable, DonutChart, HBarChart, Notice, PageHead, Panel,
  RadialGauge, StackedBar, VitalsRail, Grid,
} from '@/components/ui';
import { useProjectData, L } from '@/lib/project-data';
import { projects, type MisResult } from '@/lib/services';

/**
 * PMO / CEO MIS.
 *
 * Live cross-project roll-up with five chart bands above the table:
 *   - Health distribution donut
 *   - EAC vs budget horizontal bars per project
 *   - NCR / claims / approvals stacked bar per project
 *   - SPI radial gauges
 *   - Pending approvals table (unchanged)
 *
 * All data from /projects/portfolio-mis — no hardcoded values.
 */

const HEALTH_TONE: Record<string, 'ok' | 'warn' | 'bad' | 'mute'> = {
  green: 'ok',
  amber: 'warn',
  red: 'bad',
};

const HEALTH_COLOR: Record<string, string> = {
  green: 'var(--ok)',
  amber: 'var(--warn)',
  red: 'var(--danger)',
};

export default function EpcMisPage() {
  const { projects: PROJ } = useProjectData();
  const [mis, setMis] = useState<MisResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setMis(await projects.portfolioMis());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load portfolio MIS');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // --- derived chart data ------------------------------------------------

  const healthSegments = useMemo(() => {
    if (!mis) return [];
    const counts = { green: 0, amber: 0, red: 0 };
    for (const r of mis.rows) {
      counts[r.health] = (counts[r.health] ?? 0) + 1;
    }
    return [
      { value: counts.green, color: HEALTH_COLOR.green, label: 'Green' },
      { value: counts.amber, color: HEALTH_COLOR.amber, label: 'Amber' },
      { value: counts.red, color: HEALTH_COLOR.red, label: 'Red' },
    ].filter((s) => s.value > 0);
  }, [mis]);

  const eacBarItems = useMemo(() => {
    if (!mis) return [];
    return [...mis.rows]
      .sort((a, b) => b.eac - a.eac)
      .map((r) => ({
        label: r.name,
        value: r.eac,
        tone: (r.eac > r.budget ? 'bad' : 'ok') as 'ok' | 'bad',
      }));
  }, [mis]);

  const stackedRows = useMemo(() => {
    if (!mis) return [];
    return mis.rows
      .filter((r) => r.openNcrs > 0 || r.openClaims > 0 || r.pendingApprovals > 0)
      .map((r) => ({
        label: r.name,
        segments: [
          { value: r.openNcrs, color: 'var(--danger)', label: `Open NCRs: ${r.openNcrs}` },
          { value: r.openClaims, color: 'var(--warn)', label: `Open claims: ${r.openClaims}` },
          { value: r.pendingApprovals, color: 'var(--accent)', label: `Pending approvals: ${r.pendingApprovals}` },
        ],
      }));
  }, [mis]);

  const spiGauges = useMemo(() => {
    if (!mis) return [];
    return [...mis.rows]
      .filter((r) => r.status !== 'completed' && r.status !== 'closed')
      .slice(0, 6)
      .map((r) => ({
        value: Math.round(r.spi * 100),
        label: r.name.slice(0, 18),
        tone: (r.spi >= 0.97 ? 'ok' : r.spi >= 0.9 ? 'warn' : 'bad') as 'ok' | 'warn' | 'bad',
      }));
  }, [mis]);

  // --- render -------------------------------------------------------------

  if (loading) {
    return <PageHead title="PMO / CEO MIS" description="Loading portfolio roll-up…" />;
  }

  if (error || !mis) {
    return (
      <>
        <PageHead title="PMO / CEO MIS" description="Live portfolio roll-up" />
        <Notice>{error ?? 'No data available.'}</Notice>
      </>
    );
  }

  const variance = mis.totalEac - mis.totalBudget;

  return (
    <>
      <PageHead
        title="PMO / CEO MIS"
        description={`Live roll-up across ${mis.totalProjects} projects · refreshed ${new Date().toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}`}
      />

      <VitalsRail
        items={[
          {
            label: 'Order book',
            value: L(mis.orderBook),
            note: `${mis.totalProjects} projects · ${mis.activeProjects} active · ${mis.delayedProjects} delayed`,
          },
          {
            label: 'EAC vs budget',
            value: L(mis.totalEac),
            unit: `vs ${L(mis.totalBudget)}`,
            pct: mis.totalBudget > 0 ? Math.round((mis.totalEac / mis.totalBudget) * 100) : 0,
            tone: variance > 0 ? 'bad' : undefined,
          },
          {
            label: 'Open quality items',
            value: String(mis.totalOpenNcrs + mis.totalOpenClaims),
            note: `${mis.totalOpenNcrs} NCR · ${mis.totalOpenClaims} claims`,
            tone: mis.totalOpenNcrs > 0 ? 'warn' : undefined,
          },
          {
            label: 'Pending approvals',
            value: String(mis.totalPendingApprovals),
            note: 'across all projects',
          },
          {
            label: 'Closed final accounts',
            value: L(mis.totalFinalAccount),
            note: 'agreed / paid settlements',
          },
        ]}
      />

      <div className="mt-[18px]" />

      {/* Chart row 1: health donut + EAC bars */}
      <Grid cols={2}>
        <Panel
          title="Portfolio health"
          sub="RAG distribution across all projects"
          bodyless
        >
          <div className="flex items-center justify-center p-6">
            {healthSegments.length > 0 ? (
              <DonutChart
                segments={healthSegments}
                centreLabel={String(mis.totalProjects)}
                centreSub="projects"
                size={130}
                thickness={18}
              />
            ) : (
              <p className="text-[13px]" style={{ color: 'var(--muted)' }}>
                No projects in scope.
              </p>
            )}
          </div>
        </Panel>

        <Panel
          title="EAC by project"
          sub="Estimate at completion vs budget · over-budget bars in red"
          bodyless
        >
          <div className="p-4">
            {eacBarItems.length > 0 ? (
              <HBarChart items={eacBarItems} unit="L" height={22} />
            ) : (
              <p className="text-[13px]" style={{ color: 'var(--muted)' }}>No EAC data yet.</p>
            )}
          </div>
        </Panel>
      </Grid>

      {/* Chart row 2: stacked open-items + SPI gauges */}
      <div className="mt-[18px] grid gap-[18px] grid-cols-1 lg:grid-cols-2">
        <Panel
          title="Open items by project"
          sub="Open NCRs · Open claims · Pending approvals"
          bodyless
        >
          <div className="p-4">
            {stackedRows.length > 0 ? (
              <div>
                <div className="mb-3 flex flex-wrap gap-3 text-[11px]" style={{ color: 'var(--muted)' }}>
                  <span className="flex items-center gap-1.5">
                    <i className="inline-block h-2 w-2 rounded-[2px]" style={{ background: 'var(--danger)' }} />
                    Open NCRs
                  </span>
                  <span className="flex items-center gap-1.5">
                    <i className="inline-block h-2 w-2 rounded-[2px]" style={{ background: 'var(--warn)' }} />
                    Open claims
                  </span>
                  <span className="flex items-center gap-1.5">
                    <i className="inline-block h-2 w-2 rounded-[2px]" style={{ background: 'var(--accent)' }} />
                    Pending approvals
                  </span>
                </div>
                <StackedBar rows={stackedRows} />
              </div>
            ) : (
              <p className="text-[13px]" style={{ color: 'var(--muted)' }}>No open items.</p>
            )}
          </div>
        </Panel>

        <Panel
          title="Schedule performance"
          sub="SPI as % · below 97% amber, below 90% red"
          bodyless
        >
          <div className="flex flex-wrap items-start gap-5 p-4">
            {spiGauges.length > 0 ? (
              spiGauges.map((g, i) => (
                <RadialGauge
                  key={i}
                  value={g.value}
                  max={120}
                  label={g.label}
                  unit="%"
                  tone={g.tone}
                  size={90}
                  thickness={8}
                />
              ))
            ) : (
              <p className="text-[13px]" style={{ color: 'var(--muted)' }}>No active projects with SPI data.</p>
            )}
          </div>
        </Panel>
      </div>

      <div className="mt-[18px]" />

      {/* Full project table */}
      <Panel
        title="Project MIS"
        sub="One row per project · SPI/CPI/health from stored indices · NCR/claims/approvals live"
        bodyless
      >
        <DataTable
          columns={[
            { key: 'project', label: 'Project' },
            { key: 'pm', label: 'PM' },
            { key: 'health', label: 'Health', align: 'right' },
            { key: 'prog', label: 'Progress', align: 'right' },
            { key: 'spi', label: 'SPI', align: 'right' },
            { key: 'cpi', label: 'CPI', align: 'right' },
            { key: 'eac', label: 'EAC (₹L)', align: 'right' },
            { key: 'var', label: 'Var %', align: 'right' },
            { key: 'ncr', label: 'NCR', align: 'right' },
            { key: 'claims', label: 'Claims', align: 'right' },
            { key: 'appr', label: 'Appr.', align: 'right' },
            { key: 'fa', label: 'Closed FA', align: 'right' },
          ]}
          rows={mis.rows.map((r) => {
            const rowVar = r.budget > 0 ? Math.round(((r.eac - r.budget) / r.budget) * 100) : 0;
            return [
              <span key="n" className="font-semibold">{r.name}</span>,
              r.pm || '—',
              <Chip key="h" tone={HEALTH_TONE[r.health] ?? 'mute'}>{r.health}</Chip>,
              <span key="p" className="num">{r.progress}%</span>,
              <span key="sp" className="num" style={{ color: r.spi < 0.95 ? 'var(--red)' : undefined }}>
                {r.spi.toFixed(2)}
              </span>,
              <span key="cp" className="num" style={{ color: r.cpi < 1 ? 'var(--amber)' : undefined }}>
                {r.cpi.toFixed(2)}
              </span>,
              <span key="eac" className="num">{r.eac.toLocaleString('en-IN')}</span>,
              <span key="v" className="num" style={{ color: rowVar > 0 ? 'var(--red)' : 'var(--ok)' }}>
                {rowVar > 0 ? '+' : ''}{rowVar}%
              </span>,
              <span key="n2" className="num" style={{ color: r.openNcrs > 0 ? 'var(--red)' : undefined }}>
                {r.openNcrs}
              </span>,
              <span key="cl" className="num">{r.openClaims}</span>,
              <span key="a" className="num">{r.pendingApprovals}</span>,
              <span key="fa" className="num">
                {r.closedAccounts > 0 ? `${r.closedAccounts} · ₹${r.finalAccount.toLocaleString('en-IN')}L` : '—'}
              </span>,
            ];
          })}
        />
      </Panel>

      {mis.rows.some((r) => r.pendingApprovals > 0) ? (
        <div className="mt-[18px]" />
      ) : null}

      <Panel
        title="Projects awaiting approval"
        sub="Open approval chains by project"
        bodyless
      >
        {mis.rows.filter((r) => r.pendingApprovals > 0).length === 0 ? (
          <p className="m-0 p-4 text-[13px]" style={{ color: 'var(--muted)' }}>
            No pending approvals. All open items are cleared.
          </p>
        ) : (
          <DataTable
            columns={[
              { key: 'project', label: 'Project' },
              { key: 'pending', label: 'Pending', align: 'right' },
              { key: 'oldest', label: 'Oldest open since' },
            ]}
            rows={mis.rows.filter((r) => r.pendingApprovals > 0).map((r) => [
              <span key="n" className="font-semibold">{r.name}</span>,
              <span key="p" className="num">{r.pendingApprovals}</span>,
              <span key="o" style={{ color: 'var(--muted)' }}>—</span>,
            ])}
          />
        )}
      </Panel>
    </>
  );
}
