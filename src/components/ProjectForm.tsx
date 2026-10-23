'use client';

import { useEffect, useMemo, useState } from 'react';

import { admin, projects as projectService } from '@/lib/services';
import type { CreateProjectInput, ManagerOption } from '@/lib/services';
import { Button } from '@/components/ui';

/**
 * Create-plant form.
 *
 * One plant, four possible delivery phases. The stage checkboxes are the point
 * of the form: what is ticked here becomes a real project row on the server, in
 * the same transaction as the plant. Untick EPC and no EPC project exists — the
 * plant is not "missing" it, the client simply did not buy it.
 *
 * The budget split shown beside each phase is a preview of what the backend
 * will assign. It mirrors the service's share map, so the number the user sees
 * before saving is the number that lands.
 */

const STAGES = ['pmc', 'epc', 'eptp', 'om'] as const;
type Stage = (typeof STAGES)[number];

const STAGE_LABEL: Record<Stage, string> = {
  pmc: 'PMC — Project Management Consultancy',
  epc: 'EPC — Engineering, Procurement and Construction',
  eptp: 'EPTP — Engineering, Procurement and Testing',
  om: 'O&M — Operation and Maintenance',
};

const STAGE_SHORT: Record<Stage, string> = {
  pmc: 'PMC',
  epc: 'EPC',
  eptp: 'EPTP',
  om: 'O&M',
};

/** Must match the backend service's split. */
const STAGE_SHARE: Record<Stage, number> = {
  pmc: 0.05,
  eptp: 0.05,
  epc: 0.7,
  om: 0.1,
};

interface ProjectFormProps {
  onCancel: () => void;
  onSubmit: (body: CreateProjectInput) => Promise<void>;
}

export function ProjectForm({ onCancel, onSubmit }: ProjectFormProps) {
  const [clients, setClients] = useState<{ id: string; name: string }[]>([]);
  const [managers, setManagers] = useState<ManagerOption[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [location, setLocation] = useState('');
  const [technology, setTechnology] = useState('Bio-CNG');
  const [clientId, setClientId] = useState('');
  const [managerId, setManagerId] = useState('');
  const [pm, setPm] = useState('');
  const [capacityTpd, setCapacityTpd] = useState('0');
  const [contractValue, setContractValue] = useState('0');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [enabledStages, setEnabledStages] = useState<Stage[]>([...STAGES]);

  useEffect(() => {
    Promise.all([admin.clients(), admin.managers()])
      .then(([cl, ms]) => {
        setClients(cl.map((c) => ({ id: c.id, name: c.name })));
        setManagers(ms);
        if (cl.length === 1) setClientId(cl[0].id);
      })
      .catch(() => {
        setClients([]);
        setManagers([]);
      });
  }, []);

  const value = Number(contractValue) || 0;

  const preview = useMemo(
    () =>
      STAGES.filter((s) => enabledStages.includes(s)).map((s) => ({
        stage: s,
        amount: Math.round(value * STAGE_SHARE[s]),
      })),
    [enabledStages, value],
  );

  function toggle(stage: Stage): void {
    setEnabledStages((list) =>
      list.includes(stage) ? list.filter((s) => s !== stage) : [...list, stage],
    );
  }

  async function submit(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    setError(null);

    if (!name.trim() || !code.trim()) {
      setError('Name and code are required.');
      return;
    }
    if (!clientId) {
      setError('Choose a client.');
      return;
    }
    if (enabledStages.length === 0) {
      setError('Tick at least one delivery phase.');
      return;
    }

    setBusy(true);
    try {
      await onSubmit({
        name: name.trim(),
        code: code.trim().toUpperCase(),
        location: location.trim(),
        technology: technology.trim() || 'Bio-CNG',
        pm: pm.trim(),
        managerId: managerId || undefined,
        clientId,
        capacityTpd: Number(capacityTpd) || 0,
        contractValue: value,
        startDate,
        endDate,
        enabledStages,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Create failed');
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
      aria-label="Create project"
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
          <h3 className="m-0 text-[14px] font-semibold">Create project</h3>
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

          <Row>
            <Field label="Plant name" required>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="w-full rounded px-2.5 py-1.5 text-[13px]"
                style={{ border: '1px solid var(--line)', background: '#fff' }}
                placeholder="Kanpur Plant"
              />
            </Field>
            <Field label="Code" required>
              <input
                value={code}
                onChange={(e) => setCode(e.target.value.toUpperCase())}
                className="num w-full rounded px-2.5 py-1.5 text-[13px]"
                style={{ border: '1px solid var(--line)', background: '#fff' }}
                placeholder="KNP"
              />
            </Field>
          </Row>

          <Row>
            <Field label="Client" required>
              <select
                value={clientId}
                onChange={(e) => setClientId(e.target.value)}
                className="w-full rounded px-2.5 py-1.5 text-[13px]"
                style={{ border: '1px solid var(--line)', background: '#fff' }}
              >
                <option value="">Choose a client…</option>
                {clients.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Location">
              <input
                value={location}
                onChange={(e) => setLocation(e.target.value)}
                className="w-full rounded px-2.5 py-1.5 text-[13px]"
                style={{ border: '1px solid var(--line)', background: '#fff' }}
                placeholder="Rooma Industrial Area, Kanpur (UP)"
              />
            </Field>
          </Row>

          <Row>
            <Field label="Technology">
              <input
                value={technology}
                onChange={(e) => setTechnology(e.target.value)}
                className="w-full rounded px-2.5 py-1.5 text-[13px]"
                style={{ border: '1px solid var(--line)', background: '#fff' }}
              />
            </Field>
            <Field label="Capacity (TPD)">
              <input
                type="number"
                min={0}
                value={capacityTpd}
                onChange={(e) => setCapacityTpd(e.target.value)}
                className="num w-full rounded px-2.5 py-1.5 text-[13px]"
                style={{ border: '1px solid var(--line)', background: '#fff' }}
              />
            </Field>
          </Row>

          <Row>
            <Field label="Project manager">
              <select
                value={managerId}
                onChange={(e) => {
                  setManagerId(e.target.value);
                  const chosen = managers.find((m) => m.id === e.target.value);
                  setPm(chosen ? chosen.name : '');
                }}
                className="w-full rounded px-2.5 py-1.5 text-[13px]"
                style={{ border: '1px solid var(--line)', background: '#fff' }}
              >
                <option value="">No project manager yet</option>
                {managers.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name} — {m.role.replace(/[-_]/g, ' ')}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Contract value (₹ L)">
              <input
                type="number"
                min={0}
                value={contractValue}
                onChange={(e) => setContractValue(e.target.value)}
                className="num w-full rounded px-2.5 py-1.5 text-[13px]"
                style={{ border: '1px solid var(--line)', background: '#fff' }}
              />
            </Field>
          </Row>

          <Row>
            <Field label="Start date">
              <input
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                className="w-full rounded px-2.5 py-1.5 text-[13px]"
                style={{ border: '1px solid var(--line)', background: '#fff' }}
              />
            </Field>
            <Field label="End date">
              <input
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                className="w-full rounded px-2.5 py-1.5 text-[13px]"
                style={{ border: '1px solid var(--line)', background: '#fff' }}
              />
            </Field>
          </Row>

          <div>
            <div className="mb-1.5 text-[12.5px] font-medium">Delivery phases</div>
            <p className="mb-2 mt-0 text-[12px]" style={{ color: 'var(--muted)' }}>
              Each ticked phase becomes its own project, with its own budget, team and approvals.
            </p>
            <div className="grid gap-2">
              {STAGES.map((s) => {
                const on = enabledStages.includes(s);
                const amount = preview.find((p) => p.stage === s)?.amount ?? 0;
                return (
                  <label
                    key={s}
                    className="flex cursor-pointer items-center justify-between gap-3 rounded px-3 py-2"
                    style={{
                      border: `1px solid ${on ? 'var(--accent)' : 'var(--line)'}`,
                      background: on ? 'var(--accent-soft)' : '#fff',
                    }}
                  >
                    <span className="flex items-center gap-2.5">
                      <input
                        type="checkbox"
                        checked={on}
                        onChange={() => toggle(s)}
                        className="h-4 w-4"
                      />
                      <span className="text-[13px]">{STAGE_LABEL[s]}</span>
                    </span>
                    <span className="num text-[12.5px]" style={{ color: 'var(--muted)' }}>
                      {on ? `₹${amount.toLocaleString('en-IN')} L` : '—'}
                    </span>
                  </label>
                );
              })}
            </div>
          </div>
        </div>

        <footer
          className="flex justify-end gap-2 px-4 py-3"
          style={{ borderTop: '1px solid var(--line-2)' }}
        >
          <Button onClick={onCancel}>Cancel</Button>
          <Button type="submit" variant="primary" className={busy ? 'opacity-60' : ''}>
            {busy ? 'Creating…' : `Create plant + ${enabledStages.length} stage${enabledStages.length === 1 ? '' : 's'}`}
          </Button>
        </footer>
      </form>
    </div>
  );
}

function Row({ children }: { children: React.ReactNode }) {
  return <div className="grid gap-3 sm:grid-cols-2">{children}</div>;
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
      <span className="mb-1 block text-[12px]" style={{ color: 'var(--muted)' }}>
        {label}
        {required ? ' *' : ''}
      </span>
      {children}
    </label>
  );
}

export { STAGE_SHORT };
