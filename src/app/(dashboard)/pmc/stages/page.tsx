'use client';

import { Button, Chip, DataTable, PageHead, Panel } from '@/components/ui';

/** Stage-gate and scope blocks. */
export default function PmcStagesPage() {
  return (
    <>
      <PageHead
        title="Stage-gate & scope blocks"
        description="The project cannot move to a stage without its predecessor's minimum information and approval status. Optional activities are activated explicitly, with a reason and an audit trail."
        actions={<Button variant="primary">Activate / deactivate scope block</Button>}
      />

      <Panel title="Stage-gate framework" bodyless>
        <DataTable
          columns={[
            { key: 's', label: 'Stage' },
            { key: 'o', label: 'Objective' },
            { key: 'c', label: 'Minimum process chain' },
            { key: 'p', label: 'Primary control' },
          ]}
          rows={[
            ['01', 'Project creation & PMC mobilisation', 'Appointment → Project Master → scope → stakeholders → governance → kickoff', 'Project activation gate'],
            ['02', 'JFR & CGD synchronisation', 'JFR/feasibility → site/climate study → GOBARDHAN support → evacuation → CGD/OMC planning', 'Technical/commercial readiness'],
            ['03', 'Commercial enablement', 'TPA if applicable → Term Sheet → LOI → offtake support', 'Commercial readiness'],
            ['04', 'DPR & financial closure', 'Bankable DPR → lender/investor ID → TEV coordination → lender presentations', 'Financial closure readiness'],
            ['05', 'Compliance & audit', 'Monthly EPC audit → payment/cash-flow tracking → contract compliance → forensic checks if required', 'Monthly compliance gate'],
            ['06', 'Handover & subsidy', 'PGTR coordination → final documents/as-builts → subsidy facilitation if applicable', 'Handover/closure gate'],
            ['07', 'General PMC governance', 'Meetings → progress review → Client/lender reporting → actions/escalations', 'Management governance'],
          ]}
        />
      </Panel>

      <Panel title="Scope block applicability" sub="Rajasthan Green Fuels" bodyless>
        <DataTable
          columns={[
            { key: 'b', label: 'Scope block' },
            { key: 'a', label: 'Applicability' },
            { key: 'r', label: 'Reason' },
            { key: 's', label: 'Set by' },
          ]}
          rows={[
            ['Stage 1 — JFR & CGD synchronisation', <Chip key="c" tone="ok">Applicable</Chip>, 'Core scope', 'PMC PM'],
            ['Stage 1A — Commercial enablement (TPA)', <Chip key="c" tone="ok">Applicable</Chip>, 'Offtake arrangement required', 'PMC PM'],
            ['Stage 2 — DPR & financial closure', <Chip key="c" tone="ok">Applicable</Chip>, 'External lender funding', 'PMC PM'],
            ['Stage 3 — Compliance & audit', <Chip key="c" tone="ok">Applicable</Chip>, 'Core scope', 'PMC PM'],
            ['Stage 3 — Forensic checks', <Chip key="c" tone="mute">Not applicable</Chip>, 'No trigger event to date', 'PMC PM'],
            ['Stage 4 — Subsidy facilitation', <Chip key="c" tone="mute">Not applicable</Chip>, 'Client applying directly', 'Client'],
            ['Stage 4 — PGTR coordination', <Chip key="c" tone="ok">Applicable</Chip>, 'Core scope', 'PMC PM'],
          ]}
        />
      </Panel>
    </>
  );
}
