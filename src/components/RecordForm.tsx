'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

import { projects as projectService, records, uploads as uploadService } from '@/lib/services';
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
  /**
   * Field keys to leave off this form (the BOQ desk's item form hides the
   * late-stage columns — ordered qty, vendor, PO reference — which belong
   * to the RFQ / PO screens). Hidden fields still save: a value the form
   * does not show writes back whatever the record already held.
   */
  excludeFields?: string[];
  onCancel: () => void;
  onSubmit: (body: Record<string, unknown>) => Promise<void>;
}

export function RecordForm({ type, record, initialValues, onCancel, onSubmit, excludeFields }: RecordFormProps) {
  const [values, setValues] = useState<Record<string, unknown>>({});
  const [projectId, setProjectId] = useState<string>('');
  const [projects, setProjects] = useState<{ id: string; name: string }[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /**
   * Files chosen but not yet uploaded, keyed by field key. A single-file
   * pick holds one File; a multi-image field (the DSR's site photos) holds
   * a File[] the picker appends to. Normalised on submit.
   */
  const [pending, setPending] = useState<Record<string, File | File[]>>({});
  const pendingFilesFor = (key: string): File[] => {
    const p = pending[key];
    if (!p) return [];
    return Array.isArray(p) ? p : [p];
  };
  const [uploadingKey, setUploadingKey] = useState<string | null>(null);
  /** Live select options, keyed by the source register key a field pulls from. */
  const [liveOptions, setLiveOptions] = useState<Record<string, string[]>>({});
  /**
   * The source rows behind each option list, keyed the same way. optionsFrom
   * fields can auto-reflect a picked row's other fields (the GRN's PO select
   * reflects the PO's item and quantity), so the option loader keeps the
   * rows, not just their titles.
   */
  const [liveRows, setLiveRows] = useState<Record<string, Array<{ title: string; data: Record<string, unknown> }>>>({});

  // excludeFields: the BOQ desk hides the late-stage columns (ordered qty,
  // vendor, PO reference) from the indent-stage item form. On an edit the
  // values state is seeded from record.data, so hidden keys still ride in
  // the payload untouched; on a create they are simply absent and the
  // backend fills each field's empty value.
  const hidden = new Set(excludeFields ?? []);
  const fields = [...type.fields]
    .filter((f) => !hidden.has(f.key))
    .sort((a, b) => a.sortOrder - b.sortOrder);

  // Fields that declare optionsFrom (e.g. the GRN vendor list follows the
  // Vendor master) load their options live: one register fetch per source,
  // each rendered through its own title field. A failure leaves the field
  // with its static options, so the form still works.
  //
  // Two kinds of source. Global: loaded once, same for every record — the
  // vendor master, the BOQ reference. Project-scoped (optionsFromScope
  // 'project'): loaded for the record's project only — the DSR task dropdown
  // must list this project's plan, never another project's WBS.
  const globalKeys = [
    ...new Set(fields.filter((f) => f.optionsFrom && f.optionsFromScope !== 'project').map((f) => f.optionsFrom as string)),
  ];
  const scopedKeys = [
    ...new Set(fields.filter((f) => f.optionsFrom && f.optionsFromScope === 'project').map((f) => f.optionsFrom as string)),
  ];

  const loadSource = useCallback(
    (key: string, projectId?: string): (() => void) => {
      let cancelled = false;
      // Type first (for its title field), then the rows. One source = one
      // option list; rows are read in title-field order, de-duplicated.
      void (async () => {
        try {
          const [t, page] = await Promise.all([
            records.type(key),
            records.list(key, projectId ? { projectId, limit: 500 } : { limit: 500 }),
          ]);
          if (cancelled) return;
          const rows = page.items
            .map((r) => ({
              title: String(r.data[t.titleField] ?? r.ref),
              data: (r.data ?? {}) as Record<string, unknown>,
            }))
            .filter((r) => r.title !== '')
            .map((r) => ({ ...r, title: r.title.trim() }));
          const seen = new Set<string>();
          const dedup = rows.filter((r) => (seen.has(r.title) ? false : (seen.add(r.title), true)));
          setLiveOptions((prev) => ({ ...prev, [key]: dedup.map((r) => r.title) }));
          setLiveRows((prev) => ({ ...prev, [key]: dedup }));
        } catch {
          // A failed source fetch leaves the field on its static options.
        }
      })();
      return () => {
        cancelled = true;
      };
    },
    [],
  );

  useEffect(() => {
    const unloads = globalKeys.map((key) => loadSource(key));
    return () => {
      for (const u of unloads) u();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [type.key, globalKeys.length, loadSource]);

  // Project-scoped sources reload whenever the project changes: the option
  // list must follow the record's project. No project chosen = no list, so a
  // scoped dropdown stays empty until a project is picked.
  useEffect(() => {
    if (scopedKeys.length === 0) return;
    if (!projectId) {
      for (const key of scopedKeys) {
        setLiveOptions((prev) => ({ ...prev, [key]: [] }));
        setLiveRows((prev) => ({ ...prev, [key]: [] }));
      }
      return;
    }
    const unloads = scopedKeys.map((key) => loadSource(key, projectId));
    return () => {
      for (const u of unloads) u();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [type.key, scopedKeys.length, projectId, loadSource]);

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
    // row always points at a real document. `files` fields hold a whole
    // batch (the DSR's site photos); a new pick appends to the batch already
    // on the row, it never replaces the photos the report carried.
    const fileFields = fields.filter((f) => f.type === 'file' || f.type === 'files');
    const toUpload = fileFields.filter((f) => pending[f.key] !== undefined);

    setBusy(true);
    setError(null);

    try {
      const resolved = { ...values };

      for (const f of toUpload) {
        setUploadingKey(f.key);
        const picked = pendingFilesFor(f.key);
        const descriptors: Array<{ url: string; name: string; size: number; mimetype: string }> = [];
        for (const file of picked) {
          const descriptor = await uploadService.upload(
            file,
            `${type.permissionModule}:create`,
          );
          descriptors.push(descriptor);
        }
        if (f.type === 'files') {
          const prev = Array.isArray(resolved[f.key])
            ? (resolved[f.key] as Array<{ url?: string; name?: string; size?: number; mimetype?: string }>)
            : resolved[f.key]
              ? [resolved[f.key]]
              : [];
          resolved[f.key] = [...prev, ...descriptors];
        } else {
          resolved[f.key] = descriptors[0] ?? null;
        }
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

          {fields.map((f) => {
            // Create-only options: the DSR add form offers a single entry
            // word ("Submit for approval") that the backend rewrites to the
            // stored default on save; the edit form and the chips keep the
            // full set.
            const shown =
              !record && f.createOptions && f.createOptions.length > 0 && !f.optionsFrom
                ? { ...f, options: f.createOptions }
                : f;
            // Linked dropdown (the DSR sub-task picker): when a select is fed
            // from a register, its list can be narrowed to the rows whose
            // matchField equals the sibling field's chosen value read through
            // sourceKey. The sibling holds the picked title; find that title's
            // source row, read the code it carries, keep only the sub rows
            // whose parent points at it.
            const liveRowsForField = f.optionsFrom ? liveRows[f.optionsFrom] ?? [] : [];
            const liveOptsForField = f.optionsFrom ? liveOptions[f.optionsFrom] ?? [] : [];
            let filteredOptions: string[] | null = null;
            if (f.optionsFrom && f.optionsFromFilter) {
              const { fromField, matchField, sourceKey } = f.optionsFromFilter;
              const siblingValue = String(values[fromField] ?? '');
              const sourceRow = sourceKey
                ? liveRowsForField.find((r) => r.title === siblingValue)
                : undefined;
              const codeMatch = sourceKey && sourceRow ? String(sourceRow.data[sourceKey] ?? '') : siblingValue;
              filteredOptions = liveRowsForField
                .filter((r) => String(r.data[matchField] ?? '') === codeMatch)
                .map((r) => r.title);
            }
            const mergedOptions = f.optionsFrom
              ? filteredOptions !== null
                ? [...new Set([...filteredOptions, ...f.options])]
                : [...new Set([...liveOptsForField, ...f.options])]
              : shown.options;
            return (
            <Field key={f.key} label={f.label} required={f.required}>
              <Input
                field={{ ...shown, options: mergedOptions }}
                value={values[f.key]}
                onChange={(v) => {
                  set(f.key, v);
                  // Linked dropdown: changing the main task orphans the sub
                  // task picked against the old one, so clear every field
                  // whose options are filtered off this field's value.
                  for (const dep of fields) {
                    if (dep.optionsFromFilter && dep.optionsFromFilter.fromField === f.key) {
                      if (values[dep.key] !== undefined && values[dep.key] !== '') set(dep.key, '');
                    }
                  }
                  // optionsFromDetail: picking the PO reflects its item and
                  // quantity onto the receipt so the GRN reads what the PO
                  // bought, no re-typing.
                  if (f.optionsFrom && f.optionsFromDetail && typeof v === 'string' && v) {
                    const hit = (liveRows[f.optionsFrom] ?? []).find((r) => r.title === v);
                    if (hit) {
                      for (const [target, source] of Object.entries(f.optionsFromDetail)) {
                        const reflected = hit.data[source];
                        if (reflected !== undefined && reflected !== null) set(target, String(reflected));
                      }
                    }
                  }
                }}
                pending={pending[f.key]}
                onPick={(picked) => {
                  // A `files` field appends to the batch already picked; a
                  // single-file field replaces its pick.
                  setPending((prev) => {
                    const existing = prev[f.key];
                    if (f.type === 'files' && (Array.isArray(existing) || picked)) {
                      const list = Array.isArray(existing) ? existing : existing ? [existing] : [];
                      const isDup = list.some((x) => x.name === picked.name && x.size === picked.size);
                      return { ...prev, [f.key]: isDup ? list : [...list, picked] };
                    }
                    return { ...prev, [f.key]: picked };
                  });
                }}
                onPickMany={(pickedMany) => {
                  // The batch picker (the DSR's site photos) adds a whole
                  // selection at once, de-duped by name + size.
                  setPending((prev) => {
                    const existing = prev[f.key];
                    const list = Array.isArray(existing) ? existing : existing ? [existing] : [];
                    const merged = [...list];
                    for (const p of pickedMany) {
                      if (!merged.some((x) => x.name === p.name && x.size === p.size)) merged.push(p);
                    }
                    return { ...prev, [f.key]: merged };
                  });
                }}
                onRemoveFile={(index) => {
                  setPending((prev) => {
                    const list = prev[f.key];
                    if (!Array.isArray(list)) return prev;
                    return { ...prev, [f.key]: list.filter((_, i) => i !== index) };
                  });
                }}
                onClear={() => clearField(f.key)}
                uploading={uploadingKey === f.key}
              />
            </Field>
            );
          })}
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
  /** Files chosen in this session but not yet uploaded: one for a `file`
   * field, a batch for a `files` field (the DSR's site photos). */
  pending?: File | File[];
  /** True while this field's files are being uploaded on submit. */
  uploading?: boolean;
  onPick: (file: File) => void;
  /** Multi-file pick for a `files` field: a whole batch at once. */
  onPickMany?: (files: File[]) => void;
  /** Clears one pending pick by index (a `files` batch). */
  onRemoveFile?: (index: number) => void;
  /** Clears a pending pick. Must also remove it from pending state, not just
   * set the value to null — a null value would still be shadowed by the
   * pending File and uploaded anyway. */
  onClear: () => void;
}

function Input({
  field,
  value,
  onChange,
  pending,
  uploading,
  onPick,
  onPickMany,
  onRemoveFile,
  onClear,
}: InputProps) {
  const str = value === null || value === undefined ? '' : String(value);
  const pendingFiles = pending ? (Array.isArray(pending) ? pending : [pending]) : [];

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
      // A live-options field (optionsFrom) renders as a dropdown combobox:
      // clicking the field opens the source register's values as a panel,
      // typing filters the list, and a free value stays allowed, so an empty
      // vendor master never blocks the form with a dead dropdown.
      if (field.optionsFrom) {
        return <ComboSelect key={field.key} options={field.options} value={str} onChange={onChange} />;
      }
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

    case 'files':
      return (
        <FilesInput
          value={value as Array<{ url?: string; name?: string }> | { url?: string; name?: string } | null}
          pending={pendingFiles}
          uploading={uploading}
          onPickMany={onPickMany}
          onRemoveFile={onRemoveFile}
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
 * Click-to-open dropdown combobox for live-options fields (optionsFrom).
 *
 * Clicking (or focusing) the input opens a panel listing the source
 * register's values; typing filters it. Free text stays allowed: a value
 * that matches no option is kept as-is, so a vendor master without rows
 * never blocks the form.
 */
function ComboSelect({
  options,
  value,
  onChange,
}: {
  options: string[];
  value: string;
  onChange: (value: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [initial, setInitial] = useState('');
  const rootRef = useRef<HTMLDivElement | null>(null);
  // While the text is untouched, show every option. Once the user types,
  // the list narrows to matches.
  const visible = options.filter((o) =>
    query === initial ? true : o.toLowerCase().includes(query.toLowerCase())
  );

  // A click anywhere in the panel keeps it open; a click outside closes it.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  return (
    <div ref={rootRef} style={{ position: 'relative' }}>
      <input
        value={open ? query : value}
        onChange={(e) => {
          setQuery(e.target.value);
          onChange(e.target.value);
          setOpen(true);
        }}
        onFocus={() => {
          setQuery(value);
          setInitial(value);
          setOpen(true);
        }}
        placeholder={options.length === 0 ? 'Type a name or pick…' : 'Pick…'}
        className={INPUT_CLASS}
        style={INPUT_STYLE}
      />
      {open && visible.length > 0 ? (
        <div
          style={{
            position: 'absolute',
            top: '100%',
            left: 0,
            right: 0,
            zIndex: 30,
            margin: 0,
            maxHeight: 220,
            overflowY: 'auto',
            background: '#fff',
            border: '1px solid var(--line)',
            borderRadius: 6,
            boxShadow: '0 6px 16px rgba(0, 0, 0, 0.12)',
          }}
        >
          {visible.map((o) => (
            <div
              key={o}
              role="option"
              aria-selected={o === value}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => {
                onChange(o);
                setOpen(false);
              }}
              style={{
                padding: '6px 10px',
                fontSize: 13,
                cursor: 'pointer',
                background: o === value ? 'var(--accent-soft, #eef1f7)' : '#fff',
              }}
            >
              {o}
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

/**
 * A saved document plus the option to replace it.
 *
 * A saved descriptor renders as a link so the row can be viewed immediately.
 * A newly chosen File renders with its name and a remove affordance; it is
 * uploaded on submit, not on selection.
 */
/**
 * A batch of documents / images for a `files` field. The DSR's site photos:
 * the whole day's shots, not one. A picked batch lists its names and drops
 * individually; saved descriptors render as links. A pending pick
 * (this session's files) lists with sizes and removes on click.
 */
function FilesInput({
  value,
  pending,
  uploading,
  onPickMany,
  onRemoveFile,
  onChange,
}: {
  value: Array<{ url?: string; name?: string }> | { url?: string; name?: string } | null;
  pending: File[];
  uploading?: boolean;
  onPickMany?: (files: File[]) => void;
  onRemoveFile?: (index: number) => void;
  onChange: (value: unknown) => void;
}) {
  const saved = Array.isArray(value)
    ? value
    : value && typeof value === 'object' && value.url
      ? [value]
      : [];

  if (uploading) {
    return (
      <span className="inline-flex items-center gap-2 rounded px-2.5 py-1.5 text-[12.5px]" style={INPUT_STYLE}>
        <span className="inline-block h-2.5 w-2.5 animate-pulse rounded-full" style={{ background: 'var(--accent)' }} />
        Uploading {pending.length} file{pending.length === 1 ? '' : 's'}…
      </span>
    );
  }

  return (
    <div className="flex flex-col gap-1.5">
      {pending.length > 0 ? (
        <div className="flex flex-wrap gap-1.5">
          {pending.map((f, i) => (
            <span
              key={`${f.name}-${i}`}
              className="inline-flex items-center gap-1.5 rounded px-2 py-1 text-[12px]"
              style={{ border: '1px solid var(--line)', background: 'var(--panel-2, #f9faf8)' }}
            >
              <span className="truncate" style={{ maxWidth: 160 }}>{f.name}</span>
              <span style={{ color: 'var(--muted)' }}>({humanSize(f.size)})</span>
              <button
                type="button"
                onClick={() => onRemoveFile?.(i)}
                className="ml-0.5 text-[14px] leading-none"
                style={{ color: 'var(--muted)' }}
                aria-label={`Remove ${f.name}`}
              >
                ×
              </button>
            </span>
          ))}
        </div>
      ) : null}
      {saved.length > 0 ? (
        <div className="flex flex-wrap items-center gap-2 text-[12.5px]">
          {saved.map((d, i) => (
            <a
              key={`${d.url}-${i}`}
              href={d.url}
              target="_blank"
              rel="noreferrer"
              style={{ color: 'var(--accent)', textDecoration: 'underline' }}
            >
              {d.name || 'Download'}
            </a>
          ))}
          {pending.length === 0 ? (
            <button
              type="button"
              onClick={() => onChange(null)}
              className="rounded px-1.5 py-0.5 text-[12px]"
              style={{ border: '1px solid var(--line)', color: 'var(--muted)' }}
            >
              Clear all
            </button>
          ) : null}
        </div>
      ) : null}
      <label
        className="flex w-full cursor-pointer items-center gap-3 rounded-md px-3.5 py-3"
        style={{
          border: '1.5px dashed var(--line)',
          background: 'var(--panel-2, #f9faf8)',
          transition: 'border-color 0.15s ease',
        }}
      >
        <svg width="26" height="26" viewBox="0 0 24 24" fill="none" className="flex-none" aria-hidden="true">
          <path
            d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8l-5-5Z"
            stroke="var(--muted)"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <path
            d="M14 3v4a1 1 0 0 0 1 1h4"
            stroke="var(--muted)"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
        <span className="text-[12.5px]">
          <span className="font-semibold" style={{ color: 'var(--ink)' }}>
            Add site images
          </span>
          <span className="block text-[11.5px]" style={{ color: 'var(--muted)' }}>
            Pick several at once · uploaded on save
          </span>
        </span>
        <input
          type="file"
          multiple
          accept="image/*"
          className="sr-only"
          tabIndex={-1}
          aria-hidden="true"
          onChange={(e) => {
            const files = Array.from(e.target.files ?? []);
            if (files.length > 0) onPickMany?.(files);
            e.target.value = '';
          }}
        />
      </label>
    </div>
  );
}

/**
 * Width of a picked image, measured from the File itself. Used for a
 * low-resolution warning: a WhatsApp-compressed photo (~700px wide) uploads
 * fine but reads as "blurry" — catch it at pick time instead.
 */
function useImageWidth(file: File | undefined): number | null {
  const [w, setW] = useState<number | null>(null);
  useEffect(() => {
    setW(null);
    if (!file || !file.type.startsWith('image/')) return;
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      setW(img.naturalWidth);
      URL.revokeObjectURL(url);
    };
    img.src = url;
    return () => URL.revokeObjectURL(url);
  }, [file]);
  return w;
}

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
  const imgWidth = useImageWidth(pending);

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
        {pending.type.startsWith('image/') && imgWidth !== null && imgWidth < 1000 ? (
          <span
            className="rounded px-1.5 py-0.5 text-[11px]"
            style={{ background: 'var(--warn-soft)', color: 'var(--warn)' }}
            title={`Image is ${imgWidth}px wide — below 1000px it will look soft when zoomed`}
          >
            Low-res ({imgWidth}px)
          </span>
        ) : null}
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

  // Empty state: a styled pick-zone, not the native control. The native
  // input stays in the tree, visually hidden, so keyboard and screen-reader
  // semantics are untouched; the dashed card is its label.
  return (
    <label
      className="flex w-full cursor-pointer items-center gap-3 rounded-md px-3.5 py-3"
      style={{
        border: '1.5px dashed var(--line)',
        background: 'var(--panel-2, #f9faf8)',
        transition: 'border-color 0.15s ease',
      }}
      onDragOver={(e) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'copy';
      }}
      onDrop={(e) => {
        e.preventDefault();
        const file = e.dataTransfer.files?.[0];
        if (file) onPick(file);
      }}
    >
      <svg
        width="26"
        height="26"
        viewBox="0 0 24 24"
        fill="none"
        className="flex-none"
        aria-hidden="true"
      >
        <path
          d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8l-5-5Z"
          stroke="var(--muted)"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <path
          d="M14 3v4a1 1 0 0 0 1 1h4"
          stroke="var(--muted)"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
      <span className="text-[12.5px]">
        <span className="font-semibold" style={{ color: 'var(--ink)' }}>
          Choose a document
        </span>
        <span className="block text-[11.5px]" style={{ color: 'var(--muted)' }}>
          PDF, DWG, XLSX or image · uploaded on save
        </span>
      </span>
      <input
        type="file"
        className="sr-only"
        tabIndex={-1}
        aria-hidden="true"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) onPick(file);
          e.target.value = '';
        }}
      />
    </label>
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
