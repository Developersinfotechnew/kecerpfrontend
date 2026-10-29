'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useParams } from 'next/navigation';

import { approvals, projects as projectService } from '@/lib/services';
import type { ApprovalInstanceSummary, MisProjectRow, ProjectOption, ProjectTeamMember } from '@/lib/services';
import { Button, Chip, DataTable, Notice, PageHead, Panel, RadialGauge } from '@/components/ui';
import type { ChipTone } from '@/components/ui';
import Link from 'next/link';

/**
 * Project detail. The superadmin's full view of one plant.
 *
 * Master fields, delivery phases, the live MIS row (SPI / CPI / open items),
 * the team and the approval chains still waiting on this project. Everything
 * is composed from existing endpoints — no new backend. The id comes from
 * the URL via useParams, never a prop, for the same reason the register
 * screen does.
 */
export default function ProjectDetailPage() {
  const params = useParams<{ id: string }>();
  const id = String(params?.id ?? '');

  const [project, setProject] = useState<ProjectOption | null>(null);
  const [team, setTeam] = useState<ProjectTeamMember[]>([]);
  const [mis, setMis] = useState<MisProjectRow | null>(null);
  const [pending, setPending] = useState<ApprovalInstanceSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    setError(null);
    try {
      const masters = await projectService.list({ kind: 'master' });
      const p = masters.find((x) => x.id === id) ?? null;
      setProject(p);
      if (p) {
        // Independent reads. A failed panel must not blank the others.
        void projectService
          .team(id)
          .then(setTeam)
          .catch(() => setTeam([]));
        void projectService
          .portfolioMis()
          .then((r) => setMis(r.rows.find((row) => row.projectId === id) ?? null))
          .catch(() => setMis(null));
        void approvals
          .instances({ status: 'pending', limit: 200 })
          .then((page) => setPending(page.items.filter((i) => i.projectId === id)))
          .catch(() => setPending([]));
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load project');
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  const p = project;

  return (
    <>
      <PageHead
        title={p ? `${p.name} (${p.code})` : 'Project detail'}
        description={p ? `${p.clientName ? `${p.clientName} · ` : ''}${p.location}` : 'One plant, everything on it.'}
        actions={
          <Link href="/projects">
            <Button>All projects</Button>
          </Link>
        }
      />

      {error ? <Notice>{error}</Notice> : null}

      {loading ? (
        <p className="text-sm" style={{ color: 'var(--muted)' }}>
          Loading project…
        </p>
      ) : !p ? (
        <Panel title="Project not found">
          <p className="m-0 text-[13px]" style={{ color: 'var(--muted)' }}>
            No project with this id is in your scope. It may be offboarded or
            the link is stale.
          </p>
        </Panel>
      ) : (
        <div className="grid gap-4">
          {/* ── Master ─────────────────────────────────────────────── */}
          <Panel title="Project master" bodyless>
            <div className="flex flex-wrap items-center gap-2 px-4 pt-3.5">
              <Chip tone={statusTone(p.status)}>{labelOf(p.status)}</Chip>
              {p.health ? (
                <Chip tone={p.health === 'green' ? 'ok' : p.health === 'amber' ? 'warn' : 'bad'}>
                  {p.health.toUpperCase()}
                </Chip>
              ) : null}
              {p.stages.length > 0 ? null : (
                <Chip tone="mute">No phases yet</Chip>
              )}
            </div>

            <div className="grid grid-cols-2 gap-x-4 gap-y-3 p-4 sm:grid-cols-4">
              <Fact label="Client" value={p.clientName || '—'} />
              <Fact label="Contract no." value={p.contractNo || '—'} />
              <Fact label="Project type" value={p.projectType || 'EPC'} />
              <Fact label="Currency" value={p.currency || 'INR'} />
              <Fact label="Capacity" value={`${p.capacityTpd} TPD`} />
              <Fact label="Technology" value={p.technology || '—'} />
              <Fact label="PM" value={p.pm || '—'} />
              <Fact label="Target margin" value={p.targetMargin ? `${p.targetMargin}%` : '—'} />
              <Fact label="Contract value" value={`₹${p.contractValue.toLocaleString('en-IN')} L`} />
              <Fact label="Budget" value={p.budget ? `₹${p.budget.toLocaleString('en-IN')} L` : '—'} />
              <Fact label="Est. at completion" value={p.eac ? `₹${p.eac.toLocaleString('en-IN')} L` : '—'} />
              <Fact label="Contract start" value={p.startDate ? new Date(p.startDate).toLocaleDateString('en-IN') : '—'} />
              <Fact label="Planned completion" value={p.endDate ? new Date(p.endDate).toLocaleDateString('en-IN') : '—'} />
              <Fact
                label="Schedule baseline"
                value={
                  p.baselineStart && p.baselineFinish
                    ? `${new Date(p.baselineStart).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' })} – ${new Date(p.baselineFinish).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' })}`
                    : '—'
                }
              />
              <Fact
                label="DPR cutoff"
                value={p.dprCutoffTime ?? '20:00'}
              />
              <Fact
                label="Client approvals"
                value={p.clientApprovalsEnabled === false ? 'Off · offline evidence' : 'On · portal client steps'}
              />
              <Fact label="Health" value={p.health ? p.health.toUpperCase() : '—'} tone={p.health === 'red' ? 'bad' : p.health === 'amber' ? 'warn' : 'ok'} />
            </div>

            <div className="border-t px-4 py-3" style={{ borderColor: 'var(--line-2)' }}>
              <span className="text-[11px] font-medium uppercase tracking-wide" style={{ color: 'var(--muted)' }}>
                Physical progress
              </span>
              <div className="mt-2 flex items-center gap-3">
                <div className="h-2 flex-1 overflow-hidden rounded-full" style={{ background: 'var(--line-2)' }}>
                  <div
                    className="h-full rounded-full"
                    style={{
                      width: `${Math.min(100, Math.max(0, p.progress))}%`,
                      background: 'var(--accent, #2f6f6a)',
                    }}
                  />
                </div>
                <span className="num text-[13px] font-semibold" style={{ color: 'var(--ink)' }}>
                  {p.progress}%
                </span>
              </div>
            </div>
          </Panel>

          {/* ── Team ───────────────────────────────────────────────── */}
          <Panel
            title="Team on this project"
            sub={team.length ? `${team.length} member${team.length === 1 ? '' : 's'}` : 'No team assigned — its chains stall'}
            bodyless
          >
            <DataTable
              columns={[
                { key: 'member', label: 'Member' },
                { key: 'role', label: 'Role on project' },
                { key: 'added', label: 'Added', align: 'right' },
              ]}
              empty="No team. Assign members under Admin → Project teams."
              rows={team.map((m) => [
                <span key="n">
                  <span className="font-semibold">{m.name}</span>
                  <span className="block text-[11.5px]" style={{ color: 'var(--muted)' }}>{m.email}</span>
                </span>,
                <Chip key="r" tone="info">{m.roleLabel}</Chip>,
                <span key="a" className="num text-[12px]" style={{ color: 'var(--muted)' }}>
                  {new Date(m.addedAt).toLocaleDateString('en-IN')}
                </span>,
              ])}
            />
          </Panel>

          {/* ── Performance + commercial ───────────────────────────── */}
          <div className="grid gap-4 md:grid-cols-2">
            <Panel title="Performance" sub="SPI · CPI · schedule slip" bodyless>
              <div className="grid grid-cols-3 gap-3 p-4">
                <RadialGauge
                  value={Math.round(p.spi * 100)}
                  max={100}
                  label="SPI"
                  unit="%"
                  tone={p.spi >= 0.97 ? 'ok' : p.spi >= 0.9 ? 'warn' : 'bad'}
                  size={120}
                  thickness={10}
                />
                <RadialGauge
                  value={Math.round(p.cpi * 100)}
                  max={100}
                  label="CPI"
                  unit="%"
                  tone={p.cpi >= 1 ? 'ok' : p.cpi >= 0.95 ? 'warn' : 'bad'}
                  size={120}
                  thickness={10}
                />
                <div className="flex flex-col justify-center gap-1.5">
                  <Fact
                    label="Schedule slip"
                    value={`${p.scheduleDays > 0 ? '+' : ''}${p.scheduleDays}d`}
                    tone={p.scheduleDays > 0 ? 'bad' : 'ok'}
                  />
                  <Fact label="Open actions" value={String(p.openActions)} />
                </div>
              </div>
            </Panel>

            <Panel title="Commercial" sub="Lakhs, whole numbers" bodyless>
              <div className="grid grid-cols-2 gap-x-4 gap-y-3 p-4">
                <Fact label="Contract value" value={`₹${p.contractValue.toLocaleString('en-IN')} L`} />
                <Fact label="Committed (POs)" value={`₹${p.committed.toLocaleString('en-IN')} L`} />
                <Fact label="Booked actual" value={`₹${p.actual.toLocaleString('en-IN')} L`} />
                <Fact label="Invoiced" value={`₹${p.billed.toLocaleString('en-IN')} L`} />
                <Fact label="Collected" value={`₹${p.collected.toLocaleString('en-IN')} L`} />
                <Fact label="Receivables open" value={`₹${Math.max(0, p.billed - p.collected).toLocaleString('en-IN')} L`} />
              </div>
            </Panel>
          </div>

          {/* ── MIS row, when it is in the portfolio scope ────────── */}
          {mis ? (
            <Panel title="Portfolio MIS row" sub="Live roll-up from the portfolio service" bodyless>
              <div className="grid grid-cols-2 gap-x-4 gap-y-3 p-4 sm:grid-cols-4">
                <Fact label="Open NCRs" value={String(mis.openNcrs)} />
                <Fact label="Open claims" value={String(mis.openClaims)} />
                <Fact label="Pending approvals" value={String(mis.pendingApprovals)} />
                <Fact label="Pending client approvals" value={String(mis.pendingClientApprovals)} />
                <Fact label="Max client ageing" value={mis.clientApprovalAgeDays > 0 ? `${mis.clientApprovalAgeDays}d` : '—'} />
                <Fact label="Final account" value={mis.finalAccount ? `₹${mis.finalAccount.toLocaleString('en-IN')} L` : '—'} />
                <Fact label="Closed accounts" value={String(mis.closedAccounts)} />
                <Fact label="Budget" value={`₹${mis.budget.toLocaleString('en-IN')} L`} />
              </div>
            </Panel>
          ) : null}

          {/* ── Delivery phases ────────────────────────────────────── */}
          <Panel title="Delivery phases" sub="One stage project per enabled line" bodyless>
            <DataTable
              columns={[
                { key: 'stage', label: 'Phase' },
                { key: 'status', label: 'Status' },
                { key: 'progress', label: 'Progress', align: 'right' },
                { key: 'value', label: 'Contract (₹L)', align: 'right' },
              ]}
              empty="No phases yet — enable them on the master."
              rows={p.stages.map((s) => [
                <span key="stage" className="font-semibold">{stageShort(s.stage)}</span>,
                <Chip key="st" tone="mute">{s.status}</Chip>,
                <span key="pr" className="num">{s.progress}%</span>,
                <span key="v" className="num">{s.contractValue.toLocaleString('en-IN')}</span>,
              ])}
            />
          </Panel>

          {/* ── Pending chains on this project ─────────────────────── */}
          <Panel title="Open approval chains" sub={`${pending.length} pending on this project`} bodyless>
            <DataTable
              columns={[
                { key: 'item', label: 'Item' },
                { key: 'flow', label: 'Flow' },
                { key: 'step', label: 'At step', align: 'right' },
                { key: 'raised', label: 'Raised', align: 'right' },
              ]}
              empty="Nothing is waiting on approval."
              rows={pending.map((i) => [
                <span key="e" className="num text-[12.5px]">{i.entity} · {i.entityId}</span>,
                <span key="f">{i.workflowLabel}</span>,
                <span key="s" className="num">
                  {i.currentStep} / {i.totalSteps}
                </span>,
                <span key="t" className="num text-[12px]" style={{ color: 'var(--muted)' }}>
                  {new Date(i.createdAt).toLocaleDateString('en-IN')}
                </span>,
              ])}
            />
          </Panel>
        </div>
      )}
    </>
  );
}

function Fact({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: 'ok' | 'warn' | 'bad';
}) {
  const color =
    tone === 'bad' ? 'var(--red)' : tone === 'warn' ? 'var(--amber)' : tone === 'ok' ? 'var(--ok)' : undefined;
  return (
    <div>
      <span className="block text-[11px]" style={{ color: 'var(--muted)' }}>
        {label}
      </span>
      <b className="num block text-[14px] font-semibold" style={color ? { color } : undefined}>
        {value}
      </b>
    </div>
  );
}

function labelOf(status: string): string {
  switch (status) {
    case 'planning':
      return 'Planning';
    case 'onhold':
      return 'On hold';
    case 'completed':
      return 'Completed';
    case 'closed':
      return 'Closed';
    default:
      return 'Active';
  }
}

function stageShort(stage: string): string {
  switch (stage) {
    case 'pmc':
      return 'PMC';
    case 'epc':
      return 'EPC';
    case 'eptp':
      return 'EPTP';
    case 'om':
      return 'O&M';
    default:
      return stage.toUpperCase();
  }
}

function statusTone(status: string): ChipTone {
  switch (status) {
    case 'active':
      return 'ok';
    case 'planning':
      return 'info';
    case 'onhold':
      return 'warn';
    case 'completed':
    case 'closed':
      return 'mute';
    default:
      return 'mute';
  }
}
