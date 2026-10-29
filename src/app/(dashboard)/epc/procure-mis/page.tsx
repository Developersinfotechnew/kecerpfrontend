'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';

import {
  DataTable, HBarChart, Notice, PageHead, Panel, VitalsRail,
} from '@/components/ui';
import { L } from '@/lib/project-data';
import { records, type ProcurementMis } from '@/lib/services';

/**
 * CR-26: the procurement department view, cross project.
 *
 * One screen answering "what is procurement doing across all projects":
 * open PRs by stage, RFQs awaiting offers, POs pending approval, delayed
 * items, vendor payments pending and saving against the BOQ budget. All
 * from /records/procurement-mis — no register is duplicated here, the
 * PR/RFQ/PO screens stay the EPC module's, this is the department lens.
 */
export default function ProcureMisPage() {
  const [mis, setMis] = useState<ProcurementMis | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setMis(await records.procurementMis());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load procurement dashboard');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const openPrTotal = mis
    ? mis.openPrsByStage.reduce((s, r) => s + r.count, 0)
    : 0;

  const prBars = useMemo(() => {
    if (!mis) return [];
    return mis.openPrsByStage
      .filter((r) => r.count > 0)
      .map((r) => ({ label: r.stage, value: r.count, tone: 'info' as const }));
  }, [mis]);

  if (loading) {
    return <PageHead title="Procurement department" description="Loading department view…" />;
  }
  if (error || !mis) {
    return (
      <>
        <PageHead title="Procurement department" description="Cross project procurement view" />
        <Notice>{error ?? 'No data available.'}</Notice>
      </>
    );
  }

  return (
    <>
      <PageHead
        title="Procurement department"
        description={`${mis.scopeLabel} · live roll-up across all procurement registers`}
      />

      <Panel
        title="Department vitals"
        sub={mis.scopeLabel}
        bodyless
      >
        <VitalsRail
          items={[
            { label: 'Open PRs', value: String(openPrTotal), tone: openPrTotal > 0 ? 'warn' : 'ok' },
            { label: 'RFQs awaiting', value: String(mis.rfqAwaitingOffers), tone: mis.rfqAwaitingOffers > 0 ? 'warn' : 'ok' },
            { label: 'POs pending approval', value: String(mis.poPendingApproval), tone: mis.poPendingApproval > 0 ? 'warn' : 'ok' },
            { label: 'Delayed items', value: String(mis.delayedItems), tone: mis.delayedItems > 0 ? 'bad' : 'ok', note: `Oldest ${mis.delayedOldestDays}d` },
          ]}
        />
      </Panel>

      <div className="grid gap-3 lg:grid-cols-2">
        <Panel
          title="Open PRs by stage"
          sub="Where the requisitions are sitting"
        >
          {prBars.length === 0 ? (
            <p className="m-0 text-[13px]" style={{ color: 'var(--muted)' }}>No open PRs.</p>
          ) : (
            <HBarChart items={prBars} unit="" />
          )}
        </Panel>

        <Panel
          title="Vendor position"
          sub="PO-derived, not yet a payments register"
          bodyless
        >
          <DataTable
            columns={[
              { key: 'k', label: 'Measure' },
              { key: 'v', label: 'Value', align: 'right' },
            ]}
            rows={[
              [
                <span key="k" className="font-semibold">Vendor payments pending</span>,
                <span key="v" className="num">{L(mis.vendorPaymentsPending)}</span>,
              ],
              [
                <span key="k" className="font-semibold">PO value placed</span>,
                <span key="v" className="num">{L(mis.poPlaced)}</span>,
              ],
              [
                <span key="k" className="font-semibold">Approved BOQ budget</span>,
                <span key="v" className="num">{L(mis.boqBudget)}</span>,
              ],
              [
                <span key="k" className="font-semibold">Saving vs BOQ</span>,
                <span
                  key="v"
                  className="num"
                  style={{
                    color:
                      mis.savingVsBoq < 0
                        ? 'var(--red)'
                        : mis.savingVsBoq > 0
                          ? 'var(--ok)'
                          : undefined,
                  }}
                >
                  {mis.savingVsBoq >= 0 ? '+' : ''}
                  {L(mis.savingVsBoq)}
                </span>,
              ],
            ]}
          />
        </Panel>
      </div>
    </>
  );
}
