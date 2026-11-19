/**
 * Macro-level milestones, derived from an L1 planning schedule.
 *
 * Client rule: "Schedule milestones should reflect the L1 schedule
 * (macro level) derived from planning & tasks" — so every consumer that
 * shows schedule milestones (the register screen, the EPC dashboard
 * panel, the planner's own register sync) derives its rows from the top
 * level of the plan run through the engine, never from hand-typed dates.
 */
import { ComputeResult, compute, PTask } from './engine';
import { hydrate } from './plan';

export interface L1Milestone {
  name: string;
  /** The phase's planned finish (a milestone lands when the phase ends). */
  planned: string;
  /** Logged actual finish, when one exists. */
  forecast?: string;
  /** Engine roll-up of the phase's physical progress, 0–100. */
  progress: number;
  status: 'Not started' | 'In progress' | 'Slipped' | 'Completed';
}

/**
 * Macro milestones from an already-computed plan. The planner holds a live
 * ComputeResult, so it uses this directly instead of re-running the engine.
 */
export function milestonesFrom(res: ComputeResult): L1Milestone[] {
  return res.all
    .filter((t) => t.depth === 0)
    .map((t) => {
      const c = res.c.get(t.id)!;
      const day = (d: Date): string => d.toISOString().slice(0, 10);
      const forecast = t.ae ? new Date(t.ae) : undefined;
      const slipped = forecast && !Number.isNaN(forecast.getTime()) && forecast.getTime() > c.finish.getTime();
      const status: L1Milestone['status'] =
        c.pct >= 100 ? 'Completed' : slipped ? 'Slipped' : c.pct > 0 ? 'In progress' : 'Not started';
      return {
        name: t.name,
        planned: day(c.finish),
        forecast: forecast && !Number.isNaN(forecast.getTime()) ? day(forecast) : undefined,
        progress: c.pct,
        status,
      };
    });
}

/** Top-level phases of a plan tree, as macro milestones. */
export function deriveL1Milestones(roots: PTask[], startDate: string): L1Milestone[] {
  if (!roots.length) return [];
  let res;
  try {
    res = compute(roots, startDate);
  } catch {
    return [];
  }
  return milestonesFrom(res);
}

/** The freshest `project_planner` row's plan, as macro milestones. */
export function deriveFromPlannerRows(
  rows: Array<{ data: Record<string, unknown>; updatedAt?: string | null }>,
): L1Milestone[] {
  const row = [...rows].sort((a, b) => String(b.updatedAt ?? '').localeCompare(String(a.updatedAt ?? '')))[0];
  const json = row ? String(row.data.plan ?? '') : '';
  if (!json) return [];
  let roots: PTask[];
  try {
    roots = hydrate(json);
  } catch {
    return [];
  }
  return deriveL1Milestones(roots, String(row.data.startDate ?? ''));
}
