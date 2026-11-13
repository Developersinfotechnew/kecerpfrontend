'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';

import { Button, Chip, DataTable, Flow, PageHead, Panel } from '@/components/ui';
import type { ChipTone } from '@/components/ui';
import { records } from '@/lib/services';
import type { RecordRow } from '@/lib/types';
import { useProjectData } from '@/lib/project-data';

const CODE = ({ children }: { children: React.ReactNode }) => (
  <span className="num text-[12px]" style={{ color: 'var(--muted)' }}>{children}</span>
);

const RFQ_TONE: Record<string, ChipTone> = {
  'Not yet issued': 'mute',
  'RFQ issued': 'info',
  'Awaiting offers': 'warn',
  'Offers received': 'info',
  'Technical evaluation': 'info',
  'Commercial evaluation': 'info',
  'PO placed': 'ok',
  Closed: 'ok',
};

const TEV_TONE: Record<string, ChipTone> = {
  'In progress': 'info',
  'Technical cleared': 'ok',
  'Commercial cleared': 'ok',
  'Vendor recommended': 'ok',
  'Approved for PO': 'ok',
  Rejected: 'bad',
};

/**
 * RFQ, vendor and TBE — live on the two procurement-support registers:
 * `rfq_registers` (the tracker table) and `technical_evaluations` (the TBE
 * comparison). "Issue RFQ" opens the RFQ register's create form and
 * "Open TBE comparison" opens the evaluation register — both through the
 * generic register engine, so the rows persist like every other register.
 */
export default function EptpRfqPage() {
  const router = useRouter();
  const { current, loading: projectLoading } = useProjectData();
  const [rfqRows, setRfqRows] = useState<RecordRow[]>([]);
  const [tevRows, setTevRows] = useState<RecordRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!current) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    Promise.all([
      records.list('rfq_registers', { projectId: current.id, limit: 200 }),
      records.list('technical_evaluations', { projectId: current.id, limit: 200 }),
    ])
      .then(([rfq, tev]) => {
        if (cancelled) return;
        setRfqRows(rfq.items);
        setTevRows(tev.items);
      })
      .catch((err) => !cancelled && setError(err instanceof Error ? err.message : 'Could not load the RFQ registers'))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [current]);

  /** The TBE panel shows the newest evaluation; the register holds the rest. */
  const activeTev = useMemo(() => [...tevRows].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0] ?? null, [tevRows]);

  /** Plain inline notice: the shared Notice has no tone, and these need one. */
  const note = (text: string, tone: 'info' | 'warn' | 'bad' = 'info') => {
    const map = {
      info: { background: 'var(--accent-soft)', border: '1px solid var(--line)', color: 'var(--accent-dark)' },
      warn: { background: 'var(--amber-soft)', border: '1px solid #ebdab8', color: 'var(--amber)' },
      bad: { background: '#fdecec', border: '1px solid #f2c4c4', color: '#a33' },
    } as const;
    return <div className="mb-[18px] rounded px-3.5 py-2.5 text-[12.5px]" style={map[tone]}>{text}</div>;
  };

  const rfqColumns = [
    { key: 'ref', label: 'RFQ no.' },
    { key: 'item', label: 'Equipment' },
    { key: 'prRef', label: 'Datasheet ref' },
    { key: 'vendorsInvited', label: 'Vendors invited', align: 'right' as const },
    { key: 'offersReceived', label: 'Offers received', align: 'right' as const },
    { key: 'status', label: 'Status', align: 'right' as const },
  ];
  const rfqRowsView = rfqRows.map((r) => [
    <CODE key="ref">{r.ref}</CODE>,
    String(r.data.item ?? '—'),
    <CODE key="pr">{String(r.data.prRef ?? '—')}</CODE>,
    <span key="v" className="num">{String(r.data.vendorsInvited ?? 0)}</span>,
    <span key="o" className="num">{String(r.data.offersReceived ?? 0)}</span>,
    <Chip key="s" tone={RFQ_TONE[String(r.data.status)] ?? 'mute'}>{String(r.data.status ?? 'Not yet issued')}</Chip>,
  ]);

  return (
    <>
      <PageHead
        title="RFQ, vendor & TBE"
        description="Equipment requirement to RFQ, vendor technical offers and the technical bid evaluation that produces a recommendation for Procurement/Commercial."
        actions={
          <>
            <Button onClick={() => router.push('/registers/technical_evaluations')}>Open TBE comparison</Button>
            <Button variant="primary" onClick={() => router.push('/registers/rfq_registers?new=1')}>Issue RFQ</Button>
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

      <Panel title="RFQ tracker" sub="Live from the RFQ register — one row per issued RFQ" bodyless>
        {error ? (
          note(error, 'bad')
        ) : loading ? (
          note('Loading the RFQ register…')
        ) : rfqRows.length === 0 ? (
          note('No RFQs recorded for this project yet. Use "Issue RFQ" to add the first one.', 'warn')
        ) : (
          <DataTable columns={rfqColumns} rows={rfqRowsView} />
        )}
      </Panel>

      <Panel
        title={activeTev ? `Technical bid evaluation — ${String(activeTev.data.item ?? activeTev.ref)}` : 'Technical bid evaluation'}
        sub="Live from the technical / commercial evaluation register — newest first"
        bodyless
      >
        {activeTev ? (
          <DataTable
            columns={[
              { key: 'f', label: 'Field' },
              { key: 'v', label: 'Value' },
            ]}
            rows={[
              ['RFQ reference', <CODE key="ref">{String(activeTev.data.rfqRef ?? activeTev.ref)}</CODE>],
              ['Vendors evaluated', <span key="ve" className="num">{String(activeTev.data.vendorsEvaluated ?? '—')}</span>],
              ['Top technical score', String(activeTev.data.technicalScore ?? '—')],
              ['Top commercial score', String(activeTev.data.commercialScore ?? '—')],
              ['Recommended vendor', String(activeTev.data.recommendedVendor ?? '—')],
              ['Negotiation note', String(activeTev.data.negotiation ?? '—')],
              [
                'Status',
                <Chip key="s" tone={TEV_TONE[String(activeTev.data.status)] ?? 'info'}>
                  {String(activeTev.data.status ?? 'In progress')}
                </Chip>,
              ],
            ]}
          />
        ) : error ? (
          note(error, 'bad')
        ) : (
          note('No evaluation yet. When vendor offers land, open the TBE comparison and record the recommended vendor.', 'warn')
        )}
      </Panel>
    </>
  );
}
