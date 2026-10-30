'use client';

import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useParams } from 'next/navigation';

import { Button, Chip, DataTable, Notice, PageHead, Panel } from '@/components/ui';
import { RecordForm } from '@/components/RecordForm';
import { useProjectData } from '@/lib/project-data';
import { useSession } from '@/app/session';
import { records, projects, admin, approvals, type ProjectOption, type RecordApprovalSummary, type RecordApprovalState } from '@/lib/services';
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
  // CR-11: the DPR register opens the create form pre-filled from the day's
  // DSRs. The prefilled values sit here and are handed to the form on open.
  const [prefill, setPrefill] = useState<Record<string, unknown> | undefined>(undefined);
  const [prefillBusy, setPrefillBusy] = useState(false);
  // Live chain position per row ref: who each approval is with now, who is
  // next. Shown as an Approval column; the detail modal fetches the full
  // state for one row on click.
  const [approvalStates, setApprovalStates] = useState<Record<string, RecordApprovalSummary>>({});
  const [detail, setDetail] = useState<RecordApprovalState | null>(null);
  const [detailBusy, setDetailBusy] = useState(false);

  // Bulk live chain position for every row in the register. Registers that
  // never open a chain come back empty, so no column is shown for them.
  useEffect(() => {
    if (rows.length === 0) {
      setApprovalStates({});
      return;
    }
    let cancelled = false;
    approvals
      .recordStates(key, rows.map((r) => r.ref))
      .then((states) => {
        if (!cancelled) setApprovalStates(states ?? {});
      })
      .catch(() => {
        if (!cancelled) setApprovalStates({});
      });
    return () => {
      cancelled = true;
    };
  }, [key, rows]);

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
    return type.fields
      .filter((f) => f.listColumn)
      .slice(0, 7)
      .map((f) => ({ key: f.key, label: f.label, align: f.align }));
  }, [type]);

  const titleField = type?.titleField ?? '';

  // The Approval column only shows for a register that has live chain state
  // on at least one row; registers that never open a chain stay clean.
  const hasApprovals = Object.keys(approvalStates ?? {}).length > 0;

  function approvalCell(r: RecordRow): ReactNode {
    const s = approvalStates[r.ref];
    if (!s) return '—';
    const word = s.status === 'pending' ? (s.awaitingUser ? 'Returned' : 'Pending') : s.status;
    const pos =
      s.status === 'pending' && s.nextStep
        ? `step ${s.nextStep.order} of ${s.totalSteps} · ${s.nextStep.name}`
        : s.status === 'pending'
          ? `step ${s.currentStep} of ${s.totalSteps}`
          : word;
    const who = s.nextOwners.length > 0 ? s.nextOwners.join(', ') : '';
    return (
      <span className="flex items-center gap-2">
        <Chip tone={s.status === 'approved' ? 'ok' : s.status === 'rejected' ? 'bad' : 'warn'}>
          {word}
        </Chip>
        <span className="text-[11.5px]" style={{ color: 'var(--muted)' }}>
          {pos}
          {who ? ` · ${who}` : ''}
        </span>
        <Button onClick={() => void openDetail(r.ref)} disabled={detailBusy}>
          Details
        </Button>
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
              ...(hasApprovals ? [{ key: '__approval', label: 'Approval', align: 'left' as const }] : []),
            ]
          }
          rows={
            filteredRows.length === 0
              ? [
                  [
                    ...(columns.length > 0 ? columns : [{ key: titleField, label: '' }]).map(() => '—'),
                    ...(hasApprovals ? ['—'] : []),
                  ],
                ]
              : filteredRows.map((r) =>
                  [
                    ...(columns.length > 0 ? columns : [{ key: titleField, label: '' }]).map((c) => {
                      const value = r.data[c.key];
                      if (value === undefined || value === null || value === '') return '—';
                      if (typeof value === 'number') return value.toLocaleString();
                      return String(value);
                    }),
                    ...(hasApprovals ? [approvalCell(r)] : []),
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
    </>
  );
}
