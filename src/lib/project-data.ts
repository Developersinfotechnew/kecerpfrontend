'use client';

import { useCallback, useEffect, useState } from 'react';

import { projects as projectService } from './services';
import type { ProjectOption } from './services';

/**
 * Project data access for the screens.
 *
 * Replaces the old static dataset. A screen calls useProjectData once and gets
 * the projects its user may see, the first one as "current", and the two
 * derived values that several screens display: the risk tone and the schedule
 * comment.
 *
 * Both derived values are computed from the stored indices rather than being
 * typed in by hand, because a hand-written risk badge can disagree with the
 * numbers next to it. Deriving them makes disagreement impossible.
 */

/**
 * The display shape the screens were written against.
 *
 * The API stores a project as a flat record with stored indices. The screens
 * want a friendlier view: a status word, a risk tone and a schedule comment,
 * already resolved. `toView` derives those three so no screen has to.
 *
 * This also lets a screen keep its existing field names. `value` is the
 * contract value; `loc`, `type` and `open` are the shortened forms the cramped
 * portfolio cards use.
 */
export interface ProjectView {
  id: string;
  name: string;
  loc: string;
  client: string;
  status: 'Active' | 'Planning' | 'Delayed' | 'Completed';
  pm: string;
  value: number;
  budget: number;
  committed: number;
  actual: number;
  billed: number;
  collected: number;
  progress: number;
  start: string;
  end: string;
  type: string;
  open: number;
  risk: 'ok' | 'warn' | 'bad';
  spi: number;
  cpi: number;
  eac: number;
  cp: string;
}

export interface ProjectData {
  projects: ProjectView[];
  /** The first project in scope, or null when there are none. */
  current: ProjectView | null;
  loading: boolean;
  error: string | null;
  reload: () => Promise<void>;
}

export function useProjectData(): ProjectData {
  const [rows, setRows] = useState<ProjectOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setRows(await projectService.list());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load projects');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const projects = rows.map(toView);

  return {
    projects,
    current: projects[0] ?? null,
    loading,
    error,
    reload: load,
  };
}

/** Resolves a stored project into the view the screens render. */
export function toView(p: ProjectOption): ProjectView {
  return {
    id: p.id,
    name: p.name,
    loc: p.location,
    client: p.clientName,
    status: statusLabel(p) as ProjectView['status'],
    pm: p.pm,
    value: p.contractValue,
    budget: p.budget,
    committed: p.committed,
    actual: p.actual,
    billed: p.billed,
    collected: p.collected,
    progress: p.progress,
    start: formatMonth(p.startDate),
    end: formatMonth(p.endDate),
    type: `${p.technology} · ${p.capacityTpd} TPD`,
    open: p.openActions,
    risk: riskTone(p),
    spi: p.spi,
    cpi: p.cpi,
    eac: p.eac,
    cp: scheduleComment(p),
  };
}

/** "12 Feb 2026" from an ISO string, or an em dash when absent. */
function formatMonth(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}

/**
 * Formats a lakh figure for display: 1840 becomes "1,840 L".
 *
 * Amounts are stored as whole lakhs, so the display always carries the unit.
 * This keeps the column readable and stops a "1840" being read as ₹1,840.
 */
export function lakh(n: number): string {
  return `${n.toLocaleString('en-IN')} L`;
}

/** Short form the cramped cards use: 1840 L. */
export const L = lakh;

/** Percent of one value against another, rounded to one decimal. */
export function pct(part: number, whole: number): number {
  return whole === 0 ? 0 : Math.round((part / whole) * 1000) / 10;
}

/**
 * Risk tone from the cost and schedule indices.
 *
 * Either index below 0.9 is bad, either below 0.97 is a warning. Both healthy
 * is ok. Completed projects report ok regardless, since there is no variance
 * left to close.
 */
export function riskTone(p: ProjectOption): 'ok' | 'warn' | 'bad' {
  if (p.status === 'completed' || p.status === 'closed') return 'ok';
  if (p.spi < 0.9 || p.cpi < 0.9) return 'bad';
  if (p.spi < 0.97 || p.cpi < 0.97) return 'warn';
  return 'ok';
}

/** Schedule comment, derived from the variance against baseline. */
export function scheduleComment(p: ProjectOption): string {
  if (p.status === 'completed' || p.status === 'closed') return 'Complete';
  if (p.scheduleDays === 0) return 'On track';
  return `${p.scheduleDays} days late`;
}

/** Chip tone for a resolved status word. */
export function statusTone(status: string): 'ok' | 'warn' | 'bad' | 'info' | 'mute' {
  switch (status) {
    case 'Active':
      return 'ok';
    case 'Planning':
      return 'info';
    case 'Delayed':
      return 'bad';
    default:
      return 'mute';
  }
}

/** Display label for a stored status. */
export function statusLabel(p: ProjectOption): string {
  switch (p.status) {
    case 'planning':
      return 'Planning';
    case 'onhold':
      return 'Delayed';
    case 'completed':
      return 'Completed';
    case 'closed':
      return 'Closed';
    default:
      return 'Active';
  }
}
