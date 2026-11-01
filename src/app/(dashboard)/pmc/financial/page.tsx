'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';

import { Button, Chip, DataTable, Grid, Notice, PageHead, Panel } from '@/components/ui';
import { records } from '@/lib/services';
import type { RecordRow } from '@/lib/types';
import { useProjectData } from '@/lib/project-data';

function payTone(s: string): 'ok' | 'warn' | 'bad' | 'info' | 'mute' {
  if (s === 'Paid') return 'ok';
  if (s === 'Approved, unpaid') return 'warn';
  if (s === 'Overdue') return 'bad';
  return 'info';
}
function auditTone(s: string): 'ok' | 'warn' | 'bad' | 'info' | 'mute' {
  if (s === 'Closed' || s === 'Exception accepted') return 'ok';
  if (s === 'Response awaited') return 'info';
  return 'bad';
}

/**
 * Financial & audit.
 *
 * Three live registers, no demo rows: the payment register (approved vs paid
 * per contract package, the PMC monitors but is not the payer), the
 * cash-flow tracker (forecast vs actual with the variance reason), and the
 * monthly EPC audit findings (severity + closure).
 */
export default function PmcFinancialPage() {
  const router = useRouter();
  const { current: p, loading, error } = useProjectData();
  const [payments, setPayments] = useState<RecordRow[]>([]);
  const [cashflow, setCashflow] = useState<RecordRow[]>([]);
  const [audits, setAudits] = useState<RecordRow[]>([]);

  useEffect(() => {
    if (!p) return;
    let cancelled = false;
    const guard = <T,>(promise: Promise<T>, apply: (value: T) => void) =>
      promise.then((v) => { if (!cancelled) apply(v); }).catch(() => undefined);
    guard(records.list('pmc_payments', { projectId: p.id, limit: 300 }), (pg) => setPayments(pg.items));
    guard(records.list('pmc_cashflow', { projectId: p.id, limit: 300 }), (pg) => setCashflow(pg.items));
    guard(records.list('pmc_audits', { projectId: p.id, limit: 300 }), (pg) => setAudits(pg.items));
    return () => { cancelled = true; };
  }, [p?.id]);

  if (error) return <PageHead title="Financial & audit" description="No project in scope." actions={<Notice>{error}</Notice>} />;
  if (loading || !p) return <Panel title="Financial & audit" sub="Loading"><p className="m-0 p-4 text-[12.5px]" style={{ color: 'var(--muted)' }}>Loading project…</p></Panel>;

  return (
    <>
      <PageHead
        title="Financial & audit"
        description="Payment and cash-flow monitoring without the PMC being the payer or system of record, plus the monthly EPC audit trail."
        actions={<Button variant="primary" onClick={() => router.push('/registers/pmc_audits')}>Log audit finding</Button>}
      />

      <Panel title="Payment register" sub={`${payments.length} row(s) · Client/Finance remains system of record`} bodyless>
        {payments.length === 0 ? (
          <p className="m-0 p-4 text-[12.5px]" style={{ color: 'var(--muted)' }}>No payment rows yet. Add one per invoice in the Payment register.</p>
        ) : (
          <DataTable
            columns={[
              { key: 'i', label: 'Invoice / bill' },
              { key: 'c', label: 'Contract package' },
              { key: 'd', label: 'Due date' },
              { key: 'a', label: 'Approved (₹L)', align: 'right' },
              { key: 'p', label: 'Paid (₹L)', align: 'right' },
              { key: 's', label: 'Status', align: 'right' },
            ]}
            rows={payments.map((r) => [
              String(r.data.invoice ?? r.ref),
              String(r.data.contractPackage ?? '—'),
              String(r.data.dueDate ?? '—'),
              <span key="a" className="num">{r.data.approved !== '' && r.data.approved != null ? Number(r.data.approved).toLocaleString() : '—'}</span>,
              <span key="p" className="num">{r.data.paid !== '' && r.data.paid != null ? Number(r.data.paid).toLocaleString() : '—'}</span>,
              <Chip key="s" tone={payTone(String(r.data.status ?? ''))}>{String(r.data.status ?? '—')}</Chip>,
            ])}
          />
        )}
      </Panel>

      <div className="mt-[18px]" />
      <Grid cols={2}>
        <Panel title="Cash-flow — forecast vs actual" sub={`${cashflow.length} period(s) · ₹ in lakh`} bodyless>
          {cashflow.length === 0 ? (
            <p className="m-0 p-4 text-[12.5px]" style={{ color: 'var(--muted)' }}>No cash-flow periods yet.</p>
          ) : (
            <DataTable
              columns={[
                { key: 'p', label: 'Period' },
                { key: 'e', label: 'Expected inflow', align: 'right' },
                { key: 'a', label: 'Actual inflow', align: 'right' },
                { key: 'v', label: 'Variance', align: 'right' },
              ]}
              rows={cashflow.map((r) => {
                const exp = Number(r.data.expected ?? 0);
                const act = r.data.actual !== '' && r.data.actual != null ? Number(r.data.actual) : null;
                const variance = act === null ? null : act - exp;
                return [
                  String(r.data.period ?? r.ref),
                  <span key="e" className="num">{exp}</span>,
                  <span key="a" className="num">{act === null ? '—' : act}</span>,
                  variance === null
                    ? <Chip key="v" tone="info">In progress</Chip>
                    : <Chip key="v" tone={variance < 0 ? 'warn' : 'ok'}>{variance >= 0 ? `+${variance}L` : `${variance}L`}</Chip>,
                ];
              })}
            />
          )}
        </Panel>
        <Panel title="Monthly EPC audit findings" sub={`${audits.length} finding(s)`} bodyless>
          {audits.length === 0 ? (
            <p className="m-0 p-4 text-[12.5px]" style={{ color: 'var(--muted)' }}>No audit findings recorded yet.</p>
          ) : (
            <DataTable
              columns={[
                { key: 'f', label: 'Finding' },
                { key: 's', label: 'Severity' },
                { key: 'st', label: 'Status' },
              ]}
              rows={audits.map((r) => [
                String(r.data.finding ?? r.ref),
                <span key="sev">{String(r.data.severity ?? '—')}</span>,
                <Chip key="st" tone={auditTone(String(r.data.status ?? ''))}>{String(r.data.status ?? '—')}</Chip>,
              ])}
            />
          )}
        </Panel>
      </Grid>
    </>
  );
}
