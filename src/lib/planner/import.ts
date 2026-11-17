/**
 * Excel import for the planner — reads the client's own L1/L2 schedule files
 * ("Project Schedule, L1/L2") and turns them into the live task tree.
 *
 * A row is either a phase (Task = 1, 2, …) or a task under it (1.01, 2.03).
 * Dependencies are written "<number> - FS" and are resolved back to the tree
 * by their display number. Status maps to progress (Completed = 100,
 * In Progress = 50, Pending = 0); Remarks is kept on the task.
 */
import { PTask, newTask } from './engine';
import { excelSerialToISO } from '../xlsx-parse';

export interface ImportResult {
  roots: PTask[];
  phases: number;
  tasks: number;
  skipped: string[];
}

const cleanNum = (s: string): string =>
  s
    .split('.')
    .map((seg) => (seg === '0' ? '0' : seg.replace(/^0+(?=\d)/, '')))
    .join('.');

const depKeys = (raw: string): string[] =>
  raw
    .split(/[,;]+/)
    .map((s) => cleanNum(s.replace(/\s*[-–]?\s*(FS|SS|FF)\s*$/i, '').trim()))
    .filter(Boolean);

const statusToPct = (raw: string): number => {
  const s = raw.toLowerCase();
  if (s.includes('complet') || s.includes('done')) return 100;
  if (s.includes('progress') || s.includes('wip')) return 50;
  return 0;
};

/**
 * "Start Month (approx.)" → a day offset from project start. The client writes
 * a month position (3 = month 3) or, occasionally, a real Excel date serial
 * (e.g. 46266). A serial has no reference point to convert against, so it is
 * dropped (offset 0) and flagged; a month position becomes (m−1)·30 days.
 */
const parseStartOffset = (raw: string): { off: number; note: string | null } => {
  const t = raw.trim();
  if (!t) return { off: 0, note: null };
  const n = Number(t);
  if (Number.isNaN(n)) return { off: 0, note: `Start month "${t}" not a number — kept at project start` };
  if (n >= 20000) return { off: 0, note: `Start "${t}" looks like the date ${excelSerialToISO(n)}, not a month position — kept at project start` };
  return { off: Math.max(0, Math.round((n - 1) * 30)), note: null };
};

/** Header cell → role. Loose matching: the client sheet renames columns often. */
function roleOf(header: string): 'num' | 'name' | 'dur' | 'dep' | 'status' | 'rem' | 'off' | null {
  // (role set is the import's; "end month" is not read — finish is computed)
  const h = header.toLowerCase();
  // "Start Month (approx.)" staggers the schedule — the client's own way of
  // saying when each phase starts; mapped to a day offset (Finish is computed
  // from offset + duration, so no separate end column is read).
  if (/start/.test(h) && /month/.test(h)) return 'off';
  if (/sr|task|no\.?\s*$/.test(h) && !/descript/.test(h)) return 'num';
  if (/activity|descript|work\s?scope|^name$|phase/.test(h)) return 'name';
  if (/duration|dur/.test(h)) return 'dur';
  if (/depend|predecess|pred/.test(h)) return 'dep';
  if (/status/.test(h)) return 'status';
  if (/remark|note/.test(h)) return 'rem';
  return null;
}

/**
 * Find the header row (within the first 12 rows) that names both a task-number
 * column and a description column. Returns the row index + column indices by role.
 */
function findHeader(grid: string[][]): { roles: Record<string, number>; row: number } | null {
  for (let r = 0; r < Math.min(25, grid.length); r += 1) {
    const roles: Record<string, number> = {};
    grid[r].forEach((cell, c) => {
      const role = roleOf(String(cell ?? '').trim());
      if (role && !(role in roles)) roles[role] = c;
    });
    if ('num' in roles && 'name' in roles) return { roles, row: r };
  }
  return null;
}

const cell = (row: string[], idx: number): string => (idx < 0 ? '' : String(row[idx] ?? '').trim());

/**
 * Parse the client sheet into a task tree. Data starts the row after the
 * header. A top-level row (1, 2, …) with its own duration and no sub-rows is
 * imported as a leaf that keeps that duration (the client's L1 "Overall" style);
 * the engine only recomputes a duration when the node actually has children.
 * A second header block (the sheet's lower "Gantt Timeline" table) ends the run.
 */
export function importScheduleGrid(grid: string[][]): ImportResult {
  const found = findHeader(grid);
  const skipped: string[] = [];
  if (!found) {
    // Surface what we saw so a missed header is diagnosable, not a mystery:
    // the first few non-empty lines, truncated.
    const preview = grid
      .slice(0, 8)
      .map((r) => r.map((c) => c.slice(0, 14)).filter(Boolean).join(' | '))
      .filter(Boolean)
      .slice(0, 5)
      .join('  //  ');
    skipped.push(`No header row with task numbers + descriptions found. First lines: ${preview || '(sheet is empty)'}`);
    return { roots: [], phases: 0, tasks: 0, skipped };
  }
  const { roles, row: headerRow } = found;
  const col = (role: string): number => (role in roles ? roles[role] : -1);

  const byNum = new Map<string, PTask>();
  const roots: PTask[] = [];

  const addNode = (num: string, name: string, dur: number, depRaw: string, status: string, rem: string, off: number): void => {
    const node = newTask(name, dur, statusToPct(status));
    node.rem = rem;
    if (off > 0) node.off = off;
    byNum.set(num, node);
    const parentNum = num.includes('.') ? num.slice(0, num.lastIndexOf('.')) : null;
    if (parentNum) {
      const parent = byNum.get(parentNum);
      if (parent) {
        node.parent = parent;
        parent.kids.push(node);
      } else {
        skipped.push(`Row ${num}: parent "${parentNum}" not found — added as top-level`);
        node.parent = null;
        roots.push(node);
      }
    } else {
      node.parent = null;
      roots.push(node);
    }
    node.pred = depKeys(depRaw)
      .map((k) => byNum.get(k)?.id)
      .filter((x): x is number => x !== undefined && x !== node.id);
  };

  let phases = 0;
  let tasks = 0;
  let noDur = 0;

  for (let r = headerRow + 1; r < grid.length; r += 1) {
    const row = grid[r] ?? [];
    const num = cell(row, col('num'));
    const name = cell(row, col('name'));
    if (!num || !name) continue; // the second block's rows leave a column empty
    const isPhaseNum = /^\d+$/.test(num);
    if (!isPhaseNum && !/^\d+\.\d+$/.test(num)) {
      // First non-numeric "number" is the lower "Gantt Timeline" block header — stop.
      break;
    }

    const rawDur = Number(cell(row, col('dur')) || 0);
    // Phase-numbered rows ("1", "2") may have no duration of their own — they
    // become summaries whose span the engine derives from the sub-rows. Leaf
    // rows without a duration default to 1 day; count them and say it once.
    if (!(rawDur >= 1) && !isPhaseNum) noDur += 1;
    const dur = Math.max(1, Math.round(rawDur || 1));

    const startCol = cell(row, col('off'));
    const offRes = parseStartOffset(startCol);
    if (offRes.note) skipped.push(`Row ${num}: ${offRes.note}`);

    addNode(cleanNum(num), name, dur, cell(row, col('dep')), cell(row, col('status')), cell(row, col('rem')), offRes.off);
    if (isPhaseNum) phases += 1;
    else tasks += 1;
  }

  if (noDur > 0) skipped.push(`${noDur} row(s) had no duration — defaulted to 1 day`);

  return { roots, phases, tasks, skipped };
}
