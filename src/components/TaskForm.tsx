'use client';

import { useState } from 'react';

import { records } from '@/lib/services';
import type { RecordField, RecordType } from '@/lib/types';

interface TaskFormProps {
  type: RecordType;
  /** Project the task belongs to. Scoping keeps a task off the wrong plant. */
  projectId: string;
  onCancel: () => void;
  onCreated: () => void;
}

/**
 * Record form driven entirely by the type definition.
 *
 * A task here is not a hand-built form. The server sends the field list and
 * this renders one input per field, so adding a field to the Tasks type shows
 * up here with no frontend change. That is the same engine every register uses.
 */
export function TaskForm({ type, projectId, onCancel, onCreated }: TaskFormProps) {
  const [values, setValues] = useState<Record<string, string>>(() =>
    initialValues(type.fields),
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    setError(null);

    // Server enforces required too, but failing here spares a round trip.
    for (const field of type.fields) {
      if (field.required && !String(values[field.key] ?? '').trim()) {
        setError(`${field.label} is required.`);
        return;
      }
    }

    setBusy(true);
    try {
      await records.create(type.key, {
        projectId,
        data: toData(type.fields, values),
      });
      onCreated();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Task could not be saved');
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
      aria-label="Add task"
    >
      <form
        onSubmit={submit}
        className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded"
        style={{ background: 'var(--panel)', border: '1px solid var(--line)' }}
      >
        <header
          className="flex items-center justify-between px-4 py-3"
          style={{ borderBottom: '1px solid var(--line-2)' }}
        >
          <h3 className="m-0 text-[14px] font-semibold">Add task</h3>
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

          {type.fields.map((field) => (
            <FieldInput key={field.key} field={field} value={values[field.key] ?? ''} onChange={(v) => setValues((prev) => ({ ...prev, [field.key]: v }))} />
          ))}

          <div className="flex items-center justify-end gap-2 pt-1">
            <button
              type="button"
              onClick={onCancel}
              className="rounded px-3.5 py-2 text-[12.5px] font-medium"
              style={{ border: '1px solid var(--line)', color: 'var(--ink)' }}
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={busy}
              className="rounded px-3.5 py-2 text-[12.5px] font-semibold text-white disabled:opacity-50"
              style={{ background: 'var(--accent)' }}
            >
              {busy ? 'Saving…' : 'Save task'}
            </button>
          </div>
        </div>
      </form>
    </div>
  );
}

function FieldInput({
  field,
  value,
  onChange,
}: {
  field: RecordField;
  value: string;
  onChange: (value: string) => void;
}) {
  const label = (
    <label className="block text-[11.5px] font-medium" style={{ color: 'var(--muted)' }}>
      {field.label}
      {field.required ? <span style={{ color: 'var(--red)' }}> *</span> : null}
    </label>
  );

  const shared = {
    value,
    onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
      onChange(e.target.value),
    className:
      'mt-1 w-full rounded px-2.5 py-2 text-[13px] outline-none',
    style: {
      background: 'var(--panel-2)',
      border: '1px solid var(--line)',
      color: 'var(--ink)',
    },
  };

  switch (field.type) {
    case 'textarea':
      return (
        <div>
          {label}
          <textarea rows={3} {...shared} />
        </div>
      );
    case 'date':
      return (
        <div>
          {label}
          <input type="date" {...shared} />
        </div>
      );
    case 'select':
    case 'status':
      return (
        <div>
          {label}
          <select {...shared}>
            {field.options.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
        </div>
      );
    case 'number':
    case 'currency':
    case 'percent':
      return (
        <div>
          {label}
          <input type="number" step="any" {...shared} />
        </div>
      );
    default:
      return (
        <div>
          {label}
          <input type="text" {...shared} />
        </div>
      );
  }
}

/** Default every field has to its default value, so a form opens sane. */
function initialValues(fields: RecordField[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const f of fields) out[f.key] = f.defaultValue ?? '';
  return out;
}

/**
 * Coerce form strings to the type the record engine expects.
 *
 * Dates go out as `YYYY-MM-DD`, which is what a date field is stored as.
 * Numbers go out as numbers, because the validator rejects strings where it
 * expects a number.
 */
function toData(fields: RecordField[], values: Record<string, string>): Record<string, unknown> {
  const data: Record<string, unknown> = {};

  for (const field of fields) {
    const raw = values[field.key] ?? '';
    const empty = raw.trim() === '';

    if (empty) {
      if (field.required) data[field.key] = '';
      else if (field.defaultValue) data[field.key] = field.defaultValue;
      continue;
    }

    switch (field.type) {
      case 'number':
      case 'currency':
      case 'percent':
        data[field.key] = Number(raw);
        break;
      case 'boolean':
        data[field.key] = raw === 'true';
        break;
      default:
        data[field.key] = raw;
        break;
    }
  }

  return data;
}
