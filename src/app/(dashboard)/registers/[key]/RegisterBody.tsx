'use client';

import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useParams } from 'next/navigation';

import { Button, Chip, DataTable, Notice, PageHead, Panel } from '@/components/ui';
import { RecordForm } from '@/components/RecordForm';
import { ImportExcelModal } from '@/components/ImportExcelModal';
import { useProjectData } from '@/lib/project-data';
import { useSession } from '@/app/session';
import { records, projects, admin, approvals, type ProjectOption, type RecordApprovalSummary, type RecordApprovalState } from '@/lib/services';
import { APPROVED_STATUS_WORDS, CHAIN_REGISTER_KEYS, PRE_CHAIN_WORDS } from '@/lib/row-approvals';
import type { RecordRow, RecordType } from '@/lib/types';
import { ApprovalDetailsModal } from '@/components/ApprovalDetailsModal';

/**
 * Generic register screen (client component).
 *
 * The register key is read from the URL via useParams(). This is the source of
 * truth on the client side — it stays in sync with client-side navigation and
 * never falls back to a prop that may be blank during a render transition.
 */
export default function RegisterBody() {
  const params = useParams<{ key: string }>();
  const key = params.key ?? '';

  const { loading: sessionLoading } = useSession();
  const { current } = useProjectData();

  const [type, setType] = useState<RecordType | null>(null);
  const [rows, setRows] = useState<RecordRow[]>([]);
  const [total, setTotal] = useState(0);
  const [projectsOptions, setProjectsOptions] = useState<ProjectOption[]>([]);
  const [search, setSearch] = useState('');
  const [projectId, setProjectId] = useState('');
  // CR-08: the client approvals log carries dedicated filters the generic
  // register screen does not: client, item type, status and an overdue
  // toggle. They apply client-side to the loaded page, which keeps the
  // generic engine untouched.
  const [statusFilter, setStatusFilter] = useState('');
  const [itemTypeFilter, setItemTypeFilter] = useState('');
  const [clientFilter, setClientFilter] = useState('');
  const [overdueOnly, setOverdueOnly] = useState(false);
  const [clientOptions, setClientOptions] = useState<Array<{ id: string; name: string }>>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  // The row being edited: on a chain register this is the pre-approval Edit
  // button, and the form under the table saves it back with records.update.
  const [editing, setEditing] = useState<RecordRow | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  // CR-11: the DPR register opens the create form pre-filled from the day's
  // DSRs. The prefilled values sit here and are handed to the form on open.
  const [prefill, setPrefill] = useState<Record<string, unknown> | undefined>(undefined);
  const [prefillBusy, setPrefillBusy] = useState(false);
  // Live chain position per row ref: who each approval is with now, who is
  // next. Shown as an Approval column; the detail modal fetches the full
  // state for one row on click.
  const [approvalStates, setApprovalStates] = useState<Record<string, RecordApprovalSummary>>({});
  // True only when the bulk states call succeeded. A failed lookup must not
  // read as "no chain" — the Send-for-approval button shows only when we
  // positively know the row is chainless.
  const [statesKnown, setStatesKnown] = useState(false);
  const [sendBusyRef, setSendBusyRef] = useState<string | null>(null);
  const [detail, setDetail] = useState<RecordApprovalState | null>(null);
  const [detailBusy, setDetailBusy] = useState(false);

  // Bulk live chain position for every row in the register. Registers that
  // never open a chain come back empty, so no column is shown for them.
  useEffect(() => {
    if (rows.length === 0) {
      setApprovalStates({});
      setStatesKnown(false);
      return;
    }
    setStatesKnown(false);
    let cancelled = false;
    approvals
      .recordStates(key, rows.map((r) => r.ref))
      .then((states) => {
        if (cancelled) return;
        setApprovalStates(states ?? {});
        setStatesKnown(true);
      })
      .catch(() => {
        if (cancelled) return;
        setApprovalStates({});
      });
    return () => {
      cancelled = true;
    };
  }, [key, rows]);

  // Manual send-for-approval: opens the register's chain for a row whose
  // create-time trigger missed it (row predates the trigger, or the server
  // was running an older build). Refreshes the rows so the new Under
  // approval stamp shows immediately.
  async function sendForApproval(row: RecordRow): Promise<void> {
    setSendBusyRef(row.ref);
    try {
      await approvals.sendForApproval(key, row.ref);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not send for approval');
    } finally {
      setSendBusyRef(null);
    }
  }

  async function openDetail(ref: string): Promise<void> {
    setDetailBusy(true);
    try {
      const state = await approvals.recordState(key, ref);
      if (state) setDetail(state);
    } finally {
      setDetailBusy(false);
    }
  }

  const isClientApprovals = key === 'client_approvals';
  const isDpr = key === 'pm_daily_progress';

  useEffect(() => {
    void projects.list().then(setProjectsOptions).catch(() => setProjectsOptions([]));
  }, []);

  useEffect(() => {
    if (!isClientApprovals) return;
    // Best-effort: client roles that cannot read the client master simply get
    // no client filter, the register still loads.
    void admin.clients().then((rows) => setClientOptions(rows.map((c) => ({ id: c.id, name: c.name }))))
      .catch(() => setClientOptions([]));
  }, [isClientApprovals]);

  function isOverdue(r: RecordRow): boolean {
    const due = String(r.data.dueBack ?? '');
    const t = new Date(due).getTime();
    if (!due || Number.isNaN(t)) return false;
    const status = String(r.data.status ?? 'Open');
    const decision = String(r.data.decision ?? 'Pending');
    return ['Open', 'Overdue'].includes(status) && decision === 'Pending' && t < Date.now();
  }

  const statusOptions: string[] = type?.fields.find((f) => f.key === 'status')?.options ?? [];
  const itemTypeOptions: string[] = type?.fields.find((f) => f.key === 'itemType')?.options ?? [];

  const filteredRows = isClientApprovals
    ? rows.filter((r) => {
      if (statusFilter && String(r.data.status ?? '') !== statusFilter) return false;
      if (itemTypeFilter && String(r.data.itemType ?? '') !== itemTypeFilter) return false;
      if (clientFilter && String(r.data.client ?? '') !== clientFilter) return false;
      if (overdueOnly && !isOverdue(r)) return false;
      return true;
    })
    : rows;

  function exportCsv(): void {
    if (!type) return;
    const fields = type.fields;
    const header = fields.map((f) => f.label).join(',');
    const lines = filteredRows.map((r) =>
      fields
        .map((f) => {
          const v = r.data[f.key];
          const s = v === undefined || v === null ? '' : String(typeof v === 'object' ? JSON.stringify(v) : v);
          return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
        })
        .join(','),
    );
    const blob = new Blob([`${header}\n${lines.join('\n')}`], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${type.key}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  async function prefillFromDsrs(): Promise<void> {
    // The DPR is one entry per project per day. The prefill endpoint needs a
    // project + date; default to the user's current project and today. The
    // result opens the create form filled, so the PM confirms site data they
    // do not re-type.
    const pid = current?.id;
    if (!pid) {
      setError('Pick a project to prefill the daily progress report.');
      return;
    }
    setPrefillBusy(true);
    setError(null);
    try {
      const date = new Date().toISOString().slice(0, 10);
      const data = await records.dprPrefill(pid, date);
      setPrefill(data ?? undefined);
      setCreating(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not prefill the report');
    } finally {
      setPrefillBusy(false);
    }
  }

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      if (sessionLoading) return;
      if (!key) return;
      const [typeRes, page] = await Promise.all([
        records.type(key),
        records.list(key, {
          search: search || undefined,
          projectId: projectId || undefined,
          limit: 200,
        }),
      ]);
      setType(typeRes);
      setRows(page.items);
      setTotal(page.total);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load this register');
    } finally {
      setLoading(false);
    }
  }, [key, search, projectId, sessionLoading]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    setStatusFilter('');
    setItemTypeFilter('');
    setClientFilter('');
    setOverdueOnly(false);
  }, [key]);

  const columns = useMemo(() => {
    if (!type) return [];
    const listColumns = type.fields.filter((f) => f.listColumn);
    // The approval row rule and the in-flight chip both live on the Status
    // column, so never cut it: take the first seven, then always append the
    // status field when a register had more than seven list columns.
    let cols = listColumns.slice(0, 7);
    const status = listColumns.find((f) => f.type === 'status');
    if (status && !cols.some((f) => f.key === status.key)) cols = [...cols, status];
    return cols.map((f) => ({ key: f.key, label: f.label, align: f.align, type: f.type }));
  }, [type]);

  // Status columns read as chips, not raw words: the same colour language
  // every approval register uses, so an approved row reads green at a glance.
  function statusTone(word: string): 'ok' | 'bad' | 'warn' | 'info' | 'mute' {
    const v = word.toLowerCase();
    if (/(rejected|reversed|returned|overdue|withdrawn|not achieved)/.test(v)) return 'bad';
    if (v === 'failed') return 'bad';
    // A performance test that cleared its witness chain is Achieved (green);
    // a PR at the Mgmt approval stage cleared its ladder (green). Both sit
    // before the in-flight amber words below.
    if (v === 'achieved' || v === 'mgmt approval') return 'ok';
    // An RFI whose answer chain cleared reads Answered: green, verified.
    if (v === 'answered') return 'ok';
    // A document publication that cleared its chain reads Published: green.
    if (v === 'published') return 'ok';
    if (v === 'closed') return 'mute';
    if (/(approved|accepted|passed|issued|verified|cleared|certified|client accepted|client certified|ifc|afc|superseded|active)/.test(v)) return 'ok';
    // Awaiting certification is an RA bill's in-flight word: amber, with
    // every other "this is still moving" word.
    if (/(requesting|waiting|pending|review|progress|query raised|on order|open|acceptance|claimed|approval|raised|awaiting)/.test(v)) return 'warn';
    return 'info';
  }

  const titleField = type?.titleField ?? '';

  // Chain registers always show an Actions column, whether or not a chain is
  // open on a given row; a non-chain register keeps its clean table.
  const isChainRegister = CHAIN_REGISTER_KEYS.has(key);

  // Registers whose chain opens on create (or is client-driven) never show
  // the manual Send button: DSR and DCI already start Requesting on create,
  // GRNs ride the PO chain.
  const NO_SEND_KEYS = new Set(['dsr_entries', 'dci_documents', 'goods_receipts']);

  // Hard-settled words: the row's chain business is over, the backend
  // freezes it, so the UI shows Details only. Rework words (Rejected,
  // Reversed, Query raised) are NOT in this set — those rows stay editable
  // so the raiser can fix and resend.
  const FROZEN_STATUS_WORDS = new Set([
    'Approved', 'Client accepted', 'Verified', 'Accepted', 'Part accepted',
    'Passed', 'Issued', 'AFC', 'IFC', 'Superseded', 'Withdrawn',
    'Active', 'Closed', 'Client certified', 'Cleared', 'Published',
    // Raise PO settled words: a sanctioned PO has been released or locked
    // for dispatch — the chain's business is over, the row is Details-only.
    'Released', 'Locked',
  ]);

  // Frozen: the live chain approved it, or the row's own word says it is
  // settled (same rule the backend enforces on update).
  function rowFrozen(r: RecordRow): boolean {
    const s = approvalStates[r.ref];
    if (s?.status === 'approved') return true;
    const word = String(r.data.status ?? '');
    return FROZEN_STATUS_WORDS.has(word) || APPROVED_STATUS_WORDS.has(word);
  }

  // Row rule, full: before approval the row shows Edit (+ Details when a
  // chain is live on it); after approval only Details. A chainless row on a
  // pre-chain word gets Send-for-approval, which opens the register's chain
  // manually (rows that predate the create-trigger or an older backend).
  // Same look as the Goods receipts screen: a row in flight (Under
  // approval) shows Edit only; a settled row shows Details only; Send for
  // approval appears on chainless pre-chain words (Draft) as the one path to
  // start the register's chain.
  function actionCell(r: RecordRow): ReactNode {
    const word = String(r.data.status ?? '');
    const hasChain = approvalStates[r.ref] !== undefined;
    const frozen = rowFrozen(r);
    const preChain = word === '' || PRE_CHAIN_WORDS.has(word);
    return (
      <span key="act" className="flex justify-end gap-2">
        {!frozen ? <Button variant="primary" className="min-w-[90px] justify-center" onClick={() => setEditing(r)}>Edit</Button> : null}
        {frozen || hasChain ? (
          <Button variant="primary" className="min-w-[90px] justify-center" disabled={detailBusy} onClick={() => void openDetail(r.ref)}>
            Details
          </Button>
        ) : null}
        {isChainRegister && !NO_SEND_KEYS.has(key) && statesKnown && !hasChain && !frozen && preChain ? (
          <Button variant="primary" className="min-w-[90px] justify-center" disabled={sendBusyRef === r.ref} onClick={() => void sendForApproval(r)}>
            {sendBusyRef === r.ref ? 'Sending…' : 'Send for approval'}
          </Button>
        ) : null}
      </span>
    );
  }

  if (sessionLoading) {
    return <Notice>Loading session…</Notice>;
  }

  if (error && !type) {
    return <Notice>{error}</Notice>;
  }

  return (
    <>
      <PageHead
        title={type?.label ?? key}
        description={type?.description}
        actions={
          <>
            {isDpr ? (
              <Button onClick={() => void prefillFromDsrs()} disabled={prefillBusy}>
                {prefillBusy ? 'Prefilling…' : 'New from today’s DSRs'}
              </Button>
            ) : null}
            <Button onClick={() => window.print()}>Print</Button>
            <Button onClick={() => exportCsv()}>Export CSV</Button>
            {type ? (
              <Button onClick={() => setImportOpen(true)}>Import Excel</Button>
            ) : null}
            <Button variant="primary" onClick={() => setCreating(true)}>
              Add entry
            </Button>
          </>
        }
      />

      <Panel
        title="Filter"
        bodyless
        sub={loading ? 'Loading' : `${filteredRows.length} of ${total} record${total === 1 ? '' : 's'}`}
      >
        <div className="grid gap-2 p-3 sm:grid-cols-2 lg:grid-cols-4">
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search reference or any field…"
            className="rounded px-2.5 py-2 text-[13px] outline-none"
            style={{ background: 'var(--panel-2)', border: '1px solid var(--line)', color: 'var(--ink)' }}
          />
          <select
            value={projectId}
            onChange={(e) => setProjectId(e.target.value)}
            className="rounded px-2.5 py-2 text-[13px] outline-none"
            style={{ background: 'var(--panel-2)', border: '1px solid var(--line)', color: 'var(--ink)' }}
          >
            <option value="">All projects</option>
            {projectsOptions.map((p) => (
              <option key={p.id} value={p.id}>
                {p.code} — {p.name}
              </option>
            ))}
          </select>
          {isClientApprovals ? (
            <>
              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
                className="rounded px-2.5 py-2 text-[13px] outline-none"
                style={{ background: 'var(--panel-2)', border: '1px solid var(--line)', color: 'var(--ink)' }}
              >
                <option value="">All statuses</option>
                {statusOptions.map((o) => (
                  <option key={o} value={o}>{o}</option>
                ))}
              </select>
              <select
                value={itemTypeFilter}
                onChange={(e) => setItemTypeFilter(e.target.value)}
                className="rounded px-2.5 py-2 text-[13px] outline-none"
                style={{ background: 'var(--panel-2)', border: '1px solid var(--line)', color: 'var(--ink)' }}
              >
                <option value="">All item types</option>
                {itemTypeOptions.map((o) => (
                  <option key={o} value={o}>{o}</option>
                ))}
              </select>
              <select
                value={clientFilter}
                onChange={(e) => setClientFilter(e.target.value)}
                className="rounded px-2.5 py-2 text-[13px] outline-none"
                style={{ background: 'var(--panel-2)', border: '1px solid var(--line)', color: 'var(--ink)' }}
              >
                <option value="">All clients</option>
                {clientOptions.map((c) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
              <label
                className="flex items-center gap-2 rounded px-2.5 py-2 text-[13px]"
                style={{ background: 'var(--panel-2)', border: '1px solid var(--line)', color: 'var(--ink)' }}
              >
                <input
                  type="checkbox"
                  checked={overdueOnly}
                  onChange={(e) => setOverdueOnly(e.target.checked)}
                />
                Overdue only
              </label>
            </>
          ) : null}
        </div>
      </Panel>

      <Panel title="Records" bodyless>
        <DataTable
          columns={
            [
              ...(columns.length > 0
                ? columns
                : [{ key: titleField, label: type?.label ?? 'Record' }]),
              ...(isChainRegister
                ? [
                  { key: '__actions', label: 'Actions', align: 'right' as const },
                ]
                : []),
            ]
          }
          rows={
            filteredRows.length === 0
              ? [
                [
                  ...(columns.length > 0 ? columns : [{ key: titleField, label: '', align: undefined as string | undefined, type: undefined as string | undefined }]).map(() => '—'),
                  ...(isChainRegister ? ['—'] : []),
                ],
              ]
              : filteredRows.map((r) =>
                [
                  ...(columns.length > 0 ? columns : [{ key: titleField, label: '', align: undefined as string | undefined, type: undefined as string | undefined }]).map((c) => {
                    const value = r.data[c.key];
                    if (value === undefined || value === null || value === '') return '—';
                    if (typeof value === 'number') return value.toLocaleString();
                    // Date columns: a stored value is either a bare day
                    // (2026-10-30) or a full ISO instant (…T00:00:00.000Z)
                    // from a datetime pick. Both read as 30 Oct 2026.
                    if (c.type === 'date') {
                      const d = new Date(String(value));
                      return Number.isNaN(d.getTime())
                        ? String(value)
                        : d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
                    }
                    // Status columns read as coloured chips, not raw words,
                    // so an approved row is green at a glance (the DSR look).
                    if (c.type === 'status') {
                      return (
                        <Chip key={c.key} tone={statusTone(String(value))}>
                          {String(value)}
                        </Chip>
                      );
                    }
                    return String(value);
                  }),
                  ...(isChainRegister
                    ? [<span key="act" className="flex justify-end">{actionCell(r)}</span>]
                    : []),
                ],
              )
          }
        />
      </Panel>

      {detail ? <ApprovalDetailsModal state={detail} onClose={() => setDetail(null)} /> : null}

      {creating && type ? (
        <RecordForm
          type={type}
          record={null}
          initialValues={prefill}
          onCancel={() => {
            setCreating(false);
            setPrefill(undefined);
          }}
          onSubmit={async (body) => {
            await records.create(key, body);
            setCreating(false);
            setPrefill(undefined);
            void load();
          }}
        />
      ) : null}

      {editing && type ? (
        <RecordForm
          type={type}
          record={editing}
          onCancel={() => setEditing(null)}
          onSubmit={async (body) => {
            await records.update(key, editing.id, body);
            setEditing(null);
            void load();
          }}
        />
      ) : null}

      {importOpen && type ? (
        <ImportExcelModal
          type={type}
          create={async (data) => {
            // Rows import into the project the register is filtered to, so an
            // import into a scoped register never lands on the wrong project.
            await records.create(key, projectId ? { data, projectId } : { data });
          }}
          onClose={() => setImportOpen(false)}
          onImported={() => void load()}
        />
      ) : null}
    </>
  );
}
