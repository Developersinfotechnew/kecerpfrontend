'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';

import { Button, Chip, DataTable, PageHead, Panel } from '@/components/ui';
import type { ChipTone } from '@/components/ui';
import { records } from '@/lib/services';
import type { RecordListPage } from '@/lib/types';
import { useProjectData } from '@/lib/project-data';

const CODE = ({ children }: { children: React.ReactNode }) => (
  <span className="num text-[12px]" style={{ color: 'var(--muted)' }}>{children}</span>
);

const CMP_TONE: Record<string, ChipTone> = {
  Open: 'bad',
  'In progress': 'warn',
  Complied: 'ok',
  Exempt: 'mute',
  Overdue: 'bad',
};

const BOQ_TONE: Record<string, ChipTone> = {
  'Pending approval': 'warn',
  Approved: 'ok',
  'PR raised': 'info',
  'PO raised': 'info',
  'Partially received': 'info',
  Received: 'ok',
  Superseded: 'mute',
};

/** Bumps a revision label one step: "Rev-A" → "Rev-B". */
const nextRevision = (rev: string): string => {
  const m = rev.match(/^[A-Z]{2,3}-(\w)/i);
  if (!m) return `${rev}-1`;
  const ch = m[1];
  const next = ch === 'Z' ? 'A' : String.fromCharCode(ch.charCodeAt(0) + 1);
  return `Rev-${next}`;
};

/**
 * Compliance & BOQ freeze — live on two registers. The codes table reads the
 * compliance register; the BOQ table reads the project's BOQ items. "Add
 * compliance item" opens the compliance register's create form; "Freeze BOQ
 * revision" bumps every open BOQ item to the next revision letter and marks
 * it Approved (the G7 gate action), through the normal register API.
 */
export default function EptpBoqPage() {
  const router = useRouter();
  const { current } = useProjectData();

  const [cmp, setCmp] = useState<RecordListPage | null>(null);
  const [boq, setBoq] = useState<RecordListPage | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [freezeBusy, setFreezeBusy] = useState(false);
  const [freezeMsg, setFreezeMsg] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!current) return;
    setLoading(true);
    setError(null);
    try {
      const [c, b] = await Promise.all([
        records.list('pmc_compliance', { projectId: current.id, limit: 200 }),
        records.list('boq_register', { projectId: current.id, limit: 500 }),
      ]);
      setCmp(c);
      setBoq(b);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load the registers');
    } finally {
      setLoading(false);
    }
  }, [current]);

  useEffect(() => {
    void load();
  }, [load]);

  /** G7: freeze the revision — bump Rev-X one letter and mark Approved. */
  const freezeBoq = async () => {
    if (!boq || boq.items.length === 0) {
      setFreezeMsg('No BOQ items to freeze yet. Add BOQ items first, then freeze.');
      return;
    }
    const n = window.confirm(
      `Freeze BOQ revision for ${boq.items.length} item(s)?\n\n` +
        'Every open BOQ item moves to the next revision letter and is marked Approved. Superseded items are left untouched.',
    );
    if (!n) return;
    setFreezeBusy(true);
    setFreezeMsg(null);
    try {
      const touched = boq.items.filter((r) => String(r.data.status ?? '') !== 'Superseded');
      await Promise.all(
        touched.map((r) =>
          records.update('boq_register', r.id, {
            revision: nextRevision(String(r.data.revision || 'Rev-A')),
            status: 'Approved',
          }),
        ),
      );
      const nextRev = nextRevision(String(boq.items[0].data.revision || 'Rev-A'));
      setFreezeMsg(`BOQ frozen at ${nextRev} — ${touched.length} item(s) marked Approved.`);
      void load();
    } catch (err) {
      setFreezeMsg(`Freeze failed: ${err instanceof Error ? err.message : 'unknown error'}`);
    } finally {
      setFreezeBusy(false);
    }
  };

  const note = (text: string, tone: 'info' | 'warn' | 'bad' = 'info') => {
    const map = {
      info: { background: 'var(--accent-soft)', border: '1px solid var(--line)', color: 'var(--accent-dark)' },
      warn: { background: 'var(--amber-soft)', border: '1px solid #ebdab8', color: 'var(--amber)' },
      bad: { background: '#fdecec', border: '1px solid #f2c4c4', color: '#a33' },
    } as const;
    return <div className="mb-[18px] rounded px-3.5 py-2.5 text-[12.5px]" style={map[tone]}>{text}</div>;
  };

  const currentRev = boq && boq.items.length > 0 ? String(boq.items[0].data.revision || 'Rev-A') : 'Rev-A';

  return (
    <>
      <PageHead
        title="Compliance & BOQ freeze"
        description="Applicable codes and statutory requirements, and the engineering BOQ moving from preliminary through verification to freeze for EPC contracting."
        actions={
          <>
            <Button onClick={() => router.push('/registers/pmc_compliance?new=1')}>Add compliance item</Button>
            <Button variant="primary" disabled={freezeBusy} onClick={() => void freezeBoq()}>
              {freezeBusy ? 'Freezing…' : 'Freeze BOQ revision'}
            </Button>
          </>
        }
      />

      {freezeMsg ? <div className="mb-[14px] rounded px-3.5 py-2.5 text-[12.5px]" style={{ background: 'var(--accent-soft)', border: '1px solid var(--line)', color: 'var(--accent-dark)' }}>{freezeMsg}</div> : null}

      <Panel title="Codes & compliance register" sub="Live from the compliance register — statutory and contractual requirements" bodyless>
        {error ? (
          note(error, 'bad')
        ) : loading ? (
          note('Loading the registers…')
        ) : (cmp && cmp.items.length === 0 ? (
          note('No compliance items recorded yet. Use "Add compliance item" to record the first requirement.', 'warn')
        ) : (
          <DataTable
            columns={[
              { key: 'requirement', label: 'Requirement' },
              { key: 'authority', label: 'Authority / code' },
              { key: 'dueDate', label: 'Due date' },
              { key: 'evidence', label: 'Evidence' },
              { key: 'status', label: 'Status', align: 'right' },
            ]}
            rows={(cmp?.items ?? []).map((r) => [
              String(r.data.requirement ?? '—'),
              <CODE key="a">{String(r.data.authority ?? '—')}</CODE>,
              String(r.data.dueDate || '—'),
              String(r.data.evidence ?? '—'),
              <Chip key="s" tone={CMP_TONE[String(r.data.status)] ?? 'mute'}>{String(r.data.status ?? 'Open')}</Chip>,
            ])}
          />
        ))}
      </Panel>

      <Panel title="Engineering BOQ" sub={`Live from the BOQ register — ${currentRev}`} bodyless>
        {error ? (
          note(error, 'bad')
        ) : loading ? (
          note('Loading the registers…')
        ) : (boq && boq.items.length === 0 ? (
          note('No BOQ items recorded yet for this project.', 'warn')
        ) : (
          <DataTable
            columns={[
              { key: 'description', label: 'BOQ item' },
              { key: 'wbsRef', label: 'Engineering reference' },
              { key: 'quantity', label: 'Quantity', align: 'right' },
              { key: 'amount', label: 'Est. cost (₹L)', align: 'right' },
              { key: 'revision', label: 'Revision', align: 'right' },
              { key: 'status', label: 'Status', align: 'right' },
            ]}
            rows={(boq?.items ?? []).map((r) => [
              String(r.data.description ?? r.ref),
              <CODE key="r">{String(r.data.wbsRef ?? r.data.poRef ?? '—')}</CODE>,
              <span key="q" className="num">{String(r.data.quantity ?? '—')}</span>,
              <span key="c" className="num">{String(r.data.amount ?? '—')}</span>,
              <span key="rv">{String(r.data.revision ?? 'Rev-A')}</span>,
              <Chip key="s" tone={BOQ_TONE[String(r.data.status)] ?? 'mute'}>{String(r.data.status ?? 'Pending approval')}</Chip>,
            ])}
          />
        ))}
      </Panel>
    </>
  );
}
