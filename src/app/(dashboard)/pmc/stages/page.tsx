'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';

import { Button, Chip, DataTable, Notice, PageHead, Panel } from '@/components/ui';
import { records } from '@/lib/services';
import type { RecordRow } from '@/lib/types';
import { useProjectData } from '@/lib/project-data';

const STAGE_NAMES = [
  '01 Creation & mobilisation',
  '02 JFR & CGD sync',
  '03 Commercial enablement',
  '04 DPR & financial closure',
  '05 Compliance & audit',
  '06 Handover & subsidy',
  '07 General governance',
];

// The seven-stage objective/gate text is the KEC framework — a fixed spec, not
// live data. Status, owner and dates on the same stage come from the live
// Stage register.
const FRAMEWORK: Array<{ s: string; o: string; c: string; p: string }> = [
  { s: '01', o: 'Project creation & PMC mobilisation', c: 'Appointment → Project Master → scope → stakeholders → governance → kickoff', p: 'Project activation gate' },
  { s: '02', o: 'JFR & CGD synchronisation', c: 'JFR/feasibility → site/climate study → GOBARDHAN support → evacuation → CGD/OMC planning', p: 'Technical/commercial readiness' },
  { s: '03', o: 'Commercial enablement', c: 'TPA if applicable → Term Sheet → LOI → offtake support', p: 'Commercial readiness' },
  { s: '04', o: 'DPR & financial closure', c: 'Bankable DPR → lender/investor ID → TEV coordination → lender presentations', p: 'Financial closure readiness' },
  { s: '05', o: 'Compliance & audit', c: 'Monthly EPC audit → payment/cash-flow tracking → contract compliance → forensic checks if required', p: 'Monthly compliance gate' },
  { s: '06', o: 'Handover & subsidy', c: 'PGTR coordination → final documents/as-builts → subsidy facilitation if applicable', p: 'Handover/closure gate' },
  { s: '07', o: 'General PMC governance', c: 'Meetings → progress review → Client/lender reporting → actions/escalations', p: 'Management governance' },
];

function statusTone(s: string): 'ok' | 'warn' | 'bad' | 'info' | 'mute' {
  if (s === 'Completed') return 'ok';
  if (s === 'Active') return 'info';
  if (s === 'On Hold') return 'warn';
  if (s === 'Not Applicable') return 'mute';
  return 'warn';
}

/**
 * Stage-gate & scope blocks.
 *
 * The framework table is the KEC Rev 0 spec (fixed). The status on each stage,
 * the owner, and the planned/actual dates are read live from the Stage
 * register for the current project, so a stage moving from Active to
 * Completed here mirrors the register, not a hardcode.
 */
export default function PmcStagesPage() {
  const router = useRouter();
  const { current: p, loading, error } = useProjectData();
  const [stages, setStages] = useState<RecordRow[]>([]);

  useEffect(() => {
    if (!p) return;
    let cancelled = false;
    records
      .list('stages', { projectId: p.id, limit: 200 })
      .then((page) => { if (!cancelled) setStages(page.items); })
      .catch(() => { if (!cancelled) setStages([]); })
      .finally(() => undefined);
    return () => { cancelled = true; };
  }, [p?.id]);

  // Live status keyed by stage label (matched on the first two chars of the
  // stage code, or the full label when a user typed it verbatim).
  const statusByPrefix = useMemo(() => {
    const map = new Map<string, RecordRow>();
    for (const r of stages) {
      const label = String(r.data.stage ?? '').trim();
      const prefix = label.slice(0, 2);
      if (prefix && !map.has(prefix)) map.set(prefix, r);
    }
    return map;
  }, [stages]);

  if (error) return <PageHead title="Stage-gate & scope blocks" description="No project in scope." actions={<Notice>{error}</Notice>} />;
  if (loading || !p) return <Panel title="Stage-gate & scope blocks" sub="Loading"><p className="m-0 p-4 text-[12.5px]" style={{ color: 'var(--muted)' }}>Loading project…</p></Panel>;

  return (
    <>
      <PageHead
        title="Stage-gate & scope blocks"
        description="The project cannot move to a stage without its predecessor's minimum information and approval status. Optional activities are activated explicitly, with a reason and an audit trail."
        actions={<Button variant="primary" onClick={() => router.push('/registers/stages')}>Manage stages</Button>}
      />

      <Panel title="Stage-gate framework" sub="KEC Rev 0 spec · live status from the Stage register" bodyless>
        <DataTable
          columns={[
            { key: 's', label: 'Stage' },
            { key: 'o', label: 'Objective' },
            { key: 'c', label: 'Minimum process chain' },
            { key: 'p', label: 'Primary control' },
            { key: 'st', label: 'Status', align: 'right' },
            { key: 'own', label: 'Owner', align: 'right' },
          ]}
          rows={FRAMEWORK.map((f) => {
            const prefix = f.s;
            const live = statusByPrefix.get(prefix);
            const status = live ? String(live.data.status ?? '') : '';
            const owner = live ? String(live.data.owner ?? '') : '';
            return [
              f.s,
              f.o,
              f.c,
              f.p,
              status ? <Chip key="st" tone={statusTone(status)}>{status}</Chip> : <Chip key="st" tone="mute">Not set</Chip>,
              owner || <span key="o" style={{ color: 'var(--muted)' }}>—</span>,
            ];
          })}
        />
      </Panel>

      <div className="mt-[18px]" />
      <Panel title="Scope block applicability" sub="Live from the Stage register — Not Applicable rows read as scoped-out blocks" bodyless>
        {stages.length === 0 ? (
          <p className="m-0 p-4 text-[12.5px]" style={{ color: 'var(--muted)' }}>
            No stage rows yet for {p.name}. Add a row per stage (owner, dates, status) in the Stage register and the framework above lights up.
          </p>
        ) : (
          <DataTable
            columns={[
              { key: 'b', label: 'Scope block / stage' },
              { key: 'a', label: 'Applicability' },
              { key: 'd', label: 'Planned date' },
              { key: 'ad', label: 'Actual date' },
            ]}
            rows={stages.map((r) => {
              const applicable = String(r.data.status ?? '') !== 'Not Applicable';
              return [
                String(r.data.stage ?? r.ref),
                <Chip key="c" tone={applicable ? 'ok' : 'mute'}>{applicable ? 'Applicable' : 'Not applicable'}</Chip>,
                String(r.data.plannedDate ?? '—'),
                String(r.data.actualDate ?? '—'),
              ];
            })}
          />
        )}
      </Panel>
    </>
  );
}
