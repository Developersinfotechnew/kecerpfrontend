'use client';

import { useEffect, useState } from 'react';

import { records as recordService } from '@/lib/services';
import type { FieldType, RefTarget, RecordField } from '@/lib/types';
import { Button, Chip, DataTable, Notice } from '@/components/ui';

/**
 * The register designer.
 *
 * The screen an administrator uses to add a register to the platform. Pick a
 * key, a label, a permission module and a reference prefix, then add fields one
 * at a time. Saving inserts a record type; the register is live immediately and
 * appears in the register index, with no deploy and no new page.
 *
 * Fields are checked here for the obvious failures so the operator gets feedback
 * before the round trip. The backend repeats every check on write. This client
 * check is convenience, not enforcement.
 */

interface TypeDesignerProps {
  /** False hides the controls; used when the caller lacks admin:create. */
  canCreate: boolean;
}

interface DraftField extends RecordField {
  /** Display only, so the list can key off insertion order. */
  _temp: string;
}

const FIELD_TYPE_LABELS: Record<FieldType, string> = {
  text: 'Text',
  textarea: 'Long text',
  number: 'Number',
  currency: 'Currency',
  percent: 'Percent',
  date: 'Date',
  select: 'Choice',
  status: 'Status',
  ref: 'Reference',
  boolean: 'Yes / No',
  table: 'Table',
  file: 'File',
};

const REF_OPTIONS: RefTarget[] = ['project', 'user', 'client'];

export function TypeDesigner({ canCreate }: TypeDesignerProps) {
  const [key, setKey] = useState('');
  const [label, setLabel] = useState('');
  const [description, setDescription] = useState('');
  const [permissionModule, setPermissionModule] = useState('project');
  const [refPrefix, setRefPrefix] = useState('');
  const [titleField, setTitleField] = useState('');
  const [suite, setSuite] = useState('shared');
  const [fields, setFields] = useState<DraftField[]>([]);

  const [modules, setModules] = useState<string[]>(['project']);
  const [suites, setSuites] = useState<string[]>([
    'backoffice',
    'shared',
    'epc',
    'pmc',
    'eptp',
    'om',
  ]);

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);

  // The module and suite lists come from the API, so a new module added to the
  // permission catalogue is selectable here without editing this file.
  useEffect(() => {
    recordService
      .vocabulary()
      .then((v) => {
        if (v.modules.length) setModules(v.modules);
        if (v.suites.length) setSuites(v.suites);
      })
      .catch(() => undefined);
  }, []);

  function addField(): void {
    setFields((f) => [
      ...f,
      {
        _temp: `${Date.now()}-${f.length}`,
        key: '',
        label: '',
        type: 'text',
        required: false,
        options: [],
        refType: '',
        align: 'left',
        listColumn: true,
        defaultValue: '',
        sortOrder: 100 + f.length * 10,
      },
    ]);
  }

  function patchField(index: number, patch: Partial<DraftField>): void {
    setFields((list) => list.map((f, i) => (i === index ? { ...f, ...patch } : f)));
  }

  function removeField(index: number): void {
    setFields((list) => list.filter((_, i) => i !== index));
  }

  async function save(): Promise<void> {
    setError(null);
    setOk(null);

    if (!/^[a-z][a-z0-9_]*$/.test(key)) {
      setError('Key must be lowercase with underscores, starting with a letter.');
      return;
    }
    if (!label.trim()) {
      setError('Label is required.');
      return;
    }
    if (!refPrefix.trim()) {
      setError('Reference prefix is required.');
      return;
    }
    if (fields.length === 0) {
      setError('Add at least one field.');
      return;
    }

    const seen = new Set<string>();
    for (const f of fields) {
      if (!/^[a-z][a-zA-Z0-9]*$/.test(f.key)) {
        setError(`Field key "${f.key || '(empty)'}" must be camelCase, starting lowercase.`);
        return;
      }
      if (seen.has(f.key)) {
        setError(`Duplicate field key "${f.key}".`);
        return;
      }
      seen.add(f.key);
      if (!f.label.trim()) {
        setError(`Field "${f.key}" needs a label.`);
        return;
      }
      if ((f.type === 'select' || f.type === 'status') && f.options.length === 0) {
        setError(`Field "${f.key}" needs at least one option.`);
        return;
      }
    }

    setBusy(true);
    try {
      const created = await recordService.createType({
        key,
        label: label.trim(),
        description,
        permissionModule,
        refPrefix: refPrefix.trim().toUpperCase(),
        titleField,
        suite,
        fields,
      });
      setOk(`Register ${created.key} created. It is live now.`);
      setKey('');
      setLabel('');
      setDescription('');
      setRefPrefix('');
      setTitleField('');
      setFields([]);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Create failed');
    } finally {
      setBusy(false);
    }
  }

  const columns: { key: string; label: string; align: 'left' | 'right' }[] = [
    { key: 'key', label: 'Key', align: 'left' },
    { key: 'label', label: 'Label', align: 'left' },
    { key: 'type', label: 'Type', align: 'left' },
    { key: 'options', label: 'Options (comma separated)', align: 'left' },
    { key: 'flags', label: 'Flags', align: 'left' },
    { key: '_actions', label: '', align: 'right' },
  ];

  return (
    <>
      {error ? <Notice>{error}</Notice> : null}
      {ok ? (
        <div
          className="mb-4 rounded px-3.5 py-2.5 text-[12.5px]"
          style={{ background: 'var(--accent-soft)', border: '1px solid var(--accent)', color: 'var(--accent-dark)' }}
        >
          {ok}
        </div>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-[300px_1fr]">
        <Panel title="Register">
          <div className="grid gap-3">
            <FieldRow label="Key" hint="lowercase, underscored — e.g. spare_parts" required>
              <TextInput value={key} onChange={(v) => setKey(v.toLowerCase())} placeholder="spare_parts" disabled={!canCreate} />
            </FieldRow>

            <FieldRow label="Label" hint="display name shown in the UI" required>
              <TextInput value={label} onChange={setLabel} placeholder="Spare parts catalogue" disabled={!canCreate} />
            </FieldRow>

            <FieldRow label="Description">
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={2}
                className="w-full rounded px-2.5 py-1.5 text-[13px]"
                style={{ border: '1px solid var(--line)' }}
                disabled={!canCreate}
              />
            </FieldRow>

            <FieldRow label="Permission module" hint="gates access, e.g. spares, dms, project">
              <select
                value={permissionModule}
                onChange={(e) => setPermissionModule(e.target.value)}
                className="w-full rounded px-2.5 py-1.5 text-[13px]"
                style={{ border: '1px solid var(--line)' }}
                disabled={!canCreate}
              >
                {modules.map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </select>
            </FieldRow>

            <FieldRow label="Reference prefix" hint="produces REF-0001, REF-0002" required>
              <TextInput value={refPrefix} onChange={(v) => setRefPrefix(v.toUpperCase())} placeholder="SPR" disabled={!canCreate} />
            </FieldRow>

            <FieldRow label="Suite">
              <select
                value={suite}
                onChange={(e) => setSuite(e.target.value)}
                className="w-full rounded px-2.5 py-1.5 text-[13px]"
                style={{ border: '1px solid var(--line)' }}
                disabled={!canCreate}
              >
                {suites.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </FieldRow>

            <FieldRow label="Title field" hint="the field that names a row">
              <select
                value={titleField}
                onChange={(e) => setTitleField(e.target.value)}
                className="w-full rounded px-2.5 py-1.5 text-[13px]"
                style={{ border: '1px solid var(--line)' }}
                disabled={!canCreate}
              >
                <option value="">—</option>
                {fields.map((f) => (
                  <option key={f._temp} value={f.key}>
                    {f.label || f.key}
                  </option>
                ))}
              </select>
            </FieldRow>
          </div>
        </Panel>

        <Panel
          title="Fields"
          sub={fields.length ? `${fields.length} field${fields.length === 1 ? '' : 's'}` : undefined}
          actions={
            <Button variant="small" onClick={addField} className={canCreate ? '' : 'opacity-50'}>
              Add field
            </Button>
          }
          bodyless
        >
          <DataTable
            columns={columns}
            rows={
              fields.map((f, i) => [
                <TextInput key="k" value={f.key} onChange={(v) => patchField(i, { key: v.toLowerCase() })} placeholder="fieldKey" disabled={!canCreate} className="w-32" small />,
                <TextInput key="l" value={f.label} onChange={(v) => patchField(i, { label: v })} placeholder="Field label" disabled={!canCreate} className="w-32" small />,
                <span key="t" className="flex items-center gap-1.5">
                  <select
                    value={f.type}
                    onChange={(e) => {
                      const type = e.target.value as FieldType;
                      patchField(i, {
                        type,
                        align: type === 'currency' || type === 'number' || type === 'percent' ? 'right' : 'left',
                      });
                    }}
                    className="rounded px-1.5 py-1 text-[12px]"
                    style={{ border: '1px solid var(--line)' }}
                    disabled={!canCreate}
                  >
                    {Object.entries(FIELD_TYPE_LABELS).map(([k, v]) => (
                      <option key={k} value={k}>
                        {v}
                      </option>
                    ))}
                  </select>
                  {f.type === 'ref' ? (
                    <select
                      value={f.refType}
                      onChange={(e) => patchField(i, { refType: e.target.value as RefTarget })}
                      className="rounded px-1.5 py-1 text-[12px]"
                      style={{ border: '1px solid var(--line)' }}
                      disabled={!canCreate}
                    >
                      {REF_OPTIONS.map((r) => (
                        <option key={r} value={r}>
                          {r}
                        </option>
                      ))}
                    </select>
                  ) : null}
                </span>,
                <TextInput
                  key="o"
                  value={f.options.join(', ')}
                  onChange={(v) => patchField(i, { options: v.split(',').map((s) => s.trim()).filter(Boolean) })}
                  placeholder="Valid, Expired, Renewal pending"
                  disabled={!canCreate || (f.type !== 'select' && f.type !== 'status')}
                  className="w-48"
                  small
                />,
                <span key="fl" className="flex items-center gap-3 text-[12px]">
                  <label className="flex items-center gap-1">
                    <input
                      type="checkbox"
                      checked={f.required}
                      onChange={(e) => patchField(i, { required: e.target.checked })}
                      disabled={!canCreate}
                      style={{ accentColor: 'var(--accent)' }}
                    />
                    Req
                  </label>
                  <label className="flex items-center gap-1">
                    <input
                      type="checkbox"
                      checked={f.listColumn}
                      onChange={(e) => patchField(i, { listColumn: e.target.checked })}
                      disabled={!canCreate}
                      style={{ accentColor: 'var(--accent)' }}
                    />
                    List
                  </label>
                </span>,
                <span key="a" className="flex justify-end">
                  <Button variant="small" onClick={() => removeField(i)} disabled={!canCreate}>
                    Remove
                  </Button>
                </span>,
              ])
            }
            empty="No fields yet. Add the first field to begin."
          />
        </Panel>
      </div>

      <div className="mt-4 flex items-center gap-3">
        <Button variant="primary" onClick={() => void save()} className={busy ? 'opacity-60' : canCreate ? '' : 'opacity-50'}>
          {busy ? 'Creating…' : 'Create register'}
        </Button>
        <Chip tone="mute">saved as a record type</Chip>
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------
// Small local controls
// ---------------------------------------------------------------------------

function FieldRow({
  label,
  hint,
  required,
  children,
}: {
  label: string;
  hint?: string;
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
      {hint ? (
        <span className="mt-1 block text-[11px]" style={{ color: 'var(--faint)' }}>
          {hint}
        </span>
      ) : null}
    </label>
  );
}

function TextInput({
  value,
  onChange,
  placeholder,
  disabled,
  className,
  small,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
  small?: boolean;
}) {
  return (
    <input
      type="text"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      disabled={disabled}
      className={`${small ? 'px-1.5 py-1 text-[12.5px]' : 'px-2.5 py-1.5 text-[13px]'} ${className ?? 'w-full'} rounded`}
      style={{ border: '1px solid var(--line)', background: '#fff' }}
    />
  );
}

function Panel({
  title,
  sub,
  actions,
  children,
  bodyless,
}: {
  title?: string;
  sub?: string;
  actions?: React.ReactNode;
  children: React.ReactNode;
  bodyless?: boolean;
}) {
  return (
    <section className="rounded" style={{ background: 'var(--panel)', border: '1px solid var(--line)' }}>
      {title ? (
        <header className="flex items-center justify-between gap-3 px-4 py-3" style={{ borderBottom: '1px solid var(--line-2)' }}>
          <h3 className="m-0 text-[13.5px] font-semibold">
            {title}
            {sub ? (
              <span className="ml-2 font-normal text-[12px]" style={{ color: 'var(--muted)' }}>
                {sub}
              </span>
            ) : null}
          </h3>
          {actions}
        </header>
      ) : null}
      {bodyless ? children : <div className="p-4">{children}</div>}
    </section>
  );
}
