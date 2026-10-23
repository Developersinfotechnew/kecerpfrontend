'use client';

import { Button, Chip, DataTable, Feed, Grid, KVList, PageHead, Panel } from '@/components/ui';

const CODE = ({ children }: { children: React.ReactNode }) => (
  <span className="num text-[12px]" style={{ color: 'var(--muted)' }}>{children}</span>
);

/** PMC dashboard — stage, RAG, open actions, closure readiness. */
export default function PmcDashboardPage() {
  const stage = 'Stage 3 — Compliance & Audit';
  const rag: 'ok' | 'warn' | 'bad' = 'bad';

  return (
    <>
      <PageHead
        title="PMC dashboard"
        description="Rajasthan Green Fuels — Jaipur Plant · CBG + FOM 90 TPD. KEC acts as Project Management Consultant: advising, coordinating, auditing and reporting. Execution contracts remain with the Client, EPC contractor and lenders."
        actions={
          <>
            <Button>Log meeting / MOM</Button>
            <Button variant="primary">Raise action</Button>
          </>
        }
      />

      <Panel title="PMC lifecycle" sub="Stage-gate framework — Rev 0 scope">
        <div className="flex flex-wrap items-center gap-1.5">
          {['01 Creation & mobilisation', '02 JFR & CGD sync', '03 Commercial enablement', '04 DPR & financial closure', '05 Compliance & audit', '06 Handover & subsidy', '07 General governance'].map((s, i, arr) => {
            const state = i < 4 ? 'done' : i === 4 ? 'now' : 'todo';
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
          <Panel title="Current stage" sub={stage}>
            <KVList
              pairs={[
                ['Overall health (RAG)', <span key="r"><span className="mr-1.5 inline-block h-2 w-2 rounded-full align-middle" style={{ background: rag === 'bad' ? 'var(--red)' : 'var(--amber)' }} />{rag === 'bad' ? 'Red — needs escalation' : 'Amber — monitor'}</span>],
                ['Open actions', <span key="a" className="num">9</span>],
                ['Overdue compliance items', <span key="c" className="num" style={{ color: 'var(--red)' }}>2</span>],
                ['Financial closure readiness', <span key="f" className="num">100%</span>],
                ['PMC Project Manager', 'Rakesh Verma'],
                ['Client representative', 'Authorized signatory, Rajasthan Green Fuels'],
              ]}
            />
          </Panel>
          <Panel title="Register status" sub="14 mandatory PMC registers" bodyless>
            <DataTable
              columns={[
                { key: 'r', label: 'Register' },
                { key: 'o', label: 'Open' },
                { key: 'ov', label: 'Overdue' },
                { key: 'u', label: 'Last updated' },
              ]}
              rows={[
                ['Stage Register', '7', '0', 'Today'],
                ['Stakeholder Register', '18', '—', '3d ago'],
                ['Action Register', '12', '3', <Chip key="c" tone="bad">3 overdue</Chip>],
                ['Decision Register', '6', '—', '1w ago'],
                ['Document Register / DCI', '86', '4', <Chip key="c" tone="warn">4 pending</Chip>],
                ['Meeting Register', '9', '—', '2d ago'],
                ['Risk Register', '8', '1', <Chip key="c" tone="warn">1 high</Chip>],
                ['Issue Register', '5', '2', <Chip key="c" tone="warn">2 open</Chip>],
                ['Compliance Register', '11', '2', <Chip key="c" tone="bad">Overdue</Chip>],
                ['Audit Register', '4', '1', <Chip key="c" tone="warn">Finding open</Chip>],
                ['Financial Tracker', '—', '—', 'Live'],
                ['Contract Register', '3', '—', '2w ago'],
                ['Handover Register', '—', '—', 'Not started'],
                ['Subsidy Register', '—', '—', 'Not applicable'],
              ]}
            />
          </Panel>
        </div>
        <div>
          <Panel title="Needs attention">
            <Feed
              items={[
                { tone: 'bad', text: 'Monthly EPC audit finding — payment released ahead of certified progress', meta: 'Audit register · Severity: High', time: '1d' },
                { tone: 'warn', text: 'TPA term sheet awaiting Client legal review', meta: 'Commercial enablement', time: '2d' },
                { tone: 'warn', text: 'TEV agency data request outstanding for 9 days', meta: 'DPR & financial closure', time: '2d' },
                { tone: 'info', text: 'Quarterly lender presentation scheduled', meta: '28 Sep 2026', time: '3d' },
              ]}
            />
          </Panel>
          <Panel title="Upcoming governance" bodyless>
            <DataTable
              columns={[
                { key: 'm', label: 'Meeting' },
                { key: 'd', label: 'Date' },
                { key: 'p', label: 'Participants' },
              ]}
              rows={[
                ['Monthly progress review', '30 Sep', 'Client, PMC, EPC'],
                ['Lender presentation', '02 Oct', 'Client, PMC, Lender'],
                ['Compliance audit close-out', '05 Oct', 'PMC, EPC'],
              ]}
            />
          </Panel>
        </div>
      </Grid>
    </>
  );
}
