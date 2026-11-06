'use client';

import { useMemo } from 'react';

import type { CpmActivity, CpmResult } from '@/lib/services';

/**
 * PERT / network diagram of the project schedule.
 *
 * One node per CPM activity, an edge per predecessor link. Nodes sit on
 * levels (longest path from the start), edges run left to right. The
 * critical path is drawn red end to end; a node's total float is printed on
 * it so near-critical work is visible without a Gantt. Built from the same
 * CpmResult the Gantt panel reads, so the two views always agree.
 */
const NODE_W = 170;
const NODE_H = 74;
const COL_GAP = 70;
const ROW_GAP = 26;

interface PertViewProps {
  cpm: CpmResult;
}

interface Placed {
  a: CpmActivity;
  level: number;
  row: number;
  x: number;
  y: number;
}

function computeLevels(cpm: CpmResult): Map<string, number> {
  const byCode = new Map(cpm.activities.map((a) => [a.wbsCode, a]));
  const level = new Map<string, number>();
  // Iterative relaxation: levels are the longest predecessor chain, so
  // repeat passes until nothing moves. O(n^2) worst case, fine at schedule
  // size (hundreds of activities).
  let changed = true;
  while (changed) {
    changed = false;
    for (const a of cpm.activities) {
      const pred = a.predecessor ? byCode.get(a.predecessor) : undefined;
      if (!pred) {
        if (level.get(a.wbsCode) !== 0) {
          level.set(a.wbsCode, 0);
          changed = true;
        }
        continue;
      }
      const pl = level.get(pred.wbsCode);
      if (pl === undefined) continue;
      const next = pl + 1;
      if (next > (level.get(a.wbsCode) ?? -1)) {
        level.set(a.wbsCode, next);
        changed = true;
      }
    }
  }
  // Any activity whose predecessor is missing or cyclic stays unlevelled;
  // dump it at the last level so the diagram does not lose work.
  const maxKnown = Math.max(0, ...[...level.values()]);
  for (const a of cpm.activities) {
    if (!level.has(a.wbsCode)) level.set(a.wbsCode, maxKnown);
  }
  return level;
}

export function PertView({ cpm }: PertViewProps) {
  const layout = useMemo(() => {
    const levels = computeLevels(cpm);
    const byLevel = new Map<number, CpmActivity[]>();
    for (const a of cpm.activities) {
      const l = levels.get(a.wbsCode) ?? 0;
      byLevel.set(l, [...(byLevel.get(l) ?? []), a]);
    }
    const sortedLevels = [...byLevel.keys()].sort((x, y) => x - y);
    const placed: Placed[] = [];
    const byCode = new Map<string, Placed>();
    let maxRows = 0;
    for (const l of sortedLevels) {
      const rows = byLevel.get(l) ?? [];
      // Longest chain, so the critical path runs straight across the middle
      // instead of zig-zagging: sort by early start, critical first.
      rows.sort((x, y) => Number(x.isCritical) - Number(y.isCritical) || x.earlyStart - y.earlyStart);
      maxRows = Math.max(maxRows, rows.length);
      rows.forEach((a, i) => {
        const p: Placed = {
          a,
          level: l,
          row: i,
          x: l * (NODE_W + COL_GAP),
          y: i * (NODE_H + ROW_GAP),
        };
        placed.push(p);
        byCode.set(a.wbsCode, p);
      });
    }
    const width = (sortedLevels.length) * (NODE_W + COL_GAP) + 20;
    const height = Math.max(1, maxRows) * (NODE_H + ROW_GAP) + 20;
    return { placed, byCode, width, height, levelCount: sortedLevels.length };
  }, [cpm]);

  const critical = useMemo(
    () => new Set(cpm.criticalPath.map((a) => a.wbsCode)),
    [cpm],
  );

  if (cpm.activities.length === 0) {
    return (
      <p className="m-0 text-[12.5px]" style={{ color: 'var(--muted)' }}>
        No activities to draw. Add tasks with predecessor links, then the network appears.
      </p>
    );
  }

  return (
    <div style={{ overflowX: 'auto', maxHeight: 560, overflowY: 'hidden' }}>
      <svg width={layout.width} height={layout.height} style={{ display: 'block' }}>
        <defs>
          <marker id="pert-arrow" markerWidth="7" markerHeight="7" refX="6" refY="3" orient="auto">
            <path d="M0,0 L7,3 L0,6 z" fill="var(--muted)" />
          </marker>
          <marker id="pert-arrow-crit" markerWidth="7" markerHeight="7" refX="6" refY="3" orient="auto">
            <path d="M0,0 L7,3 L0,6 z" fill="#c2402f" />
          </marker>
        </defs>

        {/* Edges first, so nodes paint over them. */}
        {layout.placed.map((p) => {
          const pred = p.a.predecessor ? layout.byCode.get(p.a.predecessor) : undefined;
          if (!pred) return null;
          const isCrit = critical.has(p.a.wbsCode) && critical.has(pred.a.wbsCode);
          const x1 = pred.x + NODE_W;
          const y1 = pred.y + NODE_H / 2;
          const x2 = p.x;
          const y2 = p.y + NODE_H / 2;
          const mid = (x1 + x2) / 2;
          return (
            <path
              key={`e-${pred.a.wbsCode}-${p.a.wbsCode}`}
              d={`M ${x1} ${y1} C ${mid} ${y1}, ${mid} ${y2}, ${x2 - 4} ${y2}`}
              fill="none"
              stroke={isCrit ? '#c2402f' : 'var(--muted)'}
              strokeWidth={isCrit ? 2.4 : 1.2}
              opacity={isCrit ? 0.95 : 0.45}
              markerEnd={isCrit ? 'url(#pert-arrow-crit)' : 'url(#pert-arrow)'}
            />
          );
        })}

        {layout.placed.map((p) => {
          const crit = critical.has(p.a.wbsCode);
          return (
            <g key={p.a.wbsCode}>
              <rect
                x={p.x}
                y={p.y}
                width={NODE_W}
                height={NODE_H}
                rx={6}
                fill={crit ? '#fbe9e6' : 'var(--panel)'}
                stroke={crit ? '#c2402f' : 'var(--line)'}
                strokeWidth={crit ? 2 : 1}
              />
              <text x={p.x + 8} y={p.y + 17} style={{ font: '600 12px ui-monospace, monospace' }} fill="var(--ink)">
                {p.a.wbsCode}
              </text>
              <text x={p.x + 8} y={p.y + 34} style={{ font: '500 11px inherit' }} fill="var(--ink)">
                {p.a.description.length > 24 ? `${p.a.description.slice(0, 24)}…` : p.a.description}
              </text>
              <text x={p.x + 8} y={p.y + 52} style={{ font: '11px inherit' }} fill="var(--muted)">
                {p.a.duration}d · float {p.a.totalFloat}
              </text>
              <text x={p.x + 8} y={p.y + 66} style={{ font: '10.5px inherit' }} fill={crit ? '#c2402f' : 'var(--muted)'}>
                {crit ? 'Critical' : p.a.status || 'Open'}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}
