'use client';
import { useCallback, useEffect, useMemo, useState } from 'react';

import { Button, Chip, DataTable, Grid, PageHead, Panel } from '@/components/ui';
import { RecordForm } from '@/components/RecordForm';
import { useProjectData } from '@/lib/project-data';
import { records } from '@/lib/services';
import type { RecordRow, RecordType } from '@/lib/types';

const CODE = ({ children }: { children: React.ReactNode }) => (
  <span className="num text-[12px]" style={{ color: 'var(--muted)' }}>{children}</span>
);

const KEY = 'maintenance_schedule';

/** Live maintenance (CMMS) — PM schedule, work orders, breakdown and RCA.
 * W5: every panel reads the real register; completing a preventive order
 * rolls the asset's next PM forward on the backend. */
export default function OmMaintenancePage() {
  const { current } = useProjectData();
  const [type, setType] = useState<RecordType | null>(null);
  const [rows, setRows] = useState<RecordRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState<{ type: 'raise' | 'rca' } | null>(null);

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
      setError(err instanceof Error ? err.message : 'Could not load the maintenance schedule');
    } finally {
      setLoading(false);
    }
  }, [current?.id]);

  useEffect(() => {
    void load();
  }, [load]);

  const today = new Date().toISOString().slice(0, 10);

  const pmRows = useMemo(
    () =>
      rows
        .filter((r) => String(r.data.type ?? '') === 'Preventive' && ['Scheduled', 'In progress'].includes(String(r.data.status ?? '')))
        .map((r) => {
          const due = String(r.data.scheduledDate ?? '');
          const overdueDays = due ? Math.floor((new Date(today).getTime() - new Date(due).getTime()) / 86_400_000) : 0;
          const status =
            overdueDays > 0 ? (
              <Chip key="s" tone="bad">Overdue {overdueDays}d</Chip>
            ) : due === today ? (
              <Chip key="s" tone="warn">Due</Chip>
            ) : (
              <Chip key="s" tone="info">{String(r.data.status)}</Chip>
            );
          return [
            <CODE key="c">{r.ref}</CODE>,
            String(r.data.assetName ?? ''),
            due || '—',
            status,
          ];
        }),
    [rows, today],
  );

  const woRows = useMemo(
    () =>
      rows
        .filter((r) => ['In progress', 'Scheduled', 'Overdue'].includes(String(r.data.status ?? '')) && String(r.data.type ?? '') !== 'Preventive')
        .concat(rows.filter((r) => String(r.data.type ?? '') === 'Preventive' && String(r.data.status) === 'Overdue'))
        .map((r) => [
          <CODE key="c">{r.ref}</CODE>,
          String(r.data.assetName ?? ''),
          String(r.data.type ?? ''),
          String(r.data.technician ?? '') || '—',
          <Chip key="s" tone={String(r.data.status) === 'Overdue' ? 'bad' : String(r.data.status) === 'In progress' ? 'info' : 'warn'}>
            {String(r.data.status)}
          </Chip>,
        ]),
    [rows],
  );

  const breakdownRows = useMemo(
    () =>
      rows
        .filter((r) => String(r.data.type ?? '') === 'Breakdown' || String(r.data.failure ?? '') !== '' || String(r.data.rcaStatus ?? '') !== 'Not started')
        .map((r) => [
          String(r.data.assetName ?? ''),
          String(r.data.failure ?? '') || '—',
          r.data.downtimeHrs != null ? `${r.data.downtimeHrs} hrs` : '—',
          <Chip key="s" tone={String(r.data.rcaStatus) === 'Closed' ? 'ok' : String(r.data.rcaStatus) === 'In progress' ? 'info' : 'warn'}>
            {String(r.data.rcaStatus ?? 'Not started')}
          </Chip>,
        ]),
    [rows],
  );

  return (
    <>
      <PageHead
        title="Maintenance (CMMS)"
        description="Preventive, predictive, corrective and breakdown maintenance, all traceable to the asset register and to spares consumed. An equipment row with a PM frequency auto-schedules its preventive work orders; completing one books the next."
        actions={
          <>
            <Button onClick={() => setForm({ type: 'rca' })} disabled={!type}>
              Log breakdown / RCA
            </Button>
            <Button variant="primary" onClick={() => setForm({ type: 'raise' })} disabled={!type}>
              Raise work order
            </Button>
          </>
        }
      />

      {error ? <Panel title="Error" bodyless><div className="p-3 text-[13px]">{error}</div></Panel> : null}

      <Panel title="PM schedule" sub={`${pmRows.length} preventive order${pmRows.length === 1 ? '' : 's'}`} bodyless>
        <DataTable
          columns={[
            { key: 'w', label: 'WO' },
            { key: 'a', label: 'Asset' },
            { key: 'd', label: 'Due' },
            { key: 'st', label: 'Status', align: 'right' },
          ]}
          rows={
            pmRows.length === 0
              ? [['No preventive orders. Set a PM frequency on an equipment row and its first order books itself here.']]
              : pmRows
          }
        />
      </Panel>

      <div className="mt-[18px]" />

      <Grid cols={2}>
        <Panel title="Open work orders" bodyless>
          <DataTable
            columns={[
              { key: 'w', label: 'WO no.' },
              { key: 'a', label: 'Asset' },
              { key: 't', label: 'Type' },
              { key: 'o', label: 'Owner' },
              { key: 's', label: 'Status', align: 'right' },
            ]}
            rows={woRows.length === 0 ? [['No open work orders.']] : woRows}
          />
        </Panel>
        <Panel title="Breakdown & RCA" bodyless>
          <DataTable
            columns={[
              { key: 'a', label: 'Asset' },
              { key: 'f', label: 'Failure' },
              { key: 'd', label: 'Downtime' },
              { key: 'r', label: 'RCA status' },
            ]}
            rows={breakdownRows.length === 0 ? [['No breakdowns logged.']] : breakdownRows}
          />
        </Panel>
      </Grid>

      {type && form ? (
        <RecordForm
          type={type}
          record={null}
          initialValues={
            form.type === 'rca'
              ? { type: 'Breakdown', rcaStatus: 'In progress', status: 'In progress' }
              : { type: 'Preventive', status: 'Scheduled' }
          }
          onCancel={() => setForm(null)}
          onSubmit={async (body) => {
            await records.create(KEY, body);
            setForm(null);
            void load();
          }}
        />
      ) : null}
    </>
  );
}
