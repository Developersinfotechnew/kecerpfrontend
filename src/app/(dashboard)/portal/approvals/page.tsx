'use client';

import { useCallback, useEffect, useState } from 'react';

import { approvals, projects, uploads } from '@/lib/services';
import type { FileValue } from '@/lib/types';
import type { Priority } from '@/lib/services';
import { useSession } from '@/app/session';
import { Button, Chip, Notice, PageHead, Panel } from '@/components/ui';

interface QueueItem {
  id: string;
  entity: string;
  entityId: string;
  amount: number;
  priority: Priority;
  projectId?: string;
  stepOrder: number;
  stepName: string;
  totalSteps: number;
  requestedByEmail: string;
  createdAt: string;
}

/**
 * CR-02: the client's own "Items for your approval" inbox.
 *
 * The client role (clientengineer / clientmgmt) is team-gated to one project,
 * so this queue already shows only their plant's items. Four actions map onto
 * the single engine act(): plain approve, approve-with-comments (an approve
 * that carries a remark), return-for-resubmission and reject. A remark is
 * mandatory for every action except a clean approve. Each decision can carry
 * an evidence attachment — the signed copy, a marked-up drawing or a letter.
 */
export default function PortalApprovalsPage() {
  const { user, can } = useSession();
  const [items, setItems] = useState<QueueItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const [notes, setNotes] = useState<Record<string, string>>({});
  const [evidence, setEvidence] = useState<Record<string, FileValue>>({});
  const [uploadingId, setUploadingId] = useState<string | null>(null);

  const [projectNames, setProjectNames] = useState<Map<string, string>>(new Map());

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setItems((await approvals.queue()) as QueueItem[]);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load your approval items');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    projects
      .list()
      .then((rows) => setProjectNames(new Map(rows.map((p) => [p.id, p.name]))))
      .catch(() => setProjectNames(new Map()));
  }, []);

  async function attach(item: QueueItem, file: File): Promise<void> {
    setUploadingId(item.id);
    setError(null);
    try {
      const value = await uploads.upload(file, 'clientapproval:create');
      setEvidence((prev) => ({ ...prev, [item.id]: value }));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Attachment failed');
    } finally {
      setUploadingId(null);
    }
  }

  async function act(
    item: QueueItem,
    action: 'approve' | 'reject' | 'return',
    requireRemark: boolean,
  ): Promise<void> {
    const remark = (notes[item.id] ?? '').trim();
    if (requireRemark && remark === '') {
      setError('A remark is required for this action.');
      return;
    }
    setBusyId(item.id);
    setError(null);
    try {
      await approvals.act(item.id, action, remark, evidence[item.id] ?? null);
      setNotes((p) => {
        const n = { ...p };
        delete n[item.id];
        return n;
      });
      setEvidence((p) => {
        const n = { ...p };
        delete n[item.id];
        return n;
      });
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Decision could not be recorded');
    } finally {
      setBusyId(null);
    }
  }

  if (!can('workflow:approve')) {
    return (
      <>
        <PageHead title="Items for your approval" description="Your decision queue" />
        <Notice>You do not have approval rights. Ask your KEC representative to assign your client role.</Notice>
      </>
    );
  }

  const total = items.length;

  return (
    <>
      <PageHead
        title="Items for your approval"
        description={`Waiting on ${user?.name ?? 'you'} · ${total} item${total === 1 ? '' : 's'}. A clean approve needs no note; every other decision carries a mandatory remark and may attach evidence.`}
      />

      {error ? <Notice>{error}</Notice> : null}

      <Panel
        title="Your queue"
        sub={loading ? 'Loading…' : items.length ? `${items.length} item(s) awaiting your decision` : 'Nothing is waiting'}
        bodyless
      >
        {loading ? (
          <div className="px-4 py-10 text-center text-[13px]" style={{ color: 'var(--muted)' }}>
            Loading your items…
          </div>
        ) : items.length === 0 ? (
          <div className="px-4 py-10 text-center text-[13px]" style={{ color: 'var(--muted)' }}>
            Nothing is waiting on you right now.
          </div>
        ) : (
          <div>
            {items.map((item) => {
              const projectId = item.projectId ?? '';
              const pn = projectId ? projectNames.get(projectId) : undefined;
              const attached = evidence[item.id];
              const busy = busyId === item.id;
              return (
                <div
                  key={item.id}
                  className="px-4 py-4"
                  style={{ borderBottom: '1px solid var(--line-2)' }}
                >
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-[200px]">
                      <div className="num text-[13px] font-semibold" style={{ color: 'var(--ink)' }}>
                        {item.entityId}
                      </div>
                      <div className="mt-0.5 text-[12px]" style={{ color: 'var(--muted)' }}>
                        {item.entity} · {pn ?? 'No project'}
                      </div>
                      <div className="mt-1 flex flex-wrap items-center gap-2 text-[12px]">
                        <Chip tone="mute">
                          {item.stepName} · step {item.stepOrder} of {item.totalSteps}
                        </Chip>
                        {item.amount > 0 ? (
                          <span className="num" style={{ color: 'var(--muted)' }}>
                            ₹{item.amount.toLocaleString('en-IN')}
                          </span>
                        ) : null}
                        <span style={{ color: 'var(--faint)' }}>
                          raised by {item.requestedByEmail}
                        </span>
                      </div>
                    </div>

                    <div className="flex flex-col gap-2">
                      <textarea
                        rows={2}
                        value={notes[item.id] ?? ''}
                        onChange={(e) => setNotes((p) => ({ ...p, [item.id]: e.target.value }))}
                        placeholder="Remark — required for comments, return and reject"
                        className="w-[320px] rounded-md px-2.5 py-1.5 text-[12.5px]"
                        style={{
                          border: '1px solid var(--line)',
                          background: 'var(--panel)',
                          color: 'var(--ink)',
                          resize: 'vertical',
                          outline: 'none',
                        }}
                      />

                      <label
                        className="flex cursor-pointer items-center gap-2 rounded-md px-2.5 py-1.5 text-[12px]"
                        style={{
                          border: '1px dashed var(--line)',
                          background: 'var(--panel-2, #f6f8fa)',
                          color: attached ? 'var(--ok)' : 'var(--muted)',
                        }}
                      >
                        <input
                          type="file"
                          onChange={(e) => {
                            const f = e.target.files?.[0];
                            if (f) void attach(item, f);
                          }}
                          className="hidden"
                        />
                        {uploadingId === item.id
                          ? 'Uploading…'
                          : attached
                            ? `Attached: ${attached.name}`
                            : 'Attach evidence (signed copy, letter)…'}
                      </label>

                      <div className="flex flex-wrap justify-end gap-2">
                        <Button
                          variant="primary"
                          disabled={busy}
                          onClick={() => void act(item, 'approve', false)}
                        >
                          Approve
                        </Button>
                        <Button
                          disabled={busy || (notes[item.id] ?? '').trim() === ''}
                          onClick={() => void act(item, 'approve', true)}
                        >
                          Approve with comments
                        </Button>
                        <Button
                          disabled={busy || (notes[item.id] ?? '').trim() === ''}
                          onClick={() => void act(item, 'return', true)}
                        >
                          Return for resubmission
                        </Button>
                        <Button
                          disabled={busy || (notes[item.id] ?? '').trim() === ''}
                          onClick={() => void act(item, 'reject', true)}
                        >
                          Reject
                        </Button>
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </Panel>

      <Panel title="How a decision records" sub="One log row per item, locked on decision">
        <p className="m-0 max-w-[70ch] text-[13px]" style={{ color: 'var(--muted)' }}>
          Each decision is written to the Client approvals log with your name, designation, the
          date-time, this device's IP and your remark, plus any attachment. A plain approve records a
          clean decision; approving with a comment is stored as "approved with comments" and becomes
          an action point on the raiser. Return and reject each require a reason. Once a decision is
          recorded the row locks — a correction is a new row, not an edit.
        </p>
      </Panel>
    </>
  );
}
