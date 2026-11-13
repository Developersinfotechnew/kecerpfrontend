'use client';

import { useRouter } from 'next/navigation';

import { Bar, Button, Chip, DataTable, Feed, Grid, KVList, PageHead, Panel } from '@/components/ui';

/**
 * EPTP dashboard — gate governance, WBS progress, deliverables.
 * The header buttons and the "Needs attention" items are live entry points:
 * they open the real action (RFI) register or the service-order register
 * with the create form ready (?new=1), so an attention row becomes a raised
 * action in one click.
 */
export default function EptpDashboardPage() {
  const router = useRouter();

  /** Raise a targeted action: open the RFI register create form, subject prefilled. */
  const raiseAction = (subject: string) => {
    router.push(`/registers/rfi_register?new=1&subject=${encodeURIComponent(subject)}`);
  };

  return (
    <div className="eptp-dashboard">
      <style>{EptpDashboardStyles}</style>
      <PageHead
        title="EPTP dashboard"
        description="Narmada Bioenergy LLP — Indore Plant · Bio-CNG 130 TPD. Converts the CRM service order into a controlled Technology, Engineering, Procurement-support and BOQ package for EPC handover."
        actions={
          <>
            <Button onClick={() => router.push('/registers/crm_deals?new=1')}>Service order intake</Button>
            <Button variant="primary" onClick={() => raiseAction('')}>Raise action</Button>
          </>
        }
      />

      <Panel title="Stage-gate governance" sub="G0 CRM acceptance → G8 EPC package handover">
        <div className="flex flex-wrap items-center gap-1.5">
          {['G0 SO acceptance', 'G1 Initiation', 'G2 Technology freeze', 'G3 Core engineering freeze', 'G4 RFQ readiness', 'G5 Vendor recommendation', 'G6 Compliance readiness', 'G7 BOQ freeze', 'G8 EPC handover'].map((s, i, arr) => {
            const state = i < 3 ? 'done' : i === 3 ? 'now' : 'todo';
            const style =
              state === 'done'
                ? { borderColor: 'var(--accent)', background: 'var(--accent-soft)', color: 'var(--accent-dark)', fontWeight: 500 }
                : state === 'now'
                  ? { borderColor: 'var(--amber)', background: 'var(--amber-soft)', color: 'var(--amber)', fontWeight: 600 }
                  : { borderColor: 'var(--line)', background: '#fafbfa' };
            return (
              <span key={i} className="flex items-center gap-1.5">
                <span className="rounded px-[11px] py-2 text-[12.5px]" style={style}>{s}</span>
                {i < arr.length - 1 ? <span style={{ color: 'var(--faint)' }}>→</span> : null}
              </span>
            );
          })}
        </div>
      </Panel>

      <Grid cols="2-1">
        <div>
          <Panel title="WBS progress by workstream" bodyless>
            <DataTable
              columns={[
                { key: 'w', label: 'Workstream' },
                { key: 'wt', label: 'Weight' },
                { key: 'p', label: 'Progress' },
                { key: 's', label: 'Status' },
              ]}
              rows={[
                ['Technology transfer', '15%', <Bar key="b" pct={100} />, <Chip key="c" tone="ok">Frozen</Chip>],
                ['Core & detailed engineering', '40%', <Bar key="b" pct={38} />, <Chip key="c" tone="info">In progress</Chip>],
                ['Procurement support (RFQ/TBE)', '20%', <Bar key="b" pct={14} />, <Chip key="c" tone="info">Started</Chip>],
                ['Codes & compliance', '10%', <Bar key="b" pct={6} />, <Chip key="c" tone="info">Started</Chip>],
                ['BOQ finalisation', '15%', <Bar key="b" pct={0} />, <Chip key="c" tone="mute">Not started</Chip>],
              ]}
            />
          </Panel>
          <Panel title="Engineering deliverable status" bodyless>
            <DataTable
              columns={[
                { key: 'd', label: 'Discipline' },
                { key: 'p', label: 'Planned' },
                { key: 'i', label: 'Issued' },
                { key: 'a', label: 'Approved' },
                { key: 'o', label: 'Overdue' },
              ]}
              rows={[
                ['Process', <span key="p" className="num">14</span>, <span key="i" className="num">12</span>, <span key="a" className="num">10</span>, <span key="o" className="num">0</span>],
                ['Mechanical', <span key="p" className="num">22</span>, <span key="i" className="num">9</span>, <span key="a" className="num">6</span>, <span key="o" className="num">2</span>],
                ['Civil / structural', <span key="p" className="num">10</span>, <span key="i" className="num">10</span>, <span key="a" className="num">8</span>, <span key="o" className="num">0</span>],
                ['Electrical', <span key="p" className="num">12</span>, <span key="i" className="num">3</span>, <span key="a" className="num">1</span>, <span key="o" className="num">1</span>],
                ['Instrumentation & automation', <span key="p" className="num">11</span>, <span key="i" className="num">2</span>, <span key="a" className="num">0</span>, <span key="o" className="num">1</span>],
              ]}
            />
          </Panel>
        </div>
        <div>
          <Panel title="Needs attention">
            <Feed
              items={[
                {
                  tone: 'bad',
                  time: '1d',
                  meta: 'Gate G4 at risk',
                  text: (
                    <>
                      2 instrumentation datasheets overdue for RFQ readiness
                      <button type="button" className="raise-link" onClick={() => raiseAction('Instrumentation datasheets overdue for RFQ readiness — Gate G4 at risk')}>Raise action</button>
                    </>
                  ),
                },
                {
                  tone: 'warn',
                  time: '2d',
                  meta: 'Core engineering',
                  text: (
                    <>
                      Mechanical equipment sizing pending client feed data
                      <button type="button" className="raise-link" onClick={() => raiseAction('Mechanical equipment sizing pending client feed data')}>Raise action</button>
                    </>
                  ),
                },
                {
                  tone: 'info',
                  time: '1w',
                  meta: 'Technology transfer',
                  text: 'Design basis freeze memo issued',
                },
              ]}
            />
          </Panel>
          <Panel title="Key output">
            <KVList
              pairs={[
                ['Current gate', 'G3 — Core Engineering Freeze'],
                ['RFQs pending issue', <span key="r" className="num">6</span>],
                ['BOQ status', <Chip key="b" tone="warn">Preliminary</Chip>],
                ['Target EPC handover', 'Feb 2027'],
              ]}
            />
          </Panel>
        </div>
      </Grid>
    </div>
  );
}

const EptpDashboardStyles = `
.eptp-dashboard .raise-link{margin-left:10px;padding:0;border:0;background:none;cursor:pointer;font-size:12px;font-weight:600;color:var(--accent);text-decoration:underline;text-underline-offset:2px}
.eptp-dashboard .raise-link:hover{color:var(--accent-dark)}
`;

