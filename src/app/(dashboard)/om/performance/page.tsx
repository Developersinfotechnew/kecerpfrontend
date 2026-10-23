'use client';

import { Button, Chip, DataTable, PageHead, Panel } from '@/components/ui';

/** Performance, SLA and MIS — KPI dashboard and client MIS summary. */
export default function OmPerformancePage() {
  return (
    <>
      <PageHead
        title="Performance, SLA & MIS"
        description="KPIs computed from validated DCS and transactional data, and the consolidated report issued to the client each month."
        actions={<Button>Generate monthly report</Button>}
      />

      <Panel title="KPI dashboard" sub="Rolling 30 days" bodyless>
        <DataTable
          columns={[
            { key: 'k', label: 'KPI' },
            { key: 's', label: 'Source' },
            { key: 'v', label: 'Value' },
            { key: 't', label: 'Target' },
            { key: 'st', label: 'Status', align: 'right' },
          ]}
          rows={[
            ['Plant availability', 'DCS status + work orders', '97.2%', '96%', <Chip key="s" tone="ok">On target</Chip>],
            ['CBG production', 'Validated dispatch data', '2,840 kg/day (avg)', '3,000 kg/day', <Chip key="s" tone="warn">Watch</Chip>],
            ['Biogas yield', 'Production ÷ feed', '0.72 Nm³/kg VS', '0.75', <Chip key="s" tone="warn">Watch</Chip>],
            ['MTBF', 'Asset failure history', '412 hrs', '500 hrs', <Chip key="s" tone="bad">Below target</Chip>],
            ['MTTR', 'Breakdown/WO timestamps', '4.1 hrs', '≤ 4 hrs', <Chip key="s" tone="warn">Watch</Chip>],
            ['PM compliance', 'PM due vs completed', '88%', '95%', <Chip key="s" tone="bad">Below target</Chip>],
            ['SLA compliance', 'Contract KPI engine', '94%', '90%', <Chip key="s" tone="ok">On target</Chip>],
          ]}
        />
      </Panel>

      <Panel title="Client MIS — August 2026 summary">
        <p className="m-0 max-w-[70ch] text-[13px]" style={{ color: 'var(--muted)' }}>
          Plant ran at 97.2% availability against a 96% target. CBG production averaged 2,840 kg/day.
          Two breakdown events totalling 8 hours were recorded, both closed with RCA. PM compliance
          slipped to 88% due to a delayed compressor overhaul, rescheduled for the first week of September.
        </p>
        <div className="mt-3.5">
          <Button variant="small">View full report</Button>
        </div>
      </Panel>
    </>
  );
}
