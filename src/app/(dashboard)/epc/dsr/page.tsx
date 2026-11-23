'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';

import { records } from '@/lib/services';
import { useRowApprovals } from '@/lib/row-approvals';
import { ApprovalDetailsModal } from '@/components/ApprovalDetailsModal';
import { Button, Chip, DataTable, Notice, PageHead, Panel } from '@/components/ui';
import { RecordForm } from '@/components/RecordForm';
import type { RecordRow, RecordType } from '@/lib/types';

const DSR_KEY = 'dsr_entries';

const STATUS_TONE: Record<string, 'ok' | 'info' | 'warn' | 'bad' | 'mute'> = {
  WIP: 'mute',
  Requesting: 'warn',
  Approved: 'ok',
  Rejected: 'bad',
  'Query raised': 'info',
};

export default function EpcDsrPage() {
  const [type, setType] = useState<RecordType | null>(null);
  const [rows, setRows] = useState<RecordRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<RecordRow | null>(null);
  const [filter, setFilter] = useState('');
  const [projectId, setProjectId] = useState('');

  const { isApproved, hasChain, openDetail, detail, setDetail, detailBusy } =
    useRowApprovals(DSR_KEY, rows);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [typeRes, page] = await Promise.all([
        records.type(DSR_KEY),
        records.list(DSR_KEY, projectId ? { projectId, limit: 300 } : { limit: 300 }),
      ]);
      setType(typeRes);
      setRows(page.items);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load DSR');
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    void load();
  }, [load]);

  // Show approved rows read-only, but PM can still edit approved rows
  // (the backend enforces the same exception — client log item 5).
  const visible = useMemo(() => {
    if (!filter.trim()) return rows;
    const q = filter.trim().toLowerCase();
    return rows.filter((r) =>
      [r.ref, r.data.activity, r.data.item, r.data.status, r.data.planTask, r.data.subTask]
        .map((v) => String(v ?? '').toLowerCase())
        .some((v) => v.includes(q)),
    );
  }, [rows, filter]);

  const listFields = useMemo(
    () =>
      (type?.fields ?? [])
        .filter((f) => f.listColumn)
        .sort((a, b) => a.sortOrder - b.sortOrder),
    [type],
  );

  const rowsData = useMemo(() => {
    if (!type) return [];
    const fields = listFields;
    return visible.map((r) => {
      const cells: React.ReactNode[] = [];
      for (const f of fields) {
        const v = r.data[f.key];
        if (f.key === 'status') {
          const s = String(v ?? '');
          cells.push(<Chip key={f.key} tone={STATUS_TONE[s] ?? 'mute'}>{s || '—'}</Chip>);
        } else if (f.key === 'percentComplete') {
          cells.push(<span key={f.key} className="num">{String(v ?? '')}%</span>);
        } else if (f.key === 'images') {
          const imgs: string[] = Array.isArray(v) ? v : v ? [String(v)] : [];
          cells.push(imgs.length > 0 ? <span key={f.key} className="text-xs" style={{ color: 'var(--muted)' }}>{imgs.length} photo{imgs.length > 1 ? 's' : ''}</span> : '—');
        } else {
          cells.push(<span key={f.key}>{String(v ?? '') || '—'}</span>);
        }
      }
      cells.push(<span key="ref" className="num">{r.ref}</span>);
      const approved = isApproved(r.ref);
      const chain = hasChain(r.ref);
      // Fixed min-width + centred label so Edit and Details render the same
      // size box, whichever one a row shows.
      const cls = 'small whitespace-nowrap min-w-[84px] justify-center';
      // Same row rule the other registers follow: before approval the row
      // shows Edit; once the chain approves it, or a chain is live on it, the
      // row shows Details. A settled report is a fact to read, not to change.
      cells.push(
        <span key="actions" className="flex flex-wrap items-center justify-end gap-1.5">
          {!approved ? <Button variant="primary" className={cls} onClick={() => { setEditing(r); setFormOpen(true); }}>Edit</Button> : null}
          {approved || chain ? (
            <Button variant="primary" className={cls} disabled={detailBusy} onClick={() => void openDetail(r.ref)}>Details</Button>
          ) : null}
        </span>,
      );
      return cells;
    });
  }, [visible, type, listFields, isApproved, hasChain, detailBusy, setEditing, setFormOpen, openDetail]);

  const cols = useMemo(() => {
    const c = listFields.map((f) => ({ key: f.key, label: f.label, align: f.align as 'left' | 'right' | 'center' }));
    c.push({ key: 'ref', label: 'Ref', align: 'left' as const });
    c.push({ key: '_actions', label: '', align: 'right' as const });
    return c;
  }, [listFields]);

  return (
    <div>
      <PageHead
        title="Daily site reports"
        description={`${visible.length} of ${rows.length} entries`}
        actions={
          <div className="flex items-center gap-2">
            <input
              type="search"
              placeholder="Search DSR…"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              className="h-9 rounded-md border border-[var(--line)] bg-white px-3 text-sm"
            />
            <Button variant="primary" onClick={() => { setEditing(null); setFormOpen(true); }}>New DSR</Button>
          </div>
        }
      />

      {error ? <Notice>{error}</Notice> : null}

      {loading ? (
        <div className="py-10 text-center text-[13px]" style={{ color: 'var(--muted)' }}>Loading…</div>
      ) : (
        <Panel>
          <DataTable
            columns={cols}
            rows={rowsData}
            empty="No daily site reports yet."
          />
        </Panel>
      )}

      {formOpen && type ? (
        <RecordForm
          type={type}
          record={editing}
          initialValues={editing ? undefined : { status: 'Submit for approval' }}
          onCancel={() => { setFormOpen(false); setEditing(null); }}
          onSubmit={async (body) => {
            if (editing) {
              await records.update(DSR_KEY, editing.id, body);
            } else {
              await records.create(DSR_KEY, body);
            }
            setFormOpen(false);
            setEditing(null);
            void load();
          }}
        />
      ) : null}

      {detail ? <ApprovalDetailsModal state={detail} onClose={() => setDetail(null)} /> : null}
    </div>
  );
}
