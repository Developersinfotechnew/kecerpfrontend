'use client';

import { Button, Chip, DataTable, Feed, Grid, KVList, PageHead, Panel, VitalsRail } from '@/components/ui';

/** O&M dashboard — live plant snapshot, production, manpower on shift. */
export default function OmDashboardPage() {
  return (
    <>
      <PageHead
        title="O&M dashboard"
        description="Vidarbha Organics Ltd — Nagpur Plant · Bio-CNG 80 TPD. DCS controls the plant; this ERP manages the O&M business around it — work, people, assets, maintenance, quality, SHE and client reporting."
        actions={
          <>
            <Button>Log shift handover</Button>
            <Button variant="primary">Raise work order</Button>
          </>
        }
      />

      <VitalsRail
        items={[
          { label: 'Plant availability', value: '97.2%', pct: 97, note: 'Target 96%' },
          { label: 'CBG production (MTD)', value: '2,840', unit: 'kg', note: 'Against plan 3,000 kg/day' },
          { label: 'SLA compliance', value: '94%', pct: 94 },
          { label: 'Open work orders', value: '6', note: 'Mostly preventive' },
          { label: 'CH₄ quality', value: '95.8%', note: 'Spec ≥ 95%' },
        ]}
      />

      <div className="mt-[18px]" />

      <Grid cols="2-1">
        <div>
          <Panel title="Live plant snapshot" sub="DCS read-only feed · updated 2 min ago" bodyless>
            <DataTable
              columns={[
                { key: 't', label: 'Tag' },
                { key: 'p', label: 'Parameter' },
                { key: 'v', label: 'Value' },
                { key: 'q', label: 'Quality' },
                { key: 's', label: 'Status', align: 'right' },
              ]}
              rows={[
                ['DIG-TT-01', 'Digester temperature', '37.8 °C', 'Good', <Chip key="s" tone="ok">Normal</Chip>],
                ['DIG-PH-01', 'Digester pH', '7.1', 'Good', <Chip key="s" tone="ok">Normal</Chip>],
                ['RB-CH4-01', 'Raw biogas CH₄', '58.2%', 'Good', <Chip key="s" tone="ok">Normal</Chip>],
                ['CBG-PR-01', 'CBG storage pressure', '245 bar', 'Good', <Chip key="s" tone="ok">Normal</Chip>],
                ['COMP-01', 'Compressor status', 'Running · 6,240 hrs', 'Good', <Chip key="s" tone="ok">Running</Chip>],
                ['H2S-AN-01', 'H₂S analyzer', '—', 'Stale', <Chip key="s" tone="bad">Signal lost 40 min</Chip>],
              ]}
            />
          </Panel>
          <Panel title="Today's production" bodyless>
            <DataTable
              columns={[
                { key: 's', label: 'Stage' },
                { key: 'p', label: 'Parameter' },
                { key: 'v', label: 'Value' },
              ]}
              rows={[
                ['Feedstock', 'Received', '42.0 MT'],
                ['Digestion', 'Gas generation', '6,180 Nm³'],
                ['Upgradation', 'CH₄ recovery', '94.2%'],
                ['CBG dispatch', 'Cascades dispatched', '3'],
              ]}
            />
          </Panel>
        </div>
        <div>
          <Panel title="Needs attention">
            <Feed
              items={[
                { tone: 'bad', text: 'H₂S analyzer signal lost — 40 minutes', meta: 'Integration health', time: '40m' },
                { tone: 'warn', text: 'Critical spare — agitator seal kit below reorder level', meta: 'Spares', time: '3h' },
                { tone: 'warn', text: 'PM overdue — compressor 6-month service', meta: 'Maintenance', time: '1d' },
                { tone: 'info', text: 'Monthly client MIS due in 3 days', meta: 'Reporting', time: '2d' },
              ]}
            />
          </Panel>
          <Panel title="Manpower on shift">
            <KVList
              pairs={[
                ['Shift', 'B Shift'],
                ['Operators', <span key="o" className="num">6</span>],
                ['Maintenance crew', <span key="m" className="num">3</span>],
                ['Shift in-charge', 'Vikram Singh'],
              ]}
            />
          </Panel>
        </div>
      </Grid>
    </>
  );
}
