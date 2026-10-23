'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';

import { PageHead, Notice, Panel, Chip } from '@/components/ui';
import { projects, admin, type ClientEntity, type ProjectOption } from '@/lib/services';

/**
 * Client portal — index.
 *
 * One card per active client. Each card links to that client's project view.
 * Read-only: a client user has no edit controls, only the project listing.
 */
export default function PortalIndexPage() {
  const [clients, setClients] = useState<ClientEntity[]>([]);
  const [plantList, setPlantList] = useState<ProjectOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const [clientRows, projRows] = await Promise.all([
          admin.clients(),
          projects.list({ kind: 'master' }),
        ]);
        setClients(clientRows.filter((c: ClientEntity) => c.isActive));
        setPlantList(projRows);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Could not load clients');
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  // Count plants per client.
  const countByClient = new Map<string, number>();
  for (const p of plantList) {
    countByClient.set(p.clientName, (countByClient.get(p.clientName) ?? 0) + 1);
  }

  if (error) {
    return <PageHead title="Client portal" description="Live project status for each client" actions={<Notice>{error}</Notice>} />;
  }

  if (loading) {
    return (
      <>
        <PageHead title="Client portal" description="Loading clients…" />
        <p className="text-[13px]" style={{ color: 'var(--muted)' }}>Loading…</p>
      </>
    );
  }

  return (
    <>
      <PageHead
        title="Client portal"
        description="Select a client to view their plant progress, milestones, quality and billing status."
      />

      <div className="grid gap-3 grid-cols-1 md:grid-cols-2 xl:grid-cols-3">
        {clients.map((c) => {
          const count = countByClient.get(c.name) ?? 0;
          return (
            <Link
              key={c.id}
              href={`/portal/${c.code.toLowerCase()}`}
              className="block rounded-lg p-4 transition"
              style={{
                background: 'var(--panel)',
                border: '1px solid var(--line)',
                boxShadow: '0 1px 2px rgba(15,23,41,.03)',
                color: 'inherit',
                textDecoration: 'none',
              }}
              onMouseEnter={(e) => { e.currentTarget.style.borderColor = 'var(--accent)'; }}
              onMouseLeave={(e) => { e.currentTarget.style.borderColor = 'var(--line)'; }}
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="truncate text-[14px] font-semibold">{c.name}</div>
                  <div className="text-[11.5px]" style={{ color: 'var(--muted)' }}>
                    {c.plant || c.code}
                  </div>
                </div>
                <Chip tone={count > 0 ? 'info' : 'mute'}>
                  {count > 0 ? `${count} plant${count > 1 ? 's' : ''}` : 'No plants'}
                </Chip>
              </div>
              <div className="mt-3 flex flex-wrap gap-1">
                {c.services.map((s) => (
                  <span
                    key={s}
                    className="rounded px-1.5 py-[2px] text-[10.5px] font-medium"
                    style={{ background: 'var(--panel-2)', color: 'var(--muted)', border: '1px solid var(--line-2)' }}
                  >
                    {s.toUpperCase()}
                  </span>
                ))}
              </div>
              <div className="mt-3 text-[11.5px]" style={{ color: 'var(--accent)' }}>
                View status →
              </div>
            </Link>
          );
        })}
      </div>

      {clients.length === 0 ? (
        <p className="mt-6 text-[13px]" style={{ color: 'var(--muted)' }}>
          No active clients. Ask your admin to onboard a client first.
        </p>
      ) : null}
    </>
  );
}
