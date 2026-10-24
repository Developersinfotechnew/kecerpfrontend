'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';

import { records as recordService } from '@/lib/services';
import type { RecordType } from '@/lib/types';
import { Panel, PageHead, Notice } from '@/components/ui';

/**
 * Register index.
 *
 * Lists every record type the signed-in user may view, across every suite. This
 * is the directory of admin-defined registers: a register an admin creates in
 * the type editor appears here with no code change, and opens at its own page.
 */
export default function RegistersIndexPage() {
  const [types, setTypes] = useState<RecordType[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    recordService
      .types()
      .then(setTypes)
      .catch((err: unknown) =>
        setError(err instanceof Error ? err.message : 'Failed to load registers'),
      )
      .finally(() => setLoading(false));
  }, []);

  const bySuite = types.reduce<Record<string, RecordType[]>>((acc, t) => {
    (acc[t.suite] ??= []).push(t);
    return acc;
  }, {});

  const suiteLabel: Record<string, string> = {
    shared: 'Head Office',
    epc: 'EPC',
    pmc: 'PMC',
    eptp: 'EPTP',
    om: 'O&M',
  };

  return (
    <>
      <PageHead
        title="Control registers"
        description="Every register in the platform. Each is defined by admin and management, and every entry carries an owner, a status and an audit trail."
      />

      {error ? <Notice>{error}</Notice> : null}

      {loading ? (
        <p className="text-sm" style={{ color: 'var(--muted)' }}>
          Loading registers…
        </p>
      ) : types.length === 0 ? (
        <Panel>
          <p className="m-0 text-[13px]" style={{ color: 'var(--muted)' }}>
            No registers yet. An administrator can create one from the register designer.
          </p>
        </Panel>
      ) : (
        Object.entries(bySuite).map(([suite, list]) => (
          <Panel key={suite} title={suiteLabel[suite] ?? suite} bodyless>
            <div className="grid gap-px grid-cols-1 md:grid-cols-2 xl:grid-cols-3" style={{ background: 'var(--line-2)' }}>
              {list.map((t) => (
                <Link
                  key={t.key}
                  href={`/registers/${t.key}`}
                  className="block p-4 no-underline"
                  style={{ background: 'var(--panel)', color: 'inherit' }}
                >
                  <div className="text-[14px] font-semibold">{t.label}</div>
                  <div className="mt-1 text-[12px]" style={{ color: 'var(--muted)' }}>
                    {t.description}
                  </div>
                  <div className="mt-2 text-[11.5px]" style={{ color: 'var(--faint)' }}>
                    {t.fields.length} fields · {t.permissionModule}
                  </div>
                </Link>
              ))}
            </div>
          </Panel>
        ))
      )}
    </>
  );
}
