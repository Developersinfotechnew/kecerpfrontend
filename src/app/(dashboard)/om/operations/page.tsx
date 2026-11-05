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

const KEY = 'om_shifts';

/** Live shift log & operations — every panel reads the om_shifts register.
 * W5 slice 2: the operations screen used to be a static prototype; the
 * "Log current shift" button writes a real row and reloads the panels. */
export default function OmOperationsPage() {
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
      setError(err instanceof Error ? err.message : 'Could not load the shift log');
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
        String(a.data.date ?? '').localeCompare(String(b.data.date ?? '')) ||
        String(a.ref).localeCompare(String(b.ref)),
      ),
    [rows],
  );
  const last5 = byDate.slice(-5);
  const latest = byDate[byDate.length - 1];

  const feed = useMemo(
    () =>
      byDate
        .filter((r) => String(r.data.abnormalities ?? '').trim() !== '')
        .slice(-5)
        .reverse()
        .map((r) => ({
          tone: 'warn' as const,
          text: String(r.data.abnormalities),
          meta: `${r.ref} · ${String(r.data.shift ?? '')} · ${String(r.data.date ?? '')}`,
        })),
    [byDate],
  );

  const last5Vitals = useMemo(() => {
    const n = last5.length;
    const cbg = last5.reduce((s, r) => s + (Number(r.data.cbgProducedKg) || 0), 0);
    const ch4 = n ? last5.reduce((s, r) => s + (Number(r.data.gasCH4) || 0), 0) / n : 0;
    const avail = n ? last5.reduce((s, r) => s + (Number(r.data.availability) || 0), 0) / n : 0;
    return { n, cbg, ch4, avail };
  }, [last5]);

  return (
    <>
      <PageHead
        title="Shift log & operations"
        description="One record per shift: feedstock, digestion, gas treatment, upgradation and CBG dispatch, plus any abnormality the operator logs."
        actions={
          <Button variant="primary" onClick={() => setForm(true)} disabled={!type}>
            Log current shift
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
            label: 'Shifts logged',
            value: String(rows.length),
            note: loading ? 'loading…' : 'all time, this project',
          },
          {
            label: 'CBG — last 5 shifts',
            value: last5Vitals.cbg.toLocaleString('en-IN'),
            note: `kg across ${last5Vitals.n} shift${last5Vitals.n === 1 ? '' : 's'}`,
          },
          { label: 'CH₄ avg', value: `${last5Vitals.ch4.toFixed(1)}%`, note: 'last 5 shifts' },
          {
            label: 'Availability avg',
            value: `${last5Vitals.avail.toFixed(0)}%`,
            note: 'last 5 shifts',
            tone: last5Vitals.avail < 90 ? 'warn' : 'good',
          },
        ]}
      />

      <div className="mt-[18px]" />

      <Grid cols={2}>
        <Panel
          title={latest ? `Latest shift — ${String(latest.data.shift ?? '')}` : 'Latest shift'}
          sub={latest ? `${latest.ref} · ${String(latest.data.date ?? '')}` : undefined}
          actions={
            latest?.data.status ? (
              <Chip tone={String(latest.data.status) === 'Closed' ? 'ok' : 'info'}>{String(latest.data.status)}</Chip>
            ) : undefined
          }
          bodyless
        >
          {latest ? (
            <DataTable
              columns={[
                { key: 'a', label: 'Process area' },
                { key: 'v', label: 'Value' },
              ]}
              rows={[
                ['Feedstock', `${latest.data.feedstockMT ?? '—'} MT${latest.data.feedstockTS != null ? ` · TS ${latest.data.feedstockTS}%` : ''}`],
                ['Digester', `${latest.data.digesterTemp ?? '—'} °C / pH ${latest.data.digesterPH ?? '—'}`],
                ['Raw biogas', `${latest.data.gasCH4 ?? '—'}% CH₄ / ${latest.data.gasH2S ?? '—'} ppm H₂S`],
                ['CBG dispatch', `${(Number(latest.data.cbgProducedKg) || 0).toLocaleString('en-IN')} kg`],
                ['Availability', `${latest.data.availability ?? '—'}%`],
              ]}
            />
          ) : (
            <div className="p-3 text-[13px]">No shifts logged yet.</div>
          )}
        </Panel>
        <Panel title="Operator log" bodyless>
          <Feed items={feed.length ? feed : [{ tone: 'info', text: 'No abnormalities logged.', meta: '' }]} />
        </Panel>
      </Grid>

      <div className="mt-[18px]" />

      <Panel title="Last 5 shifts — production" bodyless>
        <DataTable
          columns={[
            { key: 's', label: 'Shift' },
            { key: 'd', label: 'Date' },
            { key: 'p', label: 'CBG (kg)' },
            { key: 'c', label: 'CH₄ avg' },
            { key: 'a', label: 'Availability' },
            { key: 'st', label: 'Status', align: 'right' },
          ]}
          rows={
            last5.length === 0
              ? [['No shifts logged yet.']]
              : last5
                  .slice()
                  .reverse()
                  .map((r) => [
                    <span key="s">
                      <CODE>{r.ref}</CODE> · {String(r.data.shift ?? '')}
                    </span>,
                    String(r.data.date ?? '—'),
                    <span key="p" className="num">{(Number(r.data.cbgProducedKg) || 0).toLocaleString('en-IN')}</span>,
                    <span key="c" className="num">{r.data.gasCH4 != null ? `${r.data.gasCH4}%` : '—'}</span>,
                    <span key="a" className="num">{r.data.availability != null ? `${r.data.availability}%` : '—'}</span>,
                    <Chip key="st" tone={String(r.data.status) === 'Closed' ? 'ok' : 'info'}>
                      {String(r.data.status)}
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
