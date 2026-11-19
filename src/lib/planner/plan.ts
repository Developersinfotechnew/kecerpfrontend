/**
 * Tree ↔ flat-json for the `plan` field of a `project_planner` record.
 * Shared by the planner screen (save/load/import) and any consumer that
 * wants to read a stored plan — e.g. the EPC dashboard's milestone panel,
 * which derives its macro-level schedule from the L1 plan instead of a
 * hand-kept register.
 */
import { PTask, setNextId } from './engine';

export interface PlanNode {
  id: number;
  p: number | null;
  name: string;
  dur: number;
  pct: number;
  pred: number[];
  open: boolean;
  rem?: string;
  as?: string;
  ae?: string;
  /** Start offset in days from project start (imported "Start Month"). */
  off?: number;
  /** Plan status: 'draft' editable, 'approved' baseline frozen. */
  st?: string;
}

export function serialize(roots: PTask[]): string {
  const out: PlanNode[] = [];
  const walk = (list: PTask[]): void => {
    for (const t of list) {
      out.push({ id: t.id, p: t.parent?.id ?? null, name: t.name, dur: t.dur, pct: t.pct, pred: [...t.pred], open: t.open, rem: t.rem ?? '', as: t.as ?? '', ae: t.ae ?? '', off: t.off ?? 0 });
      walk(t.kids);
    }
  };
  walk(roots);
  return JSON.stringify(out);
}

export function hydrate(json: string): PTask[] {
  const nodes: PlanNode[] = JSON.parse(json) as PlanNode[];
  const byId = new Map<number, PTask>();
  const roots: PTask[] = [];
  for (const n of nodes) {
    const t: PTask = { id: n.id, name: n.name, dur: Math.max(1, n.dur), pct: n.pct, pred: [...n.pred], open: n.open, rem: n.rem ?? '', as: n.as ?? '', ae: n.ae ?? '', off: n.off ? Math.round(n.off) : undefined, kids: [], parent: null };
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

/** The freshest `project_planner` row's plan json, or null. */
export function latestPlanJson(rows: { data: Record<string, unknown>; updatedAt?: string | null }[]): string | null {
  const sorted = [...rows].sort((a, b) => String(b.updatedAt ?? '').localeCompare(String(a.updatedAt ?? '')));
  for (const r of sorted) {
    const plan = String(r.data.plan ?? '');
    if (plan) return plan;
  }
  return null;
}
