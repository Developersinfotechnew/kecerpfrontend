'use client';

import { Button, DataTable, Gantt, GanttLegend, PageHead, Panel } from '@/components/ui';

/** WBS, schedule and critical path. */
export default function EptpWbsPage() {
  return (
    <>
      <PageHead
        title="WBS, schedule & critical path"
        description="Every task, document, RFQ, vendor action, compliance item and BOQ line inherits a WBS reference. L1 master schedule below; critical path activities are flagged."
        actions={<Button>Baseline vs current</Button>}
      />

      <Panel title="WBS structure" bodyless>
        <DataTable
          columns={[
            { key: 'l', label: 'Level' },
            { key: 's', label: 'Structure' },
            { key: 'e', label: 'Example' },
          ]}
          rows={[
            ['L0', 'Project', 'EPTP-PRJ-003'],
            ['L1', 'Major workstream', 'Technology / Engineering / Procurement support / Compliance / BOQ'],
            ['L2', 'Discipline / sub-workstream', 'Process / Mechanical / Civil / Electrical / Instrumentation'],
            ['L3', 'Activity', 'Prepare P&ID / Size CSTR / Prepare RFQ'],
            ['L4', 'Deliverable / document', 'P&ID-001 Rev-00 / Datasheet-001'],
            ['L5', 'Action / comment / approval', 'Client comment, internal review, approval'],
          ]}
        />
      </Panel>

      <Panel title="L1 master schedule" sub="Critical path highlighted" bodyless>
        <Gantt
          months={['Q1', 'Q2', 'Q3', 'Q4', 'Q1']}
          todayPct={38}
          rows={[
            { label: 'Technology transfer & design basis', sub: 'Critical path', startPct: 0, widthPct: 14, tone: 'crit', critical: true },
            { label: 'Core engineering', sub: 'Critical path', startPct: 12, widthPct: 22, tone: 'crit', critical: true },
            { label: 'Detailed engineering & datasheets', sub: 'Critical path', startPct: 30, widthPct: 26, tone: 'crit', critical: true },
            { label: 'RFQ & vendor technical support', startPct: 48, widthPct: 20, tone: 'ok' },
            { label: 'Codes & compliance closure', startPct: 52, widthPct: 18, tone: 'ok' },
            { label: 'Engineering BOQ & freeze', sub: 'Critical path', startPct: 66, widthPct: 20, tone: 'crit', critical: true },
            { label: 'EPC handover', sub: 'Critical path', startPct: 84, widthPct: 10, tone: 'crit', critical: true },
          ]}
        />
        <GanttLegend
          items={[
            { color: 'var(--red)', label: 'Critical path' },
            { color: 'var(--accent)', label: 'Non-critical' },
          ]}
        />
      </Panel>
    </>
  );
}
