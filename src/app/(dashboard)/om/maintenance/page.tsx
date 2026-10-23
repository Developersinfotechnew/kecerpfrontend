'use client';

import { Button, Chip, DataTable, Grid, PageHead, Panel } from '@/components/ui';

const CODE = ({ children }: { children: React.ReactNode }) => (
  <span className="num text-[12px]" style={{ color: 'var(--muted)' }}>{children}</span>
);

/** Maintenance (CMMS) — PM schedule, work orders, breakdown and RCA. */
export default function OmMaintenancePage() {
  return (
    <>
      <PageHead
        title="Maintenance (CMMS)"
        description="Preventive, predictive, corrective and breakdown maintenance, all traceable to the asset register and to spares consumed."
        actions={
          <>
            <Button>Log RCA</Button>
            <Button variant="primary">Raise work order</Button>
          </>
        }
      />

      <Panel title="PM schedule" sub="This week" bodyless>
        <DataTable
          columns={[
            { key: 'a', label: 'Asset' },
            { key: 'p', label: 'PM type' },
            { key: 'd', label: 'Due date' },
            { key: 's', label: 'Strategy' },
            { key: 'st', label: 'Status', align: 'right' },
          ]}
          rows={[
            ['Compressor C-01', '6-month service', '12 Sep 2026', 'Hour-based', <Chip key="s" tone="bad">Overdue 3d</Chip>],
            ['Digester agitator A-01', 'Quarterly inspection', '18 Sep 2026', 'Calendar-based', <Chip key="s" tone="warn">Due</Chip>],
            ['PSA skid valves', 'Monthly check', '20 Sep 2026', 'Calendar-based', <Chip key="s" tone="info">Scheduled</Chip>],
            ['H₂S analyzer', 'Calibration', '16 Sep 2026', 'Calendar-based', <Chip key="s" tone="bad">Overdue 1d</Chip>],
          ]}
        />
      </Panel>

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
            rows={[
              [<CODE key="c">WO-0412</CODE>, 'H₂S analyzer', 'Corrective', 'Instrumentation', <Chip key="s" tone="info">In progress</Chip>],
              [<CODE key="c">WO-0409</CODE>, 'Compressor C-01', 'Preventive', 'Mechanical', <Chip key="s" tone="bad">Overdue</Chip>],
              [<CODE key="c">WO-0405</CODE>, 'Feed pump P-02', 'Breakdown', 'Mechanical', <Chip key="s" tone="warn">Awaiting spare</Chip>],
            ]}
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
            rows={[
              ['Feed pump P-02', 'Seal failure', '6 hrs', <Chip key="s" tone="info">In progress</Chip>],
              ['Compressor C-01', 'Trip on high vibration', '2 hrs', <Chip key="s" tone="ok">Closed</Chip>],
            ]}
          />
        </Panel>
      </Grid>
    </>
  );
}
