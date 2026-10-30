'use client';

import type { RecordApprovalState } from '@/lib/services';
import { StepTracker } from '@/components/StepTracker';

/**
 * What is this approval, and where is it now.
 *
 * The caller (queue card or register row) shows only the position; this
 * modal shows the substance: the underlying record's fields (what was
 * raised, by whom), the live chain with done/current/pending states, the
 * people who own the next step, and every decision made so far with its
 * note. Used by the approvals queue and by register rows that carry a
 * chain.
 */
export function ApprovalDetailsModal({
  state,
  onClose,
}: {
  state: RecordApprovalState;
  onClose: () => void;
}) {
  const r = state.record;
  const statusWord =
    state.status === 'pending'
      ? state.awaitingUser
        ? 'Returned — waiting on resubmission'
        : 'Pending'
      : state.status.charAt(0).toUpperCase() + state.status.slice(1);

  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center p-4"
      style={{ background: 'rgba(15, 23, 41, 0.45)' }}
      role="dialog"
      aria-modal="true"
    >
      <div
        className="flex max-h-[92vh] w-full max-w-2xl flex-col rounded"
        style={{ background: 'var(--panel)', border: '1px solid var(--line)' }}
      >
        <div
          className="flex items-center justify-between px-4 py-3"
          style={{ borderBottom: '1px solid var(--line-2)' }}
        >
          <div>
            <h3 className="m-0 text-[14px] font-semibold">
              {r.ref} · {state.workflowLabel}
            </h3>
            <p className="mb-0 mt-0.5 text-[11.5px]" style={{ color: 'var(--muted)' }}>
              {statusWord}
              {state.amount > 0 ? ` · ₹${state.amount.toLocaleString('en-IN')}` : ''}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-[18px] leading-none"
            style={{ color: 'var(--muted)' }}
            aria-label="Close"
          >
            ×
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-4">
          <StepTracker
            chain={state.chain}
            actions={state.actions}
            status={state.status}
          />

          {state.status === 'pending' ? (
            <div
              className="mt-3 rounded p-2.5 text-[12.5px]"
              style={{ background: 'var(--panel-2, #f9fafb)', border: '1px solid var(--line)' }}
            >
              {state.awaitingUser ? (
                <div>
                  <strong>Waiting on the requester</strong> to fix and resubmit. It restarts at
                  step 1 when they do.
                </div>
              ) : state.nextStep ? (
                <div>
                  <strong>Now with:</strong> step {state.nextStep.order} — {state.nextStep.name} (
                  {state.nextStep.role}).{' '}
                  {state.nextOwners.length > 0 ? (
                    <>
                      <strong>Waiting for:</strong> {state.nextOwners.map((o) => o.name || o.email).join(', ')}
                    </>
                  ) : (
                    <span>No one is assigned to the {state.nextStep.role} role yet.</span>
                  )}
                </div>
              ) : (
                <div>Every step has a decision; the chain is closing.</div>
              )}
            </div>
          ) : null}

          <div className="mt-4">
            <div
              className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide"
              style={{ color: 'var(--muted)' }}
            >
              What this approval is about
            </div>
            <div className="grid gap-1 text-[12.5px]">
              <div className="flex gap-2">
                <span className="w-44 flex-none" style={{ color: 'var(--muted)' }}>
                  Raised by
                </span>
                <span>{r.raisedByName}</span>
              </div>
              {r.raisedAt ? (
                <div className="flex gap-2">
                  <span className="w-44 flex-none" style={{ color: 'var(--muted)' }}>
                    Raised on
                  </span>
                  <span>{new Date(r.raisedAt).toLocaleString('en-IN')}</span>
                </div>
              ) : null}
              {r.fields.map((f) => (
                <div key={f.label} className="flex gap-2">
                  <span className="w-44 flex-none" style={{ color: 'var(--muted)' }}>
                    {f.label}
                  </span>
                  <span className="min-w-0 break-words">{f.value}</span>
                </div>
              ))}
            </div>
          </div>

          <div className="mt-4">
            <div
              className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide"
              style={{ color: 'var(--muted)' }}
            >
              Decisions so far
            </div>
            {state.actions.length === 0 ? (
              <p className="m-0 text-[12.5px]" style={{ color: 'var(--muted)' }}>
                No decision recorded yet — the first step is still open.
              </p>
            ) : (
              <div className="grid gap-1 text-[12px]">
                {state.actions.map((a, i) => (
                  <div key={i} className="flex flex-wrap gap-x-2">
                    <span className="font-medium">{a.actorName || a.actorEmail}</span>
                    <span style={{ color: 'var(--muted)' }}>
                      {a.action} · step {a.stepOrder} ({a.role}) ·{' '}
                      {new Date(a.at).toLocaleString('en-IN')}
                    </span>
                    {a.remark ? <span style={{ color: 'var(--muted)' }}>“{a.remark}”</span> : null}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
