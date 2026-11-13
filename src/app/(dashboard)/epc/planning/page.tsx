'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { Button, Notice, PageHead } from '@/components/ui';
import { compute, loadSample, newTask, PTask, setNextId } from '@/lib/planner/engine';
import { importScheduleGrid } from '@/lib/planner/import';
import { parseXlsxGrid, XlsxParseError } from '@/lib/xlsx-parse';
import { projects, records } from '@/lib/services';
import type { ProjectOption } from '@/lib/services';
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

// ── tree ↔ flat-json (the 'plan' field of the saved record) ─────────────

interface PlanNode {
  id: number;
  p: number | null;
  name: string;
  dur: number;
  pct: number;
  pred: number[];
  open: boolean;
  rem?: string;
}

function serialize(roots: PTask[]): string {
  const out: PlanNode[] = [];
  const walk = (list: PTask[]): void => {
    for (const t of list) {
      out.push({ id: t.id, p: t.parent?.id ?? null, name: t.name, dur: t.dur, pct: t.pct, pred: [...t.pred], open: t.open, rem: t.rem ?? '' });
      walk(t.kids);
    }
  };
  walk(roots);
  return JSON.stringify(out);
}

function hydrate(json: string): PTask[] {
  const nodes: PlanNode[] = JSON.parse(json) as PlanNode[];
  const byId = new Map<number, PTask>();
  const roots: PTask[] = [];
  for (const n of nodes) {
    const t: PTask = { id: n.id, name: n.name, dur: Math.max(1, n.dur), pct: n.pct, pred: [...n.pred], open: n.open, rem: n.rem ?? '', kids: [], parent: null };
    byId.set(n.id, t);
    if (n.p === null || !byId.has(n.p)) roots.push(t);
  }
  for (const n of nodes) {
    const t = byId.get(n.id)!;
    if (n.p !== null) {
      const parent = byId.get(n.p);
      if (parent) {
        t.parent = parent;
        parent.kids.push(t);
      }
    }
  }
  setNextId(nodes.length ? Math.max(...nodes.map((n) => n.id)) + 1 : 1);
  return roots;
}

// ── helpers ───────────────────────────────────────────────────────────────

function Card({ label, value }: { label: string; value: React.ReactNode }): React.JSX.Element {
  return (
    <div className="planner-card">
      {label}
      <b>{value}</b>
    </div>
  );
}

const fmt = (d: Date): string => d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: '2-digit' });
const st = (pct: number): string => (pct >= 100 ? 'done' : pct > 0 ? 'prog' : 'todo');

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
  const [msg, setMsg] = useState<string | null>(null);
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const readyRef = useRef(false); // true only after the plan load for the current project finished

  const leftRef = useRef<HTMLDivElement>(null);
  const rightRef = useRef<HTMLDivElement>(null);
  const l1Ref = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const bump = useCallback((): void => setRev((r) => r + 1), []);

  // One engine pass per change.
  const res = useMemo(() => {
    if (roots.length === 0) return null;
    return compute(roots, startDate);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roots, startDate, rev]);

  // ── load the sample on first mount so the screen is never empty ───────

  const loadSampleData = useCallback((): void => {
    const s = loadSample();
    setRoots(s.roots);
    setStartDate(s.startDate);
    setPlanRowId(null);
    setPlanName('Sample (spec §9)');
    setSel(0);
    setSaveState('idle');
    bump();
  }, [bump]);

  useEffect(() => {
    loadSampleData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
        } else {
          // No saved plan for this project yet: start from the spec sample.
          loadSampleData();
        }
        setSaveState('idle');
        setMsg(null);
      } catch {
        if (!cancelled) {
          setSavedPlans([]);
          readyRef.current = true;
          loadSampleData();
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
    const phase = newTask('Phase 1', 1, 0);
    phase.kids.push(newTask('Task 1.1', 5, 0));
    setRoots([phase]);
    setPlanRowId(null);
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
        setMsg('Pick a project first — a plan belongs to a project.');
        return;
      }
      const body: Record<string, unknown> = {
        data: {
          name: planName,
          startDate,
          plan: serialize(roots),
          project: projectId,
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
    } catch (err) {
      setSaveState('error');
      if (!silent) {
        setMsg(`Save failed: ${err instanceof Error ? err.message : 'unknown error'}. If the register is not seeded, push the backend seed and restart it.`);
      }
    }
  }, [planName, planRowId, projectId, res, roots, startDate]);

  /** Read the client's .xlsx/.csv L1 schedule into the live tree. */
  const importExcel = async (file: File): Promise<void> => {
    setMsg(null);
    try {
      const buf = await file.arrayBuffer();
      const ext = (file.name.split('.').pop() ?? '').toLowerCase();
      let grid: string[][];
      if (ext === 'csv' || ext === 'tsv' || ext === 'txt') {
        const text = await file.text();
        const delim = text.includes('\t') ? '\t' : ',';
        grid = text
          .split(/\r?\n/)
          .filter((l) => l.trim())
          .map((l) => l.split(delim).map((c) => c.replace(/^"|"$/g, '').trim()));
      } else {
        grid = await parseXlsxGrid(buf);
      }
      const res2 = importScheduleGrid(grid);
      if (res2.roots.length === 0) {
        setMsg(`Import found no tasks. ${res2.skipped.slice(0, 3).join(' ') || 'Header needs a Task-number column and a Descriptions column.'}`);
        return;
      }
      setRoots(res2.roots);
      setPlanRowId(null);
      setPlanName(`Imported: ${file.name}`);
      setSel(0);
      setView('l1');
      const warns = res2.skipped.length ? ` ${res2.skipped.length} row${res2.skipped.length > 1 ? 's' : ''} had issues.` : '';
      setMsg(`Imported ${res2.phases} phase${res2.phases !== 1 ? 's' : ''} and ${res2.tasks} task${res2.tasks !== 1 ? 's' : ''} from ${file.name}.${warns}`);
      setSaveState('idle');
      bump();
    } catch (err) {
      setMsg(`Import failed: ${err instanceof XlsxParseError ? err.message : err instanceof Error ? err.message : 'unknown error'}. For .xlsx re-save as Microsoft Excel (.xlsx); legacy .xls is not supported.`);
    }
  };

  // ── auto-save: every edit lands in the register after a short debounce ─
  useEffect(() => {
    const t = setTimeout(() => {
      if (readyRef.current && planRowId !== null && projectId) void doSave(true);
    }, 1200);
    return () => clearTimeout(t);
  }, [doSave, rev, planRowId]);

  // ── table edits ────────────────────────────────────────────────────────

  const upName = (t: PTask, v: string): void => {
    const name = v.trim();
    if (!name) return;
    t.name = name;
    setSaveState('idle');
    bump();
  };

  const upNum = (t: PTask, key: 'dur' | 'pct', v: number): void => {
    if (t.kids.length) return;
    t[key] = key === 'dur' ? Math.max(1, Math.round(v) || 1) : Math.min(100, Math.max(0, Math.round(v) || 0));
    setSaveState('idle');
    bump();
  };

  const upPred = (t: PTask, wbsText: string): void => {
    if (!res) return;
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

  const addSub = (t: PTask): void => {
    const idx = t.kids.length + 1;
    const child = newTask(`Task ${wbsOf(t)}.${idx}`, 5, 0);
    t.kids.push(child);
    t.open = true;
    setFocusId(child.id);
    setSaveState('idle');
    bump();
  };

  const addPhase = (): void => {
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
      if (view === 'l1') {
        if (l1Ref.current) l1Ref.current.scrollTop = l1Ref.current.scrollHeight;
      } else {
        if (leftRef.current) leftRef.current.scrollTop = leftRef.current.scrollHeight;
        if (rightRef.current) rightRef.current.scrollTop = rightRef.current.scrollHeight;
      }
    });
  };

  const del = (t: PTask): void => {
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

  /** Auto-focus the name input of the row just added. */
  const [focusId, setFocusId] = useState(0);

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

  /** Status ⇄ progress: Completed = 100, In Progress = 50, Pending = 0. */
  const statusOf = (pct: number): string => (pct >= 100 ? 'Completed' : pct > 0 ? 'In Progress' : 'Pending');
  const setStatus = (t: PTask, v: string): void => {
    upNum(t, 'pct', v === 'Completed' ? 100 : v === 'In Progress' ? 50 : 0);
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
  const DAY = 86_400_000;
  const visible = res?.visible ?? [];
  const end = res?.end ?? 1;
  const p0 = res?.p0 ?? new Date();
  const days = end + 16;
  const W = days * dw;

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
  const ix: Record<number, number> = {};
  visible.forEach((t, i) => {
    ix[t.id] = i;
  });

  visible.forEach((t, i) => {
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
      const q = visible[ix[pid]];
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
                <select value={dw} onChange={(e) => setDw(Number(e.target.value))}>
                  <option value="26">Days</option>
                  <option value="12">Weeks</option>
                  <option value="5">Months</option>
                </select>
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
            L1 table
          </button>
          <button type="button" className={view === 'gantt' ? 'v on' : 'v'} onClick={() => setView('gantt')}>
            Gantt
          </button>
          <button type="button" onClick={loadSampleData}>Load sample</button>
          {view === 'gantt' ? (
            <>
              <button type="button" onClick={() => setAllOpen(true)}>Expand all</button>
              <button type="button" onClick={() => setAllOpen(false)}>Collapse all</button>
            </>
          ) : null}
        </div>
      </div>

      {msg ? (
        <div className="planner-notice">
          {msg}
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
          <Card label="Critical tasks" value={stats.critical} />
        </div>
      ) : null}

      <div className="planner-wrap">
        <div
          className={`planner-left${view === 'l1' ? ' l1-off' : ''}`}
          ref={leftRef}
          onScroll={() => {
            if (rightRef.current && leftRef.current) rightRef.current.scrollTop = leftRef.current.scrollTop;
          }}
        >
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
              {visible.map((t) => {
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
                    <td className="c">
                      <button type="button" className="ic a" title="Add subtask" onClick={() => addSub(t)}>
                        +
                      </button>
                      <button type="button" className="ic d" title="Delete (with subtasks)" onClick={() => del(t)}>
                        ✕
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {view === 'l1' ? (
          <div className="l1-view" ref={l1Ref}>
            {stats ? (
              <div className="l1-title">
                <b>{allProjects.find((p) => p.id === projectId)?.name ?? planName}</b>
                <span>Level-1, Overall Project Schedule · {fmt(stats.start)} → {fmt(stats.finish)} · {stats.duration} days</span>
              </div>
            ) : null}
            <table className="l1">
              <thead>
                <tr>
                  <th style={{ width: 64 }}>Task</th>
                  <th>Descriptions</th>
                  <th style={{ width: 82 }}>Duration (days)</th>
                  <th style={{ width: 118 }}>Dependencies</th>
                  <th style={{ width: 64 }}>Float / Slack</th>
                  <th style={{ width: 78 }}>Start</th>
                  <th style={{ width: 78 }}>End</th>
                  <th style={{ width: 88 }}>Status</th>
                  <th style={{ width: 140 }}>Remarks</th>
                  <th style={{ width: 40 }} />
                </tr>
              </thead>
              <tbody>
                {visible.map((t) => {
                  if (!res) return null;
                  const c = res.c.get(t.id)!;
                  const s = t.kids.length > 0;
                  const slack = Math.max(0, c.lf - c.es - c.dur + 1);
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
                            onBlur={(e) => upNum(t, 'dur', Number(e.target.value) || 1)}
                          />
                        )}
                      </td>
                      <td>
                        <input
                          key={`L1p${t.id}:${t.pred.join(',')}`}
                          placeholder="—"
                          defaultValue={depText(t)}
                          onBlur={(e) => upDepL1(t, e.target.value)}
                        />
                      </td>
                      <td className="l1-c">{s ? c.dur > 1 ? slack : '—' : slack}</td>
                      <td className="l1-c">{fmt(c.start)}</td>
                      <td className="l1-c">{fmt(c.finish)}</td>
                      <td className="l1-c">
                        {s ? c.pct + '% done' : (
                          <select
                            key={`L1s${t.id}:${t.pct}`}
                            value={statusOf(t.pct)}
                            onChange={(e) => setStatus(t, e.target.value)}
                          >
                            <option>Pending</option>
                            <option>In Progress</option>
                            <option>Completed</option>
                          </select>
                        )}
                      </td>
                      <td>
                        <input
                          key={`L1r${t.id}:${t.rem ?? ''}`}
                          placeholder="—"
                          defaultValue={t.rem ?? ''}
                          onBlur={(e) => upRem(t, e.target.value)}
                        />
                      </td>
                      <td className="l1-c">
                        {!s ? (
                          <button type="button" className="ic a" title="Add subtask" onClick={() => addSub(t)}>
                            +
                          </button>
                        ) : null}
                        <button type="button" className="ic d" title="Delete (with subtasks)" onClick={() => del(t)}>
                          ✕
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : null}

        <div
          className={`planner-right${view === 'l1' ? ' l1-off' : ''}`}
          ref={rightRef}
          onScroll={() => {
            if (leftRef.current && rightRef.current) leftRef.current.scrollTop = rightRef.current.scrollTop;
          }}
        >
          <div className="planner-hd" style={{ width: W }}>
            {headEls}
          </div>
          <div style={{ position: 'relative', width: W, height: visible.length * ROW }}>
            {weekEls}
            {gridEls}
            {rowStripe}
            {bars}
            {labels}
            {tx >= 0 && tx <= W ? <div className="planner-today" style={{ left: tx }} /> : null}
            <svg style={{ position: 'absolute', left: 0, top: 0, pointerEvents: 'none' }} width={W} height={Math.max(visible.length * ROW, 44)}>
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
.planner-root .planner-notice{margin:8px 0;padding:8px 12px;border-radius:6px;background:#fef2f2;color:#b91c1c;border:1px solid #fecaca;font-size:12.5px}
.planner-root .planner-wrap{display:flex;background:#fff;border-radius:8px;box-shadow:0 1px 3px rgba(0,0,0,.12);overflow:hidden;height:calc(100vh - 360px);min-height:380px}
.planner-root .planner-left{flex:none;width:610px;overflow:auto;border-right:2px solid #cbd5e1}
.planner-root .planner-right{flex:1;overflow:auto;position:relative}
.planner-root .planner-left table{border-collapse:collapse;width:100%;font-size:13px;color:#1e293b}
.planner-root .planner-left th{position:sticky;top:0;background:#e2e8f0;height:44px;text-align:left;padding:0 5px;z-index:2;font-size:12px;font-weight:600}
.planner-root .planner-left td{height:34px;padding:0 4px;border-bottom:1px solid #e5e7eb;white-space:nowrap}
.planner-root .planner-left td input{width:100%;border:1px solid transparent;background:transparent;padding:3px 4px;font-size:13px;color:#1e293b}
.planner-root .planner-left td input:hover,.planner-root .planner-left td input:focus{border-color:#94a3b8;background:#fff;outline:none}
.planner-root .planner-left td.c{text-align:center;color:#475569}
.planner-root .planner-left td.c input{text-align:center;width:48px}
.planner-root .planner-left tbody tr:hover td{background:#f0f9ff}
.planner-root .planner-left tr.selrow td{background:#dbeafe!important}
.planner-root .planner-left tr.sum td{background:#f1f5f9;font-weight:700}
.planner-root .planner-left tr.crit.leaf td:nth-child(2) input{color:#b91c1c;font-weight:600}
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
.planner-root .l1-view{flex:1;overflow:auto;background:#fff}
.planner-root .l1-title{display:flex;justify-content:space-between;align-items:baseline;gap:10px;background:#c8a8d6;color:#1e1b4b;padding:7px 12px;font-size:13px;position:sticky;top:0;z-index:4}
.planner-root .l1-title b{font-size:14px}
.planner-root .l1-title span{font-size:11.5px;color:#3b2a63}
.planner-root .l1 table, .planner-root table.l1{border-collapse:collapse;width:100%;font-size:12.5px;color:#1e293b}
.planner-root .l1 thead th{position:sticky;top:33px;background:#c9a9d8;color:#1e1b4b;text-align:left;padding:6px 6px;font-size:12px;font-weight:700;z-index:3;border-bottom:1px solid #b795c9}
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
.planner-root .planner-tip{padding:10px 4px 4px;color:#475569;font-size:12px;line-height:1.6}
.planner-root .planner-lg{display:flex;gap:14px;flex-wrap:wrap;margin-bottom:4px}
.planner-root .planner-lg span:before{content:"";display:inline-block;width:12px;height:8px;border-radius:2px;margin-right:5px;background:var(--c)}
`;
