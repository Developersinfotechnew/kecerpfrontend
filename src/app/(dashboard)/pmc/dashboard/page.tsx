'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';

import { Button, Chip, DataTable, Grid, KVList, Notice, PageHead, Panel } from '@/components/ui';
import { records } from '@/lib/services';
import type { RecordRow } from '@/lib/types';
import { useProjectData } from '@/lib/project-data';

// The PMC register keys the dashboard derives from (KEC PMC Rev 0, PDF §6).
const REG = {
  stages: 'stages',
  actions: 'pmc_actions',
  meetings: 'pmc_meetings',
  decisions: 'pmc_decisions',
  risks: 'pmc_risks',
  compliance: 'pmc_compliance',
  audits: 'pmc_audits',
  payments: 'pmc_payments',
  cashflow: 'pmc_cashflow',
  contracts: 'pmc_contracts',
  subsidy: 'pmc_subsidy',
  stakeholders: 'pmc_stakeholders',
} as const;

const STAGE_NAMES = [
  '01 Creation & mobilisation',
  '02 JFR & CGD sync',
  '03 Commercial enablement',
  '04 DPR & financial closure',
  '05 Compliance & audit',
  '06 Handover & subsidy',
  '07 General governance',
];

/**
 * PMC dashboard.
 *
 * Everything on this screen is live from the project's own register rows:
 * stage position comes from the Stage register, RAG is computed from overdue
 * actions + open compliance + audit findings, open/overdue counts come from
 * the control registers, and the "needs attention" feed is the first few
 * overdue or high-severity rows. No hardcoded project text remains.
 */
export default function PmcDashboardPage() {
  const router = useRouter();
  const { current: p, loading, error } = useProjectData();

  const [stages, setStages] = useState<RecordRow[]>([]);
  const [actions, setActions] = useState<RecordRow[]>([]);
  const [meetings, setMeetings] = useState<RecordRow[]>([]);
  const [decisions, setDecisions] = useState<RecordRow[]>([]);
  const [risks, setRisks] = useState<RecordRow[]>([]);
  const [compliance, setCompliance] = useState<RecordRow[]>([]);
  const [audits, setAudits] = useState<RecordRow[]>([]);
  const [subsidy, setSubsidy] = useState<RecordRow[]>([]);
  const [stakeholders, setStakeholders] = useState<RecordRow[]>([]);
  const [payments, setPayments] = useState<RecordRow[]>([]);

  useEffect(() => {
    if (!p) return;
    let cancelled = false;
    const guard = <T,>(promise: Promise<T>, apply: (value: T) => void) =>
      promise.then((v) => { if (!cancelled) apply(v); }).catch(() => undefined);
    const list = (key: string, apply: (rows: RecordRow[]) => void) =>
      guard(records.list(key, { projectId: p.id, limit: 300 }), (page) => apply(page.items));

    list(REG.stages, setStages);
    list(REG.actions, setActions);
    list(REG.meetings, setMeetings);
    list(REG.decisions, setDecisions);
    list(REG.risks, setRisks);
    list(REG.compliance, setCompliance);
    list(REG.audits, setAudits);
    list(REG.payments, setPayments);
    list(REG.subsidy, setSubsidy);
    list(REG.stakeholders, setStakeholders);

    return () => { cancelled = true; };
  }, [p?.id]);

  // --- derived state ------------------------------------------------------

  const openActions = actions.filter((r) => String(r.data.status ?? 'Open') !== 'Closed');
  const overdueActions = openActions.filter((r) => {
    const due = String(r.data.dueDate ?? '');
    return due ? new Date(due).getTime() < Date.now() : false;
  });
  const openCompliance = compliance.filter((r) => !['Complied', 'Exempt'].includes(String(r.data.status ?? '')));
  const openAudits = audits.filter((r) => !['Closed', 'Exception accepted'].includes(String(r.data.status ?? '')));
  const openRisks = risks.filter((r) => String(r.data.status ?? 'Open') !== 'Closed');

  // RAG: red when anything is escalated or overdue, amber when anything is open
  // but on time, green when nothing is open. Derived, not stored.
  const rag = useMemo(() => {
    const escalated = openActions.filter((r) => String(r.data.status) === 'Escalated').length;
    if (escalated > 0 || overdueActions.length > 0) return 'bad' as const;
    if (openActions.length > 0 || openCompliance.length > 0 || openAudits.length > 0) return 'warn' as const;
    return 'ok' as const;
  }, [openActions, overdueActions, openCompliance, openAudits]);

  // Stage position: the stage register is ordered by sortOrder. The current
  // position is the first row that is neither Completed nor Not Applicable;
  // when every row is done, the flow sits at the end.
  const stageIndex = useMemo(() => {
    if (stages.length === 0) return 0;
    const byOrder = [...stages].sort((a, b) => Number(a.data.sortOrder ?? 0) - Number(b.data.sortOrder ?? 0));
    const idx = byOrder.findIndex((r) => !['Completed', 'Not Applicable'].includes(String(r.data.status ?? '')));
    return idx === -1 ? byOrder.length - 1 : idx;
  }, [stages]);

  // The "needs attention" feed: overdue actions first, then open high/critical
  // audits, then open compliance items — the KEC order of urgency.
  const attention = useMemo(() => {
    const items: Array<{ text: string; sub: string; tone: 'bad' | 'warn' | 'ok'; age?: string }> = [];
    for (const r of overdueActions.slice(0, 3)) {
      items.push({
        text: String(r.data.action ?? r.ref),
        sub: `${String(r.data.owner ?? '')} · due ${String(r.data.dueDate ?? '')}`,
        tone: 'bad',
      });
    }
    for (const r of openAudits.filter((a) => ['High', 'Critical'].includes(String(a.data.severity ?? ''))).slice(0, 2)) {
      items.push({
        text: String(r.data.finding ?? r.ref),
        sub: `Audit register · Severity: ${String(r.data.severity ?? '')}`,
        tone: 'warn',
      });
    }
    for (const r of openCompliance.slice(0, 2)) {
      items.push({
        text: String(r.data.requirement ?? r.ref),
        sub: `Compliance register · ${String(r.data.status ?? '')}`,
        tone: 'ok',
      });
    }
    return items;
  }, [overdueActions, openAudits, openCompliance]);

  // Close-out readiness: the share of the stage register that is Completed or
  // Not Applicable. 0 rows = nothing started yet.
  const closureReady =
    stages.length === 0
      ? 0
      : Math.round((stages.filter((r) => ['Completed', 'Not Applicable'].includes(String(r.data.status ?? ''))).length / stages.length) * 100);

  if (error) return <PageHead title="PMC dashboard" description="No project in scope." actions={<Notice>{error}</Notice>} />;
  if (loading || !p) {
    return (
      <Panel title="PMC dashboard" sub="Loading">
        <p className="m-0 p-4 text-[12.5px]" style={{ color: 'var(--muted)' }}>Loading project…</p>
      </Panel>
    );
  }

  const openPayments = payments.filter((r) => !['Paid', 'Closed'].includes(String(r.data.status ?? '')));
  const stageLabel = STAGE_NAMES[Math.min(stageIndex, STAGE_NAMES.length - 1)];

  return (
    <>
      <PageHead
        title="PMC dashboard"
        description={`${p.name} · ${p.type}. KEC acts as Project Management Consultant: advising, coordinating, auditing and reporting. Execution contracts remain with the Client, EPC contractor and lenders.`}
        actions={
          <>
            <Button onClick={() => router.push('/registers/pmc_meetings')}>Log meeting / MOM</Button>
            <Button variant="primary" onClick={() => router.push('/registers/pmc_actions')}>Raise action</Button>
          </>
        }
      />

      <Panel title="PMC lifecycle" sub="Stage-gate framework — seven stages" bodyless>
        <div className="flex flex-wrap items-center gap-1.5">
          {STAGE_NAMES.map((label, i) => {
            const state = i < stageIndex ? 'done' : i === stageIndex ? 'now' : 'todo';
            const style =
              state === 'done'
                ? { borderColor: 'var(--accent)', background: 'var(--accent-soft)', color: 'var(--accent-dark)', fontWeight: 500 }
                : state === 'now'
                  ? { borderColor: 'var(--amber)', background: 'var(--amber-soft)', color: 'var(--amber)', fontWeight: 600 }
                  : { borderColor: 'var(--line)', background: '#fafbfa' };
            return (
              <span key={i} className="flex items-center gap-1.5">
                <span className="rounded px-[11px] py-2 text-[12.5px]" style={style}>{label}</span>
                {i < STAGE_NAMES.length - 1 ? <span style={{ color: 'var(--faint)' }}>→</span> : null}
              </span>
            );
          })}
        </div>
        {stages.length === 0 ? (
          <div className="mt-3 text-[12px]" style={{ color: 'var(--muted)' }}>
            No stage rows yet. Add one per stage in the Stage register and the position updates live.
          </div>
        ) : null}
      </Panel>

      <div className="mt-[18px]" />
      <Grid cols="2-1">
        <Panel title="Current position" sub={stageLabel ?? 'Stage'} bodyless>
          <KVList
            pairs={[
              ['Overall health (RAG)', <span key="r"><span className="mr-1.5 inline-block h-2 w-2 rounded-full align-middle" style={{ background: rag === 'bad' ? 'var(--red)' : rag === 'warn' ? 'var(--amber)' : 'var(--ok)' }} />{rag === 'bad' ? 'Red — needs escalation' : rag === 'warn' ? 'Amber — monitor' : 'Green'}</span>],
              ['Open actions', <span key="a" className="num">{openActions.length}</span>],
              ['Overdue actions', <span key="c" className="num" style={{ color: overdueActions.length ? 'var(--red)' : 'var(--ink)' }}>{overdueActions.length}</span>],
              ['Open compliance items', <span key="o" className="num" style={{ color: openCompliance.length ? 'var(--red)' : 'var(--ink)' }}>{openCompliance.length}</span>],
              ['Open audit findings', <span key="f" className="num">{openAudits.length}</span>],
              ['Open risks', <span key="rk" className="num">{openRisks.length}</span>],
              ['Stakeholders on record', <span key="s" className="num">{stakeholders.length}</span>],
            ]}
          />
        </Panel>

        <Panel title="Needs attention" sub={attention.length ? `${attention.length} item(s)` : 'Nothing urgent'} bodyless>
          {attention.length === 0 ? (
            <p className="m-0 p-4 text-[12.5px]" style={{ color: 'var(--muted)' }}>
              No overdue actions, no high-severity audit findings, no open compliance items.
            </p>
          ) : (
            <div className="divide-y" style={{ borderColor: 'var(--line)' }}>
              {attention.map((a, i) => (
                <div key={i} className="flex items-start gap-2 px-4 py-2.5">
                  <span className="mt-1 h-2 w-2 flex-none rounded-full" style={{ background: a.tone === 'bad' ? 'var(--red)' : a.tone === 'warn' ? 'var(--amber)' : 'var(--ok)' }} />
                  <div className="min-w-0">
                    <div className="text-[12.5px] font-medium">{a.text}</div>
                    <div className="text-[11.5px]" style={{ color: 'var(--muted)' }}>{a.sub}</div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </Panel>
      </Grid>

      <div className="mt-[18px]" />
      <Grid cols={3}>
        <Panel
          title="KPI — overall"
          sub="Stage, RAG, open actions, key decisions"
          bodyless
        >
          <KVList
            pairs={[
              ['Current stage', <span key="s" className="num">{stageLabel}</span>],
              ['Closure readiness', <span key="c" className="num">{closureReady}%</span>],
              ['Key decisions (open)', <span key="d" className="num">{decisions.filter((r) => String(r.data.status) === 'Open').length}</span>],
            ]}
          />
        </Panel>

        <Panel title="KPI — compliance & audit" sub="Stage 3 gate">
          <KVList
            pairs={[
              ['Audits open', <span key="a" className="num">{openAudits.length}</span>],
              ['Compliance open', <span key="c" className="num">{openCompliance.length}</span>],
              ['Risks open', <span key="r" className="num">{openRisks.length}</span>],
            ]}
          />
        </Panel>

        <Panel title="KPI — payment & handover" sub="Stage 3/4">
          <KVList
            pairs={[
              ['Payments open', <span key="p" className="num">{openPayments.length}</span>],
              ['Subsidy in progress', <span key="s" className="num">{subsidy.filter((r) => !['Not applicable', 'Disbursed'].includes(String(r.data.status ?? ''))).length}</span>],
              ['Meetings held (all)', <span key="m" className="num">{meetings.length}</span>],
            ]}
          />
        </Panel>
      </Grid>
    </>
  );
}
