'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';

import { DataTable, HBarChart, Notice, PageHead, Panel, VitalsRail } from '@/components/ui';
import { records, type DciMis } from '@/lib/services';

/**
 * DCI dashboard (KEC spec, High): the document position across the scope.
 *
 * Totals, WIP, internal review, client review, approved, IFC, AFC, overdue
 * and superseded, with a discipline breakdown and the oldest open
 * transmittal so the document controller knows what to chase first.
 * All from /records/dci-mis — the DCI register itself stays at /epc/dci.
 */
export default function DciDashboardPage() {
  const [mis, setMis] = useState<DciMis | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setMis(await records.dciMis());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load DCI dashboard');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const countOf = (status: string) =>
    mis ? (mis.byStatus.find((s) => s.status === status)?.count ?? 0) : 0;

  const bars = useMemo(() => {
    if (!mis) return [];
    return mis.byDiscipline
      .filter((d) => d.count > 0)
      .slice(0, 8)
      .map((d) => ({ label: d.discipline, value: d.count, tone: 'info' as const }));
  }, [mis]);

  if (loading) {
    return <PageHead title="DCI dashboard" description="Loading document position…" />;
  }
  if (error || !mis) {
    return (
      <>
        <PageHead title="DCI dashboard" description="Document position across the scope" />
        <Notice>{error ?? 'No data available.'}</Notice>
      </>
    );
  }

  return (
    <>
      <PageHead
        title="DCI dashboard"
        description={`${mis.scopeLabel} · live roll-up of the Document Control Index`}
      />

      <Panel title="Document position" sub={mis.scopeLabel} bodyless>
        <VitalsRail
          items={[
            { label: 'Total documents', value: String(mis.total), tone: mis.total > 0 ? 'ok' : 'warn' },
            { label: 'WIP', value: String(countOf('WIP')), tone: countOf('WIP') > 0 ? 'warn' : 'ok' },
            { label: 'Internal review', value: String(countOf('Internal review')) },
            { label: 'Client review', value: String(countOf('In client review')) },
            { label: 'Approved', value: String(countOf('Approved')), tone: 'ok' },
            { label: 'IFC', value: String(countOf('IFC')), tone: 'ok' },
            { label: 'AFC', value: String(countOf('AFC')), tone: 'ok' },
            { label: 'Overdue', value: String(mis.overdue), tone: mis.overdue > 0 ? 'bad' : 'ok' },
            { label: 'Superseded', value: String(countOf('Superseded')) },
          ]}
        />
      </Panel>

      <div className="grid gap-3 lg:grid-cols-2">
        <Panel title="By discipline" sub="Where the document load sits">
          {bars.length === 0 ? (
            <p className="m-0 text-[13px]" style={{ color: 'var(--muted)' }}>
              No documents yet. Register rows on the Document Control Index.
            </p>
          ) : (
            <HBarChart items={bars} unit="" />
          )}
        </Panel>

        <Panel title="Transmittal chase" sub="What is waiting longest">
          <DataTable
            columns={[
              { key: 'k', label: 'Measure' },
              { key: 'v', label: 'Value', align: 'right' },
            ]}
            rows={[
              [
                <span key="k" className="font-semibold">Open transmittals</span>,
                <span key="v" className="num">{mis.openTransmittals}</span>,
              ],
              [
                <span key="k" className="font-semibold">Oldest open transmittal</span>,
                <span key="v" className="num" style={{ color: mis.oldestOpenTransmittal && mis.oldestOpenTransmittal.daysOpen > 30 ? 'var(--red)' : undefined }}>
                  {mis.oldestOpenTransmittal
                    ? `${mis.oldestOpenTransmittal.transmittalNo} · ${mis.oldestOpenTransmittal.daysOpen}d open`
                    : '—'}
                </span>,
              ],
              [
                <span key="k" className="font-semibold">Returned (resubmission)</span>,
                <span key="v" className="num">{countOf('Returned')}</span>,
              ],
              [
                <span key="k" className="font-semibold">Awaiting review</span>,
                <span key="v" className="num">{countOf('Awaiting review')}</span>,
              ],
            ]}
          />
        </Panel>
      </div>
    </>
  );
}
