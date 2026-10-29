'use client';

import { useCallback, useEffect, useState } from 'react';

import { projects as projectService } from '@/lib/services';
import type { CreateProjectInput, ProjectOption } from '@/lib/services';
import { useSession } from '../../session';
import { Button, Chip, DataTable, Notice, PageHead, Panel } from '@/components/ui';
import type { ChipTone } from '@/components/ui';
import { ProjectWizard } from '@/components/ProjectWizard';
import Link from 'next/link';

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
  const [editing, setEditing] = useState<ProjectOption | null>(null);

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

      <div className="mb-[18px] grid gap-4 grid-cols-1 md:grid-cols-2 xl:grid-cols-3">
        {loading ? (
          <p className="text-sm" style={{ color: 'var(--muted)' }}>
            Loading projects…
          </p>
        ) : projects.length === 0 ? (
          <p className="text-sm" style={{ color: 'var(--muted)' }}>
            No projects are in your scope.
          </p>
        ) : (
          projects.map((p) => {
            const pct = Math.min(100, Math.max(0, p.progress));
            const stripe = statusStripe(p.status);
            const status = statusMeta(p.status);
            return (
              <Link
                key={p.id}
                href={`/projects/${p.id}`}
                className="group relative flex flex-col overflow-hidden rounded-xl transition-[transform,box-shadow,border-color] duration-150 hover:-translate-y-0.5 hover:shadow-[0_10px_24px_-12px_rgba(15,23,42,0.25)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
                style={{ background: 'var(--panel)', border: '1px solid var(--line)' }}
                aria-label={`Open ${p.name} details`}
              >
                {/* Status stripe — the one loud element on the card */}
                <span
                  className="absolute inset-y-0 left-0 w-[3px]"
                  style={{ background: stripe }}
                  aria-hidden
                />

                {/* Header: name + status, code · client · location */}
                <div className="flex items-start justify-between gap-3 px-5 pt-4">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span
                        className="truncate text-[15.5px] font-semibold group-hover:text-[var(--accent-dark)] transition-colors"
                        style={{ color: 'var(--ink)' }}
                      >
                        {p.name}
                      </span>
                      <span
                        className="inline-flex flex-none items-center gap-1.5 rounded-full px-2 py-[3px] text-[10.5px] font-semibold"
                        style={{ background: status.bg, color: status.fg }}
                      >
                        <i className="h-1.5 w-1.5 rounded-full" style={{ background: status.dot }} />
                        {labelOf(p.status)}
                      </span>
                    </div>
                    <p className="num m-0 mt-1 truncate text-[11px]" style={{ color: 'var(--muted)' }}>
                      {p.code}
                      {p.clientName ? ` · ${p.clientName}` : ''}
                      {p.location ? ` · ${p.location}` : ''}
                    </p>
                  </div>
                  {can('project:update') ? (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        setEditing(p);
                      }}
                      aria-label={`Edit ${p.name}`}
                      className="flex-none rounded-md px-2.5 py-1 text-[11.5px] font-medium transition-colors"
                      style={{
                        border: '1px solid var(--line)',
                        background: 'var(--panel-2, #f6f8fa)',
                        color: 'var(--ink)',
                      }}
                    >
                      Edit
                    </button>
                  ) : null}
                </div>

                {/* Key figures on a raised panel */}
                <div
                  className="mx-5 mt-3.5 grid grid-cols-3 divide-x rounded-lg"
                  style={{ background: 'var(--panel-2, #f6f8fa)', borderColor: 'var(--line-2)' }}
                >
                  <figure className="m-0 px-3 py-2.5">
                    <figcaption className="text-[10px] font-medium uppercase tracking-wide" style={{ color: 'var(--muted)' }}>
                      Capacity
                    </figcaption>
                    <b className="num block text-[17px] font-bold" style={{ color: 'var(--ink)' }}>
                      {p.capacityTpd.toLocaleString('en-IN')}
                      <span className="text-[10px] font-medium" style={{ color: 'var(--muted)' }}> TPD</span>
                    </b>
                  </figure>
                  <figure className="m-0 px-3 py-2.5">
                    <figcaption className="text-[10px] font-medium uppercase tracking-wide" style={{ color: 'var(--muted)' }}>
                      Contract
                    </figcaption>
                    <b className="num block text-[17px] font-bold" style={{ color: 'var(--ink)' }}>
                      ₹{p.contractValue.toLocaleString('en-IN')}
                      <span className="text-[10px] font-medium" style={{ color: 'var(--muted)' }}> L</span>
                    </b>
                  </figure>
                  <figure className="m-0 px-3 py-2.5">
                    <figcaption className="text-[10px] font-medium uppercase tracking-wide" style={{ color: 'var(--muted)' }}>
                      Progress
                    </figcaption>
                    <b
                      className="num block text-[17px] font-bold"
                      style={{
                        color:
                          pct >= 80 ? 'var(--ok)' : pct >= 40 ? 'var(--ink)' : 'var(--warn, var(--muted))',
                      }}
                    >
                      {pct}
                      <span className="text-[10px] font-medium" style={{ color: 'var(--muted)' }}> %</span>
                    </b>
                  </figure>
                </div>

                {/* Progress bar, colour-coded by health of the number */}
                <div className="px-5 pt-3.5">
                  <div className="h-[6px] w-full overflow-hidden rounded-full" style={{ background: 'var(--line-2)' }}>
                    <div
                      className="h-full rounded-full"
                      style={{
                        width: `${pct}%`,
                        background:
                          pct >= 80
                            ? 'linear-gradient(90deg, var(--accent, #2f6f6a), var(--ok))'
                            : pct >= 40
                              ? 'var(--accent, #2f6f6a)'
                              : 'var(--warn, #d97706)',
                      }}
                    />
                  </div>
                </div>

                {/* Delivery phases, tiered by their own progress */}
                <div className="flex-1 px-5 pb-2.5 pt-3">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="mr-1 text-[10px] font-medium uppercase tracking-wide" style={{ color: 'var(--muted)' }}>
                      Phases
                    </span>
                    {p.stages.length === 0 ? (
                      <span className="text-[11.5px]" style={{ color: 'var(--faint, var(--muted))' }}>
                        None enabled yet
                      </span>
                    ) : (
                      p.stages.map((s) => {
                        const tier = s.progress >= 100 ? 2 : s.progress > 0 ? 1 : 0;
                        const style: React.CSSProperties =
                          tier === 2
                            ? { background: 'var(--ok-soft, #e7f6ee)', color: 'var(--ok)', border: '1px solid var(--ok)' }
                            : tier === 1
                              ? { background: 'var(--accent-soft)', color: 'var(--accent-dark)', border: '1px solid var(--accent, #2f6f6a)' }
                              : { background: 'transparent', color: 'var(--faint, var(--muted))', border: '1px solid var(--line-2)' };
                        return (
                          <span
                            key={s.id}
                            className="num inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[11px]"
                            style={style}
                            title={`${stageLabel(s.stage)} · ${s.progress}% · ₹${s.contractValue.toLocaleString('en-IN')} L`}
                          >
                            {stageShort(s.stage)}
                            <b className="font-semibold">{s.progress}%</b>
                          </span>
                        );
                      })
                    )}
                  </div>
                </div>

                {/* Footer affordance — tells the card is a page */}
                <div
                  className="flex items-center justify-between border-t px-5 py-2.5"
                  style={{ borderColor: 'var(--line-2)', background: 'var(--panel-2, #f6f8fa)' }}
                >
                  <span className="text-[11px]" style={{ color: 'var(--muted)' }}>
                    {p.stages.length} phase{p.stages.length === 1 ? '' : 's'} · SPI {p.spi.toFixed(2)} · CPI {p.cpi.toFixed(2)}
                  </span>
                  <span
                    className="text-[11.5px] font-semibold transition-transform group-hover:translate-x-0.5"
                    style={{ color: 'var(--accent-dark, var(--accent, #2f6f6a))' }}
                  >
                    View details
                  </span>
                </div>
              </Link>
            );
          })
        )}
      </div>

      {editing ? (
        <EditProjectModal
          project={editing}
          onCancel={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            void load();
          }}
        />
      ) : null}

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

/**
 * Edit the master fields of one project: name, location, technology,
 * capacity, contract value, dates and health. Code is the external
 * reference — read-only. Status and cost fields are engine-written.
 */
function EditProjectModal({
  project,
  onCancel,
  onSaved,
}: {
  project: ProjectOption;
  onCancel: () => void;
  onSaved: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [name, setName] = useState(project.name);
  const [location, setLocation] = useState(project.location);
  const [technology, setTechnology] = useState(project.technology);
  const [capacityTpd, setCapacityTpd] = useState(String(project.capacityTpd));
  const [contractValue, setContractValue] = useState(String(project.contractValue));
  const [startDate, setStartDate] = useState(project.startDate ?? '');
  const [endDate, setEndDate] = useState(project.endDate ?? '');
  const [health, setHealth] = useState<'green' | 'amber' | 'red'>(
    (project as unknown as { health?: 'green' | 'amber' | 'red' }).health ?? 'green',
  );
  const [clientApprovalsOn, setClientApprovalsOn] = useState(project.clientApprovalsEnabled ?? true);

  async function submit(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await projectService.update(project.id, {
        name: name.trim(),
        location: location.trim(),
        technology: technology.trim(),
        capacityTpd: Number(capacityTpd) || 0,
        contractValue: Number(contractValue) || 0,
        startDate: startDate || null,
        endDate: endDate || null,
        health,
        clientApprovalsEnabled: clientApprovalsOn,
      });
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save project');
      setBusy(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto p-4"
      style={{ background: 'rgba(15, 23, 41, 0.5)' }}
      role="dialog"
      aria-modal="true"
      aria-label={`Edit ${project.name}`}
      onClick={() => !busy && onCancel()}
    >
      <form
        onSubmit={submit}
        className="my-6 w-full max-w-xl rounded-lg"
        style={{ background: 'var(--panel)', border: '1px solid var(--line)', padding: '20px' }}
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="m-0 text-[15px] font-semibold" style={{ color: 'var(--ink)' }}>
          Edit project
        </h3>
        <p className="mt-0.5 mb-4 text-[12px]" style={{ color: 'var(--muted)' }}>
          <span className="num">{project.code}</span> · the code is fixed; status and cost figures are
          driven by the registers.
        </p>

        {error ? (
          <div className="mb-3">
            <Notice>{error}</Notice>
          </div>
        ) : null}

        <div className="grid grid-cols-2 gap-3.5">
          <FormField label="Project name" required>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              disabled={!busy}
              className={fieldInput}
              style={fieldStyle}
            />
          </FormField>
          <FormField label="Location">
            <input
              value={location}
              onChange={(e) => setLocation(e.target.value)}
              disabled={!busy}
              className={fieldInput}
              style={fieldStyle}
            />
          </FormField>
          <FormField label="Technology">
            <input
              value={technology}
              onChange={(e) => setTechnology(e.target.value)}
              disabled={!busy}
              className={fieldInput}
              style={fieldStyle}
            />
          </FormField>
          <FormField label="Capacity (TPD)">
            <input
              type="number"
              min="0"
              value={capacityTpd}
              onChange={(e) => setCapacityTpd(e.target.value)}
              disabled={!busy}
              className={`${fieldInput} num`}
              style={fieldStyle}
            />
          </FormField>
          <FormField label="Contract value (₹L)">
            <input
              type="number"
              min="0"
              value={contractValue}
              onChange={(e) => setContractValue(e.target.value)}
              disabled={!busy}
              className={`${fieldInput} num`}
              style={fieldStyle}
            />
          </FormField>
          <FormField label="Health">
            <select
              value={health}
              onChange={(e) => setHealth(e.target.value as 'green' | 'amber' | 'red')}
              disabled={!busy}
              className={fieldInput}
              style={fieldStyle}
            >
              <option value="green">Green</option>
              <option value="amber">Amber</option>
              <option value="red">Red</option>
            </select>
          </FormField>
          <div>
            <label className="flex cursor-pointer items-center gap-2.5">
              <input
                type="checkbox"
                checked={clientApprovalsOn}
                onChange={(e) => setClientApprovalsOn(e.target.checked)}
                disabled={!busy}
                className="h-4 w-4"
              />
              <span className="text-[12.5px]" style={{ color: 'var(--ink)' }}>
                Client approvals on this project
              </span>
            </label>
            <span className="mt-1 block text-[11px]" style={{ color: 'var(--faint)' }}>
              {clientApprovalsOn
                ? 'Client steps run in the portal. Turning this off lets KEC sign the client step offline and log it as evidence.'
                : 'Client steps are skipped; KEC records the client\'s signed copy as evidence in the register.'}
            </span>
          </div>
          <FormField label="Contract start">
            <input
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              disabled={!busy}
              className={`${fieldInput} num`}
              style={fieldStyle}
            />
          </FormField>
          <FormField label="Planned completion">
            <input
              type="date"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
              disabled={!busy}
              className={`${fieldInput} num`}
              style={fieldStyle}
            />
          </FormField>
        </div>

        <div className="mt-5 flex justify-end gap-2">
          <Button onClick={onCancel} disabled={busy}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" disabled={busy || !name.trim()}>
            {busy ? 'Saving…' : 'Save changes'}
          </Button>
        </div>
      </form>
    </div>
  );
}

const fieldInput = 'w-full rounded-md px-2.5 py-1.5 text-[13px] num';

/** Border + fill so an input reads as a control, matching the rest of the app. */
const fieldStyle: React.CSSProperties = {
  border: '1px solid var(--line)',
  background: '#fff',
  color: 'var(--ink)',
};

/** Labelled field row for the edit modal. */
function FormField({
  label,
  required,
  children,
}: {
  label: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-[11.5px] font-medium" style={{ color: 'var(--muted)' }}>
        {label}
        {required ? <span style={{ color: 'var(--red)' }}> *</span> : null}
      </span>
      {children}
    </label>
  );
}

/** The stripe colour on the left edge of a card, keyed to its status. */
function statusStripe(status: string): string {
  switch (status) {
    case 'active':
      return 'var(--accent, #2f6f6a)';
    case 'planning':
      return 'var(--ink-3, #334155)';
    case 'onhold':
      return 'var(--warn, #b45309)';
    case 'completed':
    case 'closed':
      return 'var(--ok, #1f9d6b)';
    default:
      return 'var(--line)';
  }
}

/** The status pill: tinted background + dot. */
function statusMeta(status: string): { bg: string; fg: string; dot: string } {
  switch (status) {
    case 'active':
      return { bg: 'var(--accent-soft)', fg: 'var(--accent-dark)', dot: 'var(--accent, #2f6f6a)' };
    case 'planning':
      return { bg: 'var(--panel-2, #f6f8fa)', fg: 'var(--ink-3, #334155)', dot: 'var(--ink-3, #334155)' };
    case 'onhold':
      return { bg: 'var(--warn-soft)', fg: 'var(--warn)', dot: 'var(--warn)' };
    case 'completed':
    case 'closed':
      return { bg: 'var(--ok-soft)', fg: 'var(--ok)', dot: 'var(--ok)' };
    default:
      return { bg: 'var(--panel-2, #f6f8fa)', fg: 'var(--ink)', dot: 'var(--faint, #98a1b2)' };
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
