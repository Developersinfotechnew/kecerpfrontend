'use client';

import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useParams, useSearchParams, useRouter } from 'next/navigation';

import { Button, Chip, DataTable, Notice, PageHead, Panel } from '@/components/ui';
import { RecordForm } from '@/components/RecordForm';
import { ImportExcelModal } from '@/components/ImportExcelModal';
import { useProjectData } from '@/lib/project-data';
import { useSession } from '@/app/session';
import { records, projects, admin, approvals, type ProjectOption, type RecordApprovalSummary, type RecordApprovalState } from '@/lib/services';
import { deriveFromPlannerRows, L1Milestone } from '@/lib/planner/milestones';
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
  const searchParams = useSearchParams();
  const router = useRouter();

  /** "Raise action" style entry points: ?new=1 opens the create form on load.
 *  An optional ?subject=<text> pre-fills the record's title field, so a
 *  dashboard "Needs attention" row can raise a targeted action in one click. */
  useEffect(() => {
    if (searchParams.get('new') === '1') {
      const subject = searchParams.get('subject');
      if (subject) {
        // The register's title field is declared in its metadata; fall back to
        // 'subject' (the RFI/action registers all title on that field).
        setPrefill({ subject });
      }
      setCreating(true);
      const next = new URLSearchParams(searchParams);
      next.delete('new');
      next.delete('subject');
      router.replace(`?${next.toString()}`, { scroll: false });
    }
    // run once per register: the param is cleared after the first open
  }, []); // eslint-disable-line react-hooks/exhaustive-deps


  const { loading: sessionLoading, user: sessionUser } = useSession();
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
  /** WBS register only: the selected main task ('' = the whole tree). The
   * table then shows only that node's branch, and the consumed column reads
   * off the same branch. Candidates come from the loaded rows. */
  const [wbsMainTask, setWbsMainTask] = useState('');
  /** WBS register: the material issues that count as consumption. */
  const [wbsIssueRows, setWbsIssueRows] = useState<RecordRow[]>([]);
  const [clientOptions, setClientOptions] = useState<Array<{ id: string; name: string }>>([]);
  /** Saved L1 plans, live-derived into the macro milestone view. */
  const [plannerRows, setPlannerRows] = useState<RecordRow[]>([]);
  /** Variation register: issued material + the POs that price it. */
  const [issueRows, setIssueRows] = useState<RecordRow[]>([]);
  const [poRows, setPoRows] = useState<RecordRow[]>([]);
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
  // Declared up top: the displayRows / wbsConsumed memos below read it, and
  // a memo body runs at its hook site — before any later const initialises.
  const isWbs = key === 'wbs_register';

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

  // WBS register: pick a main task and every WBS code below it is what the
  // screen shows — the node itself plus its whole branch, walked down the
  // parentCode links. No pick = the full tree.
  const displayRows = useMemo((): RecordRow[] => {
    if (!isWbs || !wbsMainTask) return filteredRows;
    // Local, not the component-level norm: that const is declared further
    // down the render body, and a memo runs before it exists.
    const n = (s: string): string => s.trim().toLowerCase();
    const parentOf = new Map<string, string>();
    for (const r of filteredRows) {
      const c = String(r.data.wbsCode ?? '').trim();
      if (c) parentOf.set(n(c), String(r.data.parentCode ?? '').trim());
    }
    const inBranch = (code: string, main: string): boolean => {
      let cur = code;
      for (let i = 0; i < 20; i += 1) {
        if (cur === main) return true;
        const up = parentOf.get(n(cur));
        if (!up) return false;
        cur = up;
      }
      return false;
    };
    const main = wbsMainTask;
    return filteredRows.filter((r) => {
      const c = String(r.data.wbsCode ?? '').trim();
      if (!c) return true;
      return c === main || inBranch(c, main);
    });
  }, [isWbs, wbsMainTask, filteredRows]);

  // WBS register: the consumed quantity per WBS code, live-summed from the
  // site material issues that name that code. The required quantity is the
  // node's own "Quantity" field; the difference is the shortfall or the
  // surplus the register should read at a glance.
  const wbsConsumed = useMemo((): Map<string, number> => {
    const map = new Map<string, number>();
    if (!isWbs) return map;
    // Local normaliser: the component-level `norm` const is declared further
    // down the render body, so it is not initialised when this memo runs.
    const n = (s: string): string => s.trim().toLowerCase();
    for (const mi of wbsIssueRows) {
      if (String(mi.data.status ?? '') !== 'Issued') continue;
      const wbs = String(mi.data.activity ?? '').trim();
      const qty = Number(mi.data.quantity ?? 0);
      if (!wbs || !(qty > 0)) continue;
      map.set(n(wbs), (map.get(n(wbs)) ?? 0) + qty);
    }
    return map;
  }, [isWbs, wbsIssueRows]);

  function exportCsv(): void {
    if (!type) return;
    const fields = type.fields;
    const header = fields.map((f) => f.label).join(',');
    // Export the rows the screen shows: on the WBS register a main-task
    // pick narrows the tree, so the CSV does too.
    const lines = displayRows.map((r) =>
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

  // Client: the schedule-milestone screen must reflect the L1 (macro) plan
  // derived from planning & tasks. When this is that register, pull the
  // project's saved L1 plans and derive the macro milestones live.
  const isScheduleMilestones = key === 'schedule_milestones';
  const l1ProjectId = projectId || current?.id || '';
  useEffect(() => {
    if (!isScheduleMilestones || !l1ProjectId) {
      setPlannerRows([]);
      return;
    }
    let cancelled = false;
    records
      .list('project_planner', { projectId: l1ProjectId, limit: 50 })
      .then((page) => { if (!cancelled) setPlannerRows(page.items); })
      .catch(() => { if (!cancelled) setPlannerRows([]); });
    return () => { cancelled = true; };
  }, [isScheduleMilestones, l1ProjectId]);

  const l1Milestones: L1Milestone[] = useMemo(
    () => (isScheduleMilestones ? deriveFromPlannerRows(plannerRows) : []),
    [isScheduleMilestones, plannerRows],
  );

  // Client: on the Variations register the "Value" column must reflect
  // consumption — material actually issued to the site (material_issue,
  // status Issued) per activity, priced at the PO rate (raise_po value ÷
  // qty) of the PO the item came through. No cost sits on the issue or GRN
  // rows themselves, so the value is derived live, not stored.
  const isVariation = key === 'variation';
  // WBS register: the "Consumed / required" cell. Required is the node's own
  // "Quantity" field; consumed is the live sum of the site material issues
  // naming this WBS code. The difference is read in colour — red when the
  // site has used less than the requirement (still to come), green when it
  // has passed it (surplus).
  const wbsConsumedCell = (r: RecordRow): ReactNode => {
    const code = String(r.data.wbsCode ?? '').trim();
    const required = Number(r.data.quantity ?? 0);
    const consumed = code ? (wbsConsumed.get(code.trim().toLowerCase()) ?? 0) : 0;
    if (!required && !consumed) return '—';
    const diff = consumed - required;
    return (
      <span key="wc" className="tabular-nums text-[12.5px]">
        <span style={{ color: diff >= 0 ? 'var(--ok)' : 'var(--red)' }}>{consumed}</span>
        <span className="opacity-60"> / {required}</span>
        {required > 0 ? (
          <span
            className="ml-1.5"
            style={{ color: diff >= 0 ? 'var(--ok)' : 'var(--red)' }}
          >
            {diff >= 0 ? `+${diff} surplus` : `${diff} short`}
          </span>
        ) : null}
      </span>
    );
  };

  // Client DCI spec cols 12–14: variance and the alert colour are derived
  // live from the planned / actual submission pair and the row status —
  // red when past the plan with no actual, orange within 3 days of it,
  // green on track, blue once approved. Nothing is stored for them.
  const isDci = key === 'dci_documents';
  function dciDerived(data: Record<string, unknown>): {
    variance: string;
    alert: string;
    tone: 'ok' | 'warn' | 'bad' | 'info' | 'mute';
  } {
    const status = String(data.status ?? '').trim().toLowerCase();
    const planned = String(data.plannedSubmission ?? '').trim();
    const actual = String(data.actualSubmission ?? '').trim();
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const parseDay = (v: string) => (v ? new Date(`${v}T00:00:00`) : null);
    let variance = '—';
    const actualD = parseDay(actual);
    const plannedD = parseDay(planned);
    if (actualD && plannedD && !Number.isNaN(actualD.getTime()) && !Number.isNaN(plannedD.getTime())) {
      const days = Math.round((actualD.getTime() - plannedD.getTime()) / 86_400_000);
      variance = days === 0 ? '0' : `${days > 0 ? '+' : ''}${days}`;
    }
    if (/^(approved|ifc|afc)$/.test(status)) {
      return { variance, alert: 'Approved', tone: 'info' };
    }
    const p = parseDay(planned);
    if (actual === '' && p && !Number.isNaN(p.getTime())) {
      const daysLeft = Math.round((p.getTime() - today.getTime()) / 86_400_000);
      if (daysLeft < 0) {
        return { variance, alert: 'Overdue', tone: 'bad' };
      }
      if (daysLeft <= 3) {
        return { variance, alert: 'Due', tone: 'warn' };
      }
      return { variance, alert: 'On track', tone: 'ok' };
    }
    return { variance, alert: 'On track', tone: 'ok' };
  }
  useEffect(() => {
    if (!isVariation || !l1ProjectId) {
      setIssueRows([]);
      setPoRows([]);
      return;
    }
    let cancelled = false;
    void Promise.all([
      records.list('material_issue', { projectId: l1ProjectId, limit: 500 }),
      records.list('raise_po', { projectId: l1ProjectId, limit: 500 }),
    ])
      .then(([issues, pos]) => {
        if (cancelled) return;
        setIssueRows(issues.items);
        setPoRows(pos.items);
      })
      .catch(() => {
        if (cancelled) return;
        setIssueRows([]);
        setPoRows([]);
      });
    return () => {
      cancelled = true;
    };
  }, [isVariation, l1ProjectId]);

  // WBS register: the consumed quantity per WBS code is the live sum of the
  // site material issues that name that code, so the register can compare
  // it against the node's required quantity without storing a second number.
  useEffect(() => {
    if (!isWbs || !l1ProjectId) {
      setWbsIssueRows([]);
      return;
    }
    let cancelled = false;
    records
      .list('material_issue', { projectId: l1ProjectId, limit: 500 })
      .then((res) => {
        if (cancelled) return;
        setWbsIssueRows(res.items);
      })
      .catch(() => {
        if (cancelled) return;
        setWbsIssueRows([]);
      });
    return () => {
      cancelled = true;
    };
  }, [isWbs, l1ProjectId]);

  const norm = (s: string): string => s.trim().toLowerCase();
  // WBS main-task candidates: the branch roots of the recorded tree — a
  // node whose parentCode is empty, or points at a code that was never
  // recorded itself. Those are the "main task" choices the register's
  // filter offers.
  const wbsMainTasks = useMemo((): string[] => {
    if (!isWbs) return [];
    const recorded = new Set(
      rows.map((r) => String(r.data.wbsCode ?? '').trim()).filter((c) => c),
    );
    const recordedNorm = new Set([...recorded].map((c) => c.toLowerCase()));
    const roots: string[] = [];
    for (const r of rows) {
      const code = String(r.data.wbsCode ?? '').trim();
      if (!code) continue;
      const parent = String(r.data.parentCode ?? '').trim();
      // A branch root: no parent, or a parent code that was never recorded
      // (e.g. WBS-00, the un-entered project node above the first level).
      if (!parent || !recordedNorm.has(parent.toLowerCase())) roots.push(code);
    }
    return [...new Set(roots)].sort();
  }, [isWbs, rows]);
  const consumptionValue = useMemo((): { wbs: string; value: number; basis: string }[] => {
    if (!isVariation) return [];
    // Rate per item: PO value (₹L) ÷ PO qty, from the freshest PO naming
    // that item (items priced on more than one PO bill at the latest rate).
    const rates = new Map<string, { rate: number; poNo: string }>();
    const poByNo = new Map<string, { rate: number; poNo: string }>();
    for (const po of poRows) {
      const item = String(po.data.item ?? '').trim();
      const poNo = String(po.data.poNo ?? '').trim();
      const qty = Number(po.data.quantity ?? 0);
      const value = Number(po.data.value ?? 0);
      if (!(qty > 0) || !(value > 0)) continue;
      const r = { rate: value / qty, poNo };
      if (poNo) poByNo.set(norm(poNo), r);
      if (item) rates.set(norm(item), r);
    }
    const byWbs = new Map<string, { value: number; basis: string[] }>();
    for (const mi of issueRows) {
      if (String(mi.data.status ?? '') !== 'Issued') continue;
      const item = String(mi.data.item ?? '').trim();
      const qty = Number(mi.data.quantity ?? 0);
      const wbs = String(mi.data.activity ?? '').trim();
      if (!(qty > 0) || !wbs) continue;
      // Prefer the issue row's own PO reference (the new poRef select) over
      // a fuzzy item-name match; the name match stays for pre-poRef rows.
      const r = (mi.data.poRef ? poByNo.get(norm(String(mi.data.poRef))) : undefined) ?? rates.get(norm(item));
      if (!r) continue;
      const cur = byWbs.get(norm(wbs)) ?? { value: 0, basis: [] };
      cur.value += qty * r.rate;
      cur.basis.push(`${qty} ${item} @ ${r.poNo || 'PO'} (${(r.rate).toLocaleString('en-IN', { maximumFractionDigits: 2 })}₹L/u)`);
      byWbs.set(norm(wbs), cur);
    }
    return [...byWbs.entries()].map(([wbs, c]) => ({
      wbs,
      value: c.value,
      basis: c.basis.join('; '),
    }));
  }, [isVariation, issueRows, poRows]);

  useEffect(() => {
    setStatusFilter('');
    setItemTypeFilter('');
    setClientFilter('');
    setOverdueOnly(false);
    setWbsMainTask('');
  }, [key]);

  // A WBS main-task pick is only valid inside one project's tree.
  useEffect(() => {
    setWbsMainTask('');
  }, [projectId]);

  // Chain registers always show an Actions column, whether or not a chain is
  // open on a given row; a non-chain register keeps its clean table. Declared
  // before the columns memo: the memo reads it in its dependency array, and a
  // `const` further down would be in its temporal dead zone at that point.
  const isChainRegister = CHAIN_REGISTER_KEYS.has(key);

  const columns = useMemo(() => {
    if (!type) return [];
    const listColumns = type.fields.filter((f) => f.listColumn).sort((a, b) => a.sortOrder - b.sortOrder);
    // The approval row rule and the in-flight chip both live on the Status
    // column, so never cut it: take the first N, then always append the
    // status field. Chain registers also need the Actions column, so reserve
    // one extra slot. Use 10 as a comfortable max that still leaves room for
    // derived columns (variation value, DCI variance, WBS consumed).
    const reserve = isChainRegister ? 2 : 1;
    let cols = listColumns.slice(0, Math.max(1, 10 - reserve));
    const status = listColumns.find((f) => f.type === 'status');
    if (status && !cols.some((f) => f.key === status.key)) cols = [...cols, status];
    return cols.map((f) => ({ key: f.key, label: f.label, align: f.align, type: f.type }));
  }, [type, isChainRegister]);

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
  // settled (same rule the backend enforces on update). Client DSR log
  // (item 5): a DSR row the chain approved is frozen for everyone except
  // the project manager, who keeps the correction path — the same exception
  // the backend's update guard applies.
  const dsrPmOverride = key === 'dsr_entries' && sessionUser?.role === 'projectmanager';
  function rowFrozen(r: RecordRow): boolean {
    if (dsrPmOverride) return false;
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
    // Compact, single-line buttons: the Actions column is narrow and the
    // previous min-width + default sizing let "Send for approval" wrap onto
    // two lines and break the row height. `small` + no-wrap keep every row
    // the same height and every label readable on one line.
    const act = 'small whitespace-nowrap';
    return (
      <span key="act" className="flex flex-wrap items-center justify-end gap-1.5">
        {!frozen ? <Button variant="primary" className={act} onClick={() => setEditing(r)}>Edit</Button> : null}
        {frozen || hasChain ? (
          <Button variant="primary" className={act} disabled={detailBusy} onClick={() => void openDetail(r.ref)}>
            Details
          </Button>
        ) : null}
        {isChainRegister && !NO_SEND_KEYS.has(key) && statesKnown && !hasChain && !frozen && preChain ? (
          <Button variant="primary" className={act} disabled={sendBusyRef === r.ref} onClick={() => void sendForApproval(r)}>
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
        sub={loading ? 'Loading' : `${displayRows.length} of ${total} record${total === 1 ? '' : 's'}`}
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
          {isWbs ? (
            // The WBS register is a hierarchy: the main-task picker narrows
            // the codes to the chosen branch (the node and everything under
            // it), the way a plan narrows to a workstream.
            <select
              value={wbsMainTask}
              onChange={(e) => setWbsMainTask(e.target.value)}
              className="rounded px-2.5 py-2 text-[13px] outline-none"
              style={{ background: 'var(--panel-2)', border: '1px solid var(--line)', color: 'var(--ink)' }}
            >
              <option value="">All main tasks</option>
              {wbsMainTasks.map((code) => {
                const r = rows.find((x) => String(x.data.wbsCode ?? '').trim() === code);
                return (
                  <option key={code} value={code}>
                    {code} — {String(r?.data.description ?? '').trim() || code}
                  </option>
                );
              })}
            </select>
          ) : null}
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

      {l1Milestones.length > 0 ? (
        <Panel
          title="L1 schedule (macro view)"
          sub={`Derived from the project's ${l1ProjectId ? 'L1 planning schedule' : 'plan'} · ${l1Milestones.length} top-level phase${l1Milestones.length === 1 ? '' : 's'}`}
          bodyless
        >
          <DataTable
            columns={[
              { key: 'm', label: 'Milestone (L1 phase)' },
              { key: 'pl', label: 'Planned' },
              { key: 'fc', label: 'Forecast' },
              { key: 'pr', label: 'Progress' },
              { key: 'st', label: 'Status', align: 'right' as const },
            ]}
            rows={l1Milestones.map((m) => [
              m.name,
              m.planned,
              m.forecast ?? '—',
              `${m.progress}%`,
              m.status,
            ])}
          />
        </Panel>
      ) : null}

      {isVariation && consumptionValue.length > 0 ? (
        <Panel
          title="Consumption value (derived)"
          sub="Material issued to the site per activity, priced at the PO rate — the source the Variation value reflects"
          bodyless
        >
          <DataTable
            columns={[
              { key: 'w', label: 'Activity / WBS' },
              { key: 'v', label: 'Value (₹L)', align: 'right' as const },
              { key: 'b', label: 'Basis (issued qty @ PO rate)' },
            ]}
            rows={consumptionValue.map((c) => [
              c.wbs,
              c.value.toLocaleString('en-IN', { maximumFractionDigits: 2 }),
              <span key="b" className="text-[12px] opacity-70">{c.basis}</span>,
            ])}
          />
        </Panel>
      ) : null}

      <Panel title="Records" bodyless>
        <DataTable
          columns={
            [
              ...(columns.length > 0
                ? columns
                : [{ key: titleField, label: type?.label ?? 'Record' }]),
              ...(isVariation
                ? [{ key: '__consumption', label: 'Consumption value (₹L)', align: 'right' as const }]
                : []),
              ...(isDci
                ? [
                  { key: '__variance', label: 'Variance (days)', align: 'right' as const },
                  { key: '__alert', label: 'Alert', align: 'right' as const },
                ]
                : []),
              ...(isChainRegister
                ? [
                  { key: '__actions', label: 'Actions', align: 'right' as const },
                ]
                : []),
              ...(isWbs
                ? [
                  { key: '__wbsConsumed', label: 'Consumed / required', align: 'right' as const },
                ]
                : []),
            ]
          }
          rows={
            displayRows.length === 0
              ? [
                [
                  ...(columns.length > 0 ? columns : [{ key: titleField, label: '', align: undefined as string | undefined, type: undefined as string | undefined }]).map(() => '—'),
                  ...(isDci ? ['—', '—'] : []),
                  ...(isChainRegister ? ['—'] : []),
                  ...(isWbs ? ['—'] : []),
                ],
              ]
              : displayRows.map((r) =>
                [
                  ...(columns.length > 0 ? columns : [{ key: titleField, label: '', align: undefined as string | undefined, type: undefined as string | undefined }]).map((c) => {
                    // The live consumption column: the derived value of the
                    // activity this variation row names, not the entered one.
                    if (c.key === '__consumption') {
                      const wbs = String(r.data.wbsRef ?? '').trim();
                      const hit = consumptionValue.find((cv) => norm(cv.wbs) === norm(wbs));
                      return hit
                        ? hit.value.toLocaleString('en-IN', { maximumFractionDigits: 2 })
                        : '—';
                    }
                    // Client DCI spec cols 14 + 1: the derived variance day
                    // count and the colour-coded alert word, computed from
                    // the row's planned / actual submission pair.
                    if (c.key === '__variance' || c.key === '__alert') {
                      const d = dciDerived(r.data as Record<string, unknown>);
                      if (c.key === '__variance') return d.variance;
                      return (
                        <Chip key={c.key} tone={d.tone}>
                          {d.alert}
                        </Chip>
                      );
                    }
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
                      const statusWord = String(value);
                      // WBS register: an In-progress node also carries its
                      // live % completion, so the row reads "In progress ·
                      // 45%" — how far the work has moved, not just the word.
                      const wbsPct = isWbs ? Number(r.data.progress ?? 0) : 0;
                      const showWbsPct =
                        isWbs && /in progress/i.test(statusWord) && wbsPct > 0;
                      return (
                        <Chip key={c.key} tone={statusTone(statusWord)}>
                          {statusWord}
                          {showWbsPct ? ` · ${wbsPct}%` : ''}
                        </Chip>
                      );
                    }
                    // Document columns: a `file` row holds one descriptor, a
                    // `files` row (the DSR's site images) holds a batch.
                    // Either reads as the links themselves, with a count when
                    // it is more than one.
                    if (c.type === 'file' || c.type === 'files') {
                      const raw = value as Array<{ url?: string; name?: string }> | { url?: string; name?: string } | string;
                      // A type guard, not a plain predicate: the cell value
                      // is a union (string | descriptor | descriptor[]), and
                      // only a guard narrows the elements for the map below.
                      const items = (Array.isArray(raw) ? raw : raw ? [raw] : []).filter(
                        (d): d is { url: string; name?: string } =>
                          d !== null && typeof d === 'object' && typeof d.url === 'string' && d.url !== '',
                      );
                      if (items.length === 0) return '—';
                      return (
                        <span key={c.key} className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[12px]">
                          {items.map((d, i) => (
                            <a
                              key={`${i}-${d.url}`}
                              href={d.url}
                              target="_blank"
                              rel="noreferrer"
                              className="underline"
                              style={{ color: 'var(--accent)' }}
                            >
                              {d.name || 'document'}
                            </a>
                          ))}
                          {items.length > 1 ? <span className="opacity-60">×{items.length}</span> : null}
                        </span>
                      );
                    }
                    return String(value);
                  }),
                  ...(isChainRegister
                    ? [actionCell(r)]
                    : []),
                  ...(isWbs
                    ? [wbsConsumedCell(r)]
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
          createBulk={async (rowsData) => {
            // Same one-round-trip bulk path, chunk-safe up to 500 rows.
            await records.createBulk(key, projectId ? { projectId, rows: rowsData } : { rows: rowsData });
          }}
          onClose={() => setImportOpen(false)}
          onImported={() => void load()}
        />
      ) : null}
    </>
  );
}
