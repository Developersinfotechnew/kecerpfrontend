'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';

import { RecordForm } from '@/components/RecordForm';
import { Bar, Button, Chip, DataTable, Notice, PageHead, Panel, VitalsRail } from '@/components/ui';
import { records } from '@/lib/services';
import { L } from '@/lib/project-data';
import type { RecordRow, RecordType } from '@/lib/types';

const WP_KEY = 'work_packages';

const WP_TONE: Record<string, 'ok' | 'info' | 'warn' | 'bad' | 'mute'> = {
  'Not started': 'mute',
  'In progress': 'info',
  Ahead: 'ok',
  Behind: 'bad',
  Complete: 'ok',
};

const num = (v: unknown) => Number(v) || 0;

/** SPI below 1 means the schedule is running behind the plan. */
const SPI_OK = 0.95;

/** EVM — earned value against plan and actual, indices computed live. */
export default function EpcEvmPage() {
  const [type, setType] = useState<RecordType | null>(null);
  const [rows, setRows] = useState<RecordRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // undefined = closed, null = create, row = edit.
  const [form, setForm] = useState<RecordRow | null | undefined>(undefined);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [t, page] = await Promise.all([records.type(WP_KEY), records.list(WP_KEY, { limit: 300 })]);
      setType(t);
      setRows(page.items);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load work packages');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const roll = useMemo(() => {
    let bac = 0;
    let pv = 0;
    let ev = 0;
    let ac = 0;
    let ahead = 0;
    let behind = 0;
    const out = rows.map((r): React.ReactNode[] => {
      const planned = num(r.data.pv);
      const earned = num(r.data.ev);
      const spent = num(r.data.ac);
      const base = num(r.data.bac);
      const pct = num(r.data.pctComplete);
      const status = String(r.data.status ?? '');

      // SPI and CPI are ratios. A zero denominator means the index is
      // undefined, not zero — print an em dash so nobody reads it as on plan.
      const spi = planned > 0 ? earned / planned : null;
      const cpi = spent > 0 ? earned / spent : null;
      const scheduleVar = earned - planned;
      const costVar = earned - spent;

      // EAC is cost to complete extrapolated from the CPI. If spend is zero
      // there is no evidence to extrapolate from, so BAC stands in.
      const eac = cpi && cpi > 0 ? base / cpi : base;
      const eacDiff = eac - base;

      bac += base;
      pv += planned;
      ev += earned;
      ac += spent;
      if (spi !== null) {
        if (spi >= SPI_OK) ahead += 1;
        else behind += 1;
      }

      return [
        String(r.data.name ?? ''),
        String(r.data.rule ?? '—'),
        <span key="bac" className="num">{L(base)}</span>,
        <Bar key="pc" pct={Math.min(100, Math.max(0, pct))} />,
        <span key="pv" className="num">{L(planned)}</span>,
        <span key="ev" className="num">{L(earned)}</span>,
        <span key="ac" className="num">{L(spent)}</span>
        ,
        <span key="sv" className="num" style={scheduleVar < 0 ? { color: 'var(--red)' } : undefined}>
          {L(scheduleVar)}
        </span>,
        <span key="cv" className="num" style={costVar < 0 ? { color: 'var(--red)' } : undefined}>
          {L(costVar)}
        </span>,
        <Chip key="spi" tone={spi === null ? 'mute' : spi >= SPI_OK ? 'ok' : 'bad'}>
          {spi === null ? '—' : spi.toFixed(2)}
        </Chip>,
        <Chip key="cpi" tone={cpi === null ? 'mute' : cpi >= 1 ? 'ok' : cpi >= 0.95 ? 'warn' : 'bad'}>
          {cpi === null ? '—' : cpi.toFixed(2)}
        </Chip>,
        <span key="eac" className="num" style={eacDiff > 0 ? { color: 'var(--red)' } : undefined}>
          {L(eac)}
        </span>
        ,
        <Chip key="s" tone={WP_TONE[status] ?? 'mute'}>{status}</Chip>,
        <Button key="edit" onClick={() => setForm(r)}>Edit</Button>,
      ];
    });

    const totalSpi = pv > 0 ? ev / pv : null;
    const totalCpi = ac > 0 ? ev / ac : null;
    const totalEac = totalCpi && totalCpi > 0 ? bac / totalCpi : bac;

    return {
      rows: out,
      bac,
      pv,
      ev,
      ac,
      eac: totalEac,
      eacDiff: totalEac - bac,
      totalSpi,
      totalCpi,
      ahead,
      behind,
      packages: rows.length,
    };
  }, [rows]);

  return (
    <>
      <PageHead
        title="Earned value management"
        description="Planned value against earned value and actual cost, by work package. SPI and CPI are computed from the stored figures."
        actions={
          <Button variant="primary" onClick={() => type && setForm(null)}>
            Add work package
          </Button>
        }
      />

      {error ? <Notice>{error}</Notice> : null}

      <VitalsRail
        items={[
          { label: 'Budget at completion', value: L(roll.bac), note: `${roll.packages} work packages` },
          {
            label: 'Schedule variance',
            value: `${roll.totalSpi === null ? '—' : roll.totalSpi.toFixed(2)}`,
            note: `SV ${L(roll.ev - roll.pv)}`,
            tone: roll.totalSpi === null ? undefined : roll.totalSpi >= SPI_OK ? 'ok' : 'bad',
          },
          {
            label: 'Cost variance',
            value: `${roll.totalCpi === null ? '—' : roll.totalCpi.toFixed(2)}`,
            note: `CV ${L(roll.ev - roll.ac)}`,
            tone: roll.totalCpi === null ? undefined : roll.totalCpi >= 1 ? 'ok' : 'bad',
          },
          {
            label: 'Estimate at completion',
            value: L(roll.eac),
            note: `${roll.eacDiff > 0 ? `+${L(roll.eacDiff)} over BAC` : 'Within BAC'}`,
            tone: roll.eacDiff > 0 ? ('bad' as const) : undefined,
          },
          { label: 'On track', value: String(roll.ahead), note: `${roll.behind} behind plan` },
        ]}
      />

      <div className="mt-[18px]" />

      <Panel
        title="Work packages"
        sub={loading ? 'Loading' : `${roll.packages} packages · ₹ in lakh`}
        bodyless
      >
        <DataTable
          columns={[
            { key: 'w', label: 'Work package' },
            { key: 'm', label: 'Measurement rule' },
            { key: 'b', label: 'BAC', align: 'right' },
            { key: 'pc', label: '% complete' },
            { key: 'pv', label: 'PV', align: 'right' },
            { key: 'ev', label: 'EV', align: 'right' },
            { key: 'ac', label: 'AC', align: 'right' },
            { key: 'sv', label: 'SV', align: 'right' },
            { key: 'cv', label: 'CV', align: 'right' },
            { key: 'spi', label: 'SPI', align: 'right' },
            { key: 'cpi', label: 'CPI', align: 'right' },
            { key: 'eac', label: 'EAC', align: 'right' },
            { key: 's', label: 'Status', align: 'right' },
            { key: 'edit', label: '' },
          ]}
          rows={
            roll.rows.length === 0
              ? [[loading ? 'Loading work packages…' : 'No work packages yet. Use Add work package.']]
              : roll.rows
          }
        />
      </Panel>

      {type && form !== undefined ? (
        <RecordForm
          type={type}
          record={form}
          onCancel={() => setForm(undefined)}
          onSubmit={async (body) => {
            const id = form?.id;
            if (id) {
              await records.update(WP_KEY, id, body);
            } else {
              await records.create(WP_KEY, body);
            }
            setForm(undefined);
            void load();
          }}
        />
      ) : null}
    </>
  );
}
