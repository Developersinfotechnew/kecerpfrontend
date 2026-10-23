'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';

import { DataTable, Notice, Panel } from '@/components/ui';
import { REPORT_LIMIT } from '@/lib/analytics';
import { records } from '@/lib/services';
import type { RecordRow } from '@/lib/types';
import type { ReportDef } from '@/lib/report-definitions';

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
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const registers = [...new Set(report.registers)];
      const pages = await Promise.all(
        registers.map((key) => records.list(key, { limit: limit ?? REPORT_LIMIT })),
      );
      const byKey: Record<string, RecordRow[]> = {};
      registers.forEach((key, i) => {
        byKey[key] = pages[i]!.items;
      });
      setData(byKey);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not run this report');
    } finally {
      setLoading(false);
    }
  }, [report, limit]);

  useEffect(() => {
    void load();
  }, [load]);

  const totalRows = useMemo(
    () => (data ? Object.values(data).flat().length : 0),
    [data],
  );

  const summary = data ? report.summary?.(data) : undefined;
  const body = data ? report.rows(data) : [];
  const footer = data ? report.footer?.(data) : undefined;

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
