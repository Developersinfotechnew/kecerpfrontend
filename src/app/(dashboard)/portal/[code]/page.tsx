'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';

import {
  Bar,
  Chip,
  DataTable,
  DonutChart,
  Flow,
  Grid,
  HBarChart,
  KVList,
  Notice,
  PageHead,
  Panel,
  RadialGauge,
} from '@/components/ui';
import { L } from '@/lib/project-data';
import { admin, projects, records, type ClientEntity, type ProjectOption } from '@/lib/services';
import type { RecordRow } from '@/lib/types';

/**
 * Client portal — per-client project view.
 *
 * Read-only status dashboard for one client. Shows:
 *   - Plant cards with progress gauge, SPI/CPI, stage-gate position
 *   - Milestone table with planned vs forecast dates
 *   - Quality / NCR / claims status
 *   - Billing & collection position
 *   - Handover / commissioning readiness
 *
 * No edit controls. A client user sees status; they do not modify data.
 * Gated on project:view — same gate as the internal dashboard.
 */

const HEALTH_TONE: Record<string, 'ok' | 'warn' | 'bad' | 'info' | 'mute'> = {
  green: 'ok',
  amber: 'warn',
  red: 'bad',
  planning: 'info',
  active: 'ok',
  onhold: 'warn',
  completed: 'mute',
};

export default function PortalClientPage({ params }: { params: { code: string } }) {
  const code = params.code;
  const [allProjects, setAllProjects] = useState<ProjectOption[]>([]);
  const [projLoading, setProjLoading] = useState(true);
  const [client, setClient] = useState<ClientEntity | null>(null);
  const [clientError, setClientError] = useState<string | null>(null);
  const [milestones, setMilestones] = useState<RecordRow[]>([]);
  const [ncrs, setNcrs] = useState<RecordRow[]>([]);
  const [claims, setClaims] = useState<RecordRow[]>([]);
  const [commissions, setCommissions] = useState<RecordRow[]>([]);

  // Load projects directly — we need the raw ProjectOption with clientName,
  // kind, contractValue and scheduleDays which ProjectView does not carry.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const rows = await projects.list({ kind: 'master' });
        if (!cancelled) setAllProjects(rows);
      } finally {
        if (!cancelled) setProjLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // Filter to projects belonging to this client by name.
  const clientProjects = useMemo(
    () => allProjects.filter((p) => p.clientName === client?.name),
    [allProjects, client],
  );

  const masterProjects = useMemo(
    () => clientProjects,
    [clientProjects],
  );

  const loadClient = useCallback(async () => {
    try {
      const all = await admin.clients();
      const match = all.find((c) => c.code.toLowerCase() === code.toLowerCase());
      if (!match) {
        setClientError(`No client found with code "${code}".`);
        return;
      }
      setClient(match);
    } catch (err) {
      setClientError(err instanceof Error ? err.message : 'Could not load client');
    }
  }, [code]);

  const loadRegisters = useCallback(async () => {
    const pid = masterProjects[0]?.id;
    if (!pid) return;
    const guard = <T,>(p: Promise<T>, apply: (v: T) => void) =>
      p.then((v) => apply(v)).catch(() => undefined);

    guard(records.list('schedule_milestones', { projectId: pid, limit: 100 }),
      (page) => setMilestones(page.items));
    guard(records.list('ncr_register', { projectId: pid, limit: 300 }),
      (page) => setNcrs(page.items));
    guard(records.list('claims_register', { projectId: pid, limit: 300 }),
      (page) => setClaims(page.items));
    guard(records.list('commissioning_readiness', { projectId: pid, limit: 100 }),
      (page) => setCommissions(page.items));
  }, [masterProjects]);

  useEffect(() => { void loadClient(); }, [loadClient]);
  useEffect(() => { void loadRegisters(); }, [loadRegisters]);

  if (clientError) {
    return (
      <>
        <PageHead title={`Client portal — ${code}`} description="No client found" />
        <Notice>{clientError}</Notice>
        <Link href="/portal" style={{ color: 'var(--accent)' }}>← Back to client list</Link>
      </>
    );
  }

  if (projLoading || !client) {
    return <PageHead title={`Client portal — ${code}`} description="Loading client data…" />;
  }

  const openNcrs = ncrs.filter((r) => String(r.data.status) !== 'Closed');
  const openClaims = claims.filter((r) => !['Closed', 'Withdrew', 'Rejected'].includes(String(r.data.status ?? '')));

  // Aggregate billing across all plants for this client
  const totalBilled = masterProjects.reduce((s, p) => s + p.billed, 0);
  const totalCollected = masterProjects.reduce((s, p) => s + p.collected, 0);
  const totalEac = masterProjects.reduce((s, p) => s + p.eac, 0);
  const totalBudget = masterProjects.reduce((s, p) => s + p.budget, 0);

  return (
    <>
      <PageHead
        title={`${client.name} — Client portal`}
        description={`${client.plant || client.code} · ${masterProjects.length} plant${masterProjects.length !== 1 ? 's' : ''} · ${client.services.map((s) => s.toUpperCase()).join(' · ')}`}
        actions={
          <Link
            href="/portal"
            className="rounded px-[13px] py-[7px] text-[13px] font-medium"
            style={{ border: '1px solid var(--line)', background: 'var(--panel)', color: 'inherit', textDecoration: 'none' }}
          >
            ← All clients
          </Link>
        }
      />

      {/* --- Client-level billing band ---------------------------------- */}
      {masterProjects.length > 0 ? (
        <div className="mb-[18px] grid gap-3 grid-cols-2 lg:grid-cols-4">
          <MiniStat label="Contract value" value={L(masterProjects.reduce((s, p) => s + p.contractValue, 0))} />
          <MiniStat label="EAC total" value={L(totalEac)} tone={totalEac > totalBudget ? 'bad' : undefined} />
          <MiniStat
            label="Billed / collected"
            value={L(totalBilled)}
            sub={`Collected ${L(totalCollected)}`}
          />
          <MiniStat
            label="Open items"
            value={String(openNcrs.length + openClaims.length)}
            sub={`${openNcrs.length} NCR · ${openClaims.length} claims`}
            tone={openNcrs.length > 0 ? 'warn' : undefined}
          />
        </div>
      ) : null}

      {/* --- Per-plant cards -------------------------------------------- */}
      {masterProjects.map((p) => (
        <PlantCard
          key={p.id}
          p={p}
          milestones={milestones}
          ncrs={ncrs}
          claims={claims}
          commissions={commissions}
        />
      ))}

      {masterProjects.length === 0 ? (
        <Panel title="No plants found">
          <p className="m-0 text-[13px]" style={{ color: 'var(--muted)' }}>
            No plants are linked to this client yet. Ask your KEC representative to create one.
          </p>
        </Panel>
      ) : null}
    </>
  );
}

// ---------------------------------------------------------------------------

function MiniStat({
  label,
  value,
  sub,
  tone,
}: {
  label: string;
  value: string;
  sub?: string;
  tone?: 'ok' | 'warn' | 'bad';
}) {
  const color =
    tone === 'bad' ? 'var(--red)' :
    tone === 'warn' ? 'var(--amber)' :
    'var(--ink)';
  return (
    <div
      className="rounded-lg p-3.5"
      style={{ background: 'var(--panel)', border: '1px solid var(--line)' }}
    >
      <div className="text-[11px]" style={{ color: 'var(--muted)' }}>{label}</div>
      <div className="num mt-1 text-[19px] font-semibold" style={{ color }}>{value}</div>
      {sub ? <div className="mt-0.5 text-[11px]" style={{ color: 'var(--faint)' }}>{sub}</div> : null}
    </div>
  );
}

// ---------------------------------------------------------------------------

function PlantCard({
  p,
  milestones,
  ncrs,
  claims,
  commissions,
}: {
  p: ProjectOption;
  milestones: RecordRow[];
  ncrs: RecordRow[];
  claims: RecordRow[];
  commissions: RecordRow[];
}) {
  const openNcrs = ncrs.filter((r) => String(r.data.status) !== 'Closed');
  const openClaims = claims.filter((r) => !['Closed', 'Withdrew', 'Rejected'].includes(String(r.data.status ?? '')));
  const openCommissions = commissions.filter((r) => ['Not ready', 'Conditional', 'In progress'].includes(String(r.data.status ?? '')));

  const healthScore = p.spi >= 0.97 && p.cpi >= 1 ? 88 : p.spi >= 0.9 || p.cpi >= 0.97 ? 71 : 55;
  const healthTone = p.spi >= 0.97 && p.cpi >= 1 ? 'ok' : p.spi >= 0.9 || p.cpi >= 0.97 ? 'warn' : 'bad';

  const msDone = milestones.filter((m) => String(m.data.status) === 'Completed').length;
  const msTotal = milestones.length;

  return (
    <div className="mb-[18px]">
      <Panel
        title={p.name}
        sub={`${p.location} · ${p.technology} · ${p.capacityTpd} TPD`}
        bodyless
      >
        {/* Plant status strip */}
        <div className="flex flex-wrap items-center gap-4 px-4 py-3" style={{ borderBottom: '1px solid var(--line-2)' }}>
          <RadialGauge
            value={p.progress}
            max={100}
            label="Physical progress"
            unit="%"
            tone={p.progress >= 70 ? 'ok' : p.progress >= 30 ? 'info' : 'warn'}
            size={80}
            thickness={8}
          />
          <div className="flex flex-col gap-1 text-[12px]">
            <div>
              <span style={{ color: 'var(--muted)' }}>Status: </span>
              <Chip tone={HEALTH_TONE[p.status] ?? 'mute'}>{p.status}</Chip>
            </div>
            <div>
              <span style={{ color: 'var(--muted)' }}>SPI </span>
              <span className="num font-semibold" style={{ color: p.spi < 0.95 ? 'var(--red)' : 'var(--ok)' }}>
                {p.spi.toFixed(2)}
              </span>
              <span className="mx-2" style={{ color: 'var(--line)' }}>|</span>
              <span style={{ color: 'var(--muted)' }}>CPI </span>
              <span className="num font-semibold" style={{ color: p.cpi < 1 ? 'var(--amber)' : 'var(--ok)' }}>
                {p.cpi.toFixed(2)}
              </span>
            </div>
            <div>
              <span style={{ color: 'var(--muted)' }}>Schedule </span>
              {p.scheduleDays > 0 ? (
                <Chip tone="bad">{p.scheduleDays} days late</Chip>
              ) : (
                <Chip tone="ok">On track</Chip>
              )}
            </div>
          </div>

          {/* Milestone progress bar */}
          <div className="ml-auto flex flex-col items-end gap-1">
            <div className="text-[11px]" style={{ color: 'var(--muted)' }}>
              {msTotal > 0 ? `${msDone}/${msTotal} milestones complete` : 'No milestones yet'}
            </div>
            {msTotal > 0 ? (
              <div style={{ width: 120 }}>
                <Bar pct={Math.round((msDone / msTotal) * 100)} tone={msDone / msTotal >= 0.7 ? 'ok' : 'warn'} />
              </div>
            ) : null}
          </div>
        </div>

        {/* Two-col: cost + quality */}
        <div className="grid grid-cols-1 gap-0 md:grid-cols-2">
          {/* Cost side */}
          <div style={{ borderRight: '1px solid var(--line-2)' }} className="p-4">
            <div className="mb-3 text-[12px] font-semibold" style={{ color: 'var(--muted)' }}>
              COST POSITION
            </div>
            <HBarChart
              items={[
                { label: 'Contract', value: p.contractValue },
                { label: 'Budget', value: p.budget },
                { label: 'Committed', value: p.committed },
                { label: 'Actual', value: p.actual, tone: 'warn' },
                { label: 'EAC', value: p.eac, tone: (p.eac > p.budget ? 'bad' : 'ok') as 'ok' | 'bad' },
              ]}
              unit="L"
              height={16}
            />
            <div className="mt-3 text-[11.5px]" style={{ color: 'var(--muted)' }}>
              Collection: {p.billed > 0 ? Math.round((p.collected / p.billed) * 100) : 0}% of billed {L(p.collected)} / {L(p.billed)}
            </div>
          </div>

          {/* Quality + open items side */}
          <div className="p-4">
            <div className="mb-3 text-[12px] font-semibold" style={{ color: 'var(--muted)' }}>
              QUALITY & OPEN ITEMS
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="rounded-md p-3" style={{ background: 'var(--panel-2)', border: '1px solid var(--line-2)' }}>
                <div className="text-[11px]" style={{ color: 'var(--muted)' }}>Open NCRs</div>
                <div className="num text-[20px] font-semibold" style={{ color: openNcrs.length > 0 ? 'var(--red)' : 'var(--ok)' }}>
                  {openNcrs.length}
                </div>
              </div>
              <div className="rounded-md p-3" style={{ background: 'var(--panel-2)', border: '1px solid var(--line-2)' }}>
                <div className="text-[11px]" style={{ color: 'var(--muted)' }}>Open claims</div>
                <div className="num text-[20px] font-semibold" style={{ color: openClaims.length > 0 ? 'var(--amber)' : 'var(--ok)' }}>
                  {openClaims.length}
                </div>
              </div>
            </div>

            {openCommissions.length > 0 ? (
              <div className="mt-3">
                <div className="mb-1.5 text-[11.5px]" style={{ color: 'var(--muted)' }}>
                  Commissioning gates open
                </div>
                {openCommissions.slice(0, 3).map((c, i) => (
                  <div key={i} className="flex items-center gap-2 text-[12px]">
                    <Chip tone={String(c.data.status) === 'Not ready' ? 'bad' : 'warn'}>
                      {String(c.data.status)}
                    </Chip>
                    <span>{String(c.data.system ?? c.data.milestone ?? '')}</span>
                  </div>
                ))}
              </div>
            ) : null}
          </div>
        </div>

        {/* Milestones table */}
        {milestones.length > 0 ? (
          <div style={{ borderTop: '1px solid var(--line-2)' }}>
            <div className="px-4 py-2.5 text-[12px] font-semibold" style={{ color: 'var(--muted)' }}>
              MILESTONES
            </div>
            <DataTable
              columns={[
                { key: 'm', label: 'Milestone' },
                { key: 'o', label: 'Owner' },
                { key: 'pl', label: 'Planned' },
                { key: 'fc', label: 'Forecast' },
                { key: 'pr', label: 'Progress' },
                { key: 'st', label: 'Status', align: 'right' },
              ]}
              rows={milestones.slice(0, 5).map((m): React.ReactNode[] => {
                const status = String(m.data.status ?? '');
                const progress = Math.min(100, Math.max(0, Number(m.data.progress) || 0));
                return [
                  String(m.data.milestone ?? ''),
                  String(m.data.owner ?? '—'),
                  fmtDay(m.data.plannedDate),
                  fmtDay(m.data.forecastDate),
                  <div key="b" className="flex items-center gap-1.5">
                    <Bar pct={progress} tone={progress >= 80 ? 'ok' : 'warn'} />
                    <span className="num text-[11px]" style={{ color: 'var(--muted)' }}>{progress}%</span>
                  </div>,
                  <Chip key="c" tone={msTone(status)}>{status || '—'}</Chip>,
                ];
              })}
            />
          </div>
        ) : null}
      </Panel>
    </div>
  );
}

function fmtDay(v: unknown): string {
  if (!v) return '—';
  const d = new Date(String(v));
  return Number.isNaN(d.getTime()) ? String(v)
    : d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}

const MS_TONE: Record<string, 'ok' | 'info' | 'warn' | 'bad' | 'mute'> = {
  'Completed': 'ok',
  'In progress': 'info',
  'At risk': 'warn',
  Slipped: 'bad',
  'Not started': 'mute',
};

function msTone(s: string): 'ok' | 'info' | 'warn' | 'bad' | 'mute' {
  return MS_TONE[s] ?? 'mute';
}
