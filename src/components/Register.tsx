'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';

import { records as recordService } from '@/lib/services';
import type { RecordField, RecordRow, RecordType } from '@/lib/types';
import { useSession } from '@/app/session';
import { Button, Chip, DataTable, Notice, PageHead, Panel } from '@/components/ui';
import type { ChipTone } from '@/components/ui';
import { RecordForm } from '@/components/RecordForm';

/**
 * Generic register screen.
 *
 * Takes a type key and renders the whole register: table, search, create, edit
 * and delete. It reads the type's field metadata to decide every column, every
 * input and every validation hint. It never hardcodes a field of any specific
 * register, which is what lets one file serve compliance, risks, actions, and
 * any register an admin adds later.
 *
 * The three permissions are read from the session, but only to decide which
 * buttons render. The API enforces the same three independently.
 */

interface RegisterProps {
  typeKey: string;
  title: string;
  description?: string;
  /** Hide the create button even when the user may create. */
  readOnly?: boolean;
}

export function Register({ typeKey, title, description, readOnly }: RegisterProps) {
  const { can } = useSession();

  const [type, setType] = useState<RecordType | null>(null);
  const [rows, setRows] = useState<RecordRow[]>([]);
  const [total, setTotal] = useState(0);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<RecordRow | null>(null);
  const [creating, setCreating] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const t = await recordService.type(typeKey);
      setType(t);
      const page = await recordService.list(typeKey, { search, limit: 200 });
      setRows(page.items);
      setTotal(page.total);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load register');
    } finally {
      setLoading(false);
    }
  }, [typeKey, search]);

  useEffect(() => {
    void load();
  }, [load]);

  const listFields = useMemo(
    () =>
      (type?.fields ?? [])
        .filter((f) => f.listColumn)
        .sort((a, b) => a.sortOrder - b.sortOrder),
    [type],
  );

  const module = type?.permissionModule ?? '';
  const mayCreate = !readOnly && can(`${module}:create`);
  const mayUpdate = !readOnly && can(`${module}:update`);
  const mayDelete = !readOnly && can(`${module}:delete`);

  const columns = useMemo(() => {
    const cols = listFields.map((f) => ({
      key: f.key,
      label: f.label,
      align: f.align,
    }));
    cols.push({ key: 'ref', label: 'Ref', align: 'left' });
    if (mayUpdate || mayDelete) cols.push({ key: '_actions', label: '', align: 'right' });
    return cols;
  }, [listFields, mayUpdate, mayDelete]);

  async function remove(row: RecordRow): Promise<void> {
    if (!window.confirm(`Delete ${row.ref}? This cannot be undone.`)) return;
    setBusyId(row.id);
    setError(null);
    try {
      await recordService.remove(typeKey, row.id);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Delete failed');
    } finally {
      setBusyId(null);
    }
  }

  async function submit(body: Record<string, unknown>): Promise<void> {
    if (editing) {
      await recordService.update(typeKey, editing.id, body);
    } else {
      await recordService.create(typeKey, body);
    }
    setEditing(null);
    setCreating(false);
    await load();
  }

  const tableRows = rows.map((row) => {
    const cells = listFields.map((f) => (
      <span key={f.key}>{renderCell(f, row.data[f.key])}</span>
    ));

    cells.push(
      <span key="ref" className="num text-[12px]" style={{ color: 'var(--muted)' }}>
        {row.ref}
      </span>,
    );

    if (mayUpdate || mayDelete) {
      cells.push(
        <span key="_actions" className="flex justify-end gap-2">
          {mayUpdate ? (
            <Button variant="small" onClick={() => setEditing(row)}>
              Edit
            </Button>
          ) : null}
          {mayDelete ? (
            <Button
              variant="small"
              onClick={() => void remove(row)}
              className={busyId === row.id ? 'opacity-50' : ''}
            >
              Delete
            </Button>
          ) : null}
        </span>,
      );
    }

    return cells;
  });

  return (
    <>
      <PageHead
        title={title}
        description={description ?? type?.description}
        actions={
          <>
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search…"
              className="rounded px-2.5 py-1.5 text-[13px]"
              style={{ border: '1px solid var(--line)', background: 'var(--panel)' }}
            />
            {mayCreate ? (
              <Button variant="primary" onClick={() => setCreating(true)}>
                Add record
              </Button>
            ) : null}
          </>
        }
      />

      {error ? <Notice>{error}</Notice> : null}

      <Panel
        title={type?.label ?? title}
        sub={loading ? undefined : `${total} record${total === 1 ? '' : 's'}`}
        bodyless
      >
        {loading ? (
          <div className="px-4 py-10 text-center text-[13px]" style={{ color: 'var(--muted)' }}>
            Loading…
          </div>
        ) : (
          <DataTable
            columns={columns}
            rows={tableRows}
            empty="No records yet. Use Add record to create the first one."
          />
        )}
      </Panel>

      {type && (creating || editing) ? (
        <RecordForm
          type={type}
          record={editing}
          onCancel={() => {
            setCreating(false);
            setEditing(null);
          }}
          onSubmit={submit}
        />
      ) : null}
    </>
  );
}

/**
 * Renders one field value for the table.
 *
 * A date is formatted, a status becomes a chip, a boolean becomes yes/no.
 * Everything else prints as text. The goal is that a value reads at a glance
 * without the register author writing a formatter per column.
 */
function renderCell(field: RecordField, value: unknown) {
  if (value === null || value === undefined || value === '') {
    return (
      <span style={{ color: 'var(--faint)' }}>—</span>
    );
  }

  switch (field.type) {
    case 'date': {
      const d = new Date(String(value));
      if (Number.isNaN(d.getTime())) return <span>—</span>;
      return (
        <span className="num text-[12.5px]">
          {d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}
        </span>
      );
    }

    case 'status':
      return <Chip tone={statusTone(String(value))}>{String(value)}</Chip>;

    case 'select':
      return <span>{String(value)}</span>;

    case 'currency':
      return <span className="num">₹{Number(value).toLocaleString('en-IN')}</span>;

    case 'number':
      return <span className="num">{Number(value).toLocaleString('en-IN')}</span>;

    case 'percent':
      return <span className="num">{Number(value)}%</span>;

    case 'boolean':
      return <span>{value ? 'Yes' : 'No'}</span>;

    // The descriptor's url carries its own signed token, so a bare anchor is
    // enough. No fetch, no proxy — the download route is addressed by token,
    // not by path.
    case 'file': {
      const doc = value as { name?: string; url?: string } | null;
      if (!doc || typeof doc !== 'object' || !doc.url) {
        return <span style={{ color: 'var(--faint)' }}>—</span>;
      }
      return (
        <a
          href={doc.url}
          target="_blank"
          rel="noreferrer"
          title={doc.name || 'Download'}
          style={{ color: 'var(--accent)', textDecoration: 'underline' }}
        >
          {doc.name || 'Download'}
        </a>
      );
    }

    default:
      return <span>{String(value)}</span>;
  }
}

/** Maps a status word to a chip tone, so the palette stays consistent. */
function statusTone(value: string): ChipTone {
  const v = value.toLowerCase();
  if (/(expired|overdue|closed|critical|high)/.test(v)) {
    return v.includes('closed') ? 'mute' : 'bad';
  }
  if (/(expires|soon|pending|review|application|mitigating|progress|medium|warn)/.test(v)) {
    return 'warn';
  }
  if (/(valid|approved|done|complete|low|open)/.test(v)) return 'ok';
  return 'info';
}
