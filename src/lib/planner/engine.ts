/**
 * KEC Project Planner — scheduling engine.
 *
 * A pure port of the reference demo (KEC_Project_Planner_Demo.html) to typed,
 * side-effect-free functions. The rules implement the spec v3 §4 exactly:
 *
 *   - Expand dependencies to leaf level. A predecessor that is a summary is
 *     replaced by every leaf inside it. A task starts only after all of its
 *     predecessor's leaves are done ("Commissioning depends on Construction").
 *   - Earliest start ES(L) = 0 if it has no predecessor leaves, else the max
 *     over predecessor leaves Q of (ES(Q) + dur(Q)). Dates = project start +
 *     ES days; finish = start + dur − 1 day.
 *   - Backward pass gives latest finish; slack = LF − dur − ES; a leaf with
 *     slack 0 is critical. Summaries are never coloured critical.
 *   - Summary roll-up: start = earliest child start, finish = latest child
 *     finish, days = span, % = leaf-% weighted by leaf duration.
 *
 * `compute()` is pure: it reads the tree, never mutates it (except the
 * caller-owned `wbs`/`depth`/`parent` pointers that the UI relies on), and
 * returns a fresh derived-value map so React can memoise on its inputs.
 */

/** Raw task node — the shape the UI edits. Computed fields live elsewhere. */
export interface PTask {
  id: number;
  name: string;
  /** Duration in days. Meaningful for leaves; ignored (recomputed) for phases. */
  dur: number;
  /** Percent complete 0–100. Leaf only; a phase's value is the weighted roll-up. */
  pct: number;
  /** Predecessor task ids (finish-to-start). May point at leaves or phases. */
  pred: number[];
  /** UI collapse state. */
  open: boolean;
  /** Free-text remarks (the client schedule's Remarks column). */
  rem?: string;
  /**
   * Actuals (the client's hand-note: Actual Start / Actual Finish). ISO
   * yyyy-mm-dd or '' — editable even after the baseline is frozen. Delay is
   * derived: actual finish − plan finish, in days.
   */
  as?: string;
  ae?: string;
  /**
   * Earliest-start offset in days from the project start. The client's L1
   * sheets stagger phases by "Start Month" (task 7 starts month 5); the
   * importer converts that to days. 0/undefined = start as CPM dictates.
   */
  off?: number;
  /** Child tasks. Empty = leaf; non-empty = summary/phase. */
  kids: PTask[];
  /** Back-pointer, maintained by the tree helpers. null for top-level. */
  parent: PTask | null;
  /** Assigned during compute()'s walk. */
  wbs?: string;
  depth?: number;
}

/** Everything compute() derives for a single task. */
export interface CTask {
  wbs: string;
  depth: number;
  /** This task's leaf ids — [this] for a leaf, all descendant leaves for a phase. */
  lv: number[];
  /** Earliest start, in days from project start. */
  es: number;
  /** Latest finish, in days from project start. */
  lf: number;
  /** Critical (leaf, slack 0). Summaries always false. */
  crit: boolean;
  /** Effective duration: leaf dur, or the phase span (min 1). */
  dur: number;
  /** Effective percent: leaf pct, or the phase roll-up. */
  pct: number;
  start: Date;
  finish: Date;
  isPhase: boolean;
}

export interface PlannerStats {
  phases: number;
  tasks: number;
  start: Date;
  finish: Date;
  duration: number;
  progress: number;
  critical: number;
}

export interface ComputeResult {
  /** Derived values for every task (collapsed or not), keyed by task id. */
  c: Map<number, CTask>;
  /** Every task in the walk (visible or not). */
  all: PTask[];
  /** Task objects by id, for dependency lookups. */
  taskById: Map<number, PTask>;
  /** Visible rows in render order, honouring open/collapse. */
  visible: PTask[];
  /** Project length in days from start (max over leaves of ES+dur). */
  end: number;
  p0: Date;
  leaves: PTask[];
  stats: PlannerStats;
}

const DAY = 86_400_000;

let NID = 1;

/** Fresh leaf node. Durations are days (min 1); pct 0–100. */
export function newTask(name: string, dur = 1, pct = 0): PTask {
  return { id: NID++, name, dur: Math.max(1, dur), pct, pred: [], open: true, rem: '', kids: [], parent: null };
}

/** True when `desc` is `anc` itself or lives inside `anc`'s subtree. */
export function isInside(anc: PTask, desc: PTask): boolean {
  let x: PTask | null = desc;
  while (x) {
    if (x === anc) return true;
    x = x.parent;
  }
  return false;
}

/**
 * Set the next id. Call after loading a tree that already has ids (sample,
 * saved plan) so fresh nodes never collide.
 */
export function setNextId(next: number): void {
  NID = next;
}

/** The spec's sample dataset: 5 phases, 20 leaves. */
const SAMPLE: [string, string, number, string[], number][] = [
  ['1', 'Initiation & Approvals', 0, [], 0],
  ['1.1', 'Kickoff meeting', 3, [], 100],
  ['1.2', 'Board & budget approval', 5, ['1.1'], 100],
  ['1.3', 'Site survey & soil study', 7, ['1.1'], 100],
  ['2', 'Engineering & Permits', 0, [], 0],
  ['2.1', 'Process design', 10, ['1.3'], 90],
  ['2.2', 'Detailed drawings', 12, ['2.1'], 60],
  ['2.3', 'Environmental clearance', 25, ['1.2'], 50],
  ['2.4', 'Pollution board NOC', 14, ['2.3'], 20],
  ['3', 'Procurement', 0, [], 0],
  ['3.1', 'Digester & gas system order', 5, ['2.1'], 60],
  ['3.2', 'Digester manufacturing', 35, ['3.1'], 20],
  ['3.3', 'Compressor & cascade supply', 28, ['3.1'], 10],
  ['3.4', 'Delivery to site', 7, ['3.2', '3.3'], 0],
  ['4', 'Construction', 0, [], 0],
  ['4.1', 'Civil & foundations', 18, ['2.2', '2.4'], 20],
  ['4.2', 'Equipment installation', 15, ['3.4', '4.1'], 0],
  ['4.3', 'Piping & electrical', 14, ['4.2'], 0],
  ['5', 'Commissioning', 0, ['4'], 0],
  ['5.1', 'Testing', 8, [], 0],
  ['5.2', 'Gas quality trials', 6, ['5.1'], 0],
  ['5.3', 'Handover & training', 4, ['5.2'], 0],
];

export interface SamplePlan {
  roots: PTask[];
  /** Project start, ISO yyyy-mm-dd (25 days back, matching the demo). */
  startDate: string;
}

/** Builds the sample tree. Ids restart from 1 so re-loading is stable. */
export function loadSample(): SamplePlan {
  NID = 1;
  const roots: PTask[] = [];
  const byWbs = new Map<string, PTask>();
  const pending: [PTask, string[]][] = [];

  for (const [wbs, name, dur, preds, pct] of SAMPLE) {
    const node = newTask(name, dur || 1, pct);
    byWbs.set(wbs, node);
    pending.push([node, preds]);
    const parts = wbs.split('.');
    if (parts.length === 1) {
      node.parent = null;
      roots.push(node);
    } else {
      const parent = byWbs.get(parts.slice(0, -1).join('.'));
      node.parent = parent ?? null;
      (parent?.kids ?? roots).push(node);
    }
  }

  for (const [node, preds] of pending) {
    node.pred = preds
      .map((w) => byWbs.get(w)?.id)
      .filter((x): x is number => x !== undefined);
  }

  const start = new Date();
  start.setDate(start.getDate() - 25);
  return { roots, startDate: start.toISOString().slice(0, 10) };
}

/**
 * Compute every derived value for the tree.
 *
 * Mutates only the caller-owned `wbs`/`depth`/`parent` fields during the
 * walk (the UI treats those as part of node state); all scheduling values
 * land in the fresh `c` map. Pass the ISO project-start day.
 */
export function compute(roots: PTask[], startDate: string): ComputeResult {
  // 1. Walk: depth, parent, wbs; index every task.
  const all: PTask[] = [];
  const byId = new Map<number, PTask>();
  const walk = (list: PTask[], depth: number, parent: PTask | null): void => {
    for (let i = 0; i < list.length; i += 1) {
      const t = list[i];
      t.depth = depth;
      t.parent = parent;
      t.wbs = (parent?.wbs ? `${parent.wbs}.` : '') + String(i + 1);
      all.push(t);
      byId.set(t.id, t);
      walk(t.kids, depth + 1, t);
    }
  };
  walk(roots, 0, null);

  // 2. Leaf set per task: [self] for a leaf, all descendant leaf ids for a phase.
  const lvOf = (t: PTask): number[] => (t.kids.length ? t.kids.flatMap(lvOf) : [t.id]);

  // 3. Expand each leaf's predecessors to leaf level. A link to your own
  //    ancestor/descendant is a no-op (the spec forbids it; the demo ignores
  //    bad entries, and so do we here).
  const leaves = all.filter((t) => t.kids.length === 0);
  const pl = new Map<number, Set<number>>();
  for (const l of leaves) {
    const set = new Set<number>();
    for (let a: PTask | null = l; a; a = a.parent) {
      for (const pid of a.pred) {
        const q = byId.get(pid);
        if (q && !isInside(q, l)) for (const leaf of lvOf(q)) set.add(leaf);
      }
    }
    pl.set(l.id, set);
  }

  // 4. Earliest start: memoised DFS over the leaf predecessor graph.
  const es = new Map<number, number>();
  const visiting = new Set<number>();
  const calcEs = (id: number): number => {
    if (es.has(id)) return es.get(id)!;
    if (visiting.has(id)) return 0; // cycle guard: break the loop, keep a value
    visiting.add(id);
    // The node's own offset (imported "Start Month") floors its start; the
    // predecessor chain can push it later, never earlier.
    let s = byId.get(id)?.off ?? 0;
    for (const q of pl.get(id) ?? []) s = Math.max(s, calcEs(q) + (byId.get(q)?.dur ?? 0));
    visiting.delete(id);
    es.set(id, s);
    return s;
  };
  leaves.forEach((l) => calcEs(l.id));

  const end = Math.max(1, ...leaves.map((l) => (es.get(l.id) ?? 0) + l.dur));

  // 5. Backward pass: latest finish from the successor graph.
  const succOf = new Map<number, Set<number>>();
  for (const l of leaves) {
    for (const q of pl.get(l.id) ?? []) {
      if (!succOf.has(q)) succOf.set(q, new Set());
      succOf.get(q)!.add(l.id);
    }
  }
  const lf = new Map<number, number>();
  leaves.forEach((l) => lf.set(l.id, end));
  for (let k = 0; k < leaves.length; k += 1) {
    for (const l of leaves) {
      for (const s of succOf.get(l.id) ?? []) {
        lf.set(l.id, Math.min(lf.get(l.id)!, (lf.get(s) ?? end) - (byId.get(s)?.dur ?? 0)));
      }
    }
  }

  // An empty or unparseable start date falls back to today, else every
  // computed Start/Finish becomes "Invalid Date".
  const parsed = new Date(startDate ? `${startDate}T00:00:00` : 'now');
  const p0 = Number.isNaN(parsed.getTime()) ? new Date() : parsed;

  // 6. Critical leaves: slack = LF − dur − ES ≤ 0.
  const crit = new Set<number>();
  for (const l of leaves) {
    if ((lf.get(l.id) ?? end) - l.dur - (es.get(l.id) ?? 0) <= 0) crit.add(l.id);
  }

  // 7. Assemble the derived map: leaves get crit/slack, summaries roll up.
  const c = new Map<number, CTask>();
  for (const t of all) {
    if (t.kids.length) {
      const ids = t.kids.flatMap(lvOf);
      const esMin = Math.min(...ids.map((id) => es.get(id) ?? 0));
      const span = Math.max(...ids.map((id) => (es.get(id) ?? 0) + (byId.get(id)?.dur ?? 0))) - esMin;
      const dur = Math.max(span, 1);
      const w = ids.reduce((a, id) => a + (byId.get(id)?.dur ?? 0), 0);
      const pct = w ? Math.round(ids.reduce((a, id) => a + (byId.get(id)?.dur ?? 0) * (byId.get(id)?.pct ?? 0), 0) / w) : 0;
      // The summary's Late Finish comes from its most constrained child (the
      // child LF that the summary must not pass), so float = lf - es - dur
      // shows the phase's real slack instead of always 0.
      const lfMax = Math.max(...ids.map((id) => lf.get(id) ?? end));
      c.set(t.id, {
        wbs: t.wbs!, depth: t.depth!, lv: ids,
        es: esMin, lf: lfMax, crit: false, dur, pct,
        start: new Date(p0.getTime() + esMin * DAY),
        finish: new Date(p0.getTime() + (esMin + dur - 1) * DAY),
        isPhase: true,
      });
    } else {
      const e = es.get(t.id) ?? 0;
      c.set(t.id, {
        wbs: t.wbs!, depth: t.depth!, lv: [t.id],
        es: e, lf: lf.get(t.id) ?? end, crit: crit.has(t.id),
        dur: t.dur, pct: t.pct,
        start: new Date(p0.getTime() + e * DAY),
        finish: new Date(p0.getTime() + (e + t.dur - 1) * DAY),
        isPhase: false,
      });
    }
  }

  // 8. Visible rows honouring collapse.
  const visible: PTask[] = [];
  const collectVisible = (list: PTask[]): void => {
    for (const t of list) {
      visible.push(t);
      if (t.open && t.kids.length) collectVisible(t.kids);
    }
  };
  collectVisible(roots);

  // 9. Stats.
  const leafIds = leaves.map((l) => l.id);
  const totalDur = leafIds.reduce((a, id) => a + (byId.get(id)?.dur ?? 0), 0);
  const weighted = leafIds.reduce((a, id) => a + (byId.get(id)?.dur ?? 0) * (byId.get(id)?.pct ?? 0), 0);

  return {
    c,
    all,
    taskById: byId,
    visible,
    end,
    p0,
    leaves,
    stats: {
      phases: roots.length,
      tasks: leaves.length,
      start: p0,
      finish: new Date(p0.getTime() + (end - 1) * DAY),
      duration: end,
      progress: totalDur ? weighted / totalDur : 0,
      critical: leaves.filter((l) => crit.has(l.id)).length,
    },
  };
}
