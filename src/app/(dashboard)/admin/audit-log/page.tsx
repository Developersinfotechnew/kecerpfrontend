'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';

import { Button, Chip, DataTable, Notice, PageHead, Panel } from '@/components/ui';
import { useSession } from '@/app/session';
import { admin, type AuditEntry, type AuditLogPage } from '@/lib/services';

/**
 * Audit log viewer.
 *
 * Read-only. Shows who did what and when, with the before/after diff for
 * each mutation. Gated on admin:view — only platform roles can open this.
 * Supports filtering by entity, action, actor email and date range.
 */

const PAGE_SIZE = 50;

export default function AuditLogPage() {
  const { can } = useSession();
  const canView = can('admin:view');

  const [page, setPage] = useState<AuditLogPage | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [filterEntity, setFilterEntity] = useState('');
  const [filterAction, setFilterAction] = useState('');
  const [filterActor, setFilterActor] = useState('');
  const [filterFrom, setFilterFrom] = useState('');

  const [expanded, setExpanded] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await admin.auditLog({
        entity: filterEntity || undefined,
        action: filterAction || undefined,
        actorEmail: filterActor || undefined,
        from: filterFrom || undefined,
        limit: PAGE_SIZE,
        skip: 0,
      });
      setPage(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load audit log');
    } finally {
      setLoading(false);
    }
  }, [filterEntity, filterAction, filterActor, filterFrom]);

  useEffect(() => {
    if (canView) void load();
    else setLoading(false);
  }, [canView, load]);

  if (!canView) {
    return <Notice>You need admin:view to open the audit log.</Notice>;
  }

  const allActions = useMemo(() => {
    if (!page) return [];
    return [...new Set(page.items.map((i) => i.action))].sort();
  }, [page]);

  const allEntities = useMemo(() => {
    if (!page) return [];
    return [...new Set(page.items.map((i) => i.entity))].sort();
  }, [page]);

  return (
    <>
      <PageHead
        title="Audit log"
        description="Append-only trail of every mutation in the system: who, what, when, and the before/after diff."
        actions={
          <Button
            onClick={async () => {
              const rows = await admin.exportAuditLog({
                entity: filterEntity || undefined,
                action: filterAction || undefined,
                limit: 5000,
              });
              const csv = toCsv(rows);
              const blob = new Blob([csv], { type: 'text/csv' });
              const url = URL.createObjectURL(blob);
              const a = document.createElement('a');
              a.href = url;
              a.download = `audit-log-${new Date().toISOString().slice(0, 10)}.csv`;
              a.click();
              URL.revokeObjectURL(url);
            }}
          >
            Export CSV
          </Button>
        }
      />

      <Panel title="Filters" bodyless>
        <div className="grid gap-2 p-3 sm:grid-cols-2 lg:grid-cols-4">
          <input
            type="text"
            value={filterEntity}
            onChange={(e) => setFilterEntity(e.target.value)}
            placeholder="Entity (e.g. Record:ncr_register)"
            className="rounded px-2.5 py-2 text-[13px] outline-none"
            style={{ background: 'var(--panel-2)', border: '1px solid var(--line)', color: 'var(--ink)' }}
          />
          <input
            type="text"
            value={filterAction}
            onChange={(e) => setFilterAction(e.target.value)}
            placeholder="Action (e.g. record.update)"
            className="rounded px-2.5 py-2 text-[13px] outline-none"
            style={{ background: 'var(--panel-2)', border: '1px solid var(--line)', color: 'var(--ink)' }}
          />
          <input
            type="email"
            value={filterActor}
            onChange={(e) => setFilterActor(e.target.value)}
            placeholder="Actor email"
            className="rounded px-2.5 py-2 text-[13px] outline-none"
            style={{ background: 'var(--panel-2)', border: '1px solid var(--line)', color: 'var(--ink)' }}
          />
          <input
            type="date"
            value={filterFrom}
            onChange={(e) => setFilterFrom(e.target.value)}
            className="rounded px-2.5 py-2 text-[13px] outline-none"
            style={{ background: 'var(--panel-2)', border: '1px solid var(--line)', color: 'var(--ink)' }}
          />
        </div>
        <div className="flex gap-2 border-t px-3 py-2" style={{ borderColor: 'var(--line-2)' }}>
          <Button onClick={() => void load()}>Apply filters</Button>
          <Button
            onClick={() => {
              setFilterEntity('');
              setFilterAction('');
              setFilterActor('');
              setFilterFrom('');
            }}
          >
            Clear
          </Button>
        </div>
      </Panel>

      {error ? <Notice>{error}</Notice> : null}

      <Panel
        title="Entries"
        sub={loading ? 'Loading…' : page ? `${page.total} total · showing ${page.items.length}` : ''}
        bodyless
      >
        {page && page.items.length === 0 ? (
          <p className="m-0 p-4 text-[13px]" style={{ color: 'var(--muted)' }}>
            No audit entries match the current filters.
          </p>
        ) : (
          <DataTable
            columns={[
              { key: 'time', label: 'Time' },
              { key: 'actor', label: 'Actor' },
              { key: 'action', label: 'Action' },
              { key: 'entity', label: 'Entity' },
              { key: 'id', label: 'Entity ID' },
              { key: 'diff', label: '' },
            ]}
            rows={page?.items.map((i) => [
              <span key="t" className="num text-[11.5px]">
                {new Date(i.createdAt).toLocaleString('en-IN', { dateStyle: 'short', timeStyle: 'short' })}
              </span>,
              <span key="a">{i.actorEmail}</span>,
              <Chip key="ac" tone="mute">{i.action}</Chip>,
              <span key="e">{i.entity}</span>,
              <span key="id" className="num text-[11.5px]">{i.entityId || '—'}</span>,
              <Button key="d" onClick={() => setExpanded(expanded === i._id ? null : i._id)}>
                {expanded === i._id ? 'Hide' : 'Diff'}
              </Button>,
            ]) ?? []}
          />
        )}
      </Panel>

      {expanded && page ? (
        <Panel title="Change detail" sub={page.items.find((i) => i._id === expanded)?.entity ?? ''} bodyless>
          <DiffView entry={page.items.find((i) => i._id === expanded) ?? null} />
        </Panel>
      ) : null}
    </>
  );
}

function DiffView({ entry }: { entry: AuditEntry | null }) {
  if (!entry) return <p className="m-0 p-4 text-[13px]" style={{ color: 'var(--muted)' }}>No entry selected.</p>;

  const changed = diffKeys(entry.before, entry.after);
  return (
    <div className="p-3">
      <div className="mb-3 text-[12px]" style={{ color: 'var(--muted)' }}>
        {entry.action} · {entry.entity} · {entry.entityId} · {entry.actorEmail} ({entry.actorRole})
      </div>
      {changed.length === 0 ? (
        <p className="m-0 text-[13px]" style={{ color: 'var(--muted)' }}>No field-level diff recorded.</p>
      ) : (
        <DataTable
          columns={[
            { key: 'field', label: 'Field' },
            { key: 'before', label: 'Before' },
            { key: 'after', label: 'After' },
          ]}
          rows={changed.map((k) => [
            <span key="f" className="font-semibold">{k}</span>,
            <span key="b" className="num text-[12px]">{json(entry.before?.[k])}</span>,
            <span key="a" className="num text-[12px]" style={{ color: 'var(--ok)' }}>{json(entry.after?.[k])}</span>,
          ])}
        />
      )}
    </div>
  );
}

function diffKeys(
  before: Record<string, unknown> | null,
  after: Record<string, unknown> | null,
): string[] {
  if (!before && !after) return [];
  const keys = new Set([...Object.keys(before ?? {}), ...Object.keys(after ?? {})]);
  return [...keys].filter((k) => JSON.stringify(before?.[k]) !== JSON.stringify(after?.[k]));
}

function json(v: unknown): string {
  if (v === null || v === undefined) return '—';
  if (typeof v === 'object') return JSON.stringify(v);
  return String(v);
}

function toCsv(rows: AuditEntry[]): string {
  const header = ['createdAt', 'actorEmail', 'actorRole', 'action', 'entity', 'entityId', 'ip'];
  const lines = [header.join(',')];
  for (const r of rows) {
    lines.push(
      [r.createdAt, r.actorEmail, r.actorRole, r.action, r.entity, r.entityId, r.ip]
        .map((v) => `"${String(v).replace(/"/g, '""')}"`)
        .join(','),
    );
  }
  return lines.join('\n');
}
