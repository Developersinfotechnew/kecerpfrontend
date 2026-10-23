'use client';

import { Button, Chip, DataTable, Feed, Grid, PageHead, Panel } from '@/components/ui';

/** Shift log and operations. */
export default function OmOperationsPage() {
  return (
    <>
      <PageHead
        title="Shift log & operations"
        description="One record per shift: feedstock, digestion, gas treatment, upgradation and CBG dispatch, plus any abnormality the operator logs."
        actions={
          <>
            <Button>Shift history</Button>
            <Button variant="primary">Log current shift</Button>
          </>
        }
      />

      <Panel
        title="Shift log — B Shift, 14 Sep 2026"
        actions={<Chip tone="ok">Closed by Vikram Singh</Chip>}
        bodyless
      >
        <DataTable
          columns={[
            { key: 'a', label: 'Process area' },
            { key: 'p', label: 'Parameter' },
            { key: 'v', label: 'Value' },
            { key: 'r', label: 'Remark' },
          ]}
          rows={[
            ['Feedstock', 'Receipt / quality', '14.2 MT · TS 22%', 'Within spec'],
            ['Digestion', 'Temperature / pH / level', '37.9 °C / 7.1 / 82%', 'Stable'],
            ['Raw biogas', 'CH₄ / H₂S / moisture', '58.4% / 180 ppm / normal', 'H₂S trending up'],
            ['Gas treatment', 'H₂S removal status', 'Running', 'Media change due in 12 days'],
            ['Upgradation', 'Feed/product flow, CH₄', '420/265 Nm³/h · 96.1%', 'Normal'],
            ['CBG dispatch', 'Quantity / vehicles', '1,080 kg · 1 cascade', 'On schedule'],
          ]}
        />
      </Panel>

      <Grid cols={2}>
        <Panel title="Operator log">
          <Feed
            items={[
              { tone: 'warn', text: 'H₂S trending upward on raw biogas analyzer', meta: 'Logged 14:20' },
              { tone: 'ok', text: 'Routine digester agitator inspection completed', meta: 'Logged 11:00' },
              { tone: 'info', text: 'Cascade 1 dispatched to customer — Delhi route', meta: 'Logged 09:40' },
            ]}
          />
        </Panel>
        <Panel title="Last 5 shifts — production" bodyless>
          <DataTable
            columns={[
              { key: 's', label: 'Shift' },
              { key: 'p', label: 'CBG produced (kg)' },
              { key: 'c', label: 'CH₄ avg' },
              { key: 'a', label: 'Availability' },
            ]}
            rows={[
              ['B — 14 Sep', <span key="p" className="num">1,080</span>, <span key="c" className="num">96.1%</span>, <span key="a" className="num">98%</span>],
              ['A — 14 Sep', <span key="p" className="num">1,120</span>, <span key="c" className="num">95.8%</span>, <span key="a" className="num">100%</span>],
              ['C — 13 Sep', <span key="p" className="num">960</span>, <span key="c" className="num">95.2%</span>, <span key="a" className="num">92%</span>],
              ['B — 13 Sep', <span key="p" className="num">1,040</span>, <span key="c" className="num">96.0%</span>, <span key="a" className="num">97%</span>],
            ]}
          />
        </Panel>
      </Grid>
    </>
  );
}
