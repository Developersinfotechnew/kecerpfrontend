'use client';

import { useEffect, useState } from 'react';

import { projects as projectService, uploads as uploadService } from '@/lib/services';
import type { RecordField, RecordRow, RecordType } from '@/lib/types';
import { Button } from '@/components/ui';

/**
 * Create-or-edit form for one record, driven entirely by its type's fields.
 *
 * The form decides each input from the field's declared type, so adding a
 * field to a register in the admin UI makes it appear here with no code change.
 * It does no validation of its own beyond the browser's required hint; the API
 * is the only validator that counts, and it re-checks every value on write.
 *
 * A `file` field does not save immediately. The chosen File sits in pending
 * state until submit, when the upload resolves and its descriptor is written
 * into the record. That ordering means a create never half-succeeds: the row
 * only appears once its document is stored.
 */

interface RecordFormProps {
  type: RecordType;
  /** null creates a new record; a row edits it. */
  record: RecordRow | null;
  /**
   * CR-11: field values to open a create with. The DPR prefill endpoint
   * returns the day's DSR numbers; passing them here means the PM confirms a
   * filled form instead of typing from scratch. Only used when record is
   * null, on top of each field's declared default.
   */
  initialValues?: Record<string, unknown>;
  onCancel: () => void;
  onSubmit: (body: Record<string, unknown>) => Promise<void>;
}

export function RecordForm({ type, record, initialValues, onCancel, onSubmit }: RecordFormProps) {
  const [values, setValues] = useState<Record<string, unknown>>({});
  const [projectId, setProjectId] = useState<string>('');
  const [projects, setProjects] = useState<{ id: string; name: string }[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** Files chosen but not yet uploaded, keyed by field key. */
  const [pending, setPending] = useState<Record<string, File>>({});
  const [uploadingKey, setUploadingKey] = useState<string | null>(null);

  const fields = [...type.fields].sort((a, b) => a.sortOrder - b.sortOrder);

  // Transaction registers that open an approval chain must be bound to a
  // project. Without one, the chain has no projectId, the team gate can't
  // bind it to a plant, and it leaks into every approver's queue. For the
  // four types that trigger a chain, a project is mandatory.
  const CHAIN_TYPES = new Set([
    'boq_register',
    'purchase_requirements',
    'purchase_orders',
    'ra_bills',
  ]);
  const requiresProject = CHAIN_TYPES.has(type.key);

  // Seed the form. Editing loads the record's data; creating starts from each
  // field's declared default.
  useEffect(() => {
    if (record) {
      setValues({ ...record.data });
      setProjectId(record.projectId ?? '');
    } else {
      const initial: Record<string, unknown> = {};
      for (const f of fields) {
        if (f.defaultValue) initial[f.key] = f.defaultValue;
      }
      // CR-11: a create opened with prefilled values (the DPR screen) layers
      // them over the defaults, so the PM starts from the day's site data.
      if (initialValues) {
        for (const [k, v] of Object.entries(initialValues)) {
          if (v !== undefined && v !== null) initial[k] = v;
        }
      }
      setValues(initial);
      setProjectId('');
    }
    setPending({});
    // fields is derived from type and is stable for a given type.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [record, type.id]);

  useEffect(() => {
    projectService
      .list()
      .then((list) => setProjects(list))
      .catch(() => setProjects([]));
  }, []);

  function set(key: string, value: unknown): void {
    setValues((v) => ({ ...v, [key]: value }));
  }

  /**
   * Drops a field's pending pick.
   *
   * Both maps must clear together. Setting only the value to null would leave
   * the File in pending, and the pending file is what submit uploads — so the
   * row would still save the document the user just removed.
   */
  function clearField(key: string): void {
    setValues((v) => {
      const next = { ...v };
      delete next[key];
      return next;
    });
    setPending((p) => {
      const next = { ...p };
      delete next[key];
      return next;
    });
  }

  async function submit(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    if (busy) return;

    // A chain-opening transaction record cannot be created without a project.
    // Catching it here gives a clear message instead of a chain with no
    // projectId that then shows up in every approver's queue.
    if (requiresProject && !projectId) {
      setError('Pick the project this record belongs to before saving.');
      return;
    }

    // Upload any pending files before saving the row. A pending upload means
    // the user picked a file in this form; resolving it first means the saved
    // row always points at a real document.
    const fileFields = fields.filter((f) => f.type === 'file');
    const toUpload = fileFields.filter((f) => pending[f.key] !== undefined);

    setBusy(true);
    setError(null);

    try {
      const resolved = { ...values };

      for (const f of toUpload) {
        setUploadingKey(f.key);
        const file = pending[f.key];
        if (!file) continue;
        const descriptor = await uploadService.upload(
          file,
          `${type.permissionModule}:create`,
        );
        resolved[f.key] = descriptor;
      }
      setUploadingKey(null);

      // Only send a projectId when the user chose one; the API treats an absent
      // key as "leave unchanged" and an empty string as "clear".
      const body: Record<string, unknown> = { data: resolved };
      if (projectId) body.projectId = projectId;

      await onSubmit(body);
    } catch (err) {
      setUploadingKey(null);
      setError(err instanceof Error ? err.message : 'Save failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center p-4"
      style={{ background: 'rgba(15, 23, 41, 0.45)' }}
      role="dialog"
      aria-modal="true"
      aria-label={record ? `Edit ${type.label}` : `New ${type.label}`}
    >
      <form
        onSubmit={submit}
        className="max-h-[90vh] w-full max-w-xl overflow-y-auto rounded"
        style={{ background: 'var(--panel)', border: '1px solid var(--line)' }}
      >
        <header
          className="flex items-center justify-between px-4 py-3"
          style={{ borderBottom: '1px solid var(--line-2)' }}
        >
          <h3 className="m-0 text-[14px] font-semibold">
            {record ? `Edit ${record.ref}` : `New ${type.label}`}
          </h3>
          <button
            type="button"
            onClick={onCancel}
            className="text-[18px] leading-none"
            style={{ color: 'var(--muted)' }}
            aria-label="Close"
          >
            ×
          </button>
        </header>

        <div className="grid gap-3 p-4">
          {error ? (
            <p className="m-0 text-[12.5px]" style={{ color: 'var(--red)' }} role="alert">
              {error}
            </p>
          ) : null}

          {projects.length > 0 ? (
            <Field label="Project" required={requiresProject}>
              <select
                value={projectId}
                onChange={(e) => setProjectId(e.target.value)}
                className="w-full rounded px-2.5 py-1.5 text-[13px]"
                style={{ border: '1px solid var(--line)', background: '#fff' }}
              >
                <option value="" disabled={requiresProject}>
                  {requiresProject ? 'Select a project…' : 'Not project-specific'}
                </option>
                {projects.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </Field>
          ) : null}

          {fields.map((f) => (
            <Field key={f.key} label={f.label} required={f.required}>
              <Input
                field={f}
                value={values[f.key]}
                onChange={(v) => set(f.key, v)}
                pending={pending[f.key]}
                onPick={(file) => setPending((p) => ({ ...p, [f.key]: file }))}
                onClear={() => clearField(f.key)}
                uploading={uploadingKey === f.key}
              />
            </Field>
          ))}
        </div>

        <footer
          className="flex justify-end gap-2 px-4 py-3"
          style={{ borderTop: '1px solid var(--line-2)' }}
        >
          <Button onClick={onCancel}>Cancel</Button>
          <Button type="submit" variant="primary" className={busy ? 'opacity-60' : ''}>
            {uploadingKey ? 'Uploading…' : busy ? 'Saving…' : record ? 'Save changes' : 'Create'}
          </Button>
        </footer>
      </form>
    </div>
  );
}

function Field({
  label,
  required,
  children,
}: {
  label: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-[12px] font-medium" style={{ color: 'var(--muted)' }}>
        {label}
        {required ? <span style={{ color: 'var(--red)' }}> *</span> : null}
      </span>
      {children}
    </label>
  );
}

const INPUT_STYLE = {
  border: '1px solid var(--line)',
  background: '#fff',
} as const;

const INPUT_CLASS = 'w-full rounded px-2.5 py-1.5 text-[13px]';

interface InputProps {
  field: RecordField;
  value: unknown;
  onChange: (value: unknown) => void;
  /** A File chosen in this session but not yet uploaded. */
  pending?: File;
  /** True while this field's file is being uploaded on submit. */
  uploading?: boolean;
  onPick: (file: File) => void;
  /** Clears a pending pick. Must also remove it from pending state, not just
   * set the value to null — a null value would still be shadowed by the
   * pending File and uploaded anyway. */
  onClear: () => void;
}

function Input({ field, value, onChange, pending, uploading, onPick, onClear }: InputProps) {
  const str = value === null || value === undefined ? '' : String(value);

  switch (field.type) {
    case 'textarea':
      return (
        <textarea
          value={str}
          onChange={(e) => onChange(e.target.value)}
          rows={3}
          className={INPUT_CLASS}
          style={INPUT_STYLE}
        />
      );

    case 'select':
    case 'status':
      return (
        <select
          value={str}
          onChange={(e) => onChange(e.target.value)}
          className={INPUT_CLASS}
          style={INPUT_STYLE}
        >
          <option value="">—</option>
          {field.options.map((o) => (
            <option key={o} value={o}>
              {o}
            </option>
          ))}
        </select>
      );

    case 'date':
      return (
        <input
          type="date"
          value={toDateInput(str)}
          onChange={(e) => onChange(e.target.value)}
          className={INPUT_CLASS}
          style={INPUT_STYLE}
        />
      );

    case 'number':
    case 'currency':
    case 'percent':
      return (
        <input
          type="number"
          value={str}
          onChange={(e) => onChange(e.target.value)}
          step={field.type === 'percent' ? '0.1' : '1'}
          className={INPUT_CLASS}
          style={INPUT_STYLE}
        />
      );

    case 'boolean':
      return (
        <input
          type="checkbox"
          checked={value === true || value === 'true'}
          onChange={(e) => onChange(e.target.checked)}
          style={{ accentColor: 'var(--accent)' }}
        />
      );

    case 'table':
      return (
        <TableInput
          columns={field.tableColumns ?? []}
          value={Array.isArray(value) ? (value as Array<Record<string, unknown>>) : []}
          onChange={(rows) => onChange(rows)}
        />
      );

    case 'file':
      return (
        <FileInput
          value={value as { name?: string; url?: string } | null}
          pending={pending}
          uploading={uploading}
          onPick={onPick}
          onClear={onClear}
          onChange={onChange}
        />
      );

    default:
      return (
        <input
          type="text"
          value={str}
          onChange={(e) => onChange(e.target.value)}
          className={INPUT_CLASS}
          style={INPUT_STYLE}
        />
      );
  }
}

/**
 * A saved document plus the option to replace it.
 *
 * A saved descriptor renders as a link so the row can be viewed immediately.
 * A newly chosen File renders with its name and a remove affordance; it is
 * uploaded on submit, not on selection.
 */
function FileInput({
  value,
  pending,
  uploading,
  onPick,
  onClear,
  onChange,
}: {
  value: { name?: string; url?: string } | null;
  pending?: File;
  uploading?: boolean;
  onPick: (file: File) => void;
  onClear: () => void;
  onChange: (value: unknown) => void;
}) {
  // A pending pick outranks the saved value: it is what will actually save.
  if (uploading) {
    return (
      <span className="inline-flex items-center gap-2 rounded px-2.5 py-1.5 text-[12.5px]" style={INPUT_STYLE}>
        <span className="inline-block h-2.5 w-2.5 animate-pulse rounded-full" style={{ background: 'var(--accent)' }} />
        Uploading…
      </span>
    );
  }

  if (pending) {
    return (
      <span className="inline-flex items-center gap-2 rounded px-2.5 py-1.5 text-[12.5px]" style={INPUT_STYLE}>
        <span className="truncate">{pending.name}</span>
        <span style={{ color: 'var(--muted)' }}>({humanSize(pending.size)})</span>
        <button
          type="button"
          onClick={onClear}
          className="ml-1 text-[15px] leading-none"
          style={{ color: 'var(--muted)' }}
          aria-label="Remove file"
        >
          ×
        </button>
      </span>
    );
  }

  if (value && typeof value === 'object' && value.url) {
    return (
      <span className="inline-flex flex-wrap items-center gap-2 text-[12.5px]">
        <a
          href={value.url}
          target="_blank"
          rel="noreferrer"
          style={{ color: 'var(--accent)', textDecoration: 'underline' }}
        >
          {value.name || 'Download'}
        </a>
        <button
          type="button"
          onClick={() => onChange(null)}
          className="rounded px-1.5 py-0.5 text-[12px]"
          style={{ border: '1px solid var(--line)', color: 'var(--muted)' }}
        >
          Remove
        </button>
      </span>
    );
  }

  return (
    <input
      type="file"
      onChange={(e) => {
        const file = e.target.files?.[0];
        if (file) onPick(file);
        e.target.value = '';
      }}
      className="block w-full text-[12.5px]"
      style={{ color: 'var(--muted)' }}
    />
  );
}

/**
 * CR-11: an inline table field. One row is an object whose keys are the
 * field's declared columns. The editor renders a grid with a column header
 * per key; each cell is a free input so the same editor serves any table
 * (activities done, hindrances, or a future one). The value is an array of
 * row objects; add and remove rows in place.
 */
function TableInput({
  columns,
  value,
  onChange,
}: {
  columns: string[];
  value: Array<Record<string, unknown>>;
  onChange: (rows: Array<Record<string, unknown>>) => void;
}) {
  if (columns.length === 0) {
    return (
      <p className="m-0 text-[12px]" style={{ color: 'var(--faint)' }}>
        No columns declared for this table.
      </p>
    );
  }

  function setCell(rowIdx: number, col: string, cell: string): void {
    onChange(value.map((r, i) => (i === rowIdx ? { ...r, [col]: cell } : r)));
  }

  function addRow(): void {
    const blank: Record<string, unknown> = {};
    for (const c of columns) blank[c] = '';
    onChange([...value, blank]);
  }

  function removeRow(rowIdx: number): void {
    onChange(value.filter((_, i) => i !== rowIdx));
  }

  return (
    <div>
      <div className="grid gap-1.5" style={{ gridTemplateColumns: `48px ${columns.map(() => '1fr').join(' ')} 32px` }}>
        <div />
        {columns.map((c) => (
          <span
            key={`h-${c}`}
            className="text-[10.5px] font-semibold uppercase tracking-wide"
            style={{ color: 'var(--muted)' }}
          >
            {c.replace(/([A-Z])/g, ' $1').toLowerCase()}
          </span>
        ))}
        <span />

        {value.map((row, rowIdx) => (
          <TableRow
            key={rowIdx}
            index={rowIdx + 1}
            row={row}
            columns={columns}
            onCell={(c, v) => setCell(rowIdx, c, v)}
            onRemove={() => removeRow(rowIdx)}
          />
        ))}

        <div className="col-span-full">
          <button
            type="button"
            onClick={addRow}
            className="rounded px-2.5 py-1 text-[12px] font-medium"
            style={{ border: '1px solid var(--line)', background: 'var(--panel-2)', color: 'var(--ink)' }}
          >
            + Add row
          </button>
        </div>
      </div>
      {value.length === 0 ? (
        <p className="mt-1.5 m-0 text-[11.5px]" style={{ color: 'var(--faint)' }}>
          No rows yet.
        </p>
      ) : null}
    </div>
  );
}

function TableRow({
  index,
  row,
  columns,
  onCell,
  onRemove,
}: {
  index: number;
  row: Record<string, unknown>;
  columns: string[];
  onCell: (col: string, v: string) => void;
  onRemove: () => void;
}) {
  return (
    <>
      <span className="num text-[11.5px]" style={{ color: 'var(--faint)', paddingTop: '4px' }}>
        {index}
      </span>
      {columns.map((c) => (
        <input
          key={c}
          value={row[c] === undefined || row[c] === null ? '' : String(row[c])}
          onChange={(e) => onCell(c, e.target.value)}
          className="rounded px-1.5 py-1 text-[12px]"
          style={{ border: '1px solid var(--line)', background: 'var(--panel)' }}
        />
      ))}
      <button
        type="button"
        onClick={onRemove}
        className="text-[14px] leading-none"
        style={{ color: 'var(--muted)' }}
        aria-label="Remove row"
      >
        ×
      </button>
    </>
  );
}

/** Converts any ISO date or date-time into the yyyy-mm-dd a date input wants. */
function toDateInput(value: string): string {
  if (!value) return '';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  return d.toISOString().slice(0, 10);
}

/** Bytes to a short human string, matching the backend's own formatting. */
function humanSize(bytes: number): string {
  if (!bytes) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  let v = bytes;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i += 1;
  }
  return `${v >= 10 || i === 0 ? Math.round(v) : v.toFixed(1)} ${units[i]}`;
}
