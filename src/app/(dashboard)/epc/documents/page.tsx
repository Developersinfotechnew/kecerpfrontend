'use client';

import { useCallback, useEffect, useState } from 'react';

import { Register } from '@/components/Register';
import { Chip, Notice, PageHead, Panel } from '@/components/ui';
import { useProjectData } from '@/lib/project-data';
import { records, uploads } from '@/lib/services';
import type { FileValue } from '@/lib/types';
import type { RecordRow } from '@/lib/types';

/**
 * WorkDrive / DMS screen.
 *
 * One screen, four registers: project documents (with upload), document
 * version history, transmittal log and the DCI. The category filter keeps
 * the document table focused; the other three render as stacked panels below.
 */

const DOCS_KEY = 'project_documents';
const VERSIONS_KEY = 'document_versions';
const TRANSMITTALS_KEY = 'transmittal_log';

const CATEGORIES = ['Technical', 'Commercial', 'Legal', 'HSE', 'Quality', 'Finance', 'Site', 'Commissioning'] as const;

export default function EpcDocumentsPage() {
  const { current: p } = useProjectData();
  const [docs, setDocs] = useState<RecordRow[]>([]);
  const [versions, setVersions] = useState<RecordRow[]>([]);
  const [transmittals, setTransmittals] = useState<RecordRow[]>([]);
  const [category, setCategory] = useState<string>(ALL_CATEGORIES);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadMsg, setUploadMsg] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const common = { projectId: p?.id, limit: 200 };
      const [docsPage, versionsPage, txnPage] = await Promise.all([
        records.list(DOCS_KEY, common),
        records.list(VERSIONS_KEY, common),
        records.list(TRANSMITTALS_KEY, common),
      ]);
      setDocs(docsPage.items);
      setVersions(versionsPage.items);
      setTransmittals(txnPage.items);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load documents');
    } finally {
      setLoading(false);
    }
  }, [p?.id]);

  useEffect(() => {
    void load();
  }, [load]);

  const projectId = p?.id ?? null;

  const filteredDocs = category === ALL_CATEGORIES
    ? docs
    : docs.filter((d) => String(d.data.category ?? '') === category);

  const currentVersions = versions.filter((v) => String(v.data.status ?? '') === 'Current');
  const openTxns = transmittals.filter((t) => !['Closed'].includes(String(t.data.status ?? '')));

  if (!p) {
    return <PageHead title="Project documents" description="No project is in your scope." />;
  }

  async function handleUpload() {
    const input = document.createElement('input');
    input.type = 'file';
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return;
      setUploading(true);
      setUploadMsg(null);
      try {
        const descriptor = await uploads.upload(file, 'dms:create');
        await records.create(DOCS_KEY, {
          title: file.name.replace(/\.[^.]+$/, ''),
          category: category === ALL_CATEGORIES ? 'Technical' : category,
          version: '1',
          owner: '',
          updatedOn: new Date().toISOString().slice(0, 10),
          size: `${Math.max(1, Math.round(file.size / 1024))} KB`,
          access: 'Open',
          attachment: descriptor,
          projectId: projectId,
        });
        setUploadMsg(`Uploaded ${file.name} to ${category === ALL_CATEGORIES ? 'Technical' : category}.`);
        void load();
      } catch (err) {
        setUploadMsg(err instanceof Error ? `Upload failed: ${err.message}` : 'Upload failed');
      } finally {
        setUploading(false);
      }
    };
    input.click();
  }

  return (
    <>
      <PageHead
        title="Project documents"
        description={`WorkDrive library for ${p.name}: documents, version history and transmittals in one view.`}
        actions={
          <>
            <button
              className="rounded px-[13px] py-[7px] text-[13px] font-medium"
              style={{ border: '1px solid var(--line)', background: 'var(--panel)' }}
              disabled={uploading}
              onClick={() => void handleUpload()}
            >
              {uploading ? 'Uploading…' : 'Upload document'}
            </button>
            <button
              className="rounded px-[13px] py-[7px] text-[13px] font-medium"
              style={{ border: '1px solid var(--line)', background: 'var(--panel)', color: 'var(--muted)' }}
              onClick={() => setCategory(ALL_CATEGORIES)}
            >
              All categories
            </button>
          </>
        }
      />

      {error ? <Notice>{error}</Notice> : null}
      {uploadMsg ? <Notice>{uploadMsg}</Notice> : null}

      <div className="mb-[18px] flex flex-wrap gap-1.5">
        <CatChip label="All" active={category === ALL_CATEGORIES} onClick={() => setCategory(ALL_CATEGORIES)} count={docs.length} />
        {CATEGORIES.map((c) => (
          <CatChip
            key={c}
            label={c}
            active={category === c}
            onClick={() => setCategory(c)}
            count={docs.filter((d) => String(d.data.category ?? '') === c).length}
          />
        ))}
      </div>

      <Panel
        title="Documents"
        sub={loading ? 'Loading…' : `${filteredDocs.length} in ${category === ALL_CATEGORIES ? 'all categories' : category}`}
        bodyless
      >
        {filteredDocs.length === 0 ? (
          <p className="m-0 p-4 text-[13px]" style={{ color: 'var(--muted)' }}>
            No documents in {category === ALL_CATEGORIES ? 'the library yet' : `${category}`}. Use Upload document or add a row from the register.
          </p>
        ) : (
          <table className="w-full border-collapse text-[12.5px]">
            <thead>
              <tr style={{ color: 'var(--muted)', borderBottom: '1px solid var(--line)' }}>
                <th className="px-3 py-2 text-left font-medium">Document</th>
                <th className="px-3 py-2 text-left font-medium">Category</th>
                <th className="px-3 py-2 text-left font-medium">Version</th>
                <th className="px-3 py-2 text-left font-medium">Owner</th>
                <th className="px-3 py-2 text-right font-medium">Updated</th>
                <th className="px-3 py-2 text-right font-medium">Access</th>
                <th className="px-3 py-2 text-right font-medium">File</th>
              </tr>
            </thead>
            <tbody>
              {filteredDocs.map((d) => {
                const file = d.data.attachment as FileValue | undefined;
                return (
                  <tr key={d.id} style={{ borderBottom: '1px solid var(--line-2)' }}>
                    <td className="px-3 py-2 font-medium">{String(d.data.title ?? d.ref)}</td>
                    <td className="px-3 py-2">{String(d.data.category ?? '—')}</td>
                    <td className="px-3 py-2 num">{String(d.data.version ?? '—')}</td>
                    <td className="px-3 py-2">{String(d.data.owner || '—')}</td>
                    <td className="px-3 py-2 text-right num">
                      {d.data.updatedOn ? new Date(String(d.data.updatedOn)).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '—'}
                    </td>
                    <td className="px-3 py-2 text-right">
                      <Chip tone={String(d.data.access ?? 'Open') === 'Confidential' ? 'bad' : String(d.data.access ?? 'Open') === 'Restricted' ? 'warn' : 'ok'}>
                        {String(d.data.access ?? 'Open')}
                      </Chip>
                    </td>
                    <td className="px-3 py-2 text-right">
                      {file?.url ? (
                        <a href={file.url} target="_blank" rel="noreferrer" style={{ color: 'var(--accent)', textDecoration: 'underline' }}>
                          {file.name || 'Download'}
                        </a>
                      ) : (
                        <span style={{ color: 'var(--faint)' }}>—</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </Panel>

      <div className="mt-[18px]" />

      <Panel
        title="Current versions"
        sub={`${currentVersions.length} live revision${currentVersions.length === 1 ? '' : 's'} · full history in Document versions register`}
        bodyless
      >
        {currentVersions.length === 0 ? (
          <p className="m-0 p-4 text-[13px]" style={{ color: 'var(--muted)' }}>
            No current versions recorded. Add rows to the Document versions register.
          </p>
        ) : (
          <table className="w-full border-collapse text-[12.5px]">
            <thead>
              <tr style={{ color: 'var(--muted)', borderBottom: '1px solid var(--line)' }}>
                <th className="px-3 py-2 text-left font-medium">Doc no.</th>
                <th className="px-3 py-2 text-left font-medium">Title</th>
                <th className="px-3 py-2 text-left font-medium">Rev</th>
                <th className="px-3 py-2 text-left font-medium">Supersedes</th>
                <th className="px-3 py-2 text-right font-medium">Issued</th>
                <th className="px-3 py-2 text-right font-medium">Issuer</th>
              </tr>
            </thead>
            <tbody>
              {currentVersions.map((v) => (
                <tr key={v.id} style={{ borderBottom: '1px solid var(--line-2)' }}>
                  <td className="px-3 py-2 num">{String(v.data.docNo ?? v.ref)}</td>
                  <td className="px-3 py-2">{String(v.data.title ?? '—')}</td>
                  <td className="px-3 py-2 font-medium">{String(v.data.rev ?? '—')}</td>
                  <td className="px-3 py-2">{String(v.data.supersedes || '—')}</td>
                  <td className="px-3 py-2 text-right num">
                    {v.data.issuedOn ? new Date(String(v.data.issuedOn)).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '—'}
                  </td>
                  <td className="px-3 py-2 text-right">{String(v.data.issuer || '—')}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Panel>

      <div className="mt-[18px]" />

      <Panel
        title="Open transmittals"
        sub={`${openTxns.length} awaiting response · full log in Transmittal log register`}
        bodyless
      >
        {openTxns.length === 0 ? (
          <p className="m-0 p-4 text-[13px]" style={{ color: 'var(--muted)' }}>
            No open transmittals. All issued documents have received a response.
          </p>
        ) : (
          <table className="w-full border-collapse text-[12.5px]">
            <thead>
              <tr style={{ color: 'var(--muted)', borderBottom: '1px solid var(--line)' }}>
                <th className="px-3 py-2 text-left font-medium">Txn no.</th>
                <th className="px-3 py-2 text-left font-medium">Document</th>
                <th className="px-3 py-2 text-left font-medium">Purpose</th>
                <th className="px-3 py-2 text-left font-medium">Recipient</th>
                <th className="px-3 py-2 text-right font-medium">Sent</th>
                <th className="px-3 py-2 text-right font-medium">Due back</th>
                <th className="px-3 py-2 text-right font-medium">Status</th>
              </tr>
            </thead>
            <tbody>
              {openTxns.map((t) => {
                const overdue = t.data.dueBack && new Date(String(t.data.dueBack)) < new Date() && String(t.data.status ?? '') !== 'Closed';
                return (
                  <tr key={t.id} style={{ borderBottom: '1px solid var(--line-2)' }}>
                    <td className="px-3 py-2 num">{String(t.data.transmittalNo ?? t.ref)}</td>
                    <td className="px-3 py-2">{String(t.data.docNo ?? '—')} · {String(t.data.title || '')}</td>
                    <td className="px-3 py-2">{String(t.data.purpose ?? '—')}</td>
                    <td className="px-3 py-2">{String(t.data.recipient || '—')}</td>
                    <td className="px-3 py-2 text-right num">
                      {t.data.sentOn ? new Date(String(t.data.sentOn)).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '—'}
                    </td>
                    <td className="px-3 py-2 text-right num">
                      {t.data.dueBack ? new Date(String(t.data.dueBack)).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '—'}
                    </td>
                    <td className="px-3 py-2 text-right">
                      <Chip tone={overdue ? 'bad' : 'warn'}>{overdue ? 'Overdue' : String(t.data.status ?? 'Open')}</Chip>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </Panel>

      <div className="mt-[18px]">
        <Panel title="Full registers" sub="Complete edit and history for each register below" bodyless>
          <div className="p-3 text-[12.5px]" style={{ color: 'var(--muted)' }}>
            Use the sidebar entries <b>Documents</b>, <b>Document versions</b>, <b>Transmittal log</b> and{' '}
            <b>Document control index</b> to add or edit rows. This screen is the read-only roll-up.
          </div>
        </Panel>
      </div>
    </>
  );
}

const ALL_CATEGORIES = 'All';

function CatChip({
  label,
  active,
  onClick,
  count,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
  count: number;
}) {
  return (
    <button
      onClick={onClick}
      className="rounded-full px-3 py-1 text-[12px] font-medium transition"
      style={{
        background: active ? 'var(--accent)' : 'var(--panel)',
        color: active ? '#fff' : 'var(--muted)',
        border: `1px solid ${active ? 'var(--accent)' : 'var(--line)'}`,
      }}
    >
      {label} · {count}
    </button>
  );
}
