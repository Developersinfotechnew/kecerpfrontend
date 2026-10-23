'use client';

import { Button, Chip, DataTable, Grid, KVList, PageHead, Panel } from '@/components/ui';

/** Quality and SHE — CBG spec vs actual, CAPA, SHE register. */
export default function OmQualityPage() {
  return (
    <>
      <PageHead
        title="Quality & SHE"
        description="Raw biogas and CBG quality against specification, and the safety register — permits, gas testing, incidents and inspections."
        actions={
          <>
            <Button>Log gas test</Button>
            <Button variant="primary">Report incident</Button>
          </>
        }
      />

      <Panel title="Quality — CBG specification vs actual" bodyless>
        <DataTable
          columns={[
            { key: 'p', label: 'Parameter' },
            { key: 's', label: 'Specification' },
            { key: 'a', label: "Today's average" },
            { key: 'st', label: 'Status', align: 'right' },
          ]}
          rows={[
            ['CH₄', '≥ 95%', '95.8%', <Chip key="s" tone="ok">Within spec</Chip>],
            ['CO₂', '≤ 4%', '3.6%', <Chip key="s" tone="ok">Within spec</Chip>],
            ['H₂S', '≤ 5 ppm', '4.2 ppm', <Chip key="s" tone="ok">Within spec</Chip>],
            ['Moisture', '≤ 10 ppm', '14 ppm', <Chip key="s" tone="bad">Deviation</Chip>],
          ]}
        />
      </Panel>

      <Grid cols={2}>
        <Panel title="CAPA — moisture deviation">
          <KVList
            pairs={[
              ['Root cause', 'Moisture removal unit media saturation'],
              ['Corrective action', 'Media replacement scheduled'],
              ['Owner', 'Process shift engineer'],
              ['Target closure', '18 Sep 2026'],
            ]}
          />
        </Panel>
        <Panel title="SHE register" bodyless>
          <DataTable
            columns={[
              { key: 't', label: 'Type' },
              { key: 'd', label: 'Detail' },
              { key: 'dt', label: 'Date' },
              { key: 's', label: 'Status', align: 'right' },
            ]}
            rows={[
              ['Gas test', 'Confined space entry — digester manhole', '13 Sep', <Chip key="s" tone="ok">Cleared</Chip>],
              ['Near miss', 'LPG cylinder trolley tipped, no injury', '12 Sep', <Chip key="s" tone="ok">Closed</Chip>],
              ['Inspection', 'Monthly fire safety inspection', '10 Sep', <Chip key="s" tone="warn">2 observations open</Chip>],
              ['PTW', 'Hot work — compressor repair', '14 Sep', <Chip key="s" tone="info">Active</Chip>],
            ]}
          />
        </Panel>
      </Grid>
    </>
  );
}
