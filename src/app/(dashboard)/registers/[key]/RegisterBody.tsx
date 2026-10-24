'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useParams } from 'next/navigation';

import { Button, Chip, DataTable, Notice, PageHead, Panel } from '@/components/ui';
import { RecordForm } from '@/components/RecordForm';
import { useProjectData } from '@/lib/project-data';
import { useSession } from '@/app/session';
import { records, projects, type ProjectOption } from '@/lib/services';
import type { RecordRow, RecordType } from '@/lib/types';

/**
 * Generic register screen (client component).
 *
 * The register key is read from the URL via useParams(). This is the source of
 * truth on the client side — it stays in sync with client-side navigation and
 * never falls back to a prop that may be blank during a render transition.
 */
export default function RegisterBody() {
  const params = useParams<{ key: string }>();
  const key = params.key ?? '';

  const { loading: sessionLoading } = useSession();
  const { current } = useProjectData();

  const [type, setType] = useState<RecordType | null>(null);
  const [rows, setRows] = useState<RecordRow[]>([]);
  const [total, setTotal] = useState(0);
  const [projectsOptions, setProjectsOptions] = useState<ProjectOption[]>([]);
  const [search, setSearch] = useState('');
  const [projectId, setProjectId] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    void projects.list().then(setProjectsOptions).catch(() => setProjectsOptions([]));
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      if (sessionLoading) return;
      if (!key) return;
      const [typeRes, page] = await Promise.all([
        records.type(key),
        records.list(key, {
          search: search || undefined,
          projectId: projectId || undefined,
          limit: 200,
        }),
      ]);
      setType(typeRes);
      setRows(page.items);
      setTotal(page.total);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load this register');
    } finally {
      setLoading(false);
    }
  }, [key, search, projectId, sessionLoading]);

  useEffect(() => {
    void load();
  }, [load]);

  const columns = useMemo(() => {
    if (!type) return [];
    return type.fields
      .filter((f) => f.listColumn)
      .slice(0, 7)
      .map((f) => ({ key: f.key, label: f.label, align: f.align }));
  }, [type]);

  const titleField = type?.titleField ?? '';

  if (sessionLoading) {
    return <Notice>Loading session…</Notice>;
  }

  if (error && !type) {
    return <Notice>{error}</Notice>;
  }

  return (
    <>
      <PageHead
        title={type?.label ?? key}
        description={type?.description}
        actions={
          <Button variant="primary" onClick={() => setCreating(true)}>
            Add entry
          </Button>
        }
      />

      <Panel
        title="Filter"
        bodyless
        sub={loading ? 'Loading' : `${total} record${total === 1 ? '' : 's'}`}
      >
        <div className="grid gap-2 p-3 sm:grid-cols-2">
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search reference or any field…"
            className="rounded px-2.5 py-2 text-[13px] outline-none"
            style={{ background: 'var(--panel-2)', border: '1px solid var(--line)', color: 'var(--ink)' }}
          />
          <select
            value={projectId}
            onChange={(e) => setProjectId(e.target.value)}
            className="rounded px-2.5 py-2 text-[13px] outline-none"
            style={{ background: 'var(--panel-2)', border: '1px solid var(--line)', color: 'var(--ink)' }}
          >
            <option value="">All projects</option>
            {projectsOptions.map((p) => (
              <option key={p.id} value={p.id}>
                {p.code} — {p.name}
              </option>
            ))}
          </select>
        </div>
      </Panel>

      <Panel title="Records" bodyless>
        <DataTable
          columns={
            columns.length > 0
              ? columns
              : [{ key: titleField, label: type?.label ?? 'Record' }]
          }
          rows={
            rows.length === 0
              ? [['No entries yet. Use Add entry to create the first one.']]
              : rows.map((r) =>
                  (columns.length > 0 ? columns : [{ key: titleField, label: '' }]).map((c) => {
                    const value = r.data[c.key];
                    if (value === undefined || value === null || value === '') return '—';
                    if (typeof value === 'number') return value.toLocaleString();
                    return String(value);
                  }),
                )
          }
        />
      </Panel>

      {creating && type ? (
        <RecordForm
          type={type}
          record={null}
          onCancel={() => setCreating(false)}
          onSubmit={async (body) => {
            await records.create(key, body);
            setCreating(false);
            void load();
          }}
        />
      ) : null}
    </>
  );
}
