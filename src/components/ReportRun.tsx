'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';

import { DataTable, Notice, Panel } from '@/components/ui';
import { REPORT_LIMIT } from '@/lib/analytics';
import { projects, records, type ProjectOption } from '@/lib/services';
import type { RecordRow } from '@/lib/types';
import type { ReportDef, ReportContext } from '@/lib/report-definitions';

/**
 * Runs one report definition against the live registers.
 *
 * A definition is data, and this component is the one thing that turns data
 * into a screen. It loads every register the definition named, calls the
 * definition to build the summary strip and the table, and renders whatever
 * comes back. There is no per-report component and no endpoint.
 *
 * Registers are loaded in parallel. One failing register fails the report,
 * because a summary computed from a missing register would be a number that
 * looks real. The alternative, partially rendering, was worse.
 */
export function ReportRun({
  report,
  limit,
  onBack,
}: {
  report: ReportDef;
  limit?: number;
  onBack: () => void;
}) {
  const [data, setData] = useState<Record<string, RecordRow[]> | null>(null);
  const [projects, setProjects] = useState<ProjectOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // Other Requirements (client): the date-ranged reports run From / To.
  const [rangeFrom, setRangeFrom] = useState('');
  const [rangeTo, setRangeTo] = useState('');

  // A date-ranged report filters each named register to From / To on the
  // register's own data date field; a row missing that date stays out.
  const inRange = useCallback((row: RecordRow, field: string, from: string, to: string) => {
    const v = String(row.data[field] ?? '').trim();
    if (!v) return false;
    const d = new Date(`${v}T00:00:00`);
    if (Number.isNaN(d.getTime())) return true; // unparsable: keep it, do not hide data
    if (from && d.getTime() < new Date(`${from}T00:00:00`).getTime()) return false;
    if (to && d.getTime() > new Date(`${to}T23:59:59.999`).getTime()) return false;
    return true;
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const registers = [...new Set(report.registers)];
      const rangeMap = report.range?.registers ?? {};
      const pages = await Promise.all(
        registers.map((key) => records.list(key, { limit: limit ?? REPORT_LIMIT })),
      );
      const byKey: Record<string, RecordRow[]> = {};
      registers.forEach((key, i) => {
        let items = pages[i]!.items;
        const field = rangeMap[key];
        if (field && (rangeFrom || rangeTo)) {
          items = items.filter((row) => inRange(row, field, rangeFrom, rangeTo));
        }
        byKey[key] = items;
      });
      // A report that opted in with needProjects reads the live project
      // masters (budget, name) alongside the registers.
      if (report.needProjects) {
        const masters = await projects.list({ kind: 'master' });
        setProjects(masters);
      }
      setData(byKey);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not run this report');
    } finally {
      setLoading(false);
    }
  }, [report, limit, rangeFrom, rangeTo, inRange]);

  useEffect(() => {
    void load();
  }, [load]);

  const totalRows = useMemo(
    () => (data ? Object.values(data).flat().length : 0),
    [data],
  );

  // needProjects reports get the live masters; every other report ignores ctx.
  const ctx: ReportContext | undefined =
    report.needProjects && data ? { projects } : undefined;
  const summary = data ? report.summary?.(data, ctx) : undefined;
  const body = data ? report.rows(data, ctx) : [];
  const footer = data ? report.footer?.(data, ctx) : undefined;

  return (
    <Panel
      title={report.title}
      sub={loading ? 'Running' : `${totalRows} rows from ${new Set(report.registers).size} register(s)`}
      actions={
        <button
          type="button"
          onClick={onBack}
          className="rounded px-2.5 py-1 text-[12.5px]"
          style={{ border: '1px solid var(--line)', color: 'var(--muted)' }}
        >
          Back to reports
        </button>
      }
      bodyless
    >
      {error ? <Notice>{error}</Notice> : null}

      {loading ? (
        <p className="m-0 p-4 text-[12.5px]" style={{ color: 'var(--muted)' }}>
          Loading {report.registers.length} register(s)…
        </p>
      ) : null}

      {report.range ? (
        <div
          className="flex flex-wrap items-center gap-3 border-b px-4 py-2"
          style={{ background: 'var(--panel)', borderColor: 'var(--line)' }}
        >
          <label className="flex items-center gap-1.5 text-[12px]" style={{ color: 'var(--muted)' }}>
            From
            <input
              type="date"
              value={rangeFrom}
              onChange={(e) => setRangeFrom(e.target.value)}
              className="rounded px-1.5 py-0.5 text-[12.5px]"
              style={{ border: '1px solid var(--line)', background: 'var(--panel-2)', color: 'var(--ink)' }}
            />
          </label>
          <label className="flex items-center gap-1.5 text-[12px]" style={{ color: 'var(--muted)' }}>
            To
            <input
              type="date"
              value={rangeTo}
              onChange={(e) => setRangeTo(e.target.value)}
              className="rounded px-1.5 py-0.5 text-[12.5px]"
              style={{ border: '1px solid var(--line)', background: 'var(--panel-2)', color: 'var(--ink)' }}
            />
          </label>
          {(rangeFrom || rangeTo) ? (
            <button
              type="button"
              onClick={() => { setRangeFrom(''); setRangeTo(''); }}
              className="text-[12px] underline"
              style={{ color: 'var(--muted)' }}
            >
              Clear range
            </button>
          ) : null}
        </div>
      ) : null}

      {!loading && !error && data ? (
        <>
          {report.caveat ? (
            <div
              className="border-b px-4 py-2 text-[12px]"
              style={{ background: 'var(--panel-2)', borderColor: 'var(--line)', color: 'var(--muted)' }}
            >
              {report.caveat}
            </div>
          ) : null}

          {summary && summary.length > 0 ? (
            <div
              className="grid grid-cols-2 gap-px sm:grid-cols-3 lg:grid-cols-5"
              style={{ background: 'var(--line)', borderBottom: '1px solid var(--line)' }}
            >
              {summary.map((s) => (
                <div key={s.label} className="px-3.5 py-2.5" style={{ background: 'var(--panel)' }}>
                  <div className="text-[11px]" style={{ color: 'var(--muted)' }}>
                    {s.label}
                  </div>
                  <div className="mt-0.5 text-[16px] font-semibold tabular-nums">{s.value}</div>
                </div>
              ))}
            </div>
          ) : null}

          <DataTable
            columns={report.columns.map((c) => ({ key: c.key, label: c.label, align: c.align }))}
            rows={body}
            empty="No rows. This report has no data to aggregate yet."
          />

          {footer ? (
            <div style={{ borderTop: '1px solid var(--line)' }}>{footer}</div>
          ) : null}
        </>
      ) : null}
    </Panel>
  );
}
