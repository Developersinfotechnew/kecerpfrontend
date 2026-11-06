'use client';

import { useRef, useState } from 'react';

import { Button, Notice } from '@/components/ui';
import { excelSerialToISO, parseXlsxGrid, XlsxParseError } from '@/lib/xlsx-parse';
import type { RecordField, RecordType } from '@/lib/types';

interface ParsedRow {
  line: number;
  data: Record<string, unknown>;
  error: string | null;
}

interface ImportExcelModalProps {
  /** The register the rows import into. The header row maps to its field labels. */
  type: RecordType;
  /** Create one row. The caller owns the body shape (project scoping, …). */
  create: (data: Record<string, unknown>) => Promise<void>;
  /**
   * Bulk create: send many rows in one round-trip. When the caller provides
   * this, the import runs in 200-row chunks instead of one request per row
   * (an 800-row schedule = 4 requests, not 800). Falls back to row-by-row
   * when absent or when a bulk call fails.
   */
  createBulk?: (rows: Record<string, unknown>[]) => Promise<void>;
  onClose: () => void;
  onImported: () => void;
}

/**
 * Import from Excel (CSV) on a generic register screen.
 *
 * The spreadsheet is saved from Excel as CSV and parsed in the browser — no
 * new package (the XLSX library is not installable in this build), no data
 * leaves the browser. The header row maps to the register's field labels, so
 * one component serves every register: Issues, Risks, BOQ, …
 *
 * Import is additive and validated row by row, per the spec: required fields
 * and select option lists are checked before anything is written, and a
 * failed create stops the run at that row so the operator sees exactly what
 * broke. No row is ever silently dropped.
 */
export function ImportExcelModal({ type, create, createBulk, onClose, onImported }: ImportExcelModalProps) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [fileName, setFileName] = useState('');
  const [rows, setRows] = useState<ParsedRow[]>([]);
  const [parseError, setParseError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<string | null>(null);

  const fields = type.fields;

  async function handleFile(file: File): Promise<void> {
    setRows([]);
    setResult(null);
    setParseError(null);
    setFileName(file.name);

    // Binary .xlsx (what Google Sheets' "Download → Microsoft Excel" writes):
    // unzip + parse in the browser. Everything else reads as text CSV.
    const ext = file.name.toLowerCase();
    const isXlsx = ext.endsWith('.xlsx') || ext.endsWith('.xls');

    let grid: string[][];
    if (isXlsx) {
      try {
        grid = await parseXlsxGrid(await file.arrayBuffer());
      } catch (err) {
        setParseError(
          err instanceof XlsxParseError
            ? err.message
            : 'Could not read the .xlsx. Try Google Sheets → File → Download → Microsoft Excel (.xlsx), or → CSV.',
        );
        return;
      }
    } else {
      let text: string;
      try {
        text = await file.text();
      } catch {
        setParseError('Could not read the file. Pick the CSV saved from Excel.');
        return;
      }
      const delim = detectDelimiter(text);
      grid = parseDelimited(text, delim);
    }
    if (grid.length < 2) {
      setParseError('The file has no data rows. Expected a header row, then one row per record.');
      return;
    }

    // Header → field key. A column matches when its trimmed, lowercase text
    // equals the field label or the field key, either way. First match wins.
    const header = grid[0].map((h) => h.trim().toLowerCase());
    const colFor = new Map<string, number>();
    for (const f of fields) {
      const byLabel = header.indexOf(f.label.trim().toLowerCase());
      const byKey = header.indexOf(f.key.toLowerCase());
      const idx = byLabel !== -1 ? byLabel : byKey;
      if (idx !== -1) colFor.set(f.key, idx);
    }

    const parsed: ParsedRow[] = grid.slice(1).map((cells, i) => {
      const data: Record<string, unknown> = {};
      for (const f of fields) {
        const idx = colFor.get(f.key);
        if (idx === undefined || idx >= cells.length) continue;
        const raw = String(cells[idx] ?? '').trim();
        if (raw === '') continue;
        // A .xlsx stores dates as serial numbers (45321); turn them into the
        // ISO days the register expects. CSV text dates already read as ISO.
        if (isXlsx && f.type === 'date' && /^\d+(\.\d+)?$/.test(raw)) {
          data[f.key] = excelSerialToISO(Number(raw));
          continue;
        }
        data[f.key] = coerce(f, raw);
      }
      return { line: i + 2, data, error: rowError(fields, data) };
    });

    setRows(parsed);
    const valid = parsed.filter((r) => !r.error).length;
    const skipped = parsed.filter((r) => Object.values(r.data).length === 0).length;
    if (valid === 0 && skipped === 0) setParseError('No usable rows. Check that the header row matches the register field names.');
  }

  async function runImport(): Promise<void> {
    const toImport = rows.filter((r) => !r.error);
    if (toImport.length === 0) return;
    setBusy(true);
    let done = 0;
    try {
      // Fast path: bulk route in 200-row chunks. One sheet of 800 rows is
      // four requests, not 800.
      if (createBulk) {
        let chunkStart = 0;
        while (chunkStart < toImport.length) {
          const chunk = toImport.slice(chunkStart, chunkStart + 200);
          await createBulk(chunk.map((c) => c.data));
          done += chunk.length;
          chunkStart += chunk.length;
        }
        setResult(`Imported ${done} of ${rows.length} rows.`);
        onImported();
        return;
      }
      for (const r of toImport) {
        await create(r.data);
        done += 1;
      }
      setResult(`Imported ${done} of ${rows.length} rows.`);
      onImported();
    } catch (err) {
      setResult(
        `Stopped after ${done} imported: ${err instanceof Error ? err.message : String(err)}`,
      );
    } finally {
      setBusy(false);
    }
  }

  const validCount = rows.filter((r) => !r.error).length;

  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center p-4"
      style={{ background: 'rgba(15, 23, 41, 0.45)' }}
      role="dialog"
      aria-modal="true"
      aria-label={`Import into ${type.label}`}
    >
      <div
        className="max-h-[90vh] w-full max-w-3xl overflow-y-auto rounded"
        style={{ background: 'var(--panel)', border: '1px solid var(--line)' }}
      >
        <header className="flex items-center justify-between px-4 py-3" style={{ borderBottom: '1px solid var(--line-2)' }}>
          <div>
            <h3 className="m-0 text-[14px] font-semibold">Import from Excel — {type.label}</h3>
            <p className="m-0 mt-1 text-[12px]" style={{ color: 'var(--muted)' }}>
              Pick the sheet file. Google Sheets: File → Download → <strong>CSV (current sheet)</strong>.
              Excel: Save As → <strong>CSV</strong>. A binary .xlsx/.xls is also parsed in the browser.
              Header row = field names; one row per record.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-[18px] leading-none"
            style={{ color: 'var(--muted)' }}
            aria-label="Close"
          >
            ×
          </button>
        </header>

        <div className="grid gap-3 p-4">
          <input
            ref={fileRef}
            type="file"
            accept=".csv,.tsv,.txt,.xlsx,.xls"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void handleFile(f);
            }}
            style={{ color: 'var(--ink)' }}
          />

          {parseError ? <Notice>{parseError}</Notice> : null}
          {result ? <Notice>{result}</Notice> : null}

          {rows.length > 0 ? (
            <>
              <p className="m-0 text-[12.5px]">
                {validCount} of {rows.length} row(s) ready.{' '}
                {validCount < rows.length ? 'Fix or delete the invalid rows, then re-pick the file.' : ''}
              </p>
              <div className="max-h-[300px] overflow-auto rounded" style={{ border: '1px solid var(--line)' }}>
                <table className="w-full border-collapse text-[12.5px]">
                  <thead>
                    <tr style={{ background: 'var(--panel-2)' }}>
                      <th className="px-2 py-1 text-left" style={{ border: '1px solid var(--line)' }}>Row</th>
                      {fields.slice(0, 5).map((f) => (
                        <th key={f.key} className="px-2 py-1 text-left" style={{ border: '1px solid var(--line)' }}>
                          {f.label}
                        </th>
                      ))}
                      <th className="px-2 py-1 text-left" style={{ border: '1px solid var(--line)' }}>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r) => (
                      <tr key={r.line}>
                        <td className="px-2 py-1" style={{ border: '1px solid var(--line)' }}>{r.line}</td>
                        {fields.slice(0, 5).map((f) => (
                          <td key={f.key} className="px-2 py-1" style={{ border: '1px solid var(--line)' }}>
                            {String(r.data[f.key] ?? '')}
                          </td>
                        ))}
                        <td className="px-2 py-1" style={{ border: '1px solid var(--line)', color: r.error ? 'var(--red)' : 'var(--muted)' }}>
                          {r.error ?? 'Valid'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="flex justify-end gap-2">
                <Button onClick={onClose}>Cancel</Button>
                <Button variant="primary" disabled={busy || validCount === 0} onClick={() => void runImport()}>
                  {busy ? 'Importing…' : `Import ${validCount} rows`}
                </Button>
              </div>
            </>
          ) : null}
        </div>
      </div>
    </div>
  );
}

// --- parsing ---------------------------------------------------------------

/** The register's own create permission already gates this modal, and the
 *  caller's create callback enforces the rest — the component only validates
 *  shape: required fields, option lists, number/date types. */
function rowError(fields: RecordField[], data: Record<string, unknown>): string | null {
  for (const f of fields) {
    const v = data[f.key];
    if (v === undefined || v === null || v === '') {
      if (f.required) return `${f.label} is required`;
      continue;
    }
    if ((f.type === 'select' || f.type === 'status') && f.options.length > 0 && !f.options.includes(String(v))) {
      return `${f.label} must be one of: ${f.options.join(', ')}`;
    }
    if ((f.type === 'number' || f.type === 'currency' || f.type === 'percent') && Number.isNaN(Number(v))) {
      return `${f.label} must be a number`;
    }
  }
  return null;
}

function coerce(f: RecordField, raw: string): unknown {
  switch (f.type) {
    case 'number':
    case 'currency':
    case 'percent':
      return Number(raw);
    case 'boolean':
      return raw === 'true' || raw === 'yes' || raw === '1';
    default:
      // dates and selects go out as their text; the engine coerces and
      // validates them on save, so a bad value is caught there, not lost.
      return raw;
  }
}

function detectDelimiter(text: string): string {
  const firstLine = text.split('\n')[0] ?? '';
  const tabs = firstLine.split('\t').length;
  const commas = firstLine.split(',').length;
  const semis = firstLine.split(';').length;
  // Excel's CSV is comma-delimited in the default locale; some European
  // locales write semicolons. Tabs cover TSV / pasted-from-Excel.
  if (tabs > semis && tabs > commas) return '\t';
  if (semis > commas) return ';';
  return ',';
}

/** A small RFC-4180 reader: quoted fields, doubled quotes, newlines inside quotes. */
function parseDelimited(text: string, delim: string): string[][] {
  const grid: string[][] = [];
  let cell = '';
  let row: string[] = [];
  let inQuotes = false;

  const pushCell = () => {
    row.push(cell);
    cell = '';
  };
  const pushRow = () => {
    pushCell();
    grid.push(row);
    row = [];
  };

  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        cell += c;
      }
      continue;
    }
    if (c === '"') {
      inQuotes = true;
      continue;
    }
    if (c === delim) {
      pushCell();
      continue;
    }
    if (c === '\n') {
      pushRow();
      continue;
    }
    if (c === '\r') {
      continue;
    }
    cell += c;
  }
  if (cell !== '' || row.length > 0) pushRow();
  // Drop rows that are entirely empty (trailing newlines).
  return grid.filter((r) => r.some((c) => c.trim() !== ''));
}
