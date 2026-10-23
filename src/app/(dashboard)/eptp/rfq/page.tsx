'use client';

import { Button, Chip, DataTable, Flow, PageHead, Panel } from '@/components/ui';

const CODE = ({ children }: { children: React.ReactNode }) => (
  <span className="num text-[12px]" style={{ color: 'var(--muted)' }}>{children}</span>
);

/** RFQ, vendor and TBE — RFQ tracker and technical bid evaluation. */
export default function EptpRfqPage() {
  return (
    <>
      <PageHead
        title="RFQ, vendor & TBE"
        description="Equipment requirement to RFQ, vendor technical offers and the technical bid evaluation that produces a recommendation for Procurement/Commercial."
        actions={
          <>
            <Button>Open TBE comparison</Button>
            <Button variant="primary">Issue RFQ</Button>
          </>
        }
      />

      <Panel title="How a requirement becomes a technical recommendation">
        <Flow
          steps={[
            { label: 'Equipment requirement', state: 'done' },
            { label: 'Datasheet', state: 'done' },
            { label: 'RFQ issued', state: 'now' },
            { label: 'Vendor offers', state: 'todo' },
            { label: 'Technical bid evaluation', state: 'todo' },
            { label: 'OEM shortlist', state: 'todo' },
            { label: 'Recommendation to Procurement', state: 'todo' },
          ]}
        />
      </Panel>

      <Panel title="RFQ tracker" bodyless>
        <DataTable
          columns={[
            { key: 'r', label: 'RFQ no.' },
            { key: 'e', label: 'Equipment' },
            { key: 'd', label: 'Datasheet ref' },
            { key: 'v', label: 'Vendors invited' },
            { key: 'o', label: 'Offers received' },
            { key: 's', label: 'Status', align: 'right' },
          ]}
          rows={[
            [<CODE key="c">RFQ-0031</CODE>, 'Digester agitator', <CODE key="d">EPTP-MEC-DTS-014</CODE>, '4', '2', <Chip key="s" tone="warn">Awaiting offers</Chip>],
            [<CODE key="c">RFQ-0028</CODE>, 'PSA purification skid', <CODE key="d">EPTP-MEC-DTS-009</CODE>, '3', '3', <Chip key="s" tone="info">TBE in progress</Chip>],
            [<CODE key="c">RFQ-0022</CODE>, 'LT panel & switchgear', <CODE key="d">EPTP-ELE-SLD-005</CODE>, '5', '0', <Chip key="s" tone="mute">Not yet issued</Chip>],
          ]}
        />
      </Panel>

      <Panel title="Technical bid evaluation — PSA purification skid" bodyless>
        <DataTable
          columns={[
            { key: 'v', label: 'Vendor' },
            { key: 'c', label: 'Technical compliance' },
            { key: 'd', label: 'Deviations' },
            { key: 'dl', label: 'Delivery' },
            { key: 'r', label: 'Recommendation', align: 'right' },
          ]}
          rows={[
            ['Aqua Process Systems', 'Full compliance', 'None', '14 weeks', <Chip key="s" tone="ok">Recommended</Chip>],
            ['Chemtrols Engineering', 'Partial', 'Membrane spec deviation', '16 weeks', <Chip key="s" tone="info">Alternate</Chip>],
            ['Purenviro Systems', 'Full compliance', 'None', '20 weeks', <Chip key="s" tone="mute">Not recommended — delivery</Chip>],
          ]}
        />
      </Panel>
    </>
  );
}
