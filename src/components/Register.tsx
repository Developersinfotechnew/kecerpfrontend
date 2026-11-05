'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';

import { records as recordService, approvals } from '@/lib/services';
import { useRowApprovals, CHAIN_REGISTER_KEYS } from '@/lib/row-approvals';

/**
 * DSR, DCI and GRN rows: the chain opens on record create (the backend
 * trigger), so a fresh row lands in its own in-flight word on its own. No
 * manual Send-for-approval button. DSR and DCI also never show Delete —
 * a report and a document index row are settled facts, not throwaway entries.
 */
const NO_SEND_KEYS = new Set(['dsr_entries', 'dci_documents', 'goods_receipts']);
const NO_DELETE_KEYS = new Set(['dsr_entries', 'dci_documents']);
import { ApprovalDetailsModal } from '@/components/ApprovalDetailsModal';
import type { FileValue, RecordField, RecordRow, RecordType } from '@/lib/types';
import { useSession } from '@/app/session';
import { Button, Chip, DataTable, Notice, PageHead, Panel } from '@/components/ui';
import type { ChipTone } from '@/components/ui';
import { RecordForm } from '@/components/RecordForm';
import { Lightbox } from '@/components/Lightbox';

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
  const [sendBusyRef, setSendBusyRef] = useState<string | null>(null);
  async function sendForApproval(row: RecordRow): Promise<void> {
    setSendBusyRef(row.ref);
    setError(null);
    try {
      await approvals.sendForApproval(typeKey, row.ref);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not send for approval');
    } finally {
      setSendBusyRef(null);
    }
  }
  // An approved record is a settled fact: the row shows Details only, no Edit.
  const { isApproved, hasChain, preChain, statesKnown, openDetail, detail, setDetail, detailBusy } =
    useRowApprovals(typeKey, rows);

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

  const anyChain = rows.some((r) => hasChain(r.ref));

  const columns = useMemo(() => {
    const cols = listFields.map((f) => ({
      key: f.key,
      label: f.label,
      align: f.align,
    }));
    cols.push({ key: 'ref', label: 'Ref', align: 'left' });
    // The actions column also exists when only Details applies: a register
    // with an approval chain shows the Details button on every row.
    if (mayUpdate || mayDelete || anyChain) cols.push({ key: '_actions', label: '', align: 'right' });
    return cols;
  }, [listFields, mayUpdate, mayDelete, anyChain]);

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

    // Client log: a task the PM has approved is locked. Edit and delete both
    // hide; the only move out is reopening it (status → Reopened), which the
    // backend allows and this UI re-enables on the next load.
    const lockedTask =
      typeKey === 'tasks' && String(row.data.status ?? '') === 'Approved by PM';
    const approved = isApproved(row.ref);
    // Approval rule: after the chain approves, the row is Details-only —
    // editing or deleting an approved record is forbidden by the backend
    // for every user. Before approval, Edit and Details both show.
    const showDetails = approved || hasChain(row.ref);
    const showEdit = !approved && mayUpdate && !lockedTask;
    const showDelete = !approved && mayDelete && !lockedTask && !NO_DELETE_KEYS.has(typeKey);
    if (showEdit || showDelete || showDetails) {
      cells.push(
        <span key="_actions" className="flex justify-end gap-2">
          {showEdit ? (
            <Button variant="primary" className="min-w-[90px] justify-center" onClick={() => setEditing(row)}>
              Edit
            </Button>
          ) : null}
          {showDetails ? (
            <Button variant="primary" className="min-w-[90px] justify-center" disabled={detailBusy} onClick={() => void openDetail(row.ref)}>
              Details
            </Button>
          ) : null}
          {/* Send for approval shows only when we positively know the row
          has no chain AND its own status is still a pre-chain word. In-review
          words (In client review, Internal review, In progress…) and the
          unresolved states case get no button — a failed lookup must not
          read as "chainless". DSR and DCI never show this: their chain
          opens on record create, so a fresh row is already Requesting. */}
          {!NO_SEND_KEYS.has(typeKey) && CHAIN_REGISTER_KEYS.has(typeKey) && statesKnown && !hasChain(row.ref) && !approved && preChain(row.ref) ? (
            <Button
              variant="primary"
              disabled={sendBusyRef === row.ref}
              onClick={() => void sendForApproval(row)}
            >
              {sendBusyRef === row.ref ? 'Sending…' : 'Send for approval'}
            </Button>
          ) : null}
          {showDelete ? (
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

      {detail ? <ApprovalDetailsModal state={detail} onClose={() => setDetail(null)} /> : null}
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
    case 'file':
      return <FileCell value={value} />;

    default:
      return <span>{String(value)}</span>;
  }
}

/** Maps a status word to a chip tone, so the palette stays consistent. */
function statusTone(value: string): ChipTone {
  const v = value.toLowerCase();
  if (/(expired|overdue|closed|critical|high|rejected|reversed|returned)/.test(v)) {
    return v === 'closed' || v === 'expired' ? 'mute' : 'bad';
  }
  // A sanctioned HSE permit is a live clearance: Active reads green, like
  // every other "this is working" word.
  if (v === 'under approval') return 'warn';
  if (v === 'active') return 'ok';
  // An ITP hold point that cleared its chain Passed: green, like every
  // other "this one is done and good" word.
  if (v === 'passed') return 'ok';
  // A performance test whose chain cleared reads Achieved: green, like the
  // ITP Passed word. The top PR stage Mgmt approval is the cleared stage.
  if (v === 'achieved' || v === 'mgmt approval') return 'ok';
  // A pre-dispatch inspection (MDDC) that cleared its chain reads Cleared:
  // green, the dispatch is released.
  if (v === 'cleared') return 'ok';
  // An RFI whose answer chain cleared reads Answered: green, the response is
  // verified. Withdrawn is the raiser pulling it: red.
  if (v === 'answered') return 'ok';
  // A document publication that cleared its chain reads Published: green,
  // the controlled document is out on its distribution list.
  if (v === 'published') return 'ok';
  if (v === 'failed' || v === 'not achieved' || v === 'withdrawn') return 'bad';
  // Awaiting certification is an RA bill's in-flight word: amber.
  if (/(expires|soon|pending|review|application|mitigating|progress|medium|warn|claimed|awaiting)/.test(v)) {
    return 'warn';
  }
  // Issued is a material issue slip's approved word: the material released.
  // Certified is the milestone word: the client certified completion.
  if (/(valid|approved|done|complete|low|open|issued|certified)/.test(v)) return 'ok';
  return 'info';
}

/**
 * A `file` field value in a table row. Images show as a thumbnail that opens
 * the in-app lightbox (full natural size, no browser downscale — the reason
 * the DCI column read as "blurry" was the 72px link target, not the file);
 * everything else stays a download link.
 */
function FileCell({ value }: { value: unknown }) {
  const [open, setOpen] = useState(false);
  const doc = value as FileValue | null;
  if (!doc || typeof doc !== 'object' || !doc.url) {
    return <span style={{ color: 'var(--faint)' }}>—</span>;
  }
  const isImage = doc.mimetype.startsWith('image/');
  return (
    <>
      {isImage ? (
        <button
          type="button"
          onClick={() => setOpen(true)}
          title={`View ${doc.name}`}
          style={{ border: 'none', padding: 0, background: 'none', cursor: 'pointer', lineHeight: 0 }}
        >
          <img
            src={doc.url}
            alt={doc.name}
            width={44}
            height={44}
            style={{ objectFit: 'cover', borderRadius: 4, border: '1px solid var(--line)' }}
          />
        </button>
      ) : (
        <a
          href={doc.url}
          target="_blank"
          rel="noreferrer"
          title={doc.name || 'Download'}
          style={{ color: 'var(--accent)', textDecoration: 'underline' }}
        >
          {doc.name || 'Download'}
        </a>
      )}
      {open && isImage ? <Lightbox src={doc.url} name={doc.name} onClose={() => setOpen(false)} /> : null}
    </>
  );
}
