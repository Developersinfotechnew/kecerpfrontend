'use client';

import { useCallback, useEffect, useState } from 'react';

import { approvals } from '@/lib/services';
import { StepTracker } from '@/components/StepTracker';
import type {
  ApprovalChain,
  ApprovalChainStep,
  ApprovalMatrixRow,
  ApprovalInstanceSummary,
  ApprovalInstancePage,
} from '@/lib/services';
import { useSession } from '@/app/session';
import { Button, Chip, Notice, PageHead, Panel } from '@/components/ui';

/**
 * Approval chain manager.
 *
 * Two views: the 13-row spec matrix (what each transaction's chain should be)
 * and the live chain definitions plus instance history. Gated on admin:view.
 */

function fmtRole(role: string): string {
  const MAP: Record<string, string> = {
    superadmin: 'Super Admin',
    ceo: 'CEO',
    pmcdirector: 'PM / Director',
    projectmanager: 'PM',
    siteengineer: 'Site Engineer',
    procurement: 'Procurement',
    storekeeper: 'Store Keeper',
    commercialfinance: 'Commercial / Finance',
    compliance: 'Compliance',
    hr: 'HR',
    backoffice: 'General',
    developer: 'Developer',
  };
  return MAP[role] ?? role;
}

function fmtAmount(n: number): string {
  if (n === 0) return 'No limit';
  return `≥ ₹${n.toLocaleString('en-IN')}`;
}

function fmtDate(d: string | null): string {
  if (!d) return '—';
  return new Date(d).toLocaleString('en-IN', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}

const STATUS_TONE: Record<string, 'ok' | 'warn' | 'bad' | 'info' | 'mute'> = {
  pending: 'warn',
  approved: 'ok',
  rejected: 'bad',
  cancelled: 'mute',
  returned: 'info',
};

/** Tone a priority chip renders. High = bad, Medium = warn, Low = mute. */
const PRIO_TONE: Record<string, 'ok' | 'warn' | 'bad' | 'mute'> = {
  High: 'bad',
  Medium: 'warn',
  Low: 'mute',
};

export default function ApprovalChainsPage() {
  const { can, user } = useSession();
  const isSuper = user?.role === 'superadmin';
  const [matrix, setMatrix] = useState<ApprovalMatrixRow[]>([]);
  const [chains, setChains] = useState<ApprovalChain[]>([]);
  const [instances, setInstances] = useState<ApprovalInstanceSummary[]>([]);
  const [instTotal, setInstTotal] = useState(0);
  const [instFilter, setInstFilter] = useState<'all' | 'pending' | 'approved' | 'rejected'>('all');
  const [expandedChain, setExpandedChain] = useState<string | null>(null);
  const [expandedInst, setExpandedInst] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<{ chain: ApprovalChain; steps: ApprovalChainStep[] } | null>(null);
  const [creating, setCreating] = useState(false);

  const load = useCallback(async () => {
    if (!can('admin:view')) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const [m, c] = await Promise.all([approvals.matrix(), approvals.chains()]);
      setMatrix(m);
      setChains(c);

      const statusParam = instFilter === 'all' ? undefined : instFilter;
      const page: ApprovalInstancePage = await approvals.instances({
        status: statusParam,
        limit: 20,
        offset: 0,
      });
      setInstances(page.items);
      setInstTotal(page.total);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load');
    } finally {
      setLoading(false);
    }
  }, [can, instFilter]);

  useEffect(() => {
    void load();
  }, [load]);

  async function loadInstances(filter: 'all' | 'pending' | 'approved' | 'rejected'): Promise<void> {
    setInstFilter(filter);
    try {
      const statusParam = filter === 'all' ? undefined : filter;
      const page: ApprovalInstancePage = await approvals.instances({
        status: statusParam,
        limit: 20,
        offset: 0,
      });
      setInstances(page.items);
      setInstTotal(page.total);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load');
    }
  }

  function openEdit(chain: ApprovalChain): void {
    setEditing({ chain, steps: chain.steps.map((s) => ({ ...s })) });
  }

  async function saveEdit(): Promise<void> {
    if (!editing) return;
    try {
      const updated = await approvals.updateChain(editing.chain.id, {
        steps: editing.steps,
      });
      setChains((prev) => prev.map((c) => (c.id === updated.id ? updated : c)));
      setEditing(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save chain');
    }
  }

  async function removeChain(chain: ApprovalChain): Promise<void> {
    if (!window.confirm(`Delete the ${chain.label} chain? In-flight approvals keep their snapshot.`)) return;
    try {
      await approvals.deleteChain(chain.id);
      setChains((prev) => prev.filter((c) => c.id !== chain.id));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete chain');
    }
  }

  if (!can('admin:view')) {
    return <p className="text-sm" style={{ color: 'var(--muted)' }}>No admin access.</p>;
  }

  return (
    <>
      <PageHead
        title="Approval chains"
        description="Transaction-level approval matrix and live chain definitions."
      />

      {error ? <Notice>{error}</Notice> : null}

      {/* ── Matrix ─────────────────────────────────────────────────────── */}
      <Panel
        title="Approval matrix"
        sub={`${matrix.filter((r) => r.exists).length} of ${matrix.length} transactions defined`}
        bodyless
      >
        <div className="overflow-x-auto">
          <table className="w-full text-[12.5px]">
            <thead>
              <tr style={{ borderBottom: '1px solid var(--line)' }}>
                <th className="px-3 py-2 text-left font-semibold" style={{ color: 'var(--muted)' }}>
                  Transaction
                </th>
                <th className="px-3 py-2 text-left font-semibold" style={{ color: 'var(--muted)' }}>
                  Minimum approval chain
                </th>
                <th className="px-3 py-2 text-right font-semibold" style={{ color: 'var(--muted)' }}>
                  Steps
                </th>
                <th className="px-3 py-2 text-right font-semibold" style={{ color: 'var(--muted)' }}>
                  Status
                </th>
              </tr>
            </thead>
            <tbody>
              {matrix.map((row) => (
                <tr
                  key={row.key}
                  style={{ borderBottom: '1px solid var(--line-2, #e8e5e2)' }}
                >
                  <td className="px-3 py-2 font-medium whitespace-nowrap">{row.transaction}</td>
                  <td className="px-3 py-2" style={{ color: 'var(--muted)' }}>
                    {row.chain}
                  </td>
                  <td className="px-3 py-2 text-right">{row.stepCount}</td>
                  <td className="px-3 py-2 text-right">
                    {row.exists ? (
                      <Chip tone="ok">defined</Chip>
                    ) : (
                      <Chip tone="warn">pending</Chip>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>

      {/* ── Chain definitions ─────────────────────────────────────────── */}
      <Panel
        title="Chain definitions"
        sub={
          isSuper
            ? `${chains.length} active workflows · only the super admin may reconfigure`
            : `${chains.length} active workflows · read-only, chain changes are super admin only`
        }
        bodyless
      >
        {isSuper ? (
          <div className="flex items-center justify-between px-4 py-2.5" style={{ borderBottom: '1px solid var(--line)' }}>
            <span className="text-[12px]" style={{ color: 'var(--muted)' }}>
              Add, reorder, or delete a step on any chain. An edited chain is marked customised and the boot seed stops overwriting it.
            </span>
            <Button variant="primary" onClick={() => setCreating(true)}>New chain</Button>
          </div>
        ) : null}
        <div className="divide-y" style={{ borderColor: 'var(--line)' }}>
          {chains.map((chain) => {
            const expanded = expandedChain === chain.key;
            return (
              <div key={chain.key}>
                <button
                  type="button"
                  onClick={() => setExpandedChain(expanded ? null : chain.key)}
                  className="flex w-full items-center justify-between px-4 py-3 text-left no-underline"
                  style={{ background: expanded ? 'var(--accent-soft, #eef5f2)' : undefined }}
                >
                  <div>
                    <div className="text-[13px] font-semibold">{chain.label}</div>
                    <div className="mt-0.5 text-[11.5px]" style={{ color: 'var(--muted)' }}>
                      {chain.description}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    {chain.customized ? <Chip tone="info">custom</Chip> : null}
                    <Chip tone={chain.isActive ? 'ok' : 'mute'}>
                      {chain.isActive ? 'active' : 'inactive'}
                    </Chip>
                    {isSuper ? (
                      <>
                        <Button onClick={() => openEdit(chain)}>Edit</Button>
                        <Button onClick={() => void removeChain(chain)}>Delete</Button>
                      </>
                    ) : null}
                    <span
                      className="text-[11px]"
                      style={{ color: 'var(--muted)' }}
                      onClick={(e) => {
                        e.stopPropagation();
                        setExpandedChain(expanded ? null : chain.key);
                      }}
                    >
                      {expanded ? '−' : '+'}
                    </span>
                  </div>
                </button>

                {expanded ? (
                  <div className="px-4 pb-3">
                    <div className="overflow-x-auto rounded" style={{ border: '1px solid var(--line)' }}>
                      <table className="w-full text-[12px]">
                        <thead>
                          <tr style={{ background: 'var(--panel-2, #f9fafb)', borderBottom: '1px solid var(--line)' }}>
                            <th className="px-2.5 py-1.5 text-left font-semibold" style={{ color: 'var(--muted)' }}>Step</th>
                            <th className="px-2.5 py-1.5 text-left font-semibold" style={{ color: 'var(--muted)' }}>Name</th>
                            <th className="px-2.5 py-1.5 text-left font-semibold" style={{ color: 'var(--muted)' }}>Role</th>
                            <th className="px-2.5 py-1.5 text-left font-semibold" style={{ color: 'var(--muted)' }}>Amount band</th>
                            <th className="px-2.5 py-1.5 text-right font-semibold" style={{ color: 'var(--muted)' }}>Mode</th>
                          </tr>
                        </thead>
                        <tbody>
                          {chain.steps.map((s) => (
                            <tr key={s.order} style={{ borderBottom: '1px solid var(--line-2, #e8e5e2)' }}>
                              <td className="px-2.5 py-1.5 text-center font-semibold">{s.order}</td>
                              <td className="px-2.5 py-1.5">{s.name}</td>
                              <td className="px-2.5 py-1.5">{fmtRole(s.role)}</td>
                              <td className="px-2.5 py-1.5" style={{ color: 'var(--muted)' }}>
                                {s.maxAmount === 0
                                  ? s.minAmount === 0
                                    ? 'All amounts'
                                    : `≥ ₹${s.minAmount.toLocaleString('en-IN')}`
                                  : `₹${s.minAmount.toLocaleString('en-IN')} – ₹${s.maxAmount.toLocaleString('en-IN')}`}
                              </td>
                              <td className="px-2.5 py-1.5 text-right">
                                {s.parallel ? <Chip tone="info">parallel</Chip> : <Chip tone="mute">sequence</Chip>}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      </Panel>

      {/* ── Instance history ──────────────────────────────────────────── */}
      <Panel
        title="Instance history"
        sub={instTotal > 0 ? `${instTotal} total` : 'No approvals yet'}
        bodyless
      >
        {/* Filter tabs */}
        <div className="flex flex-wrap gap-1.5 px-4 py-2.5" style={{ borderBottom: '1px solid var(--line)' }}>
          {(['all', 'pending', 'approved', 'rejected'] as const).map((f) => (
            <button
              key={f}
              type="button"
              onClick={() => void loadInstances(f)}
              className="rounded-full px-3 py-1 text-[12px] font-medium transition-colors"
              style={
                instFilter === f
                  ? { background: 'var(--accent)', color: '#fff' }
                  : { background: '#fff', border: '1px solid var(--line)', color: 'var(--text)' }
              }
            >
              {f === 'all' ? 'All' : f[0].toUpperCase() + f.slice(1)}
            </button>
          ))}
        </div>

        {instances.length === 0 ? (
          <div className="px-4 py-10 text-center text-[13px]" style={{ color: 'var(--muted)' }}>
            No approval instances match this filter.
          </div>
        ) : (
          <div className="divide-y" style={{ borderColor: 'var(--line)' }}>
            {instances.map((inst) => {
              const expanded = expandedInst === inst.id;
              return (
                <div key={inst.id}>
                  <button
                    type="button"
                    onClick={() => setExpandedInst(expanded ? null : inst.id)}
                    className="flex w-full items-center justify-between px-4 py-3 text-left no-underline"
                    style={{ background: expanded ? 'var(--accent-soft, #eef5f2)' : undefined }}
                  >
                    <div className="flex min-w-0 items-center gap-3">
                      <Chip tone={STATUS_TONE[inst.status] ?? 'mute'}>{inst.status}</Chip>
                      {inst.priority ? (
                        <Chip tone={PRIO_TONE[inst.priority] ?? 'mute'}>{inst.priority}</Chip>
                      ) : null}
                      <div className="min-w-0">
                        <div className="truncate text-[13px] font-medium">
                          {inst.entity.replaceAll('_', ' ')} · {inst.entityId}
                        </div>
                        <div className="text-[11px]" style={{ color: 'var(--muted)' }}>
                          {inst.requestedByEmail} · {fmtDate(inst.createdAt)}
                        </div>
                      </div>
                    </div>
                    <div className="flex flex-none items-center gap-3">
                      {inst.amount > 0 ? (
                        <span className="text-[12px] font-semibold">₹{inst.amount.toLocaleString('en-IN')}</span>
                      ) : null}
                      <span className="text-[11px]" style={{ color: 'var(--muted)' }}>
                        step {inst.currentStep}/{inst.totalSteps}
                      </span>
                      <span className="text-[11px]" style={{ color: 'var(--muted)' }}>{expanded ? '−' : '+'}</span>
                    </div>
                  </button>

                  {expanded ? (
                    <div className="px-4 pb-4">
                      {/* Live step tracker: done / current / pending, with the
                          decisions recorded on each step. The chain is read
                          against the live definition, so an admin edit of the
                          workflow shows here on reload. */}
                      <div className="mb-3">
                        <StepTracker
                          chain={inst.chain.map((s) => ({
                            ...s,
                            state:
                              s.order < inst.currentStep
                                ? 'done'
                                : s.order === inst.currentStep
                                  ? inst.status === 'pending'
                                    ? 'current'
                                    : 'done'
                                  : 'pending',
                          }))}
                          actions={inst.actions}
                          status={inst.status}
                        />
                      </div>

                      {/* Actions taken */}
                      {inst.actions.length > 0 ? (
                        <div>
                          <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide" style={{ color: 'var(--muted)' }}>
                            Actions
                          </div>
                          <div className="space-y-1">
                            {inst.actions.map((a) => (
                              <div
                                key={`${a.stepOrder}-${a.at}`}
                                className="flex items-center justify-between rounded px-2 py-1.5 text-[12px]"
                                style={{ background: 'var(--panel-2, #f9fafb)' }}
                              >
                                <div className="flex items-center gap-2">
                                  <Chip
                                    tone={a.action === 'approved' ? 'ok' : a.action === 'rejected' ? 'bad' : 'info'}
                                  >
                                    {a.action}
                                  </Chip>
                                  <span>{fmtRole(a.role)}</span>
                                </div>
                                <div className="flex items-center gap-2" style={{ color: 'var(--muted)' }}>
                                  {a.actorEmail}
                                  <span>{fmtDate(a.at)}</span>
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>
                      ) : (
                        <div className="text-[12px]" style={{ color: 'var(--muted)' }}>
                          No actions recorded yet.
                        </div>
                      )}
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>
        )}
      </Panel>

      {editing ? (
        <StepEditorDialog
          chain={editing.chain}
          steps={editing.steps}
          setSteps={(next) => setEditing((prev) => (prev ? { ...prev, steps: next } : prev))}
          onCancel={() => setEditing(null)}
          onSave={() => void saveEdit()}
        />
      ) : null}

      {creating ? (
        <NewChainDialog
          onCreated={(c) => {
            setChains((prev) => [...prev, c]);
            setCreating(false);
          }}
          onCancel={() => setCreating(false)}
        />
      ) : null}
    </>
  );
}

/** All role keys a step may assign. Kept in sync with role.seed.ts. */
const ROLE_OPTIONS = [
  'siteengineer', 'commercialfinance', 'projectmanager', 'pmcdirector',
  'procurement', 'storekeeper', 'compliance', 'hr', 'ceo', 'superadmin',
];

function roleLabel(role: string): string {
  const MAP: Record<string, string> = {
    siteengineer: 'Site Engineer',
    commercialfinance: 'Commercial / Finance',
    projectmanager: 'PM',
    pmcdirector: 'PM / Director',
    procurement: 'Procurement',
    storekeeper: 'Store Keeper',
    compliance: 'Compliance',
    hr: 'HR',
    ceo: 'CEO',
    superadmin: 'Super Admin',
  };
  return MAP[role] ?? role;
}

/** The step editor for one chain. */
function StepEditorDialog({
  chain,
  steps,
  setSteps,
  onCancel,
  onSave,
}: {
  chain: ApprovalChain;
  steps: ApprovalChainStep[];
  setSteps: (next: ApprovalChainStep[]) => void;
  onCancel: () => void;
  onSave: () => void;
}) {
  function setStep(idx: number, patch: Partial<ApprovalChainStep>): void {
    setSteps(steps.map((s, i) => (i === idx ? { ...s, ...patch } : s)));
  }
  function addStep(): void {
    setSteps([...steps, { order: steps.length + 1, name: `Step ${steps.length + 1}`, role: 'commercialfinance', minAmount: 0, maxAmount: 0, parallel: false }]);
  }
  function removeStep(idx: number): void {
    if (steps.length <= 1) return;
    setSteps(steps.filter((_, i) => i !== idx).map((s, i) => ({ ...s, order: i + 1 })));
  }
  function move(idx: number, dir: -1 | 1): void {
    const target = idx + dir;
    if (target < 0 || target >= steps.length) return;
    const next = [...steps];
    const [s] = next.splice(idx, 1);
    next.splice(target, 0, s);
    setSteps(next.map((st, i) => ({ ...st, order: i + 1 })));
  }

  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center p-4"
      style={{ background: 'rgba(15, 23, 41, 0.45)' }}
      role="dialog"
      aria-modal="true"
    >
      <div
        className="w-full max-w-2xl rounded"
        style={{ background: 'var(--panel)', border: '1px solid var(--line)' }}
      >
        <div className="px-4 py-3" style={{ borderBottom: '1px solid var(--line-2)' }}>
          <h3 className="m-0 text-[14px] font-semibold">Edit {chain.label}</h3>
          <p className="mt-1 text-[11.5px]" style={{ color: 'var(--muted)' }}>
            Chain: {chain.key} · entity {chain.entity}
          </p>
        </div>

        <div className="max-h-[60vh] overflow-y-auto p-4">
          {steps.map((s, idx) => (
            <div
              key={idx}
              className="mb-2 rounded p-2"
              style={{ background: 'var(--panel-2, #f9fafb)', border: '1px solid var(--line)' }}
            >
              <div className="flex flex-wrap items-end gap-2">
                <div className="flex flex-col items-center gap-1">
                  <button type="button" onClick={() => move(idx, -1)} disabled={idx === 0} className="text-[11px]" style={{ color: idx === 0 ? 'var(--faint)' : 'var(--blue, #2563eb)' }}>↑</button>
                  <span className="num text-[13px] font-semibold">{idx + 1}</span>
                  <button type="button" onClick={() => move(idx, 1)} disabled={idx === steps.length - 1} className="text-[11px]" style={{ color: idx === steps.length - 1 ? 'var(--faint)' : 'var(--blue, #2563eb)' }}>↓</button>
                </div>
                <label className="flex-1">
                  <span className="mb-0.5 block text-[11px]" style={{ color: 'var(--muted)' }}>Name</span>
                  <input
                    value={s.name}
                    onChange={(e) => setStep(idx, { name: e.target.value })}
                    className="w-full rounded px-2 py-1 text-[12.5px]"
                    style={{ border: '1px solid var(--line)', background: '#fff', color: 'var(--ink)' }}
                  />
                </label>
                <label className="w-[170px]">
                  <span className="mb-0.5 block text-[11px]" style={{ color: 'var(--muted)' }}>Role</span>
                  <select
                    value={s.role}
                    onChange={(e) => setStep(idx, { role: e.target.value })}
                    className="w-full rounded px-2 py-1 text-[12.5px]"
                    style={{ border: '1px solid var(--line)', background: '#fff', color: 'var(--ink)' }}
                  >
                    {ROLE_OPTIONS.map((r) => (
                      <option key={r} value={r}>{roleLabel(r)}</option>
                    ))}
                  </select>
                </label>
                <label className="w-[110px]">
                  <span className="mb-0.5 block text-[11px]" style={{ color: 'var(--muted)' }}>Min ₹</span>
                  <input
                    type="number"
                    min={0}
                    value={s.minAmount}
                    onChange={(e) => setStep(idx, { minAmount: Number(e.target.value) || 0 })}
                    className="w-full rounded px-2 py-1 text-[12.5px]"
                    style={{ border: '1px solid var(--line)', background: '#fff', color: 'var(--ink)' }}
                  />
                </label>
                <label className="w-[110px]">
                  <span className="mb-0.5 block text-[11px]" style={{ color: 'var(--muted)' }}>Max ₹ (0 = ∞)</span>
                  <input
                    type="number"
                    min={0}
                    value={s.maxAmount}
                    onChange={(e) => setStep(idx, { maxAmount: Number(e.target.value) || 0 })}
                    className="w-full rounded px-2 py-1 text-[12.5px]"
                    style={{ border: '1px solid var(--line)', background: '#fff', color: 'var(--ink)' }}
                  />
                </label>
                <label className="flex items-center gap-1 text-[11.5px]" style={{ color: 'var(--muted)' }}>
                  <input
                    type="checkbox"
                    checked={s.parallel}
                    onChange={(e) => setStep(idx, { parallel: e.target.checked })}
                  />
                  Parallel
                </label>
                <button
                  type="button"
                  onClick={() => removeStep(idx)}
                  disabled={steps.length <= 1}
                  className="text-[11px]"
                  style={{ color: steps.length <= 1 ? 'var(--faint)' : 'var(--red, #b91c1c)' }}
                >
                  Remove
                </button>
              </div>
            </div>
          ))}

          <div className="mt-2">
            <Button onClick={addStep}>Add step</Button>
          </div>
        </div>

        <div className="flex justify-end gap-2 px-4 py-3" style={{ borderTop: '1px solid var(--line)' }}>
          <Button onClick={onCancel}>Cancel</Button>
          <Button variant="primary" onClick={onSave}>Save chain</Button>
        </div>
      </div>
    </div>
  );
}

/** Create a brand-new chain from scratch. */
function NewChainDialog({
  onCreated,
  onCancel,
}: {
  onCreated: (c: ApprovalChain) => void;
  onCancel: () => void;
}) {
  const [key, setKey] = useState('');
  const [label, setLabel] = useState('');
  const [entity, setEntity] = useState('');
  const [description, setDescription] = useState('');
  const [steps, setSteps] = useState<ApprovalChainStep[]>([
    { order: 1, name: 'Step 1', role: 'commercialfinance', minAmount: 0, maxAmount: 0, parallel: false },
  ]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function submit(): Promise<void> {
    if (!key.trim() || !label.trim() || !entity.trim()) {
      setErr('Key, label and entity are required.');
      return;
    }
    setBusy(true);
    setErr(null);
    try {
      const created = await approvals.createChain({
        key: key.trim(),
        label: label.trim(),
        entity: entity.trim(),
        description: description.trim(),
        steps,
      });
      onCreated(created);
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Failed to create chain');
      setBusy(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center p-4"
      style={{ background: 'rgba(15, 23, 41, 0.45)' }}
      role="dialog"
      aria-modal="true"
    >
      <div
        className="w-full max-w-lg rounded p-4"
        style={{ background: 'var(--panel)', border: '1px solid var(--line)' }}
      >
        <h3 className="m-0 text-[14px] font-semibold">New approval chain</h3>
        <div className="mt-3 space-y-2.5">
          <label className="block">
            <span className="mb-0.5 block text-[11px]" style={{ color: 'var(--muted)' }}>Key (machine id, e.g. variation_approval)</span>
            <input value={key} onChange={(e) => setKey(e.target.value)} placeholder="variation_approval"
              className="w-full rounded px-2 py-1.5 text-[13px]" style={{ border: '1px solid var(--line)', background: '#fff', color: 'var(--ink)' }} />
          </label>
          <label className="block">
            <span className="mb-0.5 block text-[11px]" style={{ color: 'var(--muted)' }}>Label</span>
            <input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Variation / change request"
              className="w-full rounded px-2 py-1.5 text-[13px]" style={{ border: '1px solid var(--line)', background: '#fff', color: 'var(--ink)' }} />
          </label>
          <label className="block">
            <span className="mb-0.5 block text-[11px]" style={{ color: 'var(--muted)' }}>Entity (record type key it opens)</span>
            <input value={entity} onChange={(e) => setEntity(e.target.value)} placeholder="variation"
              className="w-full rounded px-2 py-1.5 text-[13px]" style={{ border: '1px solid var(--line)', background: '#fff', color: 'var(--ink)' }} />
          </label>
          <label className="block">
            <span className="mb-0.5 block text-[11px]" style={{ color: 'var(--muted)' }}>Description</span>
            <input value={description} onChange={(e) => setDescription(e.target.value)}
              className="w-full rounded px-2 py-1.5 text-[13px]" style={{ border: '1px solid var(--line)', background: '#fff', color: 'var(--ink)' }} />
          </label>

          <div>
            <span className="mb-1 block text-[11px]" style={{ color: 'var(--muted)' }}>Initial steps</span>
            {steps.map((s, idx) => (
              <div key={idx} className="mb-2 flex gap-2">
                <input value={s.name} onChange={(e) => setSteps(steps.map((x, i) => i === idx ? { ...x, name: e.target.value } : x))}
                  className="flex-1 rounded px-2 py-1 text-[12.5px]" style={{ border: '1px solid var(--line)', background: '#fff', color: 'var(--ink)' }} />
                <select value={s.role} onChange={(e) => setSteps(steps.map((x, i) => i === idx ? { ...x, role: e.target.value } : x))}
                  className="w-[150px] rounded px-2 py-1 text-[12.5px]" style={{ border: '1px solid var(--line)', background: '#fff', color: 'var(--ink)' }}>
                  {ROLE_OPTIONS.map((r) => <option key={r} value={r}>{roleLabel(r)}</option>)}
                </select>
                {steps.length > 1 ? (
                  <button type="button" onClick={() => setSteps(steps.filter((_, i) => i !== idx))}
                    className="text-[11px]" style={{ color: 'var(--red, #b91c1c)' }}>×</button>
                ) : null}
              </div>
            ))}
            <button type="button" onClick={() => setSteps([...steps, { order: steps.length + 1, name: `Step ${steps.length + 1}`, role: 'commercialfinance', minAmount: 0, maxAmount: 0, parallel: false }])}
              className="text-[12px] underline" style={{ color: 'var(--blue, #2563eb)' }}>
              Add step
            </button>
          </div>
        </div>

        {err ? <p className="mt-2 text-[12px]" style={{ color: 'var(--red, #b91c1c)' }}>{err}</p> : null}

        <div className="mt-4 flex justify-end gap-2">
          <Button onClick={onCancel}>Cancel</Button>
          <Button variant="primary" disabled={busy} onClick={() => void submit()}>
            {busy ? 'Creating…' : 'Create chain'}
          </Button>
        </div>
      </div>
    </div>
  );
}
