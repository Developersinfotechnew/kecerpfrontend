'use client';

import { Button, Chip, DataTable, Grid, PageHead, Panel } from '@/components/ui';

/** Financial and audit — payment register, cash flow, audit findings. */
export default function PmcFinancialPage() {
  return (
    <>
      <PageHead
        title="Financial & audit"
        description="Payment and cash-flow monitoring without the PMC being the payer or system of record, plus the monthly EPC audit trail."
        actions={<Button variant="primary">Log audit finding</Button>}
      />

      <Panel title="Payment register" sub="Verification only — Client/Finance remains system of record" bodyless>
        <DataTable
          columns={[
            { key: 'i', label: 'Invoice / bill' },
            { key: 'c', label: 'Contract package' },
            { key: 'd', label: 'Due date' },
            { key: 'a', label: 'Approved (₹L)', align: 'right' },
            { key: 'p', label: 'Paid (₹L)', align: 'right' },
            { key: 's', label: 'Status', align: 'right' },
          ]}
          rows={[
            ['INV-EPC-0088', 'Civil & structural', '20 Sep 2026', <span key="a" className="num">62.40</span>, <span key="p" className="num">62.40</span>, <Chip key="s" tone="ok">Paid</Chip>],
            ['INV-EPC-0091', 'Mechanical package', '28 Sep 2026', <span key="a" className="num">184.00</span>, <span key="p" className="num">—</span>, <Chip key="s" tone="warn">Approved, unpaid</Chip>],
            ['INV-EPC-0093', 'Electrical & automation', '05 Oct 2026', <span key="a" className="num">—</span>, <span key="p" className="num">—</span>, <Chip key="s" tone="info">Under PMC review</Chip>],
          ]}
        />
      </Panel>

      <Grid cols={2}>
        <Panel title="Cash-flow — forecast vs actual" sub="₹ in lakh" bodyless>
          <DataTable
            columns={[
              { key: 'p', label: 'Period' },
              { key: 'e', label: 'Expected inflow', align: 'right' },
              { key: 'a', label: 'Actual inflow', align: 'right' },
              { key: 'v', label: 'Variance', align: 'right' },
            ]}
            rows={[
              ['Aug 2026', <span key="e" className="num">220</span>, <span key="a" className="num">186</span>, <Chip key="v" tone="warn">−34L</Chip>],
              ['Sep 2026', <span key="e" className="num">240</span>, <span key="a" className="num">—</span>, <Chip key="v" tone="info">In progress</Chip>],
            ]}
          />
        </Panel>
        <Panel title="Monthly EPC audit findings" bodyless>
          <DataTable
            columns={[
              { key: 'f', label: 'Finding' },
              { key: 's', label: 'Severity' },
              { key: 'st', label: 'Status' },
            ]}
            rows={[
              ['Payment released ahead of certified progress', 'High', <Chip key="s" tone="bad">Open</Chip>],
              ['Missing test certificate for batch 4 rebar', 'Medium', <Chip key="s" tone="warn">Response awaited</Chip>],
              ['Site safety checklist not signed for 2 days', 'Low', <Chip key="s" tone="ok">Closed</Chip>],
            ]}
          />
        </Panel>
      </Grid>
    </>
  );
}
