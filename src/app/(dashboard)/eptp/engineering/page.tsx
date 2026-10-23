'use client';

import { Button, Chip, DataTable, PageHead, Panel } from '@/components/ui';

const CODE = ({ children }: { children: React.ReactNode }) => (
  <span className="num text-[12px]" style={{ color: 'var(--muted)' }}>{children}</span>
);

/** Technology and engineering — technology transfer and the deliverable register. */
export default function EptpEngineeringPage() {
  return (
    <>
      <PageHead
        title="Technology & engineering"
        description="Technology transfer package, design basis and the Master Document Register (MDR/DCI) for every engineering deliverable."
        actions={<Button variant="primary">Issue deliverable</Button>}
      />

      <Panel title="Technology transfer register" bodyless>
        <DataTable
          columns={[
            { key: 'i', label: 'Item' },
            { key: 'o', label: 'Owner' },
            { key: 's', label: 'Status' },
            { key: 'e', label: 'Evidence' },
          ]}
          rows={[
            ['Process know-how & design basis', 'Technology Lead', <Chip key="s" tone="ok">Approved</Chip>, 'Design basis Rev-B'],
            ['Mass & energy balance', 'Technology Lead', <Chip key="s" tone="ok">Approved</Chip>, 'Balance sheet Rev-A'],
            ['CSTR configuration', 'Technology Lead', <Chip key="s" tone="ok">Approved</Chip>, 'Process philosophy note'],
            ['Upgradation & gas-handling philosophy', 'Technology Lead', <Chip key="s" tone="warn">Under review</Chip>, 'Draft circulated'],
          ]}
        />
      </Panel>

      <Panel title="Engineering deliverable register (MDR)" sub="Draft → Review → Approved → Issued for RFQ/EPC" bodyless>
        <DataTable
          columns={[
            { key: 'no', label: 'Doc no.' },
            { key: 't', label: 'Title' },
            { key: 'd', label: 'Discipline' },
            { key: 'r', label: 'Rev' },
            { key: 's', label: 'Status' },
            { key: 'p', label: 'Prepared / approved' },
          ]}
          rows={[
            [<CODE key="c">EPTP-PRO-PFD-001</CODE>, 'Process flow diagram', 'Process', <CODE key="r">B</CODE>, <Chip key="s" tone="ok">Approved</Chip>, 'Process Lead / Eng. Mgr'],
            [<CODE key="c">EPTP-MEC-DTS-014</CODE>, 'Digester agitator datasheet', 'Mechanical', <CODE key="r">A</CODE>, <Chip key="s" tone="warn">Review</Chip>, 'Mech. Engineer / —'],
            [<CODE key="c">EPTP-CIV-GA-002</CODE>, 'Digester foundation GA', 'Civil', <CODE key="r">C</CODE>, <Chip key="s" tone="ok">Issued for RFQ</Chip>, 'Civil Engineer / Eng. Mgr'],
            [<CODE key="c">EPTP-ELE-SLD-005</CODE>, 'LT single line diagram', 'Electrical', <CODE key="r">A</CODE>, <Chip key="s" tone="mute">Draft</Chip>, 'Elec. Engineer / —'],
            [<CODE key="c">EPTP-INS-IDX-003</CODE>, 'Instrument index', 'Instrumentation', <CODE key="r">A</CODE>, <Chip key="s" tone="mute">Draft</Chip>, 'Inst. Engineer / —'],
          ]}
        />
      </Panel>
    </>
  );
}
