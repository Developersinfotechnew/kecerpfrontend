'use client';

import { useEffect, useMemo, useState } from 'react';

import { Button, Chip, DataTable, Grid, KVList, Notice, PageHead, Panel, VitalsRail } from '@/components/ui';
import { records } from '@/lib/services';
import type { RecordRow } from '@/lib/types';

const DEAL_STAGES = ['Qualified', 'Proposal', 'Technical', 'Commercial', 'Negotiation'] as const;

/**
 * CRM dashboard.
 *
 * One screen: "where is the pipeline." Every tile derives from the CRM
 * registers — no static data. The pipeline funnel groups open deals by
 * stage; weighted value is sum(value × probability); tenders show the next
 * due dates; invoices show aging; the team card carries owned pipeline.
 */
export default function CrmDashboardPage() {
  const [leads, setLeads] = useState<RecordRow[]>([]);
  const [deals, setDeals] = useState<RecordRow[]>([]);
  const [tenders, setTenders] = useState<RecordRow[]>([]);
  const [invoices, setInvoices] = useState<RecordRow[]>([]);
  const [payments, setPayments] = useState<RecordRow[]>([]);
  const [events, setEvents] = useState<RecordRow[]>([]);
  const [employees, setEmployees] = useState<RecordRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const guard = <T,>(promise: Promise<T>, apply: (value: T) => void) =>
      promise.then((v) => { if (!cancelled) apply(v); }).catch(() => undefined);
    const list = (key: string, apply: (rows: RecordRow[]) => void) =>
      guard(records.list(key, { limit: 300 }), (page) => apply(page.items));

    list('crm_leads', setLeads);
    list('crm_deals', setDeals);
    list('crm_tenders', setTenders);
    list('crm_invoices', setInvoices);
    list('crm_payments', setPayments);
    list('crm_events', setEvents);
    list('crm_employees', setEmployees);

    // Re-arm on mount only; the CRM registers are global (pre-project), so no
    // project-scoped reload is needed here.
    return () => {
      cancelled = true;
      setLoading(false);
    };
  }, []);

  // --- derived state ------------------------------------------------------

  const openDeals = deals.filter((r) => String(r.data.status ?? '') === 'In progress');
  const wonDeals = deals.filter((r) => String(r.data.status ?? '') === 'Won');
  const lostDeals = deals.filter((r) => String(r.data.status ?? '') === 'Lost');
  const weighted = openDeals.reduce((sum, r) => sum + Number(r.data.value ?? 0) * (Number(r.data.probability ?? 0) / 100), 0);
  const openValue = openDeals.reduce((sum, r) => sum + Number(r.data.value ?? 0), 0);

  const funnel = useMemo(
    () =>
      DEAL_STAGES.map((stage) => ({
        stage,
        count: openDeals.filter((r) => String(r.data.stage ?? '') === stage).length,
        value: openDeals
          .filter((r) => String(r.data.stage ?? '') === stage)
          .reduce((s, r) => s + Number(r.data.value ?? 0), 0),
      })),
    [openDeals],
  );
  const maxStageValue = Math.max(1, ...funnel.map((f) => f.value));

  const openTenders = tenders
    .filter((r) => !['Awarded', 'Lost', 'Withdrawn'].includes(String(r.data.status ?? '')))
    .sort((a, b) => new Date(String(a.data.dueDate ?? 0)).getTime() - new Date(String(b.data.dueDate ?? 0)).getTime());

  const today = Date.now();
  const openInvoices = invoices.filter((r) => !['Paid', 'Draft'].includes(String(r.data.status ?? '')));
  const overdueInvoices = openInvoices.filter((r) => {
    const due = String(r.data.dueDate ?? '');
    return due && new Date(due).getTime() < today;
  });
  const outstanding = openInvoices.reduce(
    (sum, r) => sum + Math.max(0, Number(r.data.value ?? 0) - Number(r.data.paid ?? 0)),
    0,
  );
  const collected = payments.reduce((sum, r) => sum + Number(r.data.amount ?? 0), 0);

  const upcomingEvents = events
    .filter((r) => String(r.data.status ?? '') === 'Scheduled')
    .filter((r) => {
      const d = String(r.data.eventDate ?? '');
      return d ? new Date(d).getTime() >= today : false;
    })
    .sort((a, b) => new Date(String(a.data.eventDate)).getTime() - new Date(String(b.data.eventDate)).getTime())
    .slice(0, 5);

  if (loading) {
    return (
      <Panel title="CRM dashboard" sub="Loading">
        <p className="m-0 p-4 text-[12.5px]" style={{ color: 'var(--muted)' }}>Loading pipeline…</p>
      </Panel>
    );
  }

  return (
    <>
      <PageHead
        title="CRM dashboard"
        description="The pre-ERP pipeline: leads, deals, tenders, quotations, collection and team. Every number is live from the CRM registers."
        actions={<Button variant="primary" onClick={() => window.location.assign('/registers/crm_deals')}>New deal</Button>}
      />

      <VitalsRail
        items={[
          { label: 'Open deals', value: String(openDeals.length), note: `₹${openValue.toLocaleString('en-IN')} L open` },
          { label: 'Weighted pipeline', value: `₹${Math.round(weighted).toLocaleString('en-IN')} L`, note: 'value × probability' },
          { label: 'Win / loss', value: `${wonDeals.length} / ${lostDeals.length}`, note: 'closed deals' },
          { label: 'Tenders open', value: String(openTenders.length), note: openTenders[0] ? `next due ${String(openTenders[0].data.dueDate ?? '')}` : 'none due' },
          { label: 'Outstanding / collected', value: `₹${Math.round(outstanding).toLocaleString('en-IN')} L`, note: `of ₹${Math.round(collected).toLocaleString('en-IN')} L collected` },
        ]}
      />

      <div className="mt-[18px]" />
      <Grid cols={2}>
        <Panel title="Pipeline funnel" sub="Open deals by stage · value in ₹L" bodyless>
          <div className="grid gap-2 p-4">
            {funnel.map((f) => (
              <div key={f.stage} className="grid grid-cols-[90px_1fr_70px] items-center gap-2 text-[12px]">
                <span style={{ color: 'var(--muted)' }}>{f.stage}</span>
                <div style={{ background: 'var(--panel-2)', borderRadius: 4, height: 12 }}>
                  <div
                    style={{
                      height: 12,
                      borderRadius: 4,
                      width: `${Math.round((f.value / maxStageValue) * 100)}%`,
                      minWidth: f.value > 0 ? 6 : 0,
                      background: 'var(--accent)',
                    }}
                  />
                </div>
                <span className="num text-right">{f.count ? `₹${f.value.toLocaleString('en-IN')} · ${f.count}` : '—'}</span>
              </div>
            ))}
          </div>
        </Panel>

        <Panel title="Tenders — next due" sub={`${openTenders.length} open`} bodyless>
          {openTenders.length === 0 ? (
            <p className="m-0 p-4 text-[12.5px]" style={{ color: 'var(--muted)' }}>No open tenders. Track one in Tenders / RFPs.</p>
          ) : (
            <DataTable
              columns={[
                { key: 'r', label: 'Ref no.' },
                { key: 'c', label: 'Client' },
                { key: 'd', label: 'Due' },
                { key: 's', label: 'Status', align: 'right' },
              ]}
              rows={openTenders.slice(0, 6).map((r) => [
                String(r.data.refNo ?? r.ref),
                String(r.data.client ?? '—'),
                String(r.data.dueDate ?? '—'),
                <Chip key="s" tone={new Date(String(r.data.dueDate ?? 0)).getTime() < today ? 'bad' : 'info'}>
                  {String(r.data.status ?? '—')}
                </Chip>,
              ])}
            />
          )}
        </Panel>
      </Grid>

      <div className="mt-[18px]" />
      <Grid cols={3}>
        <Panel title="Invoice aging" sub="Open, not paid" bodyless>
          <KVList
            pairs={[
              ['Open invoices', <span key="o" className="num">{openInvoices.length}</span>],
              ['Overdue', <span key="o" className="num" style={{ color: overdueInvoices.length ? 'var(--red)' : 'var(--ink)' }}>{overdueInvoices.length}</span>],
              ['Outstanding (₹L)', <span key="v" className="num">{Math.round(outstanding).toLocaleString('en-IN')}</span>],
            ]}
          />
        </Panel>

        <Panel title="Upcoming events" sub="Next 5 scheduled" bodyless>
          {upcomingEvents.length === 0 ? (
            <p className="m-0 p-4 text-[12.5px]" style={{ color: 'var(--muted)' }}>Nothing scheduled. Add meetings, bid due dates and follow-ups in Calendar.</p>
          ) : (
            <div className="divide-y" style={{ borderColor: 'var(--line)' }}>
              {upcomingEvents.map((r, i) => (
                <div key={i} className="px-4 py-2 text-[12.5px]">
                  <div className="font-medium">{String(r.data.title ?? r.ref)}</div>
                  <div style={{ color: 'var(--muted)' }}>{String(r.data.eventDate ?? '')} · {String(r.data.eventType ?? '')}{String(r.data.owner ?? '') ? ` · ${String(r.data.owner)}` : ''}</div>
                </div>
              ))}
            </div>
          )}
        </Panel>

        <Panel title="Team — owned pipeline" sub="CRM employees" bodyless>
          {employees.length === 0 ? (
            <p className="m-0 p-4 text-[12.5px]" style={{ color: 'var(--muted)' }}>No team rows yet. Add your sales team in Employees.</p>
          ) : (
            <KVList
              pairs={employees.slice(0, 4).map((r, i) => [
                String(r.data.name ?? r.ref),
                <span key={i} className="num">₹{Number(r.data.ownedPipeline ?? 0).toLocaleString('en-IN')} L · {String(r.data.role ?? '')}</span>,
              ])}
            />
          )}
        </Panel>
      </Grid>

      {error ? <div className="mt-[18px]"><Notice>{error}</Notice></div> : null}
    </>
  );
}
