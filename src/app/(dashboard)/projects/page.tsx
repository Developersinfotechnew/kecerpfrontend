'use client';

import { useCallback, useEffect, useState } from 'react';

import { projects as projectService } from '@/lib/services';
import type { CreateProjectInput, ProjectOption } from '@/lib/services';
import { useSession } from '../../session';
import { Button, Chip, DataTable, Notice, PageHead, Panel } from '@/components/ui';
import type { ChipTone } from '@/components/ui';
import { ProjectWizard } from '@/components/ProjectWizard';

/**
 * Projects portfolio.
 *
 * Reads the projects the signed-in user may see. The list is already filtered
 * to their scope by the API, so nothing here decides visibility.
 *
 * Create and edit projects remain an admin action on the admin routes; this
 * page is the portfolio view every role opens.
 */
export default function ProjectsPage() {
  const { can } = useSession();
  const [projects, setProjects] = useState<ProjectOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setProjects(await projectService.list({ kind: 'master' }));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load projects');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function create(body: CreateProjectInput): Promise<void> {
    await projectService.create(body);
    setCreating(false);
    await load();
  }

  const active = projects.filter((p) => p.status === 'active').length;
  const planning = projects.filter((p) => p.status === 'planning').length;
  const completed = projects.filter((p) => p.status === 'completed').length;

  return (
    <>
      <PageHead
        title="All projects"
        description="Each plant carries its own delivery phases — PMC, EPC, EPTP and O&M — with separate budgets and approvals."
        actions={
          can('project:create') ? (
            <Button variant="primary" onClick={() => setCreating(true)}>
              Create project
            </Button>
          ) : undefined
        }
      />

      {error ? <Notice>{error}</Notice> : null}

      {creating ? (
        <ProjectWizard
          onCancel={() => setCreating(false)}
          onCreated={async (body) => {
            await create(body);
          }}
        />
      ) : null}

      <div className="mb-[18px] grid gap-[18px] grid-cols-1 md:grid-cols-2 xl:grid-cols-3">
        {loading ? (
          <p className="text-sm" style={{ color: 'var(--muted)' }}>
            Loading projects…
          </p>
        ) : projects.length === 0 ? (
          <p className="text-sm" style={{ color: 'var(--muted)' }}>
            No projects are in your scope.
          </p>
        ) : (
          projects.map((p) => (
            <div
              key={p.id}
              className="rounded p-4"
              style={{ background: 'var(--panel)', border: '1px solid var(--line)' }}
            >
              <div className="mb-0.5 flex items-start justify-between gap-2.5">
                <h4 className="m-0 text-[15px] font-semibold">{p.name}</h4>
                <Chip tone={statusTone(p.status)}>{labelOf(p.status)}</Chip>
              </div>
              <div className="mb-3.5 text-[12px]" style={{ color: 'var(--muted)' }}>
                {p.code} · {p.location}
              </div>

              <div className="grid grid-cols-2 gap-x-3.5 gap-y-2.5 text-[12px]">
                <div>
                  <span style={{ color: 'var(--muted)' }}>Capacity</span>
                  <b className="num block text-[14px] font-semibold">{p.capacityTpd} TPD</b>
                </div>
                <div>
                  <span style={{ color: 'var(--muted)' }}>Status</span>
                  <b className="block text-[14px] font-semibold">{labelOf(p.status)}</b>
                </div>
              </div>

              <div className="mt-3 border-t pt-2.5" style={{ borderColor: 'var(--line-2)' }}>
                <span className="text-[11px]" style={{ color: 'var(--muted)' }}>
                  Delivery phases
                </span>
                <div className="mt-1.5 flex flex-wrap gap-1.5">
                  {p.stages.length === 0 ? (
                    <span className="text-[11.5px]" style={{ color: 'var(--faint)' }}>
                      No phases yet
                    </span>
                  ) : (
                    p.stages.map((s) => (
                      <span
                        key={s.id}
                        className="num inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10.5px]"
                        style={{
                          background: 'var(--accent-soft)',
                          color: 'var(--accent-dark)',
                          border: '1px solid var(--line)',
                        }}
                        title={`${stageLabel(s.stage)} · ${s.progress}% · ₹${s.contractValue} L`}
                      >
                        {stageShort(s.stage)}
                        <b className="font-semibold">{s.progress}%</b>
                      </span>
                    ))
                  )}
                </div>
              </div>
            </div>
          ))
        )}
      </div>

      <Panel
        title="Comparison"
        sub={loading ? undefined : `${projects.length} project${projects.length === 1 ? '' : 's'}`}
        bodyless
      >
        <DataTable
          columns={[
            { key: 'code', label: 'Code' },
            { key: 'name', label: 'Project' },
            { key: 'location', label: 'Location' },
            { key: 'stages', label: 'Delivery phases' },
            { key: 'capacity', label: 'Capacity', align: 'right' },
            { key: 'status', label: 'Status', align: 'right' },
          ]}
          rows={projects.map((p) => [
            <span key="c" className="num text-[12.5px]">
              {p.code}
            </span>,
            <span key="n" className="font-semibold">
              {p.name}
            </span>,
            p.location,
            <span key="st" className="flex flex-wrap gap-1">
              {p.stages.length === 0 ? (
                <span className="text-[12px]" style={{ color: 'var(--faint)' }}>
                  —
                </span>
              ) : (
                p.stages.map((s) => (
                  <span
                    key={s.id}
                    className="num rounded px-1.5 py-0.5 text-[10.5px]"
                    style={{
                      background: 'var(--accent-soft)',
                      color: 'var(--accent-dark)',
                      border: '1px solid var(--line)',
                    }}
                  >
                    {stageShort(s.stage)} {s.progress}%
                  </span>
                ))
              )}
            </span>,
            <span key="cap" className="num">
              {p.capacityTpd} TPD
            </span>,
            <Chip key="s" tone={statusTone(p.status)}>
              {labelOf(p.status)}
            </Chip>,
          ])}
          empty="No projects in your scope."
        />
      </Panel>

      {!loading && projects.length > 0 ? (
        <p className="mt-2 text-[12px]" style={{ color: 'var(--muted)' }}>
          {active} active · {planning} in planning · {completed} completed
        </p>
      ) : null}
    </>
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

/** Short form for a phase chip: PMC, EPC, EPTP, O&M. */
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

/** Long form for a phase tooltip. */
function stageLabel(stage: string): string {
  switch (stage) {
    case 'pmc':
      return 'Project Management Consultancy';
    case 'epc':
      return 'Engineering, Procurement and Construction';
    case 'eptp':
      return 'Engineering, Procurement and Testing';
    case 'om':
      return 'Operation and Maintenance';
    default:
      return stage;
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
