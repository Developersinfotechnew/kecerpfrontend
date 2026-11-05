'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';

import { Button, Chip, DataTable, Grid, KVList, PageHead, Panel, VitalsRail } from '@/components/ui';
import { useProjectData } from '@/lib/project-data';
import { records } from '@/lib/services';
import type { RecordRow } from '@/lib/types';

/**
 * O&M dashboard — live plant KPIs from the O&M registers.
 *
 * W5: the dashboard used to be a static prototype (hard-coded DCS tiles).
 * Every tile now reads the project's real rows: today's shift log, the
 * maintenance schedule's open work orders, the lab test readings and the
 * spares stock alert. No DCS feed in the ERP yet, so the "live snapshot"
 * panel shows the latest shift's instrument readings instead.
 */
const num = (v: unknown): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

const dateOf = (r: RecordRow): string => {
  const d = String(r.data.date ?? r.data.scheduledDate ?? r.data.sampleDate ?? '');
  return d.slice(0, 10);
};

export default function OmDashboardPage() {
  const { current: p } = useProjectData();
  const [shifts, setShifts] = useState<RecordRow[]>([]);
  const [wos, setWos] = useState<RecordRow[]>([]);
  const [labs, setLabs] = useState<RecordRow[]>([]);
  const [stock, setStock] = useState<RecordRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const pid = p?.id || undefined;

  const load = useCallback(async () => {
    if (!p) return;
    setLoading(true);
    setError(null);
    try {
      const [s, m, l, k] = await Promise.all([
        records.list('om_shifts', { projectId: pid, limit: 200 }),
        records.list('maintenance_schedule', { projectId: pid, limit: 200 }),
        records.list('om_lab_tests', { projectId: pid, limit: 200 }),
        records.list('inventory_stock', { projectId: pid, limit: 200 }),
      ]);
      setShifts(s.items);
      setWos(m.items);
      setLabs(l.items);
      setStock(k.items);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load the O&M dashboard');
    } finally {
      setLoading(false);
    }
  }, [p, pid]);

  useEffect(() => {
    void load();
  }, [load]);

  const today = new Date().toISOString().slice(0, 10);

  const m = useMemo(() => {
    const todayShifts = shifts.filter((r) => dateOf(r) === today);
    const mtdShifts = shifts.filter((r) => dateOf(r).slice(0, 7) === today.slice(0, 7));
    const todayAvg = todayShifts.length
      ? Math.round(todayShifts.reduce((s, r) => s + num(r.data.availability), 0) / todayShifts.length)
      : null;
    const cbgMtd = mtdShifts.reduce((s, r) => s + num(r.data.cbgProducedKg), 0);
    const feedMtd = mtdShifts.reduce((s, r) => s + num(r.data.feedstockMT), 0);
    const operator = todayShifts[todayShifts.length - 1]?.data.operator;
    const shiftWord = todayShifts[todayShifts.length - 1]?.data.shift;

    const openWo = wos.filter((r) => String(r.data.status) === 'Scheduled' || String(r.data.status) === 'In progress');
    const overdueWo = wos.filter((r) => String(r.data.status) === 'Overdue');

    const ch4 = labs
      .filter((r) => String(r.data.parameter) === 'CH₄')
      .sort((a, b) => dateOf(b).localeCompare(dateOf(a)))
      .slice(0, 5);
    const ch4Avg = ch4.length
      ? (ch4.reduce((s, r) => s + num(r.data.reading), 0) / ch4.length).toFixed(1)
      : null;
    const ch4Out = labs.some(
      (r) => String(r.data.parameter) === 'CH₄' && String(r.data.result) === 'Out of spec',
    );

    const lowStock = stock.filter((r) => {
      const onHand = num(r.data.received) + num(r.data.returned) - num(r.data.issued);
      const min = num(r.data.minStock);
      return min > 0 && onHand <= min;
    });

    return { todayShifts, cbgMtd, feedMtd, operator, shiftWord, openWo, overdueWo, ch4, ch4Avg, ch4Out, lowStock, todayAvg };
  }, [shifts, wos, labs, stock, today]);

  const vitals = [
    { label: 'Plant availability', value: m.todayAvg === null ? '—' : `${m.todayAvg}%`, note: 'Today shifts' },
    { label: 'CBG production (MTD)', value: m.cbgMtd ? String(Math.round(m.cbgMtd)) : '—', unit: 'kg', note: 'Shift log' },
    { label: 'Feedstock (MTD)', value: m.feedMtd ? m.feedMtd.toFixed(1) : '—', unit: 'MT', note: 'Shift log' },
    { label: 'Open work orders', value: String(m.openWo.length + m.overdueWo.length), note: `${m.overdueWo.length} overdue` },
    { label: 'CH₄ (last 5 tests)', value: m.ch4Avg ? `${m.ch4Avg}%` : '—', note: m.ch4Out ? 'Out of spec seen' : 'Within spec' },
  ];

  const attention: Array<{ tone: 'bad' | 'warn' | 'info'; text: string; meta: string }> = [
    ...m.overdueWo.map((r) => ({
      tone: 'warn' as const,
      text: `PM overdue — ${String(r.data.assetName ?? r.ref)}`,
      meta: 'Maintenance',
    })),
    ...m.lowStock.map((r) => ({
      tone: 'warn' as const,
      text: `Critical spare low — ${String(r.data.item ?? r.ref)} (min ${num(r.data.minStock)})`,
      meta: 'Spares',
    })),
    ...m.ch4.filter((r) => String(r.data.result) === 'Out of spec').map((r) => ({
      tone: 'bad' as const,
      text: `CH₄ out of spec — ${String(r.data.reading ?? '')}% (spec ${String(r.data.spec ?? '')})`,
      meta: 'Lab',
    })),
  ];

  if (!p) {
    return <PageHead title="O&M dashboard" description="No project is in your scope." />;
  }

  return (
    <>
      <PageHead
        title="O&M dashboard"
        description={`${p.name} · live KPIs from the shift log, maintenance schedule, lab tests and spares stock.`}
        actions={<Button onClick={() => void load()}>Refresh</Button>}
      />

      {loading ? (
        <p className="text-sm" style={{ color: 'var(--muted)' }}>Loading O&M dashboard…</p>
      ) : null}
      {error ? <Panel title="Load failed">{error}</Panel> : null}

      {!loading && (
        <>
          <VitalsRail items={vitals} />

          <Grid cols="2-1">
            <div>
              <Panel
                title="Live plant snapshot"
                sub="Latest shift's instrument readings"
                bodyless
              >
                <DataTable
                  columns={[
                    { key: 'p', label: 'Parameter' },
                    { key: 'v', label: 'Value' },
                    { key: 's', label: 'Status', align: 'right' },
                  ]}
                  rows={
                    m.todayShifts.length > 0
                      ? (() => {
                          const s = m.todayShifts[m.todayShifts.length - 1];
                          return [
                            ['Digester temperature', `${s.data.digesterTemp ?? '—'} °C`],
                            ['Digester pH', String(s.data.digesterPH ?? '—')],
                            ['Raw biogas CH₄', `${s.data.gasCH4 ?? '—'} %`],
                            ['H₂S level', `${s.data.gasH2S ?? '—'}`],
                            ['CBG produced today', `${num(s.data.cbgProducedKg)} kg`],
                            ['Feedstock received', `${num(s.data.feedstockMT)} MT`],
                            ['Availability', `${s.data.availability ?? '—'} %`],
                          ].map((row) => [row[0], row[1], <Chip key="s" tone="ok">Logged</Chip>]);
                        })()
                      : [['No shift logged today yet. Use Log current shift on the Operations screen.']]
                  }
                />
              </Panel>

              <Panel title="Today's production" sub="From the shift log" bodyless>
                <DataTable
                  columns={[
                    { key: 'p', label: 'Parameter' },
                    { key: 'v', label: 'Value' },
                  ]}
                  rows={
                    [
                      ['Feedstock received (MTD)', `${m.feedMtd ? m.feedMtd.toFixed(1) : '—'} MT`],
                      ['CBG produced (MTD)', `${m.cbgMtd ? Math.round(m.cbgMtd) : '—'} kg`],
                      ['Shifts logged today', String(m.todayShifts.length)],
                      ['Open work orders', String(m.openWo.length + m.overdueWo.length)],
                    ]
                  }
                />
              </Panel>
            </div>

            <div>
              <Panel title="Needs attention" sub="Overdue PMs, low spares, out-of-spec lab results">
                {attention.length === 0 ? (
                  <p className="m-0 text-[12.5px]" style={{ color: 'var(--muted)' }}>
                    Nothing needs attention — no overdue PMs, no low spares, no out-of-spec tests.
                  </p>
                ) : (
                  <ul className="m-0 pl-5 text-[12.5px]">
                    {attention.map((a, i) => (
                      <li key={i} className="mb-1.5">
                        <Chip tone={a.tone}>{a.meta}</Chip> <span>{a.text}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </Panel>

              <Panel title="Manpower on shift">
                <KVList
                  pairs={[
                    ['Shift', m.shiftWord ? String(m.shiftWord) : '—'],
                    ['Operator on duty', m.operator ? String(m.operator) : '—'],
                    ['Shifts today', <span key="n" className="num">{m.todayShifts.length}</span>],
                    ['Open WOs', <span key="w" className="num">{m.openWo.length + m.overdueWo.length}</span>],
                  ]}
                />
              </Panel>
            </div>
          </Grid>
        </>
      )}
    </>
  );
}
