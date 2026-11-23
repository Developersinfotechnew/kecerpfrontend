'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { Button, Notice, PageHead } from '@/components/ui';
import { compute, newTask, PTask } from '@/lib/planner/engine';
import { milestonesFrom } from '@/lib/planner/milestones';
import { hydrate, serialize } from '@/lib/planner/plan';
import { importScheduleGrid } from '@/lib/planner/import';
import { parseXlsxSheets, XlsxParseError, XlsxCsvGrid } from '@/lib/xlsx-parse';
import { openPrintReport } from '@/lib/print-report';
import { projects, records } from '@/lib/services';
import type { ProjectOption } from '@/lib/services';
import { useSession } from '@/app/session';
import type { RecordRow } from '@/lib/types';

/**
 * KEC Project Planner — the MS-Project-style screen (spec v3, demo reference).
 *
 * Left: the WBS task table (phases + subtasks, inline edit of name / days /
 * depends-on / %). Right: the Gantt (phase bracket bars, leaf bars with %
 * overlay, dependency arrows, today line, weekend shading, 7 summary cards
 * on top). Every edit re-runs the engine: dependencies expand to leaf level,
 * forward ES pass + backward LF pass, summary roll-up, critical path.
 * Save/load goes to the 'project_planner' register so plans persist per
 * project (F9). This screen replaces the former register-based Planning & tasks view.
 */

// ── helpers ───────────────────────────────────────────────────────────────

function Card({
  label,
  value,
  onClick,
  active,
}: {
  label: string;
  value: React.ReactNode;
  onClick?: () => void;
  active?: boolean;
}): React.JSX.Element {
  return (
    <div
      className={`planner-card${onClick ? ' planner-card-btn' : ''}`}
      onClick={onClick}
      style={active ? { outline: '2px solid #1e40af', outlineOffset: 2 } : undefined}
    >
      {label}
      <b>{value}</b>
    </div>
  );
}

const fmt = (d: Date): string => d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: '2-digit' });
const st = (pct: number): string => (pct >= 100 ? 'done' : pct > 0 ? 'prog' : 'todo');

/** L1 column labels for the width adjuster (client spec 7). Index = th order. */
const L1_COLS: string[] = ['Task no.', 'Task description', 'Duration', 'Depends on', 'Float / Slack', 'Plan start', 'Plan end', 'Actual start', 'Actual finish', '% complete', 'Delay', 'Remarks'];

/** a is an ancestor of b? */
function isAncestor(a: PTask, b: PTask): boolean {
  let x: PTask | null = b;
  while (x) {
    if (x === a) return true;
    x = x.parent;
  }
  return false;
}

export default function ProjectPlannerPage(): React.JSX.Element {
  const [allProjects, setAllProjects] = useState<ProjectOption[]>([]);
  const [projectId, setProjectId] = useState<string>('');
  const [savedPlans, setSavedPlans] = useState<RecordRow[]>([]);
  const [planRowId, setPlanRowId] = useState<string | null>(null);
  const [planName, setPlanName] = useState('Baseline schedule');

  const [roots, setRoots] = useState<PTask[]>([]);
  const [rev, setRev] = useState(0);
  const [startDate, setStartDate] = useState('');
  const [dw, setDw] = useState(12);
  const [criticalOn, setCriticalOn] = useState(true);
  const [sel, setSel] = useState(0);
  /** 'l1' = the client schedule-table format (Task / Descriptions / … / Remarks); 'gantt' = the chart view. */
  const [view, setView] = useState<'l1' | 'gantt'>('l1');
  /** Full-screen Gantt: the chart normally sits in the fixed-height panel
   * beside the L1 table, so a wide plan scrolls sideways. This lifts the
   * whole chart (task table + timeline) into a viewport overlay — the plan
   * gets the full window and the user scrolls a roomy canvas instead of a
   * cramped strip. Escape or the floating button drops back to the panel. */
  const [ganttFull, setGanttFull] = useState(false);
  /** Chart-only mode: the sticky task table is hidden and the timeline
   *  owns the full width — "show me just the graph", no side scroll. */
  const [ganttChartOnly, setGanttChartOnly] = useState(false);
  useEffect(() => {
    if (!ganttFull && !ganttChartOnly) return;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        setGanttFull(false);
        setGanttChartOnly(false);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [ganttFull, ganttChartOnly]);
  const [msg, setMsg] = useState<string | null>(null);
  const [msgTone, setMsgTone] = useState<'info' | 'ok' | 'warn' | 'err'>('info');
  const say = (m: string | null, tone: 'info' | 'ok' | 'warn' | 'err' = 'info') => { setMsg(m); setMsgTone(m ? tone : 'info'); };
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  /**
   * Baseline approval (client spec): null = draft — plan fields editable.
   * Non-null = CEO / super admin approved it, so every plan column (Task no.
   * through plan End) freezes; actuals, % and delay stay live.
   */
  const [approvedBy, setApprovedBy] = useState<string | null>(null);
  const { user } = useSession();
  const canApprove = user?.role === 'superadmin' || user?.role === 'ceo';
  const frozen = approvedBy !== null;
  const readyRef = useRef(false); // true only after the plan load for the current project finished
  /** An imported plan has no record row yet — the auto-save effect must create one. */
  const pendingCreate = useRef(false);
  /** Clicking the Critical tasks card filters the table to critical tasks only (toggle). */
  const [critOnly, setCritOnly] = useState(false);
  /** Column-width overrides for the L1 table (client spec 7); null = panel closed. */
  const [colW, setColW] = useState<Record<number, number> | null>(null);

  const l1Ref = useRef<HTMLDivElement>(null);
  const unifiedRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const bump = useCallback((): void => setRev((r) => r + 1), []);

  // One engine pass per change.
  const res = useMemo(() => {
    if (roots.length === 0) return null;
    return compute(roots, startDate);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roots, startDate, rev]);

  // ── project list + saved plans (F9) ────────────────────────────────────

  useEffect(() => {
    void (async () => {
      try {
        const list = await projects.list();
        setAllProjects(list);
        if (list.length && !projectId) setProjectId(list[0].id);
      } catch {
        // No projects yet: the planner still works unsaved.
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!projectId) {
      setSavedPlans([]);
      return;
    }
    let cancelled = false;
    readyRef.current = false;
    void (async () => {
      try {
        const page = await records.list('project_planner', { projectId, limit: 50 });
        if (cancelled) return;
        readyRef.current = true;
        const rows = [...page.items].sort((a, b) => (b.updatedAt ?? '').localeCompare(a.updatedAt ?? ''));
        setSavedPlans(rows);
        const latest = rows[0];
        if (latest && String(latest.data.plan ?? '')) {
          setRoots(hydrate(String(latest.data.plan)));
          setStartDate(String(latest.data.startDate ?? startDate));
          setPlanName(String(latest.data.name ?? 'Plan'));
          setPlanRowId(latest.id);
          setApprovedBy(latest.data.status === 'approved' ? String(latest.data.approvedBy ?? 'approved') : null);
        } else {
          setApprovedBy(null);
          // No saved plan for this project yet: start blank, import from Excel.
          setRoots([]);
        }
        setSaveState('idle');
        setMsg(null);
      } catch {
        if (!cancelled) {
          setSavedPlans([]);
          readyRef.current = true;
          setRoots([]);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  const openPlan = useCallback(
    (row: RecordRow): void => {
      const plan = String(row.data.plan ?? '');
      if (!plan) return;
      setApprovedBy(row.data.status === 'approved' ? String(row.data.approvedBy ?? 'approved') : null);
      setRoots(hydrate(plan));
      setStartDate(String(row.data.startDate ?? startDate));
      setPlanName(String(row.data.name ?? 'Plan'));
      setPlanRowId(row.id);
      setSel(0);
      setSaveState('idle');
      setMsg(null);
      bump();
    },
    [bump, startDate],
  );

  const newBlankPlan = useCallback((): void => {
    setRoots([]);
    setPlanRowId(null);
    setApprovedBy(null);
    setPlanName('New plan');
    setSel(0);
    setSaveState('idle');
    bump();
  }, [bump]);

  const doSave = useCallback(async (silent = false): Promise<void> => {
    if (!res) return;
    setSaveState('saving');
    if (!silent) setMsg(null);
    try {
      if (!projectId) {
        setSaveState('error');
        say('Pick a project first — a plan belongs to a project.', 'err');
        return;
      }
      // The register's startDate is required. The engine treats a blank
      // start as "today", so a plan that never set one still saves.
      const today = new Date().toISOString().slice(0, 10);
      const body: Record<string, unknown> = {
        data: {
          name: planName,
          startDate: startDate || today,
          plan: serialize(roots),
          project: projectId,
          status: approvedBy ? 'approved' : 'draft',
          ...(approvedBy ? { approvedBy } : {}),
        },
        projectId,
      };
      if (planRowId) {
        await records.update('project_planner', planRowId, body);
      } else {
        const { id } = await records.create('project_planner', body);
        setPlanRowId(id);
        if (projectId) {
          try {
            const page = await records.list('project_planner', { projectId, limit: 50 });
            setSavedPlans(page.items);
          } catch {
            /* keep the saved flag even if the list re-fetch fails */
          }
        }
      }
      setSaveState('saved');
      // Keep the "All changes saved" banner visible for 4 seconds so the user
      // sees the confirmation before it fades back to idle.
      setTimeout(() => { if (saveState === 'saved') setSaveState('idle'); }, 4000);
      // Keep the macro milestone register in step with the plan (client:
      // "schedule milestones reflect the L1 schedule"). Best-effort — a failed
      // sync never fails the plan save itself.
      void syncMilestones();
    } catch (err) {
      setSaveState('error');
      if (!silent) {
        say(`Save failed: ${err instanceof Error ? err.message : 'unknown error'}. If the register is not seeded, push the backend seed and restart it.`, 'err');
      }
    }
  }, [planName, planRowId, projectId, res, roots, startDate, approvedBy]);

  /**
   * Upsert the plan's top-level phases into the `schedule_milestones`
   * register so the milestone screen (and the dashboard panel that reads
   * that register) mirrors the L1 macro view. Rows are matched by phase
   * name; a phase dropped from the plan leaves its row untouched — manual
   * entries are not deleted out from under the client.
   */
  const syncMilestones = async (): Promise<void> => {
    if (!projectId || !res) return;
    try {
      const ms = milestonesFrom(res);
      if (!ms.length) return;
      const existing = await records.list('schedule_milestones', { projectId, limit: 500 });
      const byName = new Map(existing.items.map((r) => [String(r.data.milestone ?? '').trim().toLowerCase(), r.id]));
      for (const m of ms) {
        const key = m.name.trim().toLowerCase();
        const payload: Record<string, unknown> = {
          data: {
            milestone: m.name,
            plannedDate: m.planned,
            forecastDate: m.forecast ?? '',
            progress: m.progress,
            status: m.status,
          },
          projectId,
        };
        const id = byName.get(key);
        if (id) {
          await records.update('schedule_milestones', id, payload);
        } else {
          await records.create('schedule_milestones', payload);
        }
      }
    } catch {
      /* milestone sync is best-effort; the plan save already succeeded */
    }
  };

  /** Approve the baseline: freeze every plan column, keep actuals live. */
  const approveBaseline = (): void => {
    const stamp = `${user?.name ?? user?.email ?? 'approved'} · ${new Date().toLocaleString('en-GB')}`;
    if (!window.confirm(`Approve this baseline? Plan fields (task no., duration, dependencies, float, plan start/finish) will freeze for everyone. Actual start/finish, % complete and delay stay editable.`)) return;
    setApprovedBy(stamp);
    setMsg(null);
    void doSave(true);
  };

  /** Reopen after approval: unlocks plan fields for a further revision. */
  const reopenBaseline = (): void => {
    if (!window.confirm('Reopen the plan for editing? This un-freezes the plan fields.')) return;
    setApprovedBy(null);
    setMsg(null);
    void doSave(true);
  };

  /**
   * The client's workbook holds both tabs ("Project Schedule, L1" and
   * "Project Schedule, L2"). importExcel parses every tab; when more than one
   * exists it opens a picker (sheetPick) and finishImport does the work.
   */
  const [sheetPick, setSheetPick] = useState<{ file: File; sheets: { name: string; grid: XlsxCsvGrid }[] } | null>(null);

  /** Read the client's .xlsx/.csv schedule into the live tree (with tab pick). */
  const importExcel = async (file: File): Promise<void> => {
    setMsg(null);
    try {
      const buf = await file.arrayBuffer();
      const ext = (file.name.split('.').pop() ?? '').toLowerCase();
      if (ext === 'csv' || ext === 'tsv' || ext === 'txt') {
        const text = await file.text();
        const delim = text.includes('\t') ? '\t' : ',';
        const grid = text
          .split(/\r?\n/)
          .filter((l) => l.trim())
          .map((l) => l.split(delim).map((c) => c.replace(/^"|"$/g, '').trim()));
        await finishImport(file, grid);
      } else {
        const sheets = await parseXlsxSheets(buf);
        // Empty tabs (a workbook's trailing "Sheet1") are skipped so the
        // picker only offers tabs that actually hold rows.
        const usable = sheets.filter((s) => s.grid.length > 0);
        if (usable.length === 0) {
          say(`Import found no usable tab in ${file.name} — all ${sheets.length} tab(s) are empty.`, 'err');
        } else if (usable.length === 1) {
          await finishImport(file, usable[0].grid, usable[0].name);
        } else {
          setSheetPick({ file, sheets: usable });
        }
      }
    } catch (err) {
      say(`Import failed: ${err instanceof XlsxParseError ? err.message : err instanceof Error ? err.message : 'unknown error'}. For .xlsx re-save as Microsoft Excel (.xlsx); legacy .xls is not supported.`, 'err');
    }
  };

  const finishImport = async (file: File, grid: string[][], sheetLabel?: string): Promise<void> => {
    setMsg(null);
    setSheetPick(null);
    try {
      const res2 = importScheduleGrid(grid);
      if (res2.roots.length === 0) {
        say(`Import found no tasks. ${res2.skipped.slice(0, 3).join(' ') || 'Header needs a Task-number column and a Descriptions column.'}`, 'err');
        return;
      }
      setRoots(res2.roots);
      setPlanRowId(null);
      pendingCreate.current = true;
      setApprovedBy(null);
      setPlanName(`Imported: ${file.name}${sheetLabel ? ` · ${sheetLabel}` : ''}`);
      setSel(0);
      setView('l1');
      // Auto-fit the zoom: pick the widest preset that keeps the whole plan
      // (long staggered imports, 360 days) on screen next to the task table.
      let planDays = 0;
      const fit = (ts: PTask[]): void => {
        for (const t of ts) {
          planDays = Math.max(planDays, (t.off ?? 0) + t.dur);
          fit(t.kids);
        }
      };
      fit(res2.roots);
      const avail = Math.max(480, window.innerWidth - GANTT_TABLE_W - 120);
      const preset = [26, 12, 5, 2].find((z) => planDays * z <= avail);
      setDw(preset ?? 2);
      const rows = res2.phases + res2.tasks;
      const detail =
        res2.phases && res2.tasks ? ` (${res2.phases} phase row${res2.phases === 1 ? '' : 's'} + ${res2.tasks} task row${res2.tasks === 1 ? '' : 's'})` : '';
      const warns = res2.skipped.length ? ` · ${res2.skipped.length} row${res2.skipped.length > 1 ? 's' : ''} with a note: ${res2.skipped.slice(0, 3).join(' · ')}` : '';
      say(`Imported ${rows} row${rows === 1 ? '' : 's'} into the schedule from ${file.name}${detail}.${warns}`, warns ? 'warn' : 'ok');
      setSaveState('idle');
      bump();
    } catch (err) {
      say(`Import failed: ${err instanceof XlsxParseError ? err.message : err instanceof Error ? err.message : 'unknown error'}. For .xlsx re-save as Microsoft Excel (.xlsx); legacy .xls is not supported.`, 'err');
    }
  };

  // ── auto-save: every edit lands in the register after a short debounce ─
  useEffect(() => {
    const t = setTimeout(() => {
      // A fresh import has no record row yet — create one so the plan
      // survives a reload instead of vanishing back to blank.
      if (readyRef.current && projectId && (planRowId !== null || pendingCreate.current)) void doSave(true);
    }, 1200);
    return () => clearTimeout(t);
  }, [doSave, rev, planRowId, projectId]);

  // If the user switches project before an import's auto-save created its
  // row, drop the flag: the old plan has no row to update, and the new
  // project's saved plan takes over.
  useEffect(() => {
    pendingCreate.current = false;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  // ── table edits ────────────────────────────────────────────────────────

  /** The lock notice shown when a plan-field edit is attempted on an approved baseline. */
  const planLocked = (): string =>
    'Baseline is approved — plan fields are frozen. Ask the approver to reopen it first.';

  const upName = (t: PTask, v: string): void => {
    const name = v.trim();
    if (!name) return;
    if (frozen) return; // the inputs render disabled; this is the backstop
    t.name = name;
    setSaveState('idle');
    bump();
  };

  const upNum = (t: PTask, key: 'dur' | 'pct', v: number): void => {
    if (t.kids.length) return;
    if (key === 'dur' && frozen) {
      say(planLocked() ?? null, 'warn');
      return;
    }
    t[key] = key === 'dur' ? Math.max(1, Math.round(v) || 1) : Math.min(100, Math.max(0, Math.round(v) || 0));
    setSaveState('idle');
    bump();
  };

  /**
   * Actual start / actual finish — the client spec keeps these editable even
   * after the baseline is approved; only the plan fields freeze.
   */
  const upAct = (t: PTask, key: 'as' | 'ae', v: string): void => {
    t[key] = v;
    setSaveState('idle');
    bump();
  };

  const upPred = (t: PTask, wbsText: string): void => {
    if (!res) return;
    if (frozen) {
      say(planLocked(), 'warn');
      return;
    }
    const byWbs = new Map<string, PTask>();
    for (const x of res.all) if (x.wbs) byWbs.set(x.wbs, x);
    const want = [...new Set(wbsText.split(/[ ,;]+/).map((s) => s.trim()).filter(Boolean))];
    const next: number[] = [];
    for (const w of want) {
      const q = byWbs.get(w);
      if (!q) continue;
      // Spec §4: no link to yourself, your ancestors or your descendants.
      if (q === t || isAncestor(q, t) || isAncestor(t, q)) continue;
      next.push(q.id);
    }
    t.pred = [...new Set(next)];
    setSaveState('idle');
    bump();
  };

  /** Dependencies as the client writes them: "<number> - FS" per predecessor. */
  const depText = (t: PTask): string =>
    t.pred
      .map((id) => {
        const q = res?.taskById.get(id);
        return q ? `${displayNum(q)} - FS` : '';
      })
      .filter(Boolean)
      .join(', ');

  /** Accepts "1.01 - FS, 2 - FS", plain WBS numbers, or a mix. */
  const upDepL1 = (t: PTask, v: string): void => {
    const cleaned = v
      .split(/[,;]+/)
      .map((s) => {
        let n = s.trim().replace(/\s*[-–]?\s*(FS|SS|FF)\s*$/i, '');
        // strip leading zeros per segment: 1.01 → 1.1 (engine WBS keys)
        n = n.split('.').map((seg) => (seg === '0' ? '0' : seg.replace(/^0+(?=\d)/, ''))).join('.');
        return n;
      })
      .filter(Boolean)
      .join(', ');
    upPred(t, cleaned);
  };

  /** Delay (client spec): actual finish − plan finish, in days. +1 day = one day late. */
  const delayOf = (t: PTask, planFinish: Date): number | null => {
    if (!t.ae) return null;
    const a = new Date(`${t.ae}T00:00:00`);
    if (Number.isNaN(a.getTime())) return null;
    return Math.round((a.getTime() - planFinish.getTime()) / 86_400_000);
  };

  const addSub = (t: PTask): void => {
    if (frozen) {
      say(planLocked(), 'warn');
      return;
    }
    const idx = t.kids.length + 1;
    const child = newTask(`Task ${wbsOf(t)}.${idx}`, 5, 0);
    t.kids.push(child);
    t.open = true;
    setFocusId(child.id);
    setSaveState('idle');
    bump();
  };

  const addPhase = (): void => {
    if (frozen) {
      say(planLocked(), 'warn');
      return;
    }
    const num = roots.length + 1;
    const p = newTask(`Phase ${num}`, 1, 0);
    p.kids.push(newTask(`Task ${num}.1`, 5, 0));
    roots.push(p);
    setFocusId(p.id);
    setSaveState('idle');
    bump();
    // New rows land at the bottom — jump there in both panes or the change
    // looks like the button did nothing.
    requestAnimationFrame(() => {
      const pane = view === 'l1' ? l1Ref.current : unifiedRef.current;
      if (pane) pane.scrollTop = pane.scrollHeight;
    });
  };

  const del = (t: PTask): void => {
    if (frozen) {
      say(planLocked(), 'warn');
      return;
    }
    const leafCount = (function count(list: PTask[]): number {
      return list.reduce((a, x) => a + 1 + count(x.kids), 0);
    })([t]);
    if (!window.confirm(`Delete “${t.name}” with its ${leafCount - 1} subtask(s)? Dependencies pointing at it are removed too.`)) return;
    const ids = new Set<number>();
    const collect = (list: PTask[]): void => {
      for (const x of list) {
        ids.add(x.id);
        collect(x.kids);
      }
    };
    collect([t]);
    const list = t.parent ? t.parent.kids : roots;
    const idx = list.findIndex((x) => x.id === t.id);
    if (idx !== -1) list.splice(idx, 1);
    const strip = (l: PTask[]): void => {
      for (const x of l) {
        x.pred = x.pred.filter((p) => !ids.has(p));
        strip(x.kids);
      }
    };
    strip(roots);
    if (sel && ids.has(sel)) setSel(0);
    setSaveState('idle');
    bump();
  };

  /** Reorder a task within its siblings (L2 inside its L1 phase; L1 among phases). WBS renumbers from the new order on the next compute; autosave persists it. */
  const move = (t: PTask, dir: -1 | 1): void => {
    if (frozen) {
      say(planLocked(), 'warn');
      return;
    }
    const list = t.parent ? t.parent.kids : roots;
    const i = list.findIndex((x) => x.id === t.id);
    const j = i + dir;
    if (i === -1 || j < 0 || j >= list.length) return;
    const [x] = list.splice(i, 1);
    list.splice(j, 0, x);
    setSaveState('idle');
    bump();
  };

  /** Auto-focus the name input of the row just added. */
  const [focusId, setFocusId] = useState(0);

  /** Client spec 6: the whole L1 schedule as an Excel-compatible CSV. */
  const downloadExcel = (): void => {
    if (!res) return;
    const head = ['Task no.', 'Task description', 'Duration (days)', 'Depends on', 'Float / Slack (F/T days)', 'Plan start', 'Plan end', 'Actual start', 'Actual finish', '% complete', 'Delay (days)', 'Remarks', 'Status'];
    const lines = [head.join(',')];
    const q = (s: string): string => (/[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);
    const walk = (list: PTask[]): void => {
      for (const t of list) {
        const cc = res.c.get(t.id)!;
        const phase = t.kids.length > 0;
        // Free float / total slack (MS Project): "F / T".
        const pair = phase ? `— / ${cc.slack}` : `${cc.float} / ${cc.slack}`;
        const delay = delayOf(t, cc.finish);
        const row = [
          displayNum(t),
          t.name,
          String(cc.dur),
          depText(t),
          pair,
          fmt(cc.start),
          fmt(cc.finish),
          phase ? actualsOf(t).start ?? '' : t.as ?? '',
          phase ? actualsOf(t).finish ?? '' : t.ae ?? '',
          `${cc.pct}%`,
          delay === null ? '—' : String(delay),
          t.rem ?? '',
          cc.crit ? 'Critical' : phase ? 'Phase' : cc.pct >= 100 ? 'Done' : cc.pct > 0 ? 'In progress' : 'Not started',
        ];
        lines.push(row.map(q).join(','));
        walk(t.kids);
      }
    };
    walk(roots);
    // BOM prefix so Excel detects UTF-8 (task names can carry non-ASCII).
    const BOM = String.fromCharCode(0xfeff);
    const blob = new Blob([BOM + lines.join('\n')], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${planName.replace(/[^\w-]+/g, '_')}_schedule.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  /** Client spec 6: a printable PDF via the shared letterhead print window. */
  const downloadPdf = (): void => {
    if (!res) return;
    const head = ['Task no.', 'Task description', 'Days', 'Depends on', 'Float/Slack', 'Plan start', 'Plan end', 'Act. start', 'Act. finish', '%', 'Delay', 'Remarks'];
    const rows: string[][] = [];
    const walk = (list: PTask[]): void => {
      for (const t of list) {
        const cc = res.c.get(t.id)!;
        const phase = t.kids.length > 0;
        const delay = delayOf(t, cc.finish);
        rows.push([
          displayNum(t),
          t.name,
          String(cc.dur),
          depText(t),
          phase ? `— / ${cc.slack}` : `${cc.float} / ${cc.slack}`,
          fmt(cc.start),
          fmt(cc.finish),
          phase ? actualsOf(t).start ?? '—' : t.as || '—',
          phase ? actualsOf(t).finish ?? '—' : t.ae || '—',
          `${cc.pct}%`,
          delay === null ? '—' : String(delay),
          t.rem || '',
        ]);
        walk(t.kids);
      }
    };
    walk(roots);
    openPrintReport({
      title: 'Project schedule',
      sub: planName,
      meta: [
        `${allProjects.find((p) => p.id === projectId)?.name ?? planName} · ${fmt(res.stats.start)} → ${fmt(res.stats.finish)} · ${res.stats.duration} days`,
        frozen ? `Approved baseline · ${approvedBy}` : 'Draft',
      ],
      tables: [{ title: 'Schedule', head, rows, aligns: ['left', 'left', 'right', 'left', 'right', 'right', 'right', 'right', 'right', 'right', 'right', 'left'] }],
      notes: `Phases: ${res.stats.phases} · Tasks: ${res.stats.tasks} · Critical tasks: ${res.stats.critical} · Progress: ${Math.round(res.stats.progress)}%`,
      signatures: ['Prepared by', 'Checked by', 'Approved by'],
    });
  };

  /**
   * Phase actuals (client spec 2): a phase's actual start is the minimum of
   * its leaves' actual starts; its actual finish the maximum of their
   * actual finishes. No manual entry on summary rows.
   */
  const actualsOf = (t: PTask): { start?: string; finish?: string } => {
    let start: string | undefined;
    let finish: string | undefined;
    const scan = (list: PTask[]): void => {
      for (const x of list) {
        if (x.kids.length) {
          scan(x.kids);
          continue;
        }
        if (x.as && (!start || x.as < start)) start = x.as;
        if (x.ae && (!finish || x.ae > finish)) finish = x.ae;
      }
    };
    scan(t.kids);
    return { start, finish };
  };

  /** WBS of a task, computed straight from the tree (before the next engine pass). */
  const wbsOf = useCallback((t: PTask): string => {
    const parts: string[] = [];
    let x: PTask | null = t;
    while (x) {
      const self: PTask = x;
      const list = self.parent ? self.parent.kids : roots;
      parts.unshift(String(list.findIndex((y) => y.id === self.id) + 1));
      x = self.parent;
    }
    return parts.join('.');
  }, [roots]);

  /** Client L1 numbering: phases keep their WBS (1, 2…), leaves show N.01, N.02 under their parent. */
  const displayNum = (t: PTask): string => {
    if (t.kids.length || !t.parent?.wbs) return t.wbs ?? '';
    const idx = t.parent.kids.findIndex((x) => x.id === t.id) + 1;
    return `${t.parent.wbs}.${String(idx).padStart(2, '0')}`;
  };

  /** Remarks editor (the client schedule's Remarks column). */
  const upRem = (t: PTask, v: string): void => {
    t.rem = v;
    setSaveState('idle');
    bump();
  };

  const pick = (id: number): void => setSel(sel === id ? 0 : id);
  const toggle = (t: PTask): void => {
    t.open = !t.open;
    bump();
  };

  const setAllOpen = (open: boolean): void => {
    const walkAll = (l: PTask[]): void => {
      for (const t of l) {
        if (t.kids.length) t.open = open;
        walkAll(t.kids);
      }
    };
    walkAll(roots);
    bump();
  };

  // ── Gantt geometry (faithful to the demo) ──────────────────────────────

  const ROW = 34;
  /** Width of the sticky task table in the unified Gantt (bars start after it). */
  const GANTT_TABLE_W = 640;
  const DAY = 86_400_000;
  const visible = res?.visible ?? [];

  /**
   * Client spec 8: the Critical tasks card filters the schedule to critical
   * tasks only. Phases stay in as headers when any descendant leaf is
   * critical; the rest is hidden until the toggle is switched off.
   */
  const shown = useMemo((): PTask[] => {
    if (!critOnly || !res) return visible;
    const critIds = new Set(res.leaves.filter((l) => res.c.get(l.id)!.crit).map((l) => l.id));
    const keep: PTask[] = [];
    const hasCrit = (list: PTask[]): boolean =>
      list.some((x) => (x.kids.length ? hasCrit(x.kids) : critIds.has(x.id)));
    const walk = (list: PTask[]): void => {
      for (const t of list) {
        if (t.kids.length) {
          if (hasCrit(t.kids)) {
            keep.push(t);
            walk(t.kids);
          }
        } else if (critIds.has(t.id)) keep.push(t);
      }
    };
    walk(roots);
    return keep;
  }, [critOnly, res, visible, roots]);

  const end = res?.end ?? 1;
  const p0 = res?.p0 ?? new Date();
  const days = end + 16;
  const W = days * dw;

  /** Pick the zoom level that fits the whole plan into the chart's actual
   *  container width — the panel strip in normal mode, the whole viewport
   *  when the Gantt is lifted to full screen. Measuring the container beats
   *  guessing the sidebar/padding widths from the window. */
  const fitGantt = (availOverride?: number): void => {
    let d = 0;
    const w = (ts: PTask[]): void => { for (const t of ts) { d = Math.max(d, (t.off ?? 0) + t.dur); w(t.kids); } };
    w(roots);
    const avail = Math.max(480, availOverride ?? (unifiedRef.current?.clientWidth ?? window.innerWidth - GANTT_TABLE_W - 120));
    setDw([26, 12, 5, 2].find((z) => d * z <= avail) ?? 2);
  };

  const weekEls: React.ReactNode[] = [];
  const gridEls: React.ReactNode[] = [];
  const headEls: React.ReactNode[] = [];
  for (let d = 0; d < days; d += 1) {
    const dt = new Date(p0.getTime() + d * DAY);
    if (dw >= 10 && dt.getDay() % 6 === 0) weekEls.push(<div key={`we${d}`} className="we" style={{ left: d * dw, width: dw }} />);
    const showTick = dw >= 20 || (dw >= 10 && dt.getDay() === 1) || (dw < 10 && dt.getDate() === 1);
    if (showTick) {
      const width = dw >= 20 ? dw : dw < 10 ? 60 : 84;
      headEls.push(
        <div key={`h${d}`} style={{ left: d * dw, width }}>
          {dw >= 20 ? (
            <>
              {dt.getDate()}
              <br />
              {dt.toLocaleDateString('en-GB', { month: 'short' })}
            </>
          ) : (
            fmt(dt)
          )}
        </div>,
      );
      gridEls.push(<div key={`g${d}`} className="planner-grid" style={{ left: d * dw }} />);
    }
  }

  const rowStripe: React.ReactNode[] = [];
  const bars: React.ReactNode[] = [];
  const labels: React.ReactNode[] = [];
  const arrows: React.ReactNode[] = [];
  const ganttRows = shown;
  const ix: Record<number, number> = {};
  ganttRows.forEach((t, i) => {
    ix[t.id] = i;
  });

  ganttRows.forEach((t, i) => {
    if (!res) return;
    const c = res.c.get(t.id)!;
    const s = t.kids.length > 0;
    const x = c.es * dw;
    const w = c.dur * dw;
    const y = i * ROW + (s ? 11 : 6);
    if (s) rowStripe.push(<div key={`rs${t.id}`} className="planner-rs" style={{ top: i * ROW }} />);
    bars.push(
      <div
        key={`b${t.id}`}
        className={`planner-bar ${s ? 'sum' : st(c.pct)} ${criticalOn && !s && c.crit && c.pct < 100 ? 'crit' : ''} ${sel === t.id ? 'sel' : ''}`}
        onClick={() => pick(t.id)}
        style={{ left: x, top: y, width: w }}
        title={`${c.wbs} ${t.name}\n${fmt(c.start)} → ${fmt(c.finish)} (${c.dur} days, ${c.pct}%)`}
      >
        <i style={{ width: `${c.pct}%` }} />
        {!s && w > 34 ? <span>{c.pct}%</span> : null}
      </div>,
    );
    labels.push(
      <em key={`l${t.id}`} className="planner-lbl" style={{ left: x + w + 6, top: i * ROW + 10 }}>
        {t.name}
      </em>,
    );
    for (const pid of t.pred) {
      if (ix[pid] === undefined) continue;
      const q = ganttRows[ix[pid]];
      const cq = res.c.get(pid)!;
      const x1 = (cq.es + cq.dur) * dw;
      const y1 = ix[pid] * ROW + 17;
      const y2 = i * ROW + 17;
      const hl = sel !== 0 && (sel === pid || sel === t.id);
      arrows.push(
        <path
          key={`a${pid}-${t.id}`}
          opacity={sel !== 0 && !hl ? 0.25 : 1}
          d={`M${x1} ${y1} H${x1 + 6} V${y2} H${Math.max(x, x1 + 6)}`}
          fill="none"
          stroke={hl ? '#1d4ed8' : criticalOn && cq.crit && c.crit ? '#dc2626' : '#64748b'}
          strokeWidth={hl ? 2.6 : 1.4}
          markerEnd="url(#planner-a)"
        />,
      );
    }
  });

  const tx = (Date.now() - p0.getTime()) / DAY * dw;
  const stats = res?.stats;

  return (
    <div className="planner-root">
      <style>{PLANNER_CSS}</style>

      <PageHead
        title="Project planner"
        description="MS-Project-style planning: phases with subtasks, WBS auto-numbering, finish-to-start dependencies, roll-up dates, critical path and a Gantt view. Save a plan to keep it per project."
        actions={
          <>
            {savedPlans.length > 0 ? (
              <select
                className="planner-sel"
                value={planRowId ?? ''}
                onChange={(e) => {
                  const row = savedPlans.find((p) => p.id === e.target.value);
                  if (row) openPlan(row);
                  else newBlankPlan();
                }}
              >
                <option value="">+ New blank plan</option>
                {savedPlans.map((p) => (
                  <option key={p.id} value={p.id}>
                    {String(p.data.name ?? p.ref)}
                  </option>
                ))}
              </select>
            ) : null}
            <Button variant="primary" onClick={addPhase}>
              + Add phase
            </Button>
            <Button variant="primary" onClick={() => void doSave(false)} disabled={saveState === 'saving' || !res || !projectId}>
              Save now
            </Button>
          </>
        }
      />

      <div className="planner-toolbar">
        <div className="tb-left">
          <b>Plan</b>
          <select
            className="planner-sel"
            value={projectId}
            onChange={(e) => {
              setProjectId(e.target.value);
              setSavedPlans([]);
              setPlanRowId(null);
            }}
          >
            {allProjects.length === 0 ? <option value="">No projects yet</option> : null}
            {allProjects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
          {saveState !== 'idle' ? (
            <span className="planner-save">
              {saveState === 'saving' ? 'Saving…' : saveState === 'saved' ? 'All changes saved' : 'Save failed'}
            </span>
          ) : null}
          <label>
            Project start <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
          </label>
          {view === 'gantt' ? (
            <>
              <label>
                Zoom{' '}
                <select value={String(dw)} onChange={(e) => setDw(Number(e.target.value))}>
                  <option value="26">Days</option>
                  <option value="12">Weeks</option>
                  <option value="5">Months</option>
                  <option value="2">Overview</option>
                </select>
                <button type="button" onClick={() => fitGantt()}>Fit</button>
              </label>
              <label>
                <input type="checkbox" checked={criticalOn} onChange={(e) => setCriticalOn(e.target.checked)} /> Critical path
              </label>
            </>
          ) : null}
        </div>
        <div className="tb-right">
          <button type="button" className="p" onClick={() => fileRef.current?.click()}>
            Import Excel
          </button>
          <button type="button" className="p" onClick={() => downloadExcel()} disabled={!res} title="Excel-compatible .csv (opens in Excel)">
            Excel
          </button>
          <button type="button" className="p" onClick={() => downloadPdf()} disabled={!res} title="Printable PDF via the print window">
            PDF
          </button>
          <button
            type="button"
            className={colW ? 'p' : 'v'}
            onClick={() => setColW({})}
            title="Adjust L1 column widths to read wrapped text"
          >
            Column widths
          </button>
          <input
            ref={fileRef}
            type="file"
            accept=".csv,.tsv,.txt,.xlsx,.xls"
            style={{ display: 'none' }}
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void importExcel(f);
              e.target.value = '';
            }}
          />
          <button type="button" className={view === 'l1' ? 'v on' : 'v'} onClick={() => setView('l1')}>
            Schedule
          </button>
          <button type="button" className={view === 'gantt' ? 'v on' : 'v'} onClick={() => setView('gantt')}>
            Gantt
          </button>
          {view === 'gantt' ? (
            <button
              type="button"
              className="p"
              onClick={() => {
                const next = !ganttFull;
                setGanttFull(next);
                if (next) {
                  setGanttChartOnly(false);
                  fitGantt(window.innerWidth - GANTT_TABLE_W - 80);
                }
              }}
              title={ganttFull ? 'Exit full screen (Esc)' : 'View the Gantt on the whole screen'}
            >
              {ganttFull ? 'Exit full screen' : 'Full screen'}
            </button>
          ) : null}
          {canApprove ? (
            frozen ? (
              <button type="button" className="p" onClick={reopenBaseline} title="Un-freeze the plan fields">
                Reopen baseline
              </button>
            ) : (
              <button type="button" className="p" onClick={approveBaseline} title="Freeze the plan fields; actuals stay live">
                Approve baseline
              </button>
            )
          ) : null}
          {view === 'gantt' ? (
            <>
              <button type="button" onClick={() => setAllOpen(true)}>Expand all</button>
              <button type="button" onClick={() => setAllOpen(false)}>Collapse all</button>
            </>
          ) : null}
        </div>
      </div>

      {msg ? (
        <div className={`planner-notice planner-notice-${msgTone}`}>
          {msg}
        </div>
      ) : null}

      {critOnly ? (
        <div className="planner-notice">
          Showing critical tasks only — click the Critical tasks card again to show all.
          <button type="button" onClick={() => setCritOnly(false)}>
            Show all
          </button>
        </div>
      ) : null}

      {colW ? (
        <div className="planner-notice">
          <b>Column widths (L1 view)</b> — set a pixel width to read wrapped text; empty = default.
          <div className="colwidths">
            {L1_COLS.map((label, i) => (
              <label key={label}>
                {label}
                <input
                  type="number"
                  min={0}
                  placeholder="auto"
                  value={colW[i] ?? ''}
                  onChange={(e) => {
                    const v = e.target.value === '' ? undefined : Number(e.target.value);
                    setColW((p) => {
                      const next = { ...(p ?? {}) };
                      if (v === undefined || Number.isNaN(v)) delete next[i];
                      else next[i] = v;
                      return next;
                    });
                  }}
                />
              </label>
            ))}
            <button type="button" className="v" onClick={() => setColW({})}>
              Reset
            </button>
            <button type="button" className="p" onClick={() => setColW(null)}>
              Done
            </button>
          </div>
        </div>
      ) : null}

      {sheetPick ? (
        <div className="planner-notice planner-notice-info">
          <b>{sheetPick.file.name}</b> has {sheetPick.sheets.length} tabs — pick which one to import:
          <div className="sheet-pick">
            {sheetPick.sheets.map((s) => (
              <button
                key={s.name}
                type="button"
                className="p"
                onClick={() => {
                  const f = sheetPick.file;
                  void finishImport(f, s.grid, s.name);
                }}
              >
                {s.name}
              </button>
            ))}
            <button type="button" onClick={() => setSheetPick(null)}>
              Cancel
            </button>
          </div>
        </div>
      ) : null}

      {stats ? (
        <div className="planner-stats">
          <Card label="Phases" value={stats.phases} />
          <Card label="Tasks" value={stats.tasks} />
          <Card label="Start" value={fmt(stats.start)} />
          <Card label="Finish" value={fmt(stats.finish)} />
          <Card label="Duration" value={`${stats.duration} days`} />
          <Card label="Progress" value={`${Math.round(stats.progress)}%`} />
          <Card
            label="Critical tasks"
            value={stats.critical}
            active={critOnly}
            onClick={() => {
              const next = !critOnly;
              setCritOnly(next);
              // ON: the Gantt shows the critical branch only (chart + data
              // together); OFF: back to the full L1 schedule.
              setView(next ? 'gantt' : 'l1');
            }}
          />
          <Card
            label="Chart only"
            value={ganttChartOnly ? 'Exit' : '▦'}
            active={ganttChartOnly}
            onClick={() => {
              setView('gantt');
              const next = !ganttChartOnly;
              setGanttChartOnly(next);
              if (next) {
                setGanttFull(false);
                // The table is hidden, so the whole window is chart room.
                fitGantt(window.innerWidth - 80);
              }
            }}
          />
          <Card
            label="Full chart"
            value={ganttFull ? 'Exit' : '⛶'}
            active={ganttFull}
            onClick={() => {
              setView('gantt');
              const next = !ganttFull;
              setGanttFull(next);
              if (next) {
                // Full chart always keeps the task table visible; the
                // chart-only mode (table hidden) is its opposite, so clear
                // it — otherwise full screen opens without the table.
                setGanttChartOnly(false);
                // Entering from the stats row: fit the plan to the full
                // window so the chart needs no side scroll on entry.
                fitGantt(window.innerWidth - GANTT_TABLE_W - 80);
              }
            }}
          />
        </div>
      ) : null}

      <div className="planner-wrap">
        {view === 'gantt' ? (
          <div className={`gantt${ganttFull ? ' gantt-full' : ''}`} ref={unifiedRef}>
            {ganttFull ? (
              /* Title bar across the top of the overlay: the empty strip
                 under the plan reads as padding, not a missing piece. */
              <div className="gantt-full-hd">
                <div className="gantt-full-hd-t">
                  <b>{allProjects.find((pr) => pr.id === projectId)?.name ?? planName}</b>
                  {stats ? <span>{fmt(stats.start)} → {fmt(stats.finish)} · {stats.duration} days · {Math.round(stats.progress)}% done</span> : null}
                </div>
                <button type="button" onClick={() => setGanttFull(false)} title="Exit full screen (Esc)">✕</button>
              </div>
            ) : null}
            <div className="gantt-inner" style={{ width: (ganttChartOnly ? 0 : GANTT_TABLE_W) + W, height: 44 + ganttRows.length * ROW }}>
              {/* Left: the task table. Sticky so the bars stay glued to their rows.
                  Chart-only mode hides it entirely and lets the timeline own the width. */}
              <div className="gantt-table" style={{ width: GANTT_TABLE_W, display: ganttChartOnly ? 'none' : undefined }}>
                <table>
                  <thead>
                    <tr>
                      <th style={{ width: 56 }}>WBS</th>
                      <th>Task name</th>
                      <th style={{ width: 48 }}>Days</th>
                      <th style={{ width: 96 }}>Depends on</th>
                      <th style={{ width: 78 }}>Start</th>
                      <th style={{ width: 78 }}>Finish</th>
                      <th style={{ width: 54 }}>% done</th>
                      <th style={{ width: 44 }} />
                    </tr>
                  </thead>
                  <tbody>
                    {ganttRows.map((t) => {
                      if (!res) return null;
                      const c = res.c.get(t.id)!;
                      const s = t.kids.length > 0;
                      const critRow = criticalOn && !s && c.crit;
                      return (
                        <tr key={t.id} className={`${s ? 'sum' : 'leaf'} ${critRow ? 'crit' : ''} ${sel === t.id ? 'selrow' : ''}`}>
                          <td className="c" onClick={() => pick(t.id)}>
                            <span className={`dot ${st(c.pct)}`} />
                            {c.wbs}
                          </td>
                          <td>
                            <div className="nm" style={{ paddingLeft: c.depth * 18 }}>
                              {s ? (
                                <button type="button" className="tg" onClick={() => toggle(t)}>
                                  {t.open ? '▾' : '▸'}
                                </button>
                              ) : (
                                <span className="tg" />
                              )}
                              <input
                                key={`n${t.id}:${t.name}`}
                                defaultValue={t.name}
                                autoFocus={focusId === t.id}
                                disabled={frozen}
                                onBlur={(e) => {
                                  if (focusId === t.id) setFocusId(0);
                                  upName(t, e.target.value);
                                }}
                              />
                            </div>
                          </td>
                          <td className="c">
                            {s ? c.dur : (
                              <input
                                key={`d${t.id}:${t.dur}`}
                                type="number"
                                min={1}
                                defaultValue={t.dur}
                                disabled={frozen}
                                onBlur={(e) => upNum(t, 'dur', Number(e.target.value) || 1)}
                              />
                            )}
                          </td>
                          <td>
                            <input
                              key={`p${t.id}:${t.pred.join(',')}`}
                              placeholder="—"
                              defaultValue={t.pred
                                .map((id) => res.taskById.get(id)?.wbs ?? '')
                                .filter(Boolean)
                                .join(', ')}
                              disabled={frozen}
                              onBlur={(e) => upPred(t, e.target.value)}
                            />
                          </td>
                          <td className="c">{fmt(c.start)}</td>
                          <td className="c">{fmt(c.finish)}</td>
                          <td className="c">
                            {s ? c.pct : (
                              <input
                                key={`x${t.id}:${t.pct}`}
                                type="number"
                                min={0}
                                max={100}
                                defaultValue={t.pct}
                                onBlur={(e) => upNum(t, 'pct', Number(e.target.value) || 0)}
                              />
                            )}
                          </td>
                          <td className="c g-act">
                            {!frozen && ((t.parent?.kids.length ?? roots.length) > 1 ? (
                              <>
                                <button type="button" className="ic" title="Move up (WBS renumbers)" onClick={() => move(t, -1)}>▲</button>
                                <button type="button" className="ic" title="Move down (WBS renumbers)" onClick={() => move(t, 1)}>▼</button>
                              </>
                            ) : null)}
                            {!s && !frozen ? (
                              <button type="button" className="ic a" title="Add subtask" onClick={() => addSub(t)}>
                                +
                              </button>
                            ) : null}
                            {!frozen ? (
                              <button type="button" className="ic d" title="Delete (with subtasks)" onClick={() => del(t)}>
                                ✕
                              </button>
                            ) : null}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              {/* Right: the timeline, glued to the same row grid. */}
              <div className="gantt-chart" style={{ left: ganttChartOnly ? 0 : GANTT_TABLE_W, width: W }}>
                <div className="gantt-time-hd" style={{ width: W }}>
                  {headEls}
                </div>
                <div className="gantt-chart-body" style={{ width: W, height: ganttRows.length * ROW }}>
                  {weekEls}
                  {gridEls}
                  {rowStripe}
                  {bars}
                  {labels}
                  {tx >= 0 && tx <= W ? <div className="planner-today" style={{ left: tx }} /> : null}
                  <svg style={{ position: 'absolute', left: 0, top: 0, pointerEvents: 'none' }} width={W} height={Math.max(ganttRows.length * ROW, 44)}>
                    <defs>
                      <marker id="planner-a" markerWidth="7" markerHeight="7" refX="6" refY="3.5" orient="auto">
                        <path d="M0 0L7 3.5L0 7z" fill="#475569" />
                      </marker>
                    </defs>
                    {arrows}
                  </svg>
                </div>
              </div>
            </div>
          </div>
        ) : null}

        {view === 'l1' ? (
          <div className="l1-view" ref={l1Ref}>
            {stats ? (
              <div className="l1-title">
                <b>{allProjects.find((p) => p.id === projectId)?.name ?? planName}</b>
                <span>
                  Overall Project Schedule · {fmt(stats.start)} → {fmt(stats.finish)} · {stats.duration} days
                  {frozen ? (
                    <em className="l1-locked">Approved · {approvedBy}</em>
                  ) : canApprove ? (
                    <em className="l1-draft">Draft — approvable</em>
                  ) : (
                    <em className="l1-draft">Draft — editable</em>
                  )}
                </span>
              </div>
            ) : null}
            <div className="l1-scroll">
            <table className={`l1${colW ? ' l1-w' : ''}`}>
              <thead>
                <tr>
                  <th style={{ width: colW ? colW[0] : 64 }}>Task no.</th>
                  {/* Capped description column: long names scroll inside the
                      input instead of stretching the table (fixed layout). */}
                  <th style={colW ? { width: colW[1] } : { width: 300 }}>Task description</th>
                  <th style={{ width: colW ? colW[2] : 74 }}>Duration</th>
                  <th style={{ width: colW ? colW[3] : 104 }}>Depends on</th>
                  <th style={{ width: colW ? colW[4] : 48 }}>Float / Slack</th>
                  <th style={{ width: colW ? colW[5] : 84 }}>Plan start</th>
                  <th style={{ width: colW ? colW[6] : 84 }}>Plan end</th>
                  <th style={{ width: colW ? colW[7] : 140 }}>Actual start</th>
                  <th style={{ width: colW ? colW[8] : 140 }}>Actual finish</th>
                  <th style={{ width: colW ? colW[9] : 64 }}>% complete</th>
                  <th style={{ width: colW ? colW[10] : 58 }}>Delay</th>
                  <th style={{ width: colW ? colW[11] : 88 }}>Remarks</th>
                  {/* Fixed layout honours this width: 40px clipped the
                      move-up/down buttons. Four ~21px icons + padding
                      need ~100px so ▲ ▼ + ✕ all sit on one row. */}
                  <th style={{ width: 100 }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {shown.map((t) => {
                  if (!res) return null;
                  const c = res.c.get(t.id)!;
                  const s = t.kids.length > 0;
                  // Client spec 5: float = the dependent activity's Plan Start
                  // minus this Plan End (the engine's successor-based float).
                  // MS Project semantics: free float / total slack, shown as
                  // "F / T". F = dependent's Plan Start − this Plan End;
                  // T = how much the task can slip without moving the project.
                  const slack = `${c.float} / ${c.slack}`;
                  const delay = s ? null : delayOf(t, c.finish);
                  const phaseAct = s ? actualsOf(t) : null;
                  return (
                    <tr key={t.id} className={s ? 'l1-phase' : 'l1-task'}>
                      <td className="l1-num" onClick={() => pick(t.id)}>
                        {s ? (
                          <>
                            <button type="button" className="tg" onClick={() => toggle(t)}>
                              {t.open ? '▾' : '▸'}
                            </button>
                            <b>{displayNum(t)}</b>
                          </>
                        ) : displayNum(t)}
                      </td>
                      <td>
                        <input
                          key={`L1n${t.id}:${t.name}`}
                          defaultValue={t.name}
                          autoFocus={focusId === t.id}
                          disabled={frozen}
                          onBlur={(e) => {
                            if (focusId === t.id) setFocusId(0);
                            upName(t, e.target.value);
                          }}
                        />
                      </td>
                      <td className="l1-c">
                        {s ? (
                          <b>{c.dur}</b>
                        ) : (
                          <input
                            key={`L1d${t.id}:${t.dur}`}
                            type="number"
                            min={1}
                            defaultValue={t.dur}
                            disabled={frozen}
                            onBlur={(e) => upNum(t, 'dur', Number(e.target.value) || 1)}
                          />
                        )}
                      </td>
                      <td>
                        <input
                          key={`L1p${t.id}:${t.pred.join(',')}`}
                          placeholder="—"
                          defaultValue={depText(t)}
                          disabled={frozen}
                          onBlur={(e) => upDepL1(t, e.target.value)}
                        />
                      </td>
                      <td className="l1-c" title="F = free float (days until the dependent activity's Plan Start); T = total slack (how much the task can slip without moving the project finish)">{s ? `— / ${c.slack}` : slack}</td>
                      <td className="l1-c">{fmt(c.start)}</td>
                      <td className="l1-c">{fmt(c.finish)}</td>
                      <td className="l1-c">
                        {s ? (
                          // Client spec 2: phase actual start = the minimum
                          // of its subtask actual starts (read-only).
                          <span className="l1-actauto" title="Auto: earliest subtask actual start">{phaseAct!.start || '—'}</span>
                        ) : (
                          <input
                            // Stable key: a value-bearing key (t.as) remounts
                            // the input on every pick — upAct bumps rev, the
                            // key changes, and the open native date picker is
                            // torn down mid-navigation (click October, closed).
                            // These inputs are controlled, so they never need
                            // the remount-refresh the defaultValue siblings do.
                            key={`L1as${t.id}`}
                            type="date"
                            value={t.as ?? ''}
                            onChange={(e) => upAct(t, 'as', e.target.value)}
                          />
                        )}
                      </td>
                      <td className="l1-c">
                        {s ? (
                          // Phase actual finish = the maximum of its subtask
                          // actual finishes (read-only).
                          <span className="l1-actauto" title="Auto: latest subtask actual finish">{phaseAct!.finish || '—'}</span>
                        ) : (
                          <input
                            // Same stable-key fix as the actual start input:
                            // the controlled value updates in place, no
                            // remount, the picker stays open across months.
                            key={`L1ae${t.id}`}
                            type="date"
                            value={t.ae ?? ''}
                            onChange={(e) => upAct(t, 'ae', e.target.value)}
                          />
                        )}
                      </td>
                      <td className="l1-c">
                        {s ? c.pct + '%' : (
                          <input
                            key={`L1pc${t.id}:${t.pct}`}
                            type="number"
                            min={0}
                            max={100}
                            defaultValue={t.pct}
                            onBlur={(e) => upNum(t, 'pct', Number(e.target.value) || 0)}
                          />
                        )}
                      </td>
                      <td className={`l1-c l1-delay${delay !== null && delay > 0 ? ' late' : delay !== null && delay < 0 ? ' early' : ''}`} title={delay !== null ? `Actual finish ${delay >= 0 ? '+' : ''}${delay} days vs plan finish` : 'Set the actual finish to calculate delay'}>
                        {s ? '—' : delay === null ? '—' : `${delay >= 0 ? '+' : ''}${delay} day${Math.abs(delay) === 1 ? '' : 's'}`}
                      </td>
                      <td>
                        <input
                          key={`L1r${t.id}:${t.rem ?? ''}`}
                          placeholder="—"
                          defaultValue={t.rem ?? ''}
                          onBlur={(e) => upRem(t, e.target.value)}
                        />
                      </td>
                      <td className="l1-c l1-act">
                        {!frozen && ((t.parent?.kids.length ?? roots.length) > 1 ? (
                          <>
                            <button type="button" className="ic" title="Move up (WBS renumbers)" onClick={() => move(t, -1)}>▲</button>
                            <button type="button" className="ic" title="Move down (WBS renumbers)" onClick={() => move(t, 1)}>▼</button>
                          </>
                        ) : null)}
                        {!s && !frozen ? (
                          <button type="button" className="ic a" title="Add subtask" onClick={() => addSub(t)}>
                            +
                          </button>
                        ) : null}
                        {!frozen ? (
                          <button type="button" className="ic d" title="Delete (with subtasks)" onClick={() => del(t)}>
                            ✕
                          </button>
                        ) : null}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            </div>
          </div>
        ) : null}

      </div>

      <div className="planner-tip">
        <div className="planner-lg">
          <span style={{ ['--c' as never]: '#1e293b' }}>Phase (summary of its subtasks)</span>
          <span style={{ ['--c' as never]: '#94a3b8' }}>Not started</span>
          <span style={{ ['--c' as never]: '#3b82f6' }}>In progress</span>
          <span style={{ ['--c' as never]: '#16a34a' }}>Complete</span>
          <span style={{ ['--c' as never]: '#ef4444' }}>Critical</span>
          <span style={{ ['--c' as never]: '#f59e0b' }}>Today</span>
        </div>
        <b>Click any text or number to edit it</b> (name, Days, Depends on, % done) — the change is confirmed when you click away; every chart
        and card updates at once and the plan auto-saves. <b style={{ color: '#1e40af' }}>+</b> adds a subtask under that row,
        <b>+</b> Add phase makes a new top-level phase (it appears at the bottom of the list — the view scrolls to it). ▾/▸ collapses a phase.
        Phase dates, days and % are calculated from their subtasks. “Depends on” takes WBS numbers (e.g. <b>1.2, 2.1</b>); depending on a phase means
        “after the whole phase finishes”. Links to your own subtree or a cycle are refused. Click a WBS number or bar to highlight its links.
      </div>
    </div>
  );
}

// ── demo-faithful styles, scoped under .planner-root ─────────────────────

const PLANNER_CSS = `
/* Match the planner's PageHead title to the app's other page titles (Inter,
   semibold, text-xl) — e.g. "BOQ & estimation". The .planner-root stack below
   would otherwise leak a system font into the head. */
.planner-root .planner-toolbar,.planner-root .planner-stats,.planner-root .planner-card{font-family:ui-sans-serif,system-ui,'Segoe UI',Arial,sans-serif}
.planner-root h2,.planner-root h2 *{font-family:var(--font-sans)}
.planner-root .planner-stats{display:flex;gap:10px;flex-wrap:wrap;margin:10px 0}
.planner-root .planner-card{background:#fff;border-radius:6px;padding:6px 12px;box-shadow:0 1px 2px rgba(0,0,0,.13);border-left:4px solid #1e40af;min-width:88px;font-size:12px;color:#475569}
.planner-root .planner-card b{display:block;font-size:16px;color:#1e293b;margin-top:2px}

.planner-root .planner-toolbar{display:flex;gap:10px;align-items:center;flex-wrap:nowrap;overflow-x:auto;background:#1e2a44;color:#fff;padding:18px 16px;min-height:68px;border-radius:8px;margin:12px 0}
.planner-root .tb-left{display:flex;gap:10px;align-items:center;flex-wrap:nowrap;flex:0 0 auto;min-width:0}
.planner-root .tb-right{display:flex;gap:8px;align-items:center;flex-wrap:nowrap;margin-left:auto}

.planner-root .planner-toolbar b{font-size:14px;margin-right:4px}
.planner-root .planner-toolbar,.planner-root .planner-toolbar *{font-weight:700}
.planner-root .planner-toolbar input,.planner-root .planner-toolbar select{font-weight:700}
.planner-root .planner-toolbar button,.planner-root .planner-toolbar select,.planner-root .planner-toolbar input{font:inherit}
.planner-root .planner-toolbar button{padding:5px 10px;border:1px solid rgba(255,255,255,.4);background:rgba(255,255,255,.08);color:#fff;border-radius:5px;cursor:pointer;font-size:12px}
.planner-root .planner-toolbar button:hover{background:rgba(255,255,255,.18)}
.planner-root .planner-toolbar button.p{background:#1e40af;border-color:#1e40af}
.planner-root .planner-toolbar button.p:hover{background:#1a358f}
.planner-root .planner-toolbar label{font-size:12px;display:flex;align-items:center;gap:5px}
.planner-root .planner-toolbar input,.planner-root .planner-toolbar select{padding:4px 6px;border-radius:4px;border:1px solid rgba(255,255,255,.35);background:#fff;color:#1e293b;font-size:12px}
.planner-root .planner-toolbar input[type=checkbox]{background:transparent;padding:2px}
.planner-root .planner-sel{font-size:12.5px;border-radius:5px;border:1px solid #cbd5e1;background:#fff;padding:5px 8px;max-width:260px}
.planner-root .tb-left .planner-sel{max-width:220px}
.planner-root .planner-toolbar label{flex:none}
.planner-root .planner-toolbar button{flex:none;white-space:nowrap}
.planner-root .planner-save{font-size:11.5px;color:#cfe8dc;background:rgba(255,255,255,.12);padding:3px 8px;border-radius:10px;margin-left:2px}
.planner-root .planner-notice{margin:8px 0;padding:8px 12px;border-radius:6px;font-size:12.5px;background:#eff6ff;color:#1d4ed8;border:1px solid #bfdbfe}
.planner-root .planner-notice-ok{background:#ecfdf5;color:#047857;border-color:#a7f3d0}
.planner-root .planner-notice-warn{background:#fffbeb;color:#b45309;border-color:#fde68a}
.planner-root .planner-notice-err{background:#fef2f2;color:#b91c1c;border-color:#fecaca}
.planner-root .sheet-pick{display:flex;gap:8px;margin-top:8px;flex-wrap:wrap}
.planner-root .sheet-pick button{padding:4px 14px;border-radius:6px;font-size:12.5px;cursor:pointer;background:#1d4ed8;color:#fff;border:1px solid #1d4ed8}
.planner-root .sheet-pick button:hover{background:#1e40af}
.planner-root .sheet-pick button:last-child{background:#fff;color:#64748b;border-color:#cbd5e1}
.planner-root .sheet-pick button:last-child:hover{background:#f8fafc}
.planner-root .planner-wrap{display:flex;background:#fff;border-radius:8px;box-shadow:0 1px 3px rgba(0,0,0,.12);overflow:hidden;height:calc(100vh - 360px);min-height:380px}
/* Unified Gantt: one scroll container, the task table sticky-left, the
   timeline glued to its right edge. No more two side-by-side panes. */
.planner-root .gantt{flex:1;overflow:auto;background:#fff;position:relative}
/* Full screen: the chart leaves the fixed-height panel and owns the whole
   viewport — the sticky task table + timeline get the full window width,
   so a wide plan fits without a cramped side scroll. */
.planner-root .gantt.gantt-full{position:fixed;inset:0;z-index:80;width:100vw;height:100vh;flex:none}
/* Full-screen title bar: fills the top of the overlay (no more empty strip
   above the plan) and stays put when the chart scrolls. */
.planner-root .gantt-full-hd{position:sticky;top:0;z-index:81;display:flex;align-items:center;justify-content:space-between;gap:12px;padding:10px 14px;background:#f8fafc;border-bottom:1px solid #cbd5e1}
.planner-root .gantt-full-hd-t{display:flex;align-items:baseline;gap:10px;min-width:0}
.planner-root .gantt-full-hd-t b{font-size:15px;color:#1e293b}
.planner-root .gantt-full-hd-t span{font-size:13px;color:#475569}
.planner-root .gantt-full-hd button{border:1px solid var(--line,#cbd5e1);background:#fff;color:#1e293b;border-radius:6px;padding:5px 11px;font-size:13px;font-weight:600;cursor:pointer}
.planner-root .gantt-full-hd button:hover{background:#e2e8f0}
.planner-root .gantt-inner{position:relative}
.planner-root .gantt-table{position:sticky;left:0;z-index:4;background:#fff;border-right:2px solid #cbd5e1;box-shadow:2px 0 6px rgba(15,23,42,.12)}
.planner-root .gantt-table table{border-collapse:collapse;width:100%;font-size:13px;color:#1e293b}
.planner-root .gantt-table thead th{position:sticky;top:0;background:#e2e8f0;height:44px;text-align:left;padding:0 5px;z-index:2;font-size:12px;font-weight:600;color:#475569}
.planner-root .gantt-table td{height:34px;padding:0 4px;border-bottom:1px solid #e5e7eb;white-space:nowrap}
.planner-root .gantt-table td input{width:100%;border:1px solid transparent;background:transparent;padding:3px 4px;font-size:13px;color:#1e293b}
.planner-root .gantt-table td input:hover,.planner-root .gantt-table td input:focus{border-color:#94a3b8;background:#fff;outline:none}
.planner-root .gantt-table td.c{text-align:center;color:#475569}
.planner-root .gantt-table td.c input{text-align:center;width:48px}
.planner-root .gantt-table tbody tr:hover td{background:#f0f9ff}
.planner-root .gantt-table tr.selrow td{background:#dbeafe!important}
.planner-root .gantt-table tr.sum td{background:#f1f5f9;font-weight:700}
.planner-root .gantt-table tr.crit.leaf td:nth-child(2) input{color:#b91c1c;font-weight:600}
.planner-root .gantt-table input:disabled,.planner-root .l1 input:disabled{background:#f1f5f9;color:#64748b;cursor:not-allowed;border-color:transparent}
.planner-root .gantt-chart{position:absolute;top:0}
.planner-root .gantt-time-hd{position:sticky;top:0;height:44px;background:#e2e8f0;z-index:3;font-size:11px;color:#475569}
.planner-root .gantt-time-hd div{position:absolute;top:0;height:44px;border-left:1px solid #cbd5e1;padding:3px;line-height:1.25;overflow:hidden}
.planner-root .gantt-chart-body{position:relative}
.planner-root .nm{display:flex;align-items:center}
.planner-root .tg{width:18px;border:0;background:none;padding:0;color:#475569;font-size:13px;flex:none;cursor:pointer}
.planner-root .ic{border:0;background:none;padding:0 4px;font-weight:700;font-size:13px;cursor:pointer}
.planner-root .ic.a{color:#1e40af}
.planner-root .ic.d{color:#dc2626}
.planner-root .dot{display:inline-block;width:8px;height:8px;border-radius:50%;margin-right:5px}
.planner-root .dot.done{background:#16a34a}
.planner-root .dot.prog{background:#3b82f6}
.planner-root .dot.todo{background:#94a3b8}
.planner-root .planner-hd{position:sticky;top:0;height:44px;background:#e2e8f0;z-index:3;font-size:11px;color:#475569}
.planner-root .planner-hd div{position:absolute;top:0;height:44px;border-left:1px solid #cbd5e1;padding:3px;line-height:1.25;overflow:hidden}
.planner-root .planner-grid{position:absolute;top:0;bottom:0;border-left:1px solid #eef2f7}
.planner-root .we{position:absolute;top:0;bottom:0;background:#eef2f7;opacity:.8}
.planner-root .planner-rs{position:absolute;left:0;right:0;height:34px;background:#f1f5f9;opacity:.7}
.planner-root .planner-today{position:absolute;top:0;bottom:0;width:2px;background:#f59e0b;z-index:1}
.planner-root .planner-today:before{content:"Today";position:absolute;top:0;left:3px;background:#f59e0b;color:#fff;font-size:10px;padding:0 4px;border-radius:2px}
.planner-root .planner-bar{position:absolute;height:22px;border-radius:4px;background:#94a3b8 linear-gradient(rgba(255,255,255,.2),rgba(0,0,0,.08));box-shadow:0 1px 2px rgba(0,0,0,.2);overflow:hidden;cursor:pointer}
.planner-root .planner-bar.prog{background-color:#3b82f6}
.planner-root .planner-bar.done{background-color:#16a34a}
.planner-root .planner-bar.crit{background-color:#ef4444}
.planner-root .planner-bar.sel{outline:2px solid #1d4ed8;outline-offset:1px}
.planner-root .planner-bar i{display:block;height:100%;background:rgba(0,0,0,.3)}
.planner-root .planner-bar.sum{height:12px;border-radius:0;background:#1e293b;box-shadow:none;clip-path:polygon(0 0,100% 0,100% 100%,calc(100% - 6px) 55%,6px 55%,0 100%)}
.planner-root .planner-bar.sum i{background:#64748b}
.planner-root .planner-bar span{position:absolute;left:6px;top:3px;color:#fff;font-size:11px;pointer-events:none}
.planner-root .planner-lbl{position:absolute;font-style:normal;font-size:11px;color:#334155;white-space:nowrap;pointer-events:none}
.planner-root .planner-toolbar button.v{padding:5px 12px;border:1px solid rgba(255,255,255,.4);background:rgba(255,255,255,.08);color:#fff;border-radius:5px;cursor:pointer;font-size:12px;font-weight:600}
.planner-root .planner-toolbar button.v.on{background:#1e40af;border-color:#1e40af}
.planner-root .l1-off{display:none}
.planner-root .l1-view{flex:1;overflow:hidden;background:#fff;display:flex;flex-direction:column}
/* The table's own scroller: horizontal for long schedules, vertical for
   long task lists. The title bar above it never scrolls out of view. */
.planner-root .l1-scroll{flex:1;overflow:auto}
.planner-root .l1-title{flex:none;display:flex;justify-content:space-between;align-items:baseline;gap:10px;background:#c8a8d6;color:#1e1b4b;padding:7px 12px;font-size:13px}
.planner-root .l1-title b{font-size:14px}
.planner-root .l1-title span{font-size:11.5px;color:#3b2a63}
.planner-root .l1-title em{font-style:normal;font-weight:700;font-size:11px;padding:2px 8px;border-radius:10px;margin-left:8px}
.planner-root .l1-title em.l1-locked{background:#1e1b4b;color:#fde68a}
.planner-root .l1-title em.l1-draft{background:#3b2a63;color:#e9d5ff}
.planner-root .l1 td.l1-delay.late{color:#b91c1c;font-weight:700}
.planner-root .l1 td.l1-delay.early{color:#16a34a;font-weight:700}
.planner-root .l1 input[type=date]{width:100%;min-width:118px;border:1px solid transparent;background:transparent;padding:2px 4px;font-size:12px;color:#1e293b}
.planner-root .l1 input[type=date]:hover,.planner-root .l1 input[type=date]:focus{border-color:#94a3b8;background:#fff;outline:none}
/* The table fills the view width; the Task description column is capped and
   long names scroll inside their cell instead of pushing the date columns
   off screen (client: descriptions complete AND dates fully visible). */
/* The table is wider than most screens, so .l1-scroll shows a horizontal
   scroller — Task description and the dates stay fully readable. */
/* A hard width matched to the sum of the declared column sizes (~1350px):
   fixed layout keeps the declared sizes and the table stops at its content
   width instead of stretching every column to the viewport — which used to
   fatten the Remarks cell into a gap before the Actions icons. Keep the
   width in step with the th values above; grow both if a column grows.
   Narrow screens still scroll: the .l1-scroll wrapper owns the horizontal
   scroll. */
.planner-root .l1 table, .planner-root table.l1{border-collapse:collapse;width:1350px;font-size:12.5px;color:#1e293b;table-layout:fixed}
.planner-root .l1 th,.planner-root .l1 td{overflow:hidden}
.planner-root .l1 thead th{position:sticky;top:0;background:#c9a9d8;color:#1e1b4b;text-align:left;padding:6px 6px;font-size:12px;font-weight:700;z-index:3;border-bottom:1px solid #b795c9}
/* Headers follow their data: the centred numeric / date / status cells
   get a centred caption, the text columns keep the left edge. */
.planner-root .l1 thead th:nth-child(3),
.planner-root .l1 thead th:nth-child(5),
.planner-root .l1 thead th:nth-child(6),
.planner-root .l1 thead th:nth-child(7),
.planner-root .l1 thead th:nth-child(8),
.planner-root .l1 thead th:nth-child(9),
.planner-root .l1 thead th:nth-child(10),
.planner-root .l1 thead th:nth-child(11),
.planner-root .l1 thead th:nth-child(13){text-align:center}
.planner-root .l1 td{padding:4px 6px;border-bottom:1px solid #dbe4f0;white-space:nowrap}
.planner-root .l1 td input{width:100%;border:1px solid transparent;background:transparent;padding:2px 4px;font-size:12.5px;color:#1e293b}
.planner-root .l1 td input:hover,.planner-root .l1 td input:focus{border-color:#94a3b8;background:#fff;outline:none}
.planner-root .l1 td.l1-c{text-align:center;color:#475569}
.planner-root .l1 td.l1-c input{text-align:center;width:52px}
.planner-root .l1 td.l1-c select{width:100%;border:1px solid #cbd5e1;background:#fff;font-size:12px;padding:2px 4px}
.planner-root .l1 tr.l1-phase{background:#e9e2f6;font-weight:700}
.planner-root .l1 tr.l1-phase td{border-bottom:1px solid #d5c8ea}
.planner-root .l1 tr.l1-task{background:#dbeafe}
.planner-root .l1 tr.l1-task:hover td{background:#cfe0fb}
.planner-root .l1-num b{font-size:12.5px}
.planner-root .l1 td.l1-num{padding-left:20px}
.planner-root .l1 thead th:nth-child(1){padding-left:20px}
.planner-root .planner-tip{padding:10px 4px 4px;color:#475569;font-size:12px;line-height:1.6}
.planner-root .planner-lg{display:flex;gap:14px;flex-wrap:wrap;margin-bottom:4px}
.planner-root .planner-lg span:before{content:"";display:inline-block;width:12px;height:8px;border-radius:2px;margin-right:5px;background:var(--c)}
/* Clickable KPI card (client spec 8) */
.planner-root .planner-card-btn{cursor:pointer}
.planner-root .planner-card-btn:hover{background:#eef4ff}
/* Column-width adjuster panel (client spec 7) */
.planner-root .colwidths{display:flex;gap:10px;flex-wrap:wrap;margin-top:8px}
.planner-root .colwidths label{font-size:11.5px;color:#334155;display:flex;align-items:center;gap:4px}
.planner-root .colwidths input{width:64px;padding:3px 5px;border:1px solid #cbd5e1;border-radius:4px;font-size:12px}
.planner-root .colwidths button.v{background:#fff;color:#64748b;border:1px solid #cbd5e1}
.planner-root .colwidths button.p{background:#1e40af;color:#fff;border:1px solid #1e40af}
.planner-root .planner-notice button{margin-left:8px;padding:2px 8px;border-radius:4px;font-size:11.5px;cursor:pointer;background:#1e40af;color:#fff;border:1px solid #1e40af}
/* Phase actuals are auto-derived, not editable (client spec 2) */
.planner-root .l1-actauto{font-style:italic;color:#475569;font-size:12px}
.planner-root .l1 .l1-actauto:before{content:"≈ "}
/* When a custom width is set, lock the table so widths hold */
.planner-root table.l1.l1-w{table-layout:fixed;width:auto;min-width:100%}
.planner-root table.l1.l1-w th,.planner-root table.l1.l1-w td{overflow:hidden;text-overflow:ellipsis}
.planner-root table.l1.l1-w td input{white-space:normal}
`;
