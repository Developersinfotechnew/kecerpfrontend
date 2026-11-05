'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';

import { Button, Chip, DataTable, Feed, Grid, KpiGrid, PageHead, Panel } from '@/components/ui';
import { RecordForm } from '@/components/RecordForm';
import { useProjectData } from '@/lib/project-data';
import { records } from '@/lib/services';
import type { RecordRow, RecordType } from '@/lib/types';

const CODE = ({ children }: { children: React.ReactNode }) => (
  <span className="num text-[12px]" style={{ color: 'var(--muted)' }}>{children}</span>
);

const KEY = 'om_lab_tests';

/** Live lab & gas-test screen — every panel reads the om_lab_tests register.
 * W5 slice 3: the O&M quality screen used to be a static prototype; this page
 * is live and the "Log gas test" button writes a real row and reloads. */
export default function OmLabPage() {
  const { current } = useProjectData();
  const [type, setType] = useState<RecordType | null>(null);
  const [rows, setRows] = useState<RecordRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [t, page] = await Promise.all([
        records.type(KEY),
        records.list(KEY, {
          projectId: current?.id || undefined,
          limit: 200,
        }),
      ]);
      setType(t);
      setRows(page.items);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load the lab tests');
    } finally {
      setLoading(false);
    }
  }, [current?.id]);

  useEffect(() => {
    void load();
  }, [load]);

  const byDate = useMemo(
    () =>
      [...rows].sort((a, b) =>
        String(a.data.sampleDate ?? '').localeCompare(String(b.data.sampleDate ?? '')) ||
        String(a.ref).localeCompare(String(b.ref)),
      ),
    [rows],
  );
  const last5 = byDate.slice(-5);
  const latest = byDate[byDate.length - 1];

  const outOfSpec = useMemo(
    () =>
      byDate
        .filter((r) => String(r.data.result ?? '') === 'Out of spec')
        .slice(-5)
        .reverse()
        .map((r) => ({
          tone: 'bad' as const,
          text: `${String(r.data.parameter ?? '')} — reading ${String(r.data.reading ?? '')}${String(r.data.unit ?? '') ? ` ${r.data.unit}` : ''} (spec ${String(r.data.spec ?? '')})`,
          meta: `${r.ref} · ${String(r.data.testType ?? '')} · ${String(r.data.sampleDate ?? '')}`,
        })),
    [byDate],
  );

  const counts = useMemo(() => {
    let out = 0;
    let pending = 0;
    for (const r of rows) {
      const s = String(r.data.result ?? '');
      if (s === 'Out of spec') out += 1;
      if (s === 'Pending' || s === 'Open') pending += 1;
    }
    return { out, pending, total: rows.length };
  }, [rows]);

  return (
    <>
      <PageHead
        title="Lab & gas tests"
        description="Lab and gas-test samples: parameter, source, reading against spec, and the reported result."
        actions={
          <Button variant="primary" onClick={() => setForm(true)} disabled={!type}>
            Log gas test
          </Button>
        }
      />

      {error ? (
        <Panel title="Error" bodyless>
          <div className="p-3 text-[13px]">{error}</div>
        </Panel>
      ) : null}

      <KpiGrid
        items={[
          {
            label: 'Samples logged',
            value: String(rows.length),
            note: loading ? 'loading…' : 'all time, this project',
          },
          {
            label: 'Out of spec',
            value: String(counts.out),
            note: 'latest samples',
            tone: counts.out > 0 ? 'warn' : 'good',
          },
          {
            label: 'Pending / open',
            value: String(counts.pending),
            note: 'awaiting result',
          },
        ]}
      />

      <div className="mt-[18px]" />

      <Grid cols={2}>
        <Panel
          title={latest ? `Latest sample — ${String(latest.data.testType ?? '')}` : 'Latest sample'}
          sub={latest ? `${latest.ref} · ${String(latest.data.sampleDate ?? '')}` : undefined}
          actions={
            latest?.data.result ? (
              <Chip tone={String(latest.data.result) === 'Within spec' ? 'ok' : String(latest.data.result) === 'Out of spec' ? 'bad' : 'info'}>
                {String(latest.data.result)}
              </Chip>
            ) : undefined
          }
          bodyless
        >
          {latest ? (
            <DataTable
              columns={[
                { key: 'a', label: 'Field' },
                { key: 'v', label: 'Value' },
              ]}
              rows={[
                ['Parameter', `${String(latest.data.parameter ?? '')}${latest.data.spec ? ` (spec ${latest.data.spec})` : ''}`],
                ['Source', String(latest.data.source ?? '—')],
                ['Reading', `${latest.data.reading ?? '—'}${latest.data.unit ? ` ${latest.data.unit}` : ''}`],
                ['Tested by', String(latest.data.testedBy ?? '—')],
                ['Instrument', String(latest.data.instrument ?? '—')],
              ]}
            />
          ) : (
            <div className="p-3 text-[13px]">No samples logged yet.</div>
          )}
        </Panel>
        <Panel title="Out-of-spec log" bodyless>
          <Feed items={outOfSpec.length ? outOfSpec : [{ tone: 'info', text: 'No out-of-spec results logged.', meta: '' }]} />
        </Panel>
      </Grid>

      <div className="mt-[18px]" />

      <Panel title="Last 5 samples" bodyless>
        <DataTable
          columns={[
            { key: 't', label: 'Test' },
            { key: 'p', label: 'Parameter' },
            { key: 'd', label: 'Sample' },
            { key: 'r', label: 'Reading' },
            { key: 's', label: 'Spec' },
            { key: 'res', label: 'Result', align: 'right' },
            { key: 'st', label: 'Status', align: 'right' },
          ]}
          rows={
            last5.length === 0
              ? [['No samples logged yet.']]
              : last5
                  .slice()
                  .reverse()
                  .map((r) => [
                    <span key="t">
                      <CODE>{r.ref}</CODE> · {String(r.data.testType ?? '')}
                    </span>,
                    String(r.data.parameter ?? ''),
                    String(r.data.sampleDate ?? '—'),
                    <span key="r" className="num">
                      {r.data.reading != null ? `${r.data.reading}${r.data.unit ? ` ${r.data.unit}` : ''}` : '—'}
                    </span>,
                    String(r.data.spec ?? '—'),
                    <Chip
                      key="res"
                      tone={String(r.data.result) === 'Within spec' ? 'ok' : String(r.data.result) === 'Out of spec' ? 'bad' : 'info'}
                    >
                      {String(r.data.result ?? 'Pending')}
                    </Chip>,
                    <Chip key="st" tone={String(r.data.status) === 'Closed' ? 'ok' : String(r.data.status) === 'Reported' ? 'info' : 'info'}>
                      {String(r.data.status ?? 'Open')}
                    </Chip>,
                  ])
          }
        />
      </Panel>

      {type && form ? (
        <RecordForm
          type={type}
          record={null}
          initialValues={{ status: 'In progress' }}
          onCancel={() => setForm(false)}
          onSubmit={async (body) => {
            await records.create(KEY, body);
            setForm(false);
            void load();
          }}
        />
      ) : null}
    </>
  );
}
