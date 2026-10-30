'use client';

import { useCallback, useEffect, useState } from 'react';

import { approvals, records, projects } from '@/lib/services';
import type {
  ApprovalInstanceAction,
  AwaitingResubmitItem,
  HistoryItem,
  HistoryStatus,
  Priority,
  ReturnedByMeItem,
} from '@/lib/services';
import type { RecordRow, RecordType } from '@/lib/types';
import { RecordForm } from '@/components/RecordForm';
import { Button, Chip, DataTable, Notice, PageHead, Panel, VitalsRail } from '@/components/ui';
import { StepTracker } from '@/components/StepTracker';
import { ApprovalDetailsModal } from '@/components/ApprovalDetailsModal';

interface QueueItem {
  id: string;
  entity: string;
  entityId: string;
  /** The record's own title (register titleField). Empty when the register
   * has no titleField or the row no longer exists. */
  title?: string;
  amount: number;
  priority: Priority;
  projectId?: string;
  stepOrder: number;
  stepName: string;
  totalSteps: number;
  requestedByEmail: string;
  createdAt: string;
  /** Live chain with per-step states, from the backend. */
  chain?: Array<{ order: number; name: string; role: string; state: 'done' | 'current' | 'pending' }>;
  /** Decisions recorded on the chain. */
  actions?: Array<{
    stepOrder: number;
    role: string;
    actorEmail: string;
    actorName: string;
    action: string;
    remark: string;
    at: string;
  }>;
}

/**
 * The tone a priority chip renders. High is bad, Medium is warn, Low is
 * muted. The fallback covers any value the backend has not normalised.
 */
const PRIO_TONE: Record<string, 'ok' | 'info' | 'warn' | 'bad' | 'mute'> = {
  High: 'bad',
  Medium: 'warn',
  Low: 'mute',
};

/**
 * The priority a queue item or row is missing on. Records created before the
 * priority field existed have no value; treat the absence as Medium so the
 * chip never renders blank and the column stays aligned.
 */
const PRIO_DEFAULT = 'Medium';

function PrioChip({ priority }: { priority: Priority }) {
  const p = priority ?? PRIO_DEFAULT;
  return (
    <Chip tone={PRIO_TONE[p] ?? 'mute'}>
      {p}
    </Chip>
  );
}

/**
 * The unified approval queue.
 *
 * One inbox for every module. Three inboxes in one screen:
 *  - Pending your decision: steps this role owns, across every module.
 *  - Returned to you: documents an approver sent back for you to fix.
 *    Each has an Edit button (updates the record) and a Resubmit button.
 *  - Returned by you: documents you sent back that are still awaiting the
 *    requester's resubmission — your own audit trail of returns.
 */
export default function ApprovalsPage() {
  const [items, setItems] = useState<QueueItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [trailId, setTrailId] = useState<string | null>(null);
  const [trail, setTrail] = useState<Array<ApprovalInstanceAction & { actorName?: string }>>([]);
  const [resubmissions, setResubmissions] = useState<AwaitingResubmitItem[]>([]);
  const [returnedByMe, setReturnedByMe] = useState<ReturnedByMeItem[]>([]);
  const [resubmitNotes, setResubmitNotes] = useState<Record<string, string>>({});
  const [editing, setEditing] = useState<{ type: RecordType; row: RecordRow } | null>(null);
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [historyTab, setHistoryTab] = useState<HistoryStatus | 'all'>('all');
  const [histTrackId, setHistTrackId] = useState<string | null>(null);
  const [detail, setDetail] = useState<import('@/lib/services').RecordApprovalState | null>(null);
  const [projectNames, setProjectNames] = useState<Map<string, string>>(new Map());

  const loadHistory = useCallback(async (tab: HistoryStatus | 'all') => {
    try {
      const rows = await approvals.history(tab === 'all' ? undefined : tab);
      setHistory(rows);
    } catch {
      setHistory([]);
    }
  }, []);

  // Resolve project ids to names so the queue shows which plant each item is.
  useEffect(() => {
    projects
      .list()
      .then((rows) => {
        setProjectNames(new Map(rows.map((p) => [p.id, p.name])));
      })
      .catch(() => setProjectNames(new Map()));
  }, []);

  useEffect(() => {
    void loadHistory(historyTab);
  }, [historyTab, loadHistory]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    // Each inbox loads independently. A 403 on one (e.g. a stale token that
    // predates a new permission) must not blank the other two — so a missing
    // permission on the resubmission view still shows the decision queue.
    const [queueRes, awaitingRes, returnsRes] = await Promise.allSettled([
      approvals.queue(),
      approvals.awaiting(),
      approvals.returnedByMe(),
    ]);

    if (queueRes.status === 'fulfilled') setItems(queueRes.value as QueueItem[]);
    if (awaitingRes.status === 'fulfilled') setResubmissions(awaitingRes.value);
    if (returnsRes.status === 'fulfilled') setReturnedByMe(returnsRes.value);

    const failures = [queueRes, awaitingRes, returnsRes].filter(
      (r) => r.status === 'rejected',
    );
    if (failures.length > 0) {
      const first = failures[0] as PromiseRejectedResult;
      const msg = first.reason instanceof Error ? first.reason.message : 'Failed to load';
      // A permission gap is recoverable (re-login), so surface it without
      // hiding the inboxes that did load.
      setError(msg);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function act(id: string, action: 'approve' | 'reject' | 'return'): Promise<void> {
    const remark = notes[id]?.trim() ?? '';
    setBusyId(id);
    setError(null);
    try {
      await approvals.act(id, action, remark);
      setNotes((prev) => {
        const next = { ...prev };
        delete next[id];
        return next;
      });
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Action failed');
    } finally {
      setBusyId(null);
    }
  }

  async function toggleTrail(item: QueueItem): Promise<void> {
    if (trailId === item.id) {
      setTrailId(null);
      return;
    }
    setTrailId(item.id);
    try {
      const detail = await approvals.trail(item.id);
      setTrail(detail.actions ?? []);
    } catch {
      setTrail([]);
    }
  }

  async function resubmit(id: string): Promise<void> {
    const remark = resubmitNotes[id]?.trim() ?? '';
    setBusyId(`resub-${id}`);
    setError(null);
    try {
      await approvals.resubmit(id, remark);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Resubmit failed');
    } finally {
      setBusyId(null);
    }
  }

  /** Open the record form to edit the underlying document before resubmitting. */
  async function openEdit(item: AwaitingResubmitItem): Promise<void> {
    try {
      const type = await records.type(item.entity);
      const page = await records.list(item.entity, { limit: 300 });
      const row = page.items.find((r) => r.ref === item.entityId);
      if (!row) {
        setError(`No ${item.entity} record found for ${item.entityId}`);
        return;
      }
      setEditing({ type, row });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not open the record for editing');
    }
  }

  if (loading) return <p className="text-sm" style={{ color: 'var(--muted)' }}>Loading approvals…</p>;

  const totalValue = items.reduce((sum, i) => sum + i.amount, 0);

  return (
    <>
      <PageHead
        title="Approvals"
        description="Everything waiting on your role, across every module. Return items land with the requester to fix; your own returns are listed so you can see what is pending on their resubmission."
      />

      <VitalsRail
        items={[
          { label: 'Awaiting you', value: String(items.length), note: 'Across all modules' },
          { label: 'Total value', value: `₹${totalValue.toLocaleString('en-IN')}`, note: 'Sum of pending items' },
          { label: 'Awaiting resubmission', value: String(resubmissions.length), note: 'Returned to you' },
          { label: 'You returned', value: String(returnedByMe.length), note: 'Still pending with requester' },
        ]}
      />

      <div className="mt-[18px]" />

      {error ? <Notice>{error}</Notice> : null}

      <Panel
        title="Pending your decision"
        sub={items.length ? `${items.length} item${items.length === 1 ? '' : 's'}` : undefined}
        bodyless
      >
        {items.length === 0 ? (
          <div className="px-4 py-10 text-center text-[13px]" style={{ color: 'var(--muted)' }}>
            Nothing waiting on you.
          </div>
        ) : (
          <div className="divide-y" style={{ borderColor: 'var(--line)' }}>
            {items.map((item) => (
              <div key={item.id} className="px-4 py-3.5">
                {/* Card header: what it is, who asked, how much, how urgent */}
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
                  <div>
                    <span className="text-[13px] font-semibold">
                      {item.title ? `${item.title}` : item.entityId}
                    </span>
                    <span className="ml-2 num text-[11.5px]" style={{ color: 'var(--muted)' }}>
                      {item.entityId}
                    </span>
                    <span className="ml-2 text-[11.5px]" style={{ color: 'var(--muted)' }}>
                      {item.entity.replaceAll('_', ' ')}
                    </span>
                  </div>
                  <PrioChip priority={item.priority} />
                  {item.projectId ? (
                    <Chip tone="mute">
                      {projectNames.get(item.projectId) ?? item.projectId}
                    </Chip>
                  ) : null}
                  <span className="num ml-auto text-[13px] font-semibold">
                    ₹{item.amount.toLocaleString('en-IN')}
                  </span>
                  <span className="text-[11.5px]" style={{ color: 'var(--muted)' }}>
                    {item.requestedByEmail} ·{' '}
                    {new Date(item.createdAt).toLocaleDateString('en-IN', {
                      day: '2-digit',
                      month: 'short',
                    })}
                  </span>
                  <Button
                    onClick={async () => {
                      const state = await approvals.recordState(item.entity, item.entityId);
                      setDetail(state);
                    }}
                  >
                    Details
                  </Button>
                </div>

                {/* The chain position */}
                {item.chain && item.chain.length > 0 ? (
                  <div className="mt-3">
                    <StepTracker chain={item.chain} actions={item.actions ?? []} status="pending" />
                  </div>
                ) : (
                  <div className="mt-2 text-[12px]" style={{ color: 'var(--muted)' }}>
                    {item.stepName} · step {item.stepOrder} of {item.totalSteps}
                    {trailId === item.id && trail.length > 0 ? (
                      <div className="mt-1.5">
                        {trail.map((a, i) => (
                          <div key={i} className="text-[11.5px]">
                            <span style={{ color: 'var(--ink)' }}>{a.action}</span>
                            <span> · {a.actorName || a.actorEmail}</span>
                            {a.remark ? <span> · “{a.remark}”</span> : null}
                          </div>
                        ))}
                      </div>
                    ) : null}
                  </div>
                )}

                {/* Decision footer: note + the three calls */}
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <input
                    type="text"
                    placeholder="Note for the requester…"
                    value={notes[item.id] ?? ''}
                    onChange={(e) => setNotes((p) => ({ ...p, [item.id]: e.target.value }))}
                    className="w-full max-w-[320px] flex-1 rounded-md px-3 py-2 text-[12.5px]"
                    style={{
                      border: '1px solid var(--line)',
                      background: 'var(--panel)',
                      color: 'var(--ink)',
                      outline: 'none',
                    }}
                  />
                  <div className="flex flex-none items-center gap-2">
                    <Button
                      variant="primary"
                      onClick={() => void act(item.id, 'approve')}
                      className={busyId === item.id ? 'opacity-50' : ''}
                    >
                      Approve
                    </Button>
                    <Button onClick={() => void act(item.id, 'return')}>Return</Button>
                    <Button onClick={() => void act(item.id, 'reject')} className="text-[color:var(--danger,#c0392b)]">
                      Reject
                    </Button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </Panel>

      <Panel
        title="Returned to you"
        sub={resubmissions.length ? `${resubmissions.length} awaiting resubmission` : 'Nothing sent back'}
      >
        {resubmissions.length === 0 ? (
          <p className="m-0 text-[13px]" style={{ color: 'var(--muted)' }}>
            No items are waiting on you to fix and send back into the chain. When an approver
            returns one of your documents, it appears here with their note.
          </p>
        ) : (
          <div>
            {resubmissions.map((item) => (
              <div
                key={item.id}
                className="flex flex-wrap items-start gap-3 py-3"
                style={{ borderBottom: '1px solid var(--line-2)' }}
              >
                <div className="min-w-[160px]">
                  <div className="num text-[12.5px] font-semibold">{item.entityId}</div>
                  <div className="text-[11.5px]" style={{ color: 'var(--muted)' }}>
                    {item.workflowLabel} · ₹{item.amount.toLocaleString('en-IN')}
                  </div>
                </div>
                <div className="min-w-[180px]">
                  <div className="text-[12px] font-medium" style={{ color: 'var(--amber, #b45309)' }}>
                    Returned by {item.returnedBy || 'an approver'}
                  </div>
                  <div className="text-[11.5px]" style={{ color: 'var(--muted)' }}>
                    {new Date(item.returnedAt).toLocaleString('en-IN', {
                      day: '2-digit',
                      month: 'short',
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                    {item.returnedRemark ? ` · “${item.returnedRemark}”` : ''}
                  </div>
                </div>
                <div className="min-w-[160px] flex-1">
                  <div className="text-[11.5px]" style={{ color: 'var(--faint)' }}>
                    Resubmits to step {item.nextStepOrder} · {item.nextStepName}
                  </div>
                  <input
                    type="text"
                    placeholder="Explain the change you made…"
                    value={resubmitNotes[item.id] ?? ''}
                    onChange={(e) =>
                      setResubmitNotes((p) => ({ ...p, [item.id]: e.target.value }))
                    }
                    className="mt-1 w-full rounded px-2.5 py-1.5 text-[12.5px]"
                    style={{
                      border: '1px solid var(--line)',
                      background: 'var(--panel)',
                      color: 'var(--ink)',
                      outline: 'none',
                    }}
                  />
                </div>
                <div className="flex items-center gap-2">
                  <Button onClick={() => void openEdit(item)}>Edit record</Button>
                  <Button
                    variant="primary"
                    onClick={() => void resubmit(item.id)}
                    className={busyId === `resub-${item.id}` ? 'opacity-50' : ''}
                  >
                    Resubmit
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </Panel>

      <Panel
        title="Returned by you"
        sub={returnedByMe.length ? `${returnedByMe.length} awaiting the requester` : 'Nothing pending'}
      >
        {returnedByMe.length === 0 ? (
          <p className="m-0 text-[13px]" style={{ color: 'var(--muted)' }}>
            No items you returned are still awaiting a resubmission. When you return a document
            and it is waiting on the requester, it is listed here with your note.
          </p>
        ) : (
          <DataTable
            columns={[
              { key: 'ref', label: 'Reference' },
              { key: 'prio', label: 'Priority' },
              { key: 'by', label: 'Requester' },
              { key: 'note', label: 'Your return note' },
              { key: 'when', label: 'Returned' },
              { key: 'state', label: 'Status', align: 'right' },
            ]}
            rows={returnedByMe.map((item) => [
              <span key="r">
                <span className="num text-[12.5px] font-semibold">{item.entityId}</span>
                <span className="block text-[11.5px]" style={{ color: 'var(--muted)' }}>
                  {item.entity}
                </span>
              </span>,
              <span key="prio">
                <PrioChip priority={item.priority} />
              </span>,
              <span key="by" className="text-[12.5px]" style={{ color: 'var(--muted)' }}>
                {item.requestedByEmail}
              </span>,
              <span key="n" className="text-[12.5px]">
                {item.returnedRemark ? `“${item.returnedRemark}”` : '—'}
              </span>,
              <span key="w" className="text-[12.5px]" style={{ color: 'var(--muted)' }}>
                {new Date(item.returnedAt).toLocaleString('en-IN', {
                  day: '2-digit',
                  month: 'short',
                  hour: '2-digit',
                  minute: '2-digit',
                })}
              </span>,
              <span key="s">
                <Chip tone="warn">Awaiting resubmission</Chip>
              </span>,
            ])}
          />
        )}
      </Panel>

      <Panel
        title="Your record history"
        sub={`${history.length} record${history.length === 1 ? '' : 's'} · your role shown`}
        bodyless
      >
        <div className="flex flex-wrap gap-1.5 px-4 py-3" style={{ borderBottom: '1px solid var(--line-2)' }}>
          {(['all', 'pending', 'returned', 'rejected', 'approved'] as const).map((tab) => {
            const active = historyTab === tab;
            const label = tab === 'all' ? 'All' : tab.charAt(0).toUpperCase() + tab.slice(1);
            return (
              <button
                key={tab}
                type="button"
                onClick={() => setHistoryTab(tab)}
                className="rounded px-2.5 py-1 text-[12px] font-medium"
                style={{
                  background: active ? 'var(--accent-soft, #eef5f2)' : 'transparent',
                  color: active ? 'var(--ink)' : 'var(--muted)',
                  border: `1px solid ${active ? 'var(--line)' : 'transparent'}`,
                }}
              >
                {label}
              </button>
            );
          })}
        </div>
        {history.length === 0 ? (
          <div className="px-4 py-8 text-center text-[13px]" style={{ color: 'var(--muted)' }}>
            No records in this state.
          </div>
        ) : (
          <DataTable
            columns={[
              { key: 'ref', label: 'Reference' },
              { key: 'prio', label: 'Priority' },
              { key: 'status', label: 'Status' },
              { key: 'role', label: 'Your role' },
              { key: 'value', label: 'Value', align: 'right' },
              { key: 'last', label: 'Last action' },
              { key: 'track', label: 'Chain' },
              { key: 'when', label: 'Updated' },
            ]}
            rows={history.map((h) => [
              <span key="r">
                <span className="num text-[12.5px] font-semibold">{h.entityId}</span>
                <span className="block text-[11.5px]" style={{ color: 'var(--muted)' }}>
                  {h.entity}
                </span>
              </span>,
              <span key="prio">
                <PrioChip priority={h.priority} />
              </span>,
              <span key="s">
                <StatusChip status={h.status} />
              </span>,
              <span key="role" className="text-[12.5px]" style={{ color: 'var(--muted)' }}>
                {h.role}
              </span>,
              <span key="v" className="num">
                ₹{h.amount.toLocaleString('en-IN')}
              </span>,
              <span key="l" className="text-[12.5px]">
                {h.lastAction ? (
                  <>
                    <span style={{ color: 'var(--ink)' }}>{h.lastAction.action}</span>
                    <span style={{ color: 'var(--muted)' }}> by {h.lastAction.by}</span>
                    {h.lastAction.remark ? (
                      <span className="block text-[11.5px]" style={{ color: 'var(--muted)' }}>
                        “{h.lastAction.remark}”
                      </span>
                    ) : null}
                  </>
                ) : (
                  <span style={{ color: 'var(--faint)' }}>—</span>
                )}
              </span>,
              <span key="track">
                <button
                  type="button"
                  className="text-[11px] underline"
                  style={{ color: 'var(--blue, var(--accent))' }}
                  onClick={() => setHistTrackId(histTrackId === h.id ? null : h.id)}
                >
                  {histTrackId === h.id ? 'Hide' : 'Track'}
                </button>
              </span>,
              <span key="w" className="text-[12.5px]" style={{ color: 'var(--muted)' }}>
                {new Date(h.updatedAt).toLocaleString('en-IN', {
                  day: '2-digit',
                  month: 'short',
                  hour: '2-digit',
                  minute: '2-digit',
                })}
              </span>,
            ])}
          />
        )}
        {history.some((h) => h.id === histTrackId) ? (
          <div className="px-4 pb-4">
            <StepTracker
              chain={history.find((h) => h.id === histTrackId)?.chain ?? []}
              actions={history.find((h) => h.id === histTrackId)?.actions ?? []}
              status={history.find((h) => h.id === histTrackId)?.status}
            />
          </div>
        ) : null}
      </Panel>

      <Panel title="How an approval moves" sub="Every step is owned by a role, not a person">
        <p className="m-0 max-w-[70ch] text-[13px]" style={{ color: 'var(--muted)' }}>
          A requirement enters the chain at the first step, moves up on approval, and stops
          on rejection or return. Returning lands the document with the person who raised it;
          they read your note, fix the record with the Edit button, and Resubmit it to step 1.
          Rejection ends it. A step can require any one of a role, all of a role, or a specific
          named person — configured per workflow, never in code.
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          <Chip tone="ok">Approved step</Chip>
          <Chip tone="warn">Current step</Chip>
          <Chip tone="bad">Rejected</Chip>
          <Chip tone="info">Awaiting resubmission</Chip>
        </div>
      </Panel>

      {detail ? (
        <ApprovalDetailsModal state={detail} onClose={() => setDetail(null)} />
      ) : null}

      {editing ? (
        <RecordForm
          type={editing.type}
          record={editing.row}
          onCancel={() => setEditing(null)}
          onSubmit={async (body) => {
            await records.update(editing.type.key, editing.row.id, body);
            setEditing(null);
            setError(null);
          }}
        />
      ) : null}
    </>
  );
}
/** Colour-coded status chip for the history view. */
function StatusChip({ status }: { status: HistoryStatus }) {
  const tone: Record<HistoryStatus, 'ok' | 'warn' | 'bad' | 'info' | 'mute'> = {
    pending: 'warn',
    returned: 'info',
    rejected: 'bad',
    approved: 'ok',
    cancelled: 'mute',
  };
  const label: Record<HistoryStatus, string> = {
    pending: 'Pending',
    returned: 'Returned',
    rejected: 'Rejected',
    approved: 'Approved',
    cancelled: 'Cancelled',
  };
  return <Chip tone={tone[status]}>{label[status]}</Chip>;
}
