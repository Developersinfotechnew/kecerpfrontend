'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';

import { Button, Chip, DataTable, Grid, Notice, PageHead, Panel } from '@/components/ui';
import { records } from '@/lib/services';
import type { RecordRow } from '@/lib/types';
import { useProjectData } from '@/lib/project-data';

function handoverTone(s: string): 'ok' | 'warn' | 'bad' | 'info' | 'mute' {
  if (s === 'Closed' || s === 'Accepted') return 'ok';
  if (s === 'In progress' || s === 'Pending') return 'info';
  return 'warn';
}
function subsidyTone(s: string): 'ok' | 'warn' | 'bad' | 'info' | 'mute' {
  if (s === 'Approved' || s === 'Disbursed') return 'ok';
  if (s === 'Submitted' || s === 'In progress') return 'info';
  if (s === 'Not applicable') return 'mute';
  return 'warn';
}

/**
 * Handover & subsidy.
 *
 * Two live registers: the existing handover register (PGTR coordination,
 * final documentation and as-builts) and the subsidy register for the
 * facilitation step. The "handover has not started" note is derived, not
 * hard-coded: it shows only when no handover row has started yet.
 */
export default function PmcHandoverPage() {
  const router = useRouter();
  const { current: p, loading, error } = useProjectData();
  const [handover, setHandover] = useState<RecordRow[]>([]);
  const [subsidy, setSubsidy] = useState<RecordRow[]>([]);

  useEffect(() => {
    if (!p) return;
    let cancelled = false;
    const guard = <T,>(promise: Promise<T>, apply: (value: T) => void) =>
      promise.then((v) => { if (!cancelled) apply(v); }).catch(() => undefined);
    guard(records.list('handover_items', { projectId: p.id, limit: 300 }), (pg) => setHandover(pg.items));
    guard(records.list('pmc_subsidy', { projectId: p.id, limit: 300 }), (pg) => setSubsidy(pg.items));
    return () => { cancelled = true; };
  }, [p?.id]);

  const notStarted = useMemo(
    () => handover.length > 0 && handover.every((r) => String(r.data.status ?? '') === 'Not started'),
    [handover],
  );

  if (error) return <PageHead title="Handover & subsidy" description="No project in scope." actions={<Notice>{error}</Notice>} />;
  if (loading || !p) return <Panel title="Handover & subsidy" sub="Loading"><p className="m-0 p-4 text-[12.5px]" style={{ color: 'var(--muted)' }}>Loading project…</p></Panel>;

  return (
    <>
      <PageHead
        title="Handover & subsidy"
        description="PGTR coordination, final documentation and as-builts, and subsidy facilitation where applicable. Handover closes only after Client acceptance or an approved exception."
        actions={<Button variant="primary" onClick={() => router.push('/registers/handover_items')}>Add handover item</Button>}
      />

      {handover.length === 0 ? (
        <Notice>
          No handover items yet for {p.name}. Stage 6 opens once Stage 5 compliance and audit findings are closed.
        </Notice>
      ) : notStarted ? (
        <Notice>
          Handover has not yet started for this project — every item is still in Not started.
        </Notice>
      ) : null}

      <div className="mt-[18px]" />
      <Grid cols={2}>
        <Panel title="PGTR & handover items" sub={`${handover.length} item(s)`} bodyless>
          {handover.length === 0 ? (
            <p className="m-0 p-4 text-[12.5px]" style={{ color: 'var(--muted)' }}>Nothing tracked yet. Add PGTR, final-document and as-built items.</p>
          ) : (
            <DataTable
              columns={[
                { key: 'i', label: 'Item' },
                { key: 'a', label: 'Responsible' },
                { key: 'd', label: 'Due date' },
                { key: 's', label: 'Status' },
              ]}
              rows={handover.map((r) => [
                String(r.data.item ?? r.ref),
                String(r.data.responsible ?? '—'),
                String(r.data.dueDate ?? 'Not scheduled'),
                <Chip key="s" tone={handoverTone(String(r.data.status ?? ''))}>{String(r.data.status ?? 'Not started')}</Chip>,
              ])}
            />
          )}
        </Panel>
        <Panel title="Subsidy register" sub={`${subsidy.length} scheme(s)`} bodyless>
          {subsidy.length === 0 ? (
            <p className="m-0 p-4 text-[12.5px]" style={{ color: 'var(--muted)' }}>No subsidy facilitation tracked. Mark it Not applicable if the client applies directly.</p>
          ) : (
            <DataTable
              columns={[
                { key: 's', label: 'Scheme' },
                { key: 'a', label: 'Authority' },
                { key: 'st', label: 'Status' },
                { key: 'am', label: 'Amount (₹L)', align: 'right' },
              ]}
              rows={subsidy.map((r) => [
                String(r.data.scheme ?? r.ref),
                String(r.data.authority ?? '—'),
                <Chip key="s" tone={subsidyTone(String(r.data.status ?? ''))}>{String(r.data.status ?? '—')}</Chip>,
                <span key="am" className="num">{r.data.amount !== '' && r.data.amount != null ? Number(r.data.amount).toLocaleString() : '—'}</span>,
              ])}
            />
          )}
        </Panel>
      </Grid>
    </>
  );
}
