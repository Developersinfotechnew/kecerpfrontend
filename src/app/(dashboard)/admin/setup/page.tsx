'use client';

import { useCallback, useEffect, useState } from 'react';

import { admin, projects as projectService } from '@/lib/services';
import { useSession } from '@/app/session';
import { Button, Chip, Notice, PageHead, Panel } from '@/components/ui';

/**
 * Setup, in order.
 *
 * The hierarchy is a dependency chain, and this page shows where it stands:
 *
 *   1. Client   — who you work for. Nothing else can exist without one.
 *   2. Project  — a plant for a client, fanned out into delivery phases.
 *   3. Team     — people assigned to a project, each with a role.
 *
 * Step 3 cannot be done until step 2 exists, because a team is an assignment
 * onto a project. The page says that out loud rather than leaving a dead form.
 *
 * Counts come from the same endpoints each page uses, so nothing here can
 * disagree with the pages it points at.
 */

interface StepDef {
  n: number;
  title: string;
  what: string;
  have: number;
  unit: string;
  path: string;
  action: string;
  enabled: boolean;
  done: boolean;
  blocked?: boolean;
  blockWhy?: string;
}

interface SetupState {
  clientCount: number;
  projectCount: number;
  masterCount: number;
  stageCount: number;
  userCount: number;
  managerCount: number;
  assignedCount: number;
  pendingCount: number;
  unassigned: { id: string; name: string; role: string }[];
  loading: boolean;
  error: string | null;
}

export default function SetupPage() {
  const { can } = useSession();
  const [s, setS] = useState<SetupState>({
    clientCount: 0,
    projectCount: 0,
    masterCount: 0,
    stageCount: 0,
    userCount: 0,
    managerCount: 0,
    assignedCount: 0,
    pendingCount: 0,
    unassigned: [],
    loading: true,
    error: null,
  });

  const load = useCallback(async () => {
    setS((p) => ({ ...p, loading: true, error: null }));
    try {
      const [clients, masters, users] = await Promise.all([
        admin.clients(),
        projectService.list({ kind: 'master' }),
        admin.users(),
      ]);

      const stageCount = masters.reduce((n, m) => n + m.stages.length, 0);
      const managers = await admin.managers();
      const unassigned = users
        .filter((u) => u.isActive && !u.projectScopeAll && u.projectIds.length === 0)
        .map((u) => ({ id: u.id, name: u.name, role: u.role.replace(/[-_]/g, ' ') }));

      const pendingCount = users.filter((u) => u.approvalStatus !== 'approved').length;
      setS({
        clientCount: clients.filter((c) => c.isActive).length,
        projectCount: masters.length,
        masterCount: masters.length,
        stageCount,
        userCount: users.filter((u) => u.isActive).length,
        managerCount: managers.length,
        assignedCount: users.filter(
          (u) => u.isActive && (u.projectScopeAll || u.projectIds.length > 0),
        ).length,
        pendingCount,
        unassigned,
        loading: false,
        error: null,
      });
    } catch (err) {
      setS((p) => ({ ...p, loading: false, error: err instanceof Error ? err.message : 'Load failed' }));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const canCreate = can('project:create');
  const canAdmin = can('admin:create');

  const steps: StepDef[] = [
    {
      n: 1,
      title: 'Client',
      what: 'Onboard the counterparty. Set which service lines they bought — PMC, EPC, EPTP, O&M.',
      have: s.clientCount,
      unit: s.clientCount === 1 ? 'client' : 'clients',
      path: '/clients',
      action: 'Onboard client',
      enabled: canCreate,
      done: s.clientCount > 0,
    },
    {
      n: 2,
      title: 'Project',
      what: 'Create a plant for that client. Delivery phases split out automatically as separate projects with their own budgets.',
      have: s.masterCount,
      unit: s.masterCount === 1 ? 'plant' : 'plants',
      path: '/projects',
      action: 'Create project',
      enabled: canCreate,
      done: s.masterCount > 0,
      blocked: s.clientCount === 0,
      blockWhy: 'A project needs a client first.',
    },
    {
      n: 3,
      title: 'Team',
      what: 'Add people and assign each to this project with a role — project manager, site engineer, storekeeper and so on.',
      have: s.assignedCount,
      unit: s.assignedCount === 1 ? 'member' : 'members',
      path: '/users',
      action: 'Add user',
      enabled: canAdmin,
      done: s.assignedCount > 0,
      blocked: s.masterCount === 0,
      blockWhy: 'A team is an assignment onto a project. Create a project first.',
    },
  ];

  return (
    <>
      <PageHead
        title="Setup"
        description="The order to build a project from scratch. Each step is where its data lives; nothing later can start until the step before it has data."
      />

      {s.error ? <Notice>{s.error}</Notice> : null}

      <div className="grid gap-[18px]">
        {steps.map((step) => {
          const blocked = Boolean(step.blocked);
          return (
            <div
              key={step.n}
              className="rounded p-4"
              style={{
                background: 'var(--panel)',
                border: `1px solid ${step.done && !blocked ? 'var(--line-2)' : 'var(--line)'}`,
                opacity: blocked ? 0.85 : 1,
              }}
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="flex min-w-0 flex-1 items-start gap-3">
                  <div
                    className="num grid h-[34px] w-[34px] flex-none place-items-center rounded text-[15px] font-semibold"
                    style={
                      blocked
                        ? { background: '#f0f2f0', color: 'var(--faint)' }
                        : step.done
                          ? { background: 'var(--accent-soft)', color: 'var(--accent-dark)' }
                          : { background: 'var(--panel)', color: 'var(--text)', border: '1px solid var(--line-2)' }
                    }
                  >
                    {step.n}
                  </div>
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="m-0 text-[15px] font-semibold">{step.title}</h3>
                      {blocked ? (
                        <Chip tone="warn">waiting</Chip>
                      ) : step.done ? (
                        <Chip tone="ok">ready</Chip>
                      ) : (
                        <Chip tone="mute">needed</Chip>
                      )}
                    </div>
                    <p className="mb-0 mt-1 text-[12.5px]" style={{ color: 'var(--muted)' }}>
                      {step.what}
                    </p>
                    {blocked ? (
                      <p className="mb-0 mt-1.5 text-[12.5px]" style={{ color: 'var(--red)' }}>
                        {step.blockWhy}
                      </p>
                    ) : null}
                  </div>
                </div>

                <div className="flex items-center gap-3">
                  <div className="text-right">
                    <span className="block text-[11px]" style={{ color: 'var(--muted)' }}>
                      currently
                    </span>
                    <b className="num block text-[16px] font-semibold">
                      {step.have} <span className="text-[12px] font-normal" style={{ color: 'var(--muted)' }}>{step.unit}</span>
                    </b>
                  </div>
                  <Button
                    variant="primary"
                    disabled={blocked || !step.enabled}
                    onClick={() => {
                      window.location.href = step.path;
                    }}
                  >
                    {step.action}
                  </Button>
                </div>
              </div>

              {step.title === 'Project' && !s.loading && s.masterCount > 0 ? (
                <p className="mb-0 mt-3 border-t pt-2.5 text-[12px]" style={{ borderColor: 'var(--line-2)', color: 'var(--muted)' }}>
                  {s.masterCount} plant{s.masterCount === 1 ? '' : 's'} produce{' '}
                  {s.stageCount} delivery-phase project{s.stageCount === 1 ? '' : 's'} — PMC, EPC, EPTP and O&M each carry
                  their own budget, progress and approvals.
                </p>
              ) : null}
            </div>
          );
        })}
      </div>

      {s.loading ? null : (
        <div className="mt-[18px] grid grid-cols-2 gap-[18px] lg:grid-cols-4">
          <Stat label="Clients" value={s.clientCount} note="Active counterparties" />
          <Stat label="Plants" value={s.masterCount} note="Master projects" />
          <Stat label="Delivery phases" value={s.stageCount} note="Stage projects" />
          <Stat label="People eligible to manage" value={s.managerCount} note="Shown in the PM picker" />
        </div>
      )}

      {s.loading ? null : s.pendingCount > 0 ? (
        <Panel
          title="User approvals waiting"
          sub={`${s.pendingCount} account(s) cannot log in until an admin approves them`}
          bodyless
        >
          <div className="flex items-center justify-between p-3">
            <p className="m-0 text-[13px]" style={{ color: 'var(--muted)' }}>
              Go to the Users page to review and approve these accounts.
            </p>
            <Button
              variant="primary"
              onClick={() => { window.location.href = '/users'; }}
            >
              Review approvals
            </Button>
          </div>
        </Panel>
      ) : null}

      {s.loading ? null : s.unassigned.length > 0 ? (
        <Panel
          title="Active people with no project"
          sub="They can log in but see no project data"
          bodyless
        >
          <div className="grid gap-1 p-2">
            {s.unassigned.map((u) => (
              <div
                key={u.id}
                className="flex items-center justify-between gap-3 rounded px-2.5 py-2"
                style={{ background: '#fbfcfb', border: '1px solid var(--line)' }}
              >
                <span className="text-[13px]">{u.name}</span>
                <span className="text-[12px]" style={{ color: 'var(--muted)' }}>
                  {u.role}
                </span>
              </div>
            ))}
          </div>
        </Panel>
      ) : null}
    </>
  );
}

function Stat({ label, value, note }: { label: string; value: number; note: string }) {
  return (
    <div className="rounded p-4" style={{ background: 'var(--panel)', border: '1px solid var(--line)' }}>
      <div className="text-[12px]" style={{ color: 'var(--muted)' }}>
        {label}
      </div>
      <b className="num block text-[22px] font-semibold leading-tight">{value}</b>
      <div className="text-[11.5px]" style={{ color: 'var(--faint)' }}>
        {note}
      </div>
    </div>
  );
}
