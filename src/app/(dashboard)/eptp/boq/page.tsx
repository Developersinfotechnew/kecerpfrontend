'use client';

import { Button, Chip, DataTable, PageHead, Panel } from '@/components/ui';

const CODE = ({ children }: { children: React.ReactNode }) => (
  <span className="num text-[12px]" style={{ color: 'var(--muted)' }}>{children}</span>
);

/** Compliance and BOQ freeze — codes register and engineering BOQ. */
export default function EptpBoqPage() {
  return (
    <>
      <PageHead
        title="Compliance & BOQ freeze"
        description="Applicable codes and statutory requirements, and the engineering BOQ moving from preliminary through verification to freeze for EPC contracting."
        actions={
          <>
            <Button>Add compliance item</Button>
            <Button variant="primary">Freeze BOQ revision</Button>
          </>
        }
      />

      <Panel title="Codes & compliance register" bodyless>
        <DataTable
          columns={[
            { key: 'r', label: 'Requirement' },
            { key: 'a', label: 'Authority / code' },
            { key: 'd', label: 'Design impact' },
            { key: 'o', label: 'Owner' },
            { key: 's', label: 'Status', align: 'right' },
          ]}
          rows={[
            ['Gas system safety interlocks', 'PESO', 'Process safety', 'Process Lead', <Chip key="s" tone="ok">Complied</Chip>],
            ['Pressure vessel design code', 'IS 2825 / BIS', 'Mechanical', 'Mech. Engineer', <Chip key="s" tone="warn">In review</Chip>],
            ['Electrical area classification', 'BIS / CCOE', 'Electrical', 'Elec. Engineer', <Chip key="s" tone="bad">Open</Chip>],
            ['Pollution control norms', 'SPCB', 'Process', 'Compliance/HSE', <Chip key="s" tone="ok">Complied</Chip>],
          ]}
        />
      </Panel>

      <Panel title="Engineering BOQ" sub="Preliminary — Rev A" bodyless>
        <DataTable
          columns={[
            { key: 'i', label: 'BOQ item' },
            { key: 'r', label: 'Engineering reference' },
            { key: 's', label: 'Specification' },
            { key: 'q', label: 'Quantity', align: 'right' },
            { key: 'c', label: 'Est. cost (₹L)', align: 'right' },
            { key: 'st', label: 'Status', align: 'right' },
          ]}
          rows={[
            ['Digester agitator, 15 HP', <CODE key="r">EPTP-MEC-DTS-014</CODE>, 'SS316, top-entry', '2 No', <span key="c" className="num">18.40</span>, <Chip key="s" tone="ok">Verified</Chip>],
            ['PSA purification skid', <CODE key="r">EPTP-MEC-DTS-009</CODE>, '4,800 Nm³/day', '1 Set', <span key="c" className="num">312.00</span>, <Chip key="s" tone="ok">Verified</Chip>],
            ['LT panel & switchgear', <CODE key="r">EPTP-ELE-SLD-005</CODE>, 'As per SLD', '1 Lot', <span key="c" className="num">46.20</span>, <Chip key="s" tone="warn">Pending RFQ</Chip>],
            ['Digester foundation RCC', <CODE key="r">EPTP-CIV-GA-002</CODE>, 'M-30, per drawing', '1,860 Cum', <span key="c" className="num">138.57</span>, <Chip key="s" tone="ok">Verified</Chip>],
          ]}
        />
      </Panel>
    </>
  );
}
