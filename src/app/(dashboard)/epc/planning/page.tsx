'use client';

import { useCallback, useEffect, useState } from 'react';

import { Button, Chip, DataTable, Gantt, GanttLegend, Grid, Notice, PageHead, Panel } from '@/components/ui';
import { TaskForm } from '@/components/TaskForm';
import { useProjectData } from '@/lib/project-data';
import { records, wbsCpm } from '@/lib/services';
import type { CpmResult } from '@/lib/services';
import type { RecordRow, RecordType } from '@/lib/types';

/** Tasks register key. Every task in the app is a row of this one type. */
const TASKS_KEY = 'tasks';

/** Planning and tasks — schedule, critical path, float, open tasks. */
export default function EpcPlanningPage() {
  const { current: p } = useProjectData();
  const [taskType, setTaskType] = useState<RecordType | null>(null);
  const [tasks, setTasks] = useState<RecordRow[]>([]);
  const [taskError, setTaskError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [cpm, setCpm] = useState<CpmResult | null>(null);
  const [cpmError, setCpmError] = useState<string | null>(null);

  const loadCpm = useCallback(async () => {
    if (!p) return;
    setCpmError(null);
    try {
      setCpm(await wbsCpm.criticalPath(p.id));
    } catch (err) {
      setCpmError(err instanceof Error ? err.message : 'Could not compute critical path');
      setCpm(null);
    }
  }, [p]);

  const loadTasks = useCallback(async () => {
    if (!p) return;

    setTaskError(null);
    try {
      // The type drives the form fields, so fetch it once and reuse it.
      const [type, page] = await Promise.all([
        records.type(TASKS_KEY),
        records.list(TASKS_KEY, { projectId: p.id, limit: 200 }),
      ]);
      setTaskType(type);
      setTasks(page.items);
    } catch (err) {
      setTaskError(err instanceof Error ? err.message : 'Could not load tasks');
    }
  }, [p]);

  useEffect(() => {
    void loadTasks();
    void loadCpm();
  }, [loadTasks, loadCpm]);

  if (!p) {
    return <PageHead title="Planning & tasks" description="No project is in your scope." />;
  }

  return (
    <>
      <PageHead
        title="Planning & tasks"
        description={`Phases, milestones and site tasks for ${p.name}. Every task carries an owner, a due date and completion evidence.`}
        actions={
          <>
            <Button>Baseline vs actual</Button>
            <Button variant="primary" onClick={() => setAdding(true)}>Add task</Button>
          </>
        }
      />

      {cpmError ? (
        <Notice>
          Critical path could not be computed: <strong>{cpmError}</strong>
        </Notice>
      ) : null}

      {cpm && cpm.activities.length === 0 ? (
        <Notice>
          No scheduled activities yet. Add WBS rows with a baseline start and a predecessor to
          switch the critical path on.
        </Notice>
      ) : null}

      {cpm && cpm.activities.length > 0 ? (
        <>
          <Notice>
            Critical path runs {cpm.projectFinish} days through {cpm.criticalPath.length} activities
            and finishes on {cpm.projectFinishISO || '—'}.{' '}
            {cpm.issues.length > 0
              ? `${cpm.issues.length} schedule issue${cpm.issues.length > 1 ? 's' : ''} need attention.`
              : 'All activities sit inside their float.'}
          </Notice>

          <Panel
            title="Schedule"
            sub={`${cpm.projectStartISO || '—'} — ${cpm.projectFinishISO || '—'} · critical path highlighted`}
            bodyless
          >
            <Gantt
              months={ganttMonths(cpm)}
              todayPct={todayPct(cpm)}
              rows={cpm.activities.map((a) => ({
                label: `${a.wbsCode} · ${a.description}`,
                sub: `${a.owner || 'Unassigned'} · float ${a.totalFloat} d${
                  a.predecessor ? ` · pred ${a.predecessor} ${a.relType}` : ''
                }`,
                startPct: pct(a.earlyStart, cpm.projectStart, cpm.projectFinish),
                widthPct: widthPct(Math.max(1, a.duration), cpm.projectStart, cpm.projectFinish),
                tone: a.isCritical ? ('crit' as const) : a.progress > 0 ? ('ok' as const) : ('mute' as const),
                critical: a.isCritical,
              }))}
            />
            <GanttLegend
              items={[
                { color: 'var(--red)', label: 'Critical path (zero float)' },
                { color: 'var(--accent)', label: 'Started, non-critical' },
                { color: '#b9c4be', label: 'Not started' },
              ]}
            />
          </Panel>

          <Panel
            title="Critical path activities"
            sub={`${cpm.criticalPath.length} zero-float activities · recalculated on every load`}
            bodyless
          >
            <DataTable
              columns={[
                { key: 'n', label: '#' },
                { key: 'a', label: 'Activity' },
                { key: 'p', label: 'Predecessor' },
                { key: 'd', label: 'Duration' },
                { key: 'tf', label: 'Total float', align: 'right' },
                { key: 'ef', label: 'Early finish' },
                { key: 'lf', label: 'Late finish' },
                { key: 's', label: 'Status', align: 'right' },
              ]}
              rows={cpm.criticalPath.map((a, i) => [
                String(i + 1),
                `${a.wbsCode} · ${a.description}`,
                a.predecessor ? `${a.predecessor} ${a.relType}${a.lagDays ? ` ${a.lagDays > 0 ? '+' : ''}${a.lagDays}d` : ''}` : '—',
                `${a.duration} d`,
                <span key="t" className="num">0 d</span>,
                a.earlyFinishISO || '—',
                a.lateFinishISO || '—',
                <Chip key="c" tone={a.progress >= 100 ? 'ok' : a.progress > 0 ? 'info' : 'mute'}>
                  {a.status}
                </Chip>,
              ])}
            />
          </Panel>

          <Grid cols={2}>
            <Panel title="Near-critical activities" sub="Float below 15 days" bodyless>
              <DataTable
                columns={[
                  { key: 'a', label: 'Activity' },
                  { key: 'o', label: 'Owner' },
                  { key: 'f', label: 'Total float', align: 'right' },
                  { key: 'w', label: 'Watch' },
                ]}
                rows={
                  cpm.activities.filter((a) => !a.isCritical && a.totalFloat < 15).length === 0
                    ? [['No near-critical activity — float is comfortable everywhere.']]
                    : cpm.activities
                        .filter((a) => !a.isCritical && a.totalFloat < 15)
                        .map((a) => [
                          `${a.wbsCode} · ${a.description}`,
                          a.owner || '—',
                          <span key="f" className="num">{a.totalFloat} d</span>,
                          <Chip key="c" tone="warn">Becomes critical if delayed</Chip>,
                        ])
                }
              />
            </Panel>
            <Panel title="Float register" sub="Total float by activity" bodyless>
              <DataTable
                columns={[
                  { key: 'a', label: 'Activity' },
                  { key: 'p', label: 'Progress' },
                  { key: 't', label: 'Total float', align: 'right' },
                  { key: 'm', label: 'Movement' },
                ]}
                rows={cpm.activities.map((a) => [
                  `${a.wbsCode} · ${a.description}`,
                  `${a.progress}%`,
                  <span key="f" className="num">{a.totalFloat} d</span>,
                  <Chip key="c" tone={a.isCritical ? 'bad' : a.totalFloat < 15 ? 'warn' : 'mute'}>
                    {a.isCritical ? 'Zero float' : a.totalFloat < 15 ? 'Tight' : 'Comfortable'}
                  </Chip>,
                ])}
              />
            </Panel>
          </Grid>
        </>
      ) : null}

      <Panel
        title="Tasks"
        sub={taskError ? 'Load failed' : `${tasks.length} in this project`}
        bodyless
      >
        {taskError ? (
          <p className="m-0 p-4 text-[12.5px]" style={{ color: 'var(--red)' }}>
            {taskError}
          </p>
        ) : (
          <DataTable
            columns={
              taskType
                ? taskType.fields
                    .filter((f) => f.listColumn)
                    .slice(0, 6)
                    .map((f) => ({ key: f.key, label: f.label, align: f.align }))
                : [
                    { key: 'title', label: 'Task' },
                    { key: 'owner', label: 'Owner' },
                    { key: 'dueDate', label: 'Due' },
                    { key: 'status', label: 'Status', align: 'right' as const },
                  ]
            }
            rows={
              tasks.length === 0
                ? [['No tasks yet. Use Add task to create the first one.']]
                : tasks.map((t): React.ReactNode[] =>
                    taskType
                      ? taskType.fields
                          .filter((f) => f.listColumn)
                          .slice(0, 6)
                          .map((f, i) => cell(f, t.data[f.key]))
                      : [
                          String(t.data.title ?? ''),
                          String(t.data.owner ?? ''),
                          String(t.data.dueDate ?? ''),
                          <span key="s">—</span>,
                        ],
                  )
            }
          />
        )}
      </Panel>

      {adding && taskType ? (
        <TaskForm
          type={taskType}
          projectId={p.id}
          onCancel={() => setAdding(false)}
          onCreated={() => {
            setAdding(false);
            void loadTasks();
          }}
        />
      ) : null}
    </>
  );
}
/** Renders one task cell: a status field becomes a chip, a date is formatted. */
function cell(field: RecordType['fields'][number], value: unknown) {
  const text = value === null || value === undefined || value === '' ? '—' : String(value);

  if (field.type === 'status' && value !== '' && value != null) {
    const tone =
      value === 'Completed' || value === 'Verified'
        ? 'ok'
        : value === 'In progress'
          ? 'info'
          : value === 'Reopened'
            ? 'bad'
            : 'warn';
    return (
      <Chip key="s" tone={tone}>
        {String(value)}
      </Chip>
    );
  }

  return text;
}

/**
 * Gantt helpers — map CPM day-offsets onto bar-chart percentages.
 *
 * The axis runs from `projectStart` to `projectFinish` (day-offsets are
 * relative to the baseline anchor). `pct01` converts an offset to a 0–100 %
 * position; `todayPct` places "now" on that same axis.
 */
const DAY_MS = 86_400_000;

/** Day-offset → percentage position on the project timeline. */
function pct(offset: number, projectStart: number, projectFinish: number): number {
  const span = Math.max(1, projectFinish - projectStart);
  return Math.min(100, Math.max(0, ((offset - projectStart) / span) * 100));
}

/** Width of a bar, in percentage points, for a given number of days. */
function widthPct(days: number, projectStart: number, projectFinish: number): number {
  const span = Math.max(1, projectFinish - projectStart);
  return Math.max(0, (days / span) * 100);
}

/** "Today" as a percentage position on the project timeline. */
function todayPct(cpm: CpmResult): number {
  if (!cpm.projectStartISO) return 0;
  const startMs = new Date(cpm.projectStartISO).getTime();
  const nowMs = Date.now();
  const totalDays = Math.max(1, cpm.projectFinish - cpm.projectStart);
  const todayDays = Math.round((nowMs - startMs) / DAY_MS);
  return Math.min(100, Math.max(0, (todayDays / totalDays) * 100));
}

/** Month labels spanning the project start to finish. */
function ganttMonths(cpm: CpmResult): string[] {
  if (!cpm.projectStartISO) return [];
  const start = new Date(cpm.projectStartISO);
  const totalDays = Math.max(1, cpm.projectFinish - cpm.projectStart);
  const end = new Date(start.getTime() + totalDays * DAY_MS);
  const labels: string[] = [];
  const cursor = new Date(start.getFullYear(), start.getMonth(), 1);
  const names = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  let guard = 0;
  while (cursor <= end && guard < 48) {
    labels.push(names[cursor.getMonth()]);
    cursor.setMonth(cursor.getMonth() + 1);
    guard++;
  }
  return labels.slice(0, 24);
}
