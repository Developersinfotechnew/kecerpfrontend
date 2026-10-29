import { Chip } from '@/components/ui';

/**
 * StepTracker: the step-by-step position of one approval in its live chain.
 *
 * Renders the current (live) chain definition as a horizontal stepper:
 * passed steps, the step waiting right now, and the steps still ahead —
 * then the decision recorded on each passed step. The chain data comes
 * from the backend, which re-reads the live workflow definition, so an
 * admin reconfiguration of the chain shows on the next load; the tracker
 * never freezes on a start-time snapshot.
 */

export type StepState = 'done' | 'current' | 'pending';

export interface TrackerStep {
  order: number;
  name: string;
  role: string;
  state: StepState;
}

export interface TrackerAction {
  stepOrder: number;
  role: string;
  actorName?: string;
  actorEmail: string;
  action: string;
  remark: string;
  at: string;
}

function fmtRole(role: string): string {
  const map: Record<string, string> = {
    superadmin: 'Super admin',
    ceo: 'CEO',
    pmcdirector: 'PMC Director',
    projectmanager: 'Project Manager',
    siteengineer: 'Site Engineer',
    procurement: 'Procurement',
    storekeeper: 'Store',
    commercialfinance: 'Commercial / Finance',
    compliance: 'Compliance',
    clientengineer: 'Client Engineer',
    clientmgmt: 'Client Mgmt',
    backoffice: 'General',
    shared: 'Head Office',
    hr: 'HR',
    developer: 'Developer',
  };
  return map[role] ?? role;
}

function fmtAt(at: string): string {
  const d = new Date(at);
  return d.toLocaleString('en-IN', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/** One step node on the stepper rail. */
function StepNode({ step }: { step: TrackerStep }) {
  const tone =
    step.state === 'done'
      ? { bg: 'var(--ok, #1a7f5b)', ring: 'transparent', fg: '#fff' }
      : step.state === 'current'
        ? { bg: '#fff', ring: 'var(--amber, #b45309)', fg: 'var(--amber, #b45309)' }
        : { bg: 'var(--panel, #fff)', ring: 'var(--line, #d8d4cf)', fg: 'var(--faint, #9a958e)' };

  return (
    <div className="flex min-w-[72px] flex-col items-center text-center">
      <div
        className="num flex h-[26px] w-[26px] items-center justify-center rounded-full text-[11px] font-bold"
        style={{
          background: tone.bg,
          border: `2px solid ${tone.ring}`,
          color: tone.fg,
          boxShadow: step.state === 'current' ? '0 0 0 4px rgba(180, 83, 9, 0.12)' : 'none',
        }}
      >
        {step.state === 'done' ? '✓' : step.order}
      </div>
      <div className="mt-1.5 w-full">
        <div
          className="text-[11.5px] font-semibold leading-tight"
          style={{ color: step.state === 'pending' ? 'var(--faint, #9a958e)' : 'var(--ink, #1c1b19)' }}
        >
          {step.name || fmtRole(step.role)}
        </div>
        <div className="text-[10.5px]" style={{ color: 'var(--muted)' }}>
          {fmtRole(step.role)}
        </div>
      </div>
    </div>
  );
}

/** Connector line between two nodes. Painted solid once the left step passed. */
function StepConnector({ passed }: { passed: boolean }) {
  return (
    <div
      className="mt-[13px] h-[2px] flex-1 rounded-full"
      style={{ background: passed ? 'var(--ok, #1a7f5b)' : 'var(--line-2, #e8e5e2)' }}
    />
  );
}

export function StepTracker({
  chain,
  actions = [],
  status,
}: {
  chain: TrackerStep[];
  actions?: TrackerAction[];
  /** Terminal status of the whole instance, if decided. */
  status?: string;
}) {
  const byStep = new Map<number, TrackerAction[]>();
  for (const a of actions) {
    byStep.set(a.stepOrder, [...(byStep.get(a.stepOrder) ?? []), a]);
  }

  if (chain.length === 0) {
    return (
      <p className="m-0 text-[12px]" style={{ color: 'var(--muted)' }}>
        Chain not defined for this amount.
      </p>
    );
  }

  const current = chain.find((s) => s.state === 'current');
  const currentActions = current ? (byStep.get(current.order) ?? []) : [];
  const decisions = actions.length > 0;

  return (
    <div>
      {/* Stepper rail */}
      <div className="flex items-start">
        {chain.map((s, i) => (
          <div key={s.order} className="flex flex-1 items-start">
            {i > 0 ? <StepConnector passed={chain[i - 1].state === 'done'} /> : null}
            <div className="flex flex-col items-center px-1.5">
              <StepNode step={s} />
            </div>
          </div>
        ))}
      </div>

      {/* The step waiting right now: who it sits with and any note left on it */}
      {status === 'pending' && current ? (
        <div
          className="mt-3 rounded-md px-3 py-2 text-[12px]"
          style={{
            background: 'rgba(180, 83, 9, 0.07)',
            border: '1px solid rgba(180, 83, 9, 0.25)',
            color: 'var(--ink)',
          }}
        >
          <span className="font-semibold">
            Step {current.order} · {current.name || fmtRole(current.role)}
          </span>
          <span style={{ color: 'var(--muted)' }}> · waiting with {fmtRole(current.role)}</span>
          {currentActions.length > 0 ? (
            <div className="mt-1 text-[11.5px]" style={{ color: 'var(--muted)' }}>
              {currentActions
                .map((a) => `${a.actorName || a.actorEmail} — ${a.action}${a.remark ? `: “${a.remark}”` : ''}`)
                .join(' · ')}
            </div>
          ) : null}
        </div>
      ) : null}

      {/* Decisions recorded on the passed steps */}
      {decisions ? (
        <div className="mt-2 space-y-px">
          {chain
            .filter((s) => (byStep.get(s.order) ?? []).length > 0)
            .map((s) =>
              (byStep.get(s.order) ?? []).map((a) => (
                <div
                  key={`${s.order}-${a.at}`}
                  className="flex items-center gap-2.5 rounded px-2.5 py-1.5 text-[12px]"
                  style={{ background: 'var(--panel-2, #f9fafb)' }}
                >
                  <Chip
                    tone={
                      a.action === 'approved'
                        ? 'ok'
                        : a.action === 'rejected'
                          ? 'bad'
                          : a.action === 'returned'
                            ? 'warn'
                            : 'info'
                    }
                  >
                    {a.action}
                  </Chip>
                  <span className="font-medium">{a.actorName || a.actorEmail}</span>
                  <span className="text-[11.5px]" style={{ color: 'var(--muted)' }}>
                    step {s.order} · {fmtRole(s.role)}
                  </span>
                  {a.remark ? (
                    <span className="truncate text-[11.5px] italic" style={{ color: 'var(--muted)' }} title={a.remark}>
                      “{a.remark}”
                    </span>
                  ) : null}
                  <span className="num ml-auto flex-none text-[11px]" style={{ color: 'var(--faint)' }}>
                    {fmtAt(a.at)}
                  </span>
                </div>
              )),
            )}
        </div>
      ) : null}

      {/* Terminal status of the whole instance */}
      {status && status !== 'pending' ? (
        <div className="mt-2.5 flex items-center gap-2 text-[12.5px] font-medium">
          <Chip tone={status === 'approved' ? 'ok' : status === 'rejected' ? 'bad' : 'warn'}>
            {status === 'approved' ? 'Approved' : status === 'rejected' ? 'Rejected' : status}
          </Chip>
          {status === 'approved' ? 'Completed the chain' : null}
        </div>
      ) : null}
    </div>
  );
}
