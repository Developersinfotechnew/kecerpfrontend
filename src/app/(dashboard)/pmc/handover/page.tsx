'use client';

import { Button, Chip, DataTable, Grid, Notice, PageHead, Panel } from '@/components/ui';

/** Handover and subsidy — PGTR tracker and subsidy register. */
export default function PmcHandoverPage() {
  return (
    <>
      <PageHead
        title="Handover & subsidy"
        description="PGTR coordination, final documentation and as-builts, and subsidy facilitation where applicable. Handover closes only after Client acceptance or an approved exception."
        actions={<Button variant="primary">Add handover item</Button>}
      />

      <Notice>
        Handover has not yet started for Rajasthan Green Fuels — Stage 4 opens once Stage 3 compliance
        and audit findings are closed.
      </Notice>

      <Grid cols={2}>
        <Panel title="PGTR tracker" bodyless>
          <DataTable
            columns={[
              { key: 'i', label: 'Item' },
              { key: 'a', label: 'Agency / person' },
              { key: 'd', label: 'Due date' },
              { key: 's', label: 'Status' },
            ]}
            rows={[
              ['PGTR site inspection request', 'CGD authority', 'Not scheduled', <Chip key="s" tone="mute">Not started</Chip>],
              ['As-built approval', 'EPC Contractor', 'Not scheduled', <Chip key="s" tone="mute">Not started</Chip>],
            ]}
          />
        </Panel>
        <Panel title="Subsidy register" bodyless>
          <DataTable
            columns={[
              { key: 's', label: 'Scheme' },
              { key: 'a', label: 'Authority' },
              { key: 'st', label: 'Status' },
              { key: 'am', label: 'Amount (₹L)' },
            ]}
            rows={[
              ['GOBARDHAN CBG subsidy', 'MNRE / State nodal agency', <Chip key="s" tone="mute">Not applicable</Chip>, '—'],
            ]}
          />
        </Panel>
      </Grid>
    </>
  );
}
