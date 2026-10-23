'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';

import { ReportRun } from '@/components/ReportRun';
import { Button, Chip, DataTable, Notice, PageHead, Panel } from '@/components/ui';
import { CPI_OK, SPI_OK, daysUntil, indexText, lakh } from '@/lib/analytics';
import { projects, records, type ProjectOption } from '@/lib/services';
import type { RecordRow } from '@/lib/types';
import { ALL_REPORTS, type ReportDef } from '@/lib/report-definitions';

type Tone = 'ok' | 'info' | 'warn' | 'bad' | 'mute';

const DAY = 86_400_000;
const EXPIRY_WINDOW_DAYS = 45;

/** Reports & MIS. Every card runs against live registers. */
export default function EpcReportsPage() {
  const [running, setRunning] = useState<ReportDef | null>(null);
  const [query, setQuery] = useState('');
  const [plants, setPlants] = useState<ProjectOption[]>([]);
  const [compliance, setCompliance] = useState<RecordRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [all, compliancePage] = await Promise.all([
        projects.list({ kind: 'master' }),
        records.list('compliance_register', { limit: 500 }),
      ]);
      setPlants(all);
      setCompliance(compliancePage.items);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load the report index');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return ALL_REPORTS;
    return ALL_REPORTS.filter(
      (r) =>
        r.title.toLowerCase().includes(q) ||
        r.description.toLowerCase().includes(q) ||
        r.registers.some((k) => k.includes(q)),
    );
  }, [query]);

  // ---- Management snapshot (live, independent of any report run) ----

  const snapshot = useMemo(() => {
    const sum = (fn: (p: ProjectOption) => number) => plants.reduce((a, p) => a + fn(p), 0);

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const expiringSoon = compliance.filter((r) => {
      const end = r.data.validTo;
      if (!end) return false;
      const d = new Date(String(end));
      if (Number.isNaN(d.getTime())) return false;
      const days = Math.floor((d.getTime() - today.getTime()) / DAY);
      return days >= 0 && days <= EXPIRY_WINDOW_DAYS;
    });

    const utilisation = (() => {
      const budget = sum((p) => p.budget);
      const actual = sum((p) => p.actual);
      return budget > 0 ? (actual / budget) * 100 : null;
    })();

    const rows: React.ReactNode[][] = [
      ['Contract value (₹L)', ...plants.map((p) => <span key={p.id} className="num">{lakh(p.contractValue)}</span>), <span key="all" className="num">{lakh(sum((p) => p.contractValue))}</span>],
      ['Physical progress', ...plants.map((p) => <span key={p.id} className="num">{`${Math.round(p.progress)}%`}</span>), <span key="all" className="num">{plants.length ? `${Math.round(sum((p) => p.progress) / plants.length)}%` : '—'}</span>],
      ['SPI', ...plants.map((p) => <Chip key={p.id} tone={p.spi > 0 && p.spi >= SPI_OK ? 'ok' : 'mute'}>{indexText(p.spi > 0 ? p.spi : null)}</Chip>), <Chip key="all" tone="mute">—</Chip>],
      ['CPI', ...plants.map((p) => <Chip key={p.id} tone={p.cpi > 0 ? p.cpi >= CPI_OK ? 'ok' : 'bad' : 'mute'}>{indexText(p.cpi > 0 ? p.cpi : null)}</Chip>), <Chip key="all" tone="mute">—</Chip>],
      ['Forecast at completion (₹L)', ...plants.map((p) => <span key={p.id} className="num">{lakh(p.eac)}</span>), <span key="all" className="num">{lakh(sum((p) => p.eac))}</span>],
      ['Cost utilisation', ...plants.map((p) => <span key={p.id} className="num">{p.budget > 0 ? `${Math.round((p.actual / p.budget) * 100)}%` : '—'}</span>), <span key="all" className="num">{utilisation === null ? '—' : `${Math.round(utilisation)}%`}</span>],
      ['Critical path', ...plants.map((p) => <Chip key={p.id} tone={p.scheduleDays > 0 ? 'bad' : 'ok'}>{p.scheduleDays > 0 ? `${p.scheduleDays}d late` : 'On track'}</Chip>), <Chip key="all" tone={plants.some((p) => p.scheduleDays > 0) ? 'bad' : 'ok'}>{plants.filter((p) => p.scheduleDays > 0).length} at risk</Chip>],
      ['Open actions', ...plants.map((p) => <span key={p.id} className="num">{p.openActions}</span>), <span key="all" className="num">{sum((p) => p.openActions)}</span>],
      ['Compliance <45d', ...plants.map((p) => {
        const n = expiringSoon.filter((r) => r.projectId === p.id).length;
        return n > 0 ? <Chip key={p.id} tone="warn">{String(n)}</Chip> : <span key={p.id} className="num">0</span>;
      }), <span key="all" className="num">{expiringSoon.length}</span>],
    ];

    return rows;
  }, [plants, compliance]);

  // ---- Card summary badges (live counts per report) ----

  const badges = useMemo(() => {
    const out = new Map<string, { text: string; tone: Tone }>();
    const totalContracts = plants.reduce((a, p) => a + p.contractValue, 0);

    out.set('progress', { text: `${plants.length} plants`, tone: plants.length ? 'info' : 'mute' });
    out.set('budget', { text: `₹${lakh(totalContracts)}L under management`, tone: 'info' });
    out.set('consumption', { text: 'BOQ tracked', tone: 'info' });
    out.set('procurement', { text: 'PRs & POs', tone: 'info' });
    out.set('billing', { text: 'Bills & follow-ups', tone: 'info' });
    out.set('profitability', { text: 'Budget vs actual', tone: 'info' });
    out.set('approvals', { text: 'Pending queue', tone: 'warn' });
    out.set('compliance', {
      text: `${compliance.filter((r) => { const d = daysUntil(r.data.validTo); return d !== null && d <= EXPIRY_WINDOW_DAYS; }).length} due soon`,
      tone: 'warn',
    });
    out.set('vendors', { text: 'POs & receipts', tone: 'info' });
    out.set('evm', { text: 'Work packages', tone: 'info' });

    return out;
  }, [plants, compliance]);

  return (
    <>
      <PageHead
        title="Reports & MIS"
        description="Every report runs against live registers. Choose one and it loads its source data now."
      />

      {error ? <Notice>{error}</Notice> : null}

      {running ? (
        <ReportRun report={running} onBack={() => setRunning(null)} />
      ) : (
        <>
          <div className="mb-4 flex items-center gap-2">
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search reports…"
              className="rounded px-2.5 py-2 text-[13px] outline-none"
              style={{ background: 'var(--panel-2)', border: '1px solid var(--line)', color: 'var(--ink)', minWidth: 280 }}
            />
          </div>

          <div className="mb-[18px] grid gap-[18px] grid-cols-1 md:grid-cols-2 xl:grid-cols-3">
            {filtered.map((report) => {
              const badge = badges.get(report.id);
              return (
                <div key={report.id} className="rounded" style={{ background: 'var(--panel)', border: '1px solid var(--line)' }}>
                  <div className="p-4">
                    <h4 className="mb-1.5 text-[14px] font-semibold">{report.title}</h4>
                    <p className="mb-3.5 text-[12.5px]" style={{ color: 'var(--muted)' }}>{report.description}</p>
                    <div className="mb-3 flex flex-wrap gap-1.5">
                      {badge ? <Chip tone={badge.tone}>{badge.text}</Chip> : null}
                      <Chip tone="mute">{report.registers.length} source(s)</Chip>
                    </div>
                    <Button variant="small" onClick={() => setRunning(report)}>Run</Button>
                  </div>
                </div>
              );
            })}
          </div>

          <Panel
            title="Management snapshot"
            sub={loading ? 'Loading' : `${plants.length} plants in scope`}
            bodyless
          >
            {loading ? (
              <p className="m-0 p-4 text-[12.5px]" style={{ color: 'var(--muted)' }}>Loading snapshot…</p>
            ) : plants.length === 0 ? (
              <p className="m-0 p-4 text-[12.5px]" style={{ color: 'var(--muted)' }}>
                No plants in scope. Create a project to populate this snapshot.
              </p>
            ) : (
              <DataTable
                columns={[
                  { key: 'i', label: 'Indicator' },
                  ...plants.map((p) => ({ key: p.id, label: p.name })),
                  { key: 'all', label: 'All plants', align: 'right' as const },
                ]}
                rows={snapshot}
              />
            )}
          </Panel>
        </>
      )}
    </>
  );
}